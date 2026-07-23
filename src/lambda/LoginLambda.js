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
    
    if (!email) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Unauthorized: No email found in token' })
        };
    }
    
    console.log('Authenticated user email:', email);
    
    try {
        // Query UserTable by email to get user record and extract user ID
        const queryParams = {
            TableName: tableName,
            IndexName: 'EmailIndex',
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: {
                ':email': email
            }
        };
        
        const result = await docClient.send(new QueryCommand(queryParams));
        
        if (!result.Items || result.Items.length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'User not found' })
            };
        }
        
        const userRecord = result.Items[0];
        const userId = userRecord.userId; // Adjust field name based on your schema
        
        console.log('User ID:', userId);
        
        // Your login logic here
        return {
            statusCode: 200,
            body: JSON.stringify({ userId, email })
        };
        
    } catch (error) {
        console.error('Error querying user table:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};