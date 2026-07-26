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
    
    const claims = event.requestContext?.authorizer?.claims ??
        event.requestContext?.authorizer?.jwt?.claims ?? {};
    const email = claims['cognito:username'];
    const userId = claims['custom:user_id'];
    
    try {
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
    } catch (error) {
        console.error('Error querying user table:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
    
    console.log('Authenticated user email:', email);
    console.log('Authenticated user ID:', userId);
    return {
        statusCode: 200,
        body: JSON.stringify({ userId, email })
    };
};