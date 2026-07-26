const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = 'UserTable-dev';

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
    const body = parseRequestBody(event);
    
    // Extract email from Cognito authenticated user
    const claims = event.requestContext?.authorizer?.claims ??
        event.requestContext?.authorizer?.jwt?.claims ?? {};
    const email = claims['cognito:username'];
    const userId = claims['custom:userId'];
    
    if (!email || !userId) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Unauthorized: No email or user ID found in token' })
        };
    }
    
    console.log('Authenticated user email:', email);
    console.log('Authenticated user ID:', userId);
    return {
        statusCode: 200,
        body: JSON.stringify({ userId, email })
    };
};