const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, ScanCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const s3Client = new S3Client({});
const tableName = process.env.Food_Analysis_Request_Table_Name;
const bucketName = process.env.Uploading_Bucket_Name;

const parseRequestBody = (event = {}) => {
    if (!event.body) {
        return {};
    }

    if (typeof event.body === 'string') {
        try {
            console.log('Raw body received:', JSON.stringify(event.body));
            return JSON.parse(event.body);
        } catch (error) {
            console.error('Invalid JSON body:', error);
            return {};
        }
    }

    return event.body;
};


const CORS_ALLOWED_ORIGIN = process.env.CORS_ALLOWED_ORIGIN || "*";
const withCors = (handler) => async (event, context) => {
    const response = await handler(event, context);
    return {
        ...response,
        headers: {
            ...(response && response.headers ? response.headers : {}),
            "Access-Control-Allow-Origin": CORS_ALLOWED_ORIGIN
        }
    };
};

exports.handler = withCors(async (event = {}) => {
    const claims = event.requestContext?.authorizer?.claims ??
        event.requestContext?.authorizer?.jwt?.claims ?? {};
    const email = claims['cognito:username'];
    const userId = claims['custom:user_id'];
    const body = parseRequestBody(event);
    const imageId = body.imageId;

    if (!email || !userId) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Authentication required' })
        };
    }

    if (!tableName) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Service configuration is missing' })
        };
    }

    const safeEmail = email.replace(/[^a-zA-Z0-9._-]/g, '-');

    if (!imageId) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: 'Incorrect data',
                reason: 'Missing custom:imageId claim',
                userId
            })
        };
    }

    const expectedPrefix = `${userId}-${safeEmail}`;
    if (!imageId.startsWith(expectedPrefix)) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: 'Incorrect data',
                reason: 'imageId does not match the expected prefix',
                imageId,
                expectedPrefix
            })
        };
    }

    const result = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: {
            requestId: imageId,
            userId: Number(userId)
        }
    }));

    const item = result.Item;

    if (!item) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: 'Incorrect data',
                reason: 'No analysis request found for this id and user',
                requestId: imageId,
                userId: Number(userId),
                tableName
            })
        };
    }

    if (item.status !== 'PROCESSED') {
        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'IN_PROGRESS' })
        };
    }

    let analysis = {};
    try {
        analysis = typeof item.meal_analysis === 'string'
            ? JSON.parse(item.meal_analysis)
            : item.meal_analysis;
    } catch (error) {
        console.error('Failed to parse stored meal analysis', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Stored meal analysis is malformed' })
        };
    }

    const totalNutrition = analysis.total_nutrition || {};

    return {
        statusCode: 200,
        body: JSON.stringify({
            status: item.status,
            mealName: analysis.dish_name ?? '',
            confidence: analysis.confidence ?? null,
            detectedItems: Array.isArray(analysis.items)
                ? analysis.items.map((entry) => entry?.name).filter(Boolean)
                : [],
            note: analysis.note ?? '',
            macros: {
                proteinG: Number(totalNutrition.protein_g ?? 0),
                carbsG: Number(totalNutrition.carbs_g ?? 0),
                fatG: Number(totalNutrition.fat_g ?? 0),
                fiberG: Number(totalNutrition.fiber_g ?? 0)
            }
        })
    };
});