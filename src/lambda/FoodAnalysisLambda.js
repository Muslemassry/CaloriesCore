const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");
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
            return JSON.parse(event.body);
        } catch (error) {
            console.error('Invalid JSON body:', error);
            return {};
        }
    }

    return event.body;
};

exports.handler = async (event = {}) => {
    const claims = event.requestContext?.authorizer?.claims ??
        event.requestContext?.authorizer?.jwt?.claims ?? {};
    const email = claims['cognito:username'];
    const userId = claims['custom:user_id'];

    const body = parseRequestBody(event);
    const imageName = body.name;
    const contentType = body.contentType || 'application/octet-stream';
    const safeEmail = email.replace(/[^a-zA-Z0-9._-]/g, '-');
    const safeImageName = (imageName || 'image').replace(/[^a-zA-Z0-9._-]/g, '-');
    const imageId = `${userId}-${safeEmail}-${Date.now()}-${safeImageName}`;
    const objectKey = `uploads/${imageId}`;

    const putObjectCommand = new PutObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        ContentType: contentType,
        Metadata: {
            userId: userId,
            email: email,
            imageId
        }
    });

    const presignedUrl = await getSignedUrl(s3Client, putObjectCommand, { expiresIn: 3600 });

    const requestItem = {
        requestId: imageId,
        userId: Number(userId),
        status: 'init',
        bucket: bucketName,
        key: objectKey,
        contentType,
        createdAt: new Date().toISOString()
    };

    await docClient.send(new PutCommand({
        TableName: tableName,
        Item: requestItem
    }));

    console.log('Generated imageId:', imageId);
    console.log('Generated presignedUrl:', presignedUrl);

    return {
        statusCode: 200,
        body: JSON.stringify({
            imageId,
            objectKey,
            presignedUrl
        })
    };
};