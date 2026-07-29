const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const { RekognitionClient, DetectLabelsCommand } = require("@aws-sdk/client-rekognition");
const { BedrockRuntimeClient, InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");

const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const rekognitionClient = new RekognitionClient({});
const bedrockClient = new BedrockRuntimeClient({});
const tableName = process.env.Food_Analysis_Request_Table_Name;

const MODEL_ID = "global.anthropic.claude-sonnet-4-5-20250929-v1:0";

const FOOD_KEYWORDS = ["Food", "Meal", "Dish", "Beverage", "Produce", "Snack", "Dining"];
const MIN_CONFIDENCE = 75;

const getImageBuffer = async (bucketName, objectKey) => {
    const getObjectCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
    });

    const response = await s3Client.send(getObjectCommand);

    if (!response.Body) {
        throw new Error(`S3 object is empty for ${bucketName}/${objectKey}`);
    }

    const imageBuffer = await response.Body.transformToByteArray();
    return Buffer.from(imageBuffer);
};

const getUserIdFromRequestId = (requestId) => {
    const match = requestId?.match(/^(\d+)-/);
    return match ? Number(match[1]) : null;
};

const invokeBedrockModel = async (prompt, imageBase64) => {
    const requestBody = {
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1000,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: prompt,
                    },
                    {
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: "image/jpeg",
                            data: imageBase64,
                        },
                    },
                ],
            },
        ],
    };

    const command = new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify(requestBody),
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    return responseBody.content?.[0]?.text || JSON.stringify(responseBody);
};

const normalizeDynamoDbValue = (value) => {
    if (value === null || value === undefined) {
        return null;
    }

    if (Array.isArray(value)) {
        return value.map(normalizeDynamoDbValue);
    }

    if (typeof value !== "object") {
        return value;
    }

    if (Object.prototype.hasOwnProperty.call(value, "S")) {
        return value.S;
    }

    if (Object.prototype.hasOwnProperty.call(value, "N")) {
        return Number(value.N);
    }

    if (Object.prototype.hasOwnProperty.call(value, "BOOL")) {
        return value.BOOL;
    }

    if (Object.prototype.hasOwnProperty.call(value, "NULL") && value.NULL) {
        return null;
    }

    if (Object.prototype.hasOwnProperty.call(value, "L")) {
        return value.L.map(normalizeDynamoDbValue);
    }

    if (Object.prototype.hasOwnProperty.call(value, "M")) {
        return Object.fromEntries(
            Object.entries(value.M).map(([key, nestedValue]) => [key, normalizeDynamoDbValue(nestedValue)])
        );
    }

    if (Object.prototype.hasOwnProperty.call(value, "SS")) {
        return value.SS;
    }

    if (Object.prototype.hasOwnProperty.call(value, "NS")) {
        return value.NS.map(Number);
    }

    return value;
};

exports.handler = async (event = {}) => {
    try {
        const bucketName = event?.detail?.bucket?.name
            ?? event?.Records?.[0]?.s3?.bucket?.name
            ?? null;

        const objectKey = event?.detail?.object?.key
            ?? event?.Records?.[0]?.s3?.object?.key
            ?? null;

        const fileName = objectKey
            ? objectKey.split("/").filter(Boolean).pop() || objectKey
            : null;

        console.log("Extracted S3 event data:", { bucketName, objectKey, fileName });

        if (!bucketName || !objectKey) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: "Missing S3 bucket or object key",
                    bucketName,
                    objectKey,
                }),
            };
        }

        const userId = getUserIdFromRequestId(fileName);
        console.log("Resolved request metadata:", { fileName, userId, tableName });

        console.log("Updating request status to IN_PROGRESS");
        await docClient.send(new UpdateCommand({
            TableName: tableName,
            Key: {
                requestId: fileName,
                userId,
            },
            UpdateExpression: "SET #status = :status",
            ExpressionAttributeNames: {
                "#status": "status"
            },
            ExpressionAttributeValues: {
                ":status": "IN_PROGRESS"
            },
            ReturnValues: "UPDATED_NEW"
        }));
        console.log("Request status updated successfully");

        const imageBuffer = await getImageBuffer(bucketName, objectKey);
        console.log("Image downloaded successfully", { size: imageBuffer.length });
        const imageBase64 = imageBuffer.toString("base64");

        const detectLabelsCommand = new DetectLabelsCommand({
            Image: {
                Bytes: imageBuffer,
            },
            MaxLabels: 10,
            MinConfidence: MIN_CONFIDENCE,
        });

        const labelsResponse = await rekognitionClient.send(detectLabelsCommand);
        const detectedLabels = (labelsResponse.Labels || [])
            .map((label) => label.Name)
            .filter(Boolean);

        console.log("Detected labels:", detectedLabels);

        const containsFood = detectedLabels.some((label) =>
            FOOD_KEYWORDS.some((keyword) => label.toLowerCase().includes(keyword.toLowerCase()))
        );

        console.log("Food detection result:", { containsFood, detectedLabels });

        if (!containsFood) {
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: "Image does not appear to contain food",
                    detectedLabels,
                }),
            };
        }

        console.log("Food detected by Rekognition. Proceeding to Bedrock analysis...");

        const prompt = `
          Analyze this food image and provide a detailed nutritional estimate. 
          Return strictly valid JSON with no markdown formatting around it:
          {
            "dish_name": "Name of the meal",
            "items": [
              {
                "name": "Item name",
                "portion_estimate": "Estimated weight or portion",
                "calories": 250,
                "protein_g": 20,
                "carbs_g": 15,
                "fat_g": 10
              }
            ],
            "total_nutrition": {
              "calories": 0,
              "protein_g": 0,
              "carbs_g": 0,
              "fat_g": 0
            }
          }
        `;

        console.log("Invoking Bedrock");
        const bedrockResponseText = await invokeBedrockModel(prompt, imageBase64);
        console.log("Bedrock response:", bedrockResponseText);

        let parsedMealAnalysis = null;
        try {
            let cleanedText = (bedrockResponseText || "").trim();

            const fencedMatch = cleanedText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
            if (fencedMatch && fencedMatch[1]) {
                cleanedText = fencedMatch[1].trim();
            } else if (cleanedText.startsWith("```")) {
                cleanedText = cleanedText.replace(/^```[a-zA-Z]*\s*/i, "").replace(/\s*```$/i, "");
            }

            const jsonObjectMatch = cleanedText.match(/\{[\s\S]*\}/);
            if (jsonObjectMatch) {
                cleanedText = jsonObjectMatch[0];
            }

            const parsedRawMealAnalysis = JSON.parse(cleanedText.trim());
            parsedMealAnalysis = normalizeDynamoDbValue(parsedRawMealAnalysis);
        } catch (parseError) {
            console.warn("Bedrock response was not valid JSON. Storing as string.", parseError);
            parsedMealAnalysis = bedrockResponseText;
        }

        await docClient.send(new UpdateCommand({
            TableName: tableName,
            Key: {
                requestId: fileName,
                userId,
            },
            UpdateExpression: "SET #status = :status, #mealAnalysis = :mealAnalysis",
            ExpressionAttributeNames: {
                "#status": "status",
                "#mealAnalysis": "meal_analysis"
            },
            ExpressionAttributeValues: {
                ":status": "PROCESSED",
                ":mealAnalysis": parsedMealAnalysis
            },
            ReturnValues: "UPDATED_NEW"
        }));
        console.log("Request status updated to PROCESSED with meal analysis");

        return {
            bucketName,
            objectKey,
            fileName,
            contentType: "image/jpeg",
            imageSize: imageBuffer.length,
            bedrockResponse: parsedMealAnalysis,
            tableName,
        };
    } catch (error) {
        console.error("Food analysis handler failed", error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: "Food analysis handler failed",
                error: error.message,
            }),
        };
    }
};