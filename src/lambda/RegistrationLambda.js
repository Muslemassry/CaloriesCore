const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = 'HistoryIntake-dev';
exports.handler = async () => {
    const params = {
        TableName: tableName
    };
    try {
        console.log('Fetching history items from table:', tableName);
        const data = await docClient.send(new ScanCommand(params));
        if (!data.Items || data.Items.length === 0) {
            throw new Error('Exception: No history items found in the database');
        }
        console.log('Successfully fetched', data.Items.length, 'history items');
        return {
            statusCode: 200,
            body: JSON.stringify(data.Items)
        };
    } catch (error) {
        console.error('Error fetching history items:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Error fetching history items', error })
        };
    }
};