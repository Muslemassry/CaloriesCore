const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const tableName = process.env.Food_Analysis_Request_Table_Name;

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

exports.handler = async (event = {}) => {
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

    const imageBuffer = await getImageBuffer(bucketName, objectKey);
    const imageBase64 = imageBuffer.toString("base64");

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

    return {
        bucketName,
        objectKey,
        fileName,
        contentType: "image/jpeg",
        imageSize: imageBuffer.length,
        imageBase64,
        tableName,
    };
};