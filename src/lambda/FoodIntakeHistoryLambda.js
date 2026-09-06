const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env.HISTORY_INTAKE_TABLE_NAME || 'HistoryIntake-dev';
exports.handler = async (event = {}) => {
    const claims = event.requestContext?.authorizer?.claims ??
        event.requestContext?.authorizer?.jwt?.claims ?? {};
    const rawUserId = claims['custom:user_id'];
    const userId = Number(rawUserId);

    if (!Number.isFinite(userId)) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Authentication required' })
        };
    }

    const params = {
        TableName: tableName,
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId }
    };
    try {
        console.log('Fetching history items from table:', tableName);
        const data = await docClient.send(new QueryCommand(params));
        if (!data.Items || data.Items.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify([])
            };
        }
        console.log('Successfully fetched.', data.Items.length, 'history items');
        return {
            statusCode: 200,
            body: JSON.stringify(data.Items)
        };
    } catch (error) {
        console.error('Error fetching history items:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Error fetching history items' })
        };
    }
};