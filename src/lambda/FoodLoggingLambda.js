const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const mealLogTableName = 'MealLog-dev';
const dayIntakeTableName = 'DayIntake-dev';

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
        
    } catch (error) {
        console.error('Error querying user table:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }


    const body = parseRequestBody(event);
    const userID = userId; 
    const carb = body.carb;
    const protein = body.protein;
    const fat = body.fat;
    const calories = body.calories;

    if (!userID || carb == null || protein == null || fat == null || calories == null) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                message: 'Request body must include userID, carb, protein, fat, and calories',
                received: body
            })
        };
    }

    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const mealLogItem = {
        userId: Number(userID),
        date,
        carb: Number(carb),
        protein: Number(protein),
        fat: Number(fat),
        calories: Number(calories),
        createdAt: now.toISOString()
    };

    try {
        await docClient.send(new PutCommand({
            TableName: mealLogTableName,
            Item: mealLogItem
        }));

        const updateParams = {
            TableName: dayIntakeTableName,
            Key: {
                userId: Number(userID)
            },
            UpdateExpression: 'SET carb = if_not_exists(carb, :zero) + :carb, protein = if_not_exists(protein, :zero) + :protein, fat = if_not_exists(fat, :zero) + :fat, calories = if_not_exists(calories, :zero) + :calories, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':zero': 0,
                ':carb': Number(carb),
                ':protein': Number(protein),
                ':fat': Number(fat),
                ':calories': Number(calories),
                ':updatedAt': now.toISOString()
            },
            ReturnValues: 'ALL_NEW'
        };

        const updateResult = await docClient.send(new UpdateCommand(updateParams));

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Meal log created and day intake updated',
                mealLog: mealLogItem,
                dayIntake: updateResult.Attributes
            })
        };
    } catch (error) {
        console.error('Error logging food intake:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Error logging food intake' })
        };
    }
};