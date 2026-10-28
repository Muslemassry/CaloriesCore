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
    const imageId = claims['custom:imageId'];

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
            body: JSON.stringify({ error: 'Incorrect data' })
        };
    }

    const expectedPrefix = `${userId}-${safeEmail}`;
    if (!imageId.startsWith(expectedPrefix)) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Incorrect data' })
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
            body: JSON.stringify({ error: 'Incorrect data' })
        };
    }

    if (item.status !== 'PROCESSED') {
        return {
            statusCode: 200,
            body: JSON.stringify({ status: 'IN_PROGRESS' })
        };
    }

    return {
        statusCode: 200,
        body: JSON.stringify({
            bedrockResponse: item.meal_analysis
        })
    };
});