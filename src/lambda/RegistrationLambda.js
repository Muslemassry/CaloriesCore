const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env.USER_TABLE_NAME || 'UserTable-dev';
const counterTableName = process.env.USER_ID_COUNTER_TABLE_NAME || 'UserIdCounter-dev';

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

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const getNextUserId = async () => {
    const params = {
        TableName: counterTableName,
        Key: { counterName: 'UserTable' },
        UpdateExpression: 'ADD #v :incr',
        ExpressionAttributeNames: {
            '#v': 'currentValue'
        },
        ExpressionAttributeValues: {
            ':incr': 1
        },
        ReturnValues: 'UPDATED_NEW'
    };

    const result = await docClient.send(new UpdateCommand(params));
    return Number(result.Attributes?.currentValue || 0);
};

exports.handler = async (event = {}) => {
    const body = parseRequestBody(event);
    const email = body.email
    const firstName = body.firstName;
    const lastName = body.lastName;
    const age = body.age;
    const gender = body.gender

    if (!email || !firstName || !lastName || age === undefined || !gender) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                message: 'Missing required registration fields',
                received: body
            })
        };
    }

    try {
        const existingUsersResponse = await docClient.send(new QueryCommand({
            TableName: tableName,
            IndexName: 'EmailIndex',
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: {
                ':email': email
            }
        }));

        const existingUser = existingUsersResponse.Items?.[0];

        if (existingUser?.verified === true) {
            return {
                statusCode: 409,
                body: JSON.stringify({
                    message: 'User is already verified'
                })
            };
        }

        const otp = generateOtp();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        const userId = existingUser?.userId || await getNextUserId();
        const params = {
            TableName: tableName,
            Item: {
                userId,
                email,
                firstName,
                lastName,
                age: Number(age),
                gender,
                createdAt: existingUser?.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                verified: false,
                otp,
                otpExpiresAt
            }
        };

        await docClient.send(new PutCommand(params));

        return {
            statusCode: 201,
            body: JSON.stringify({
                message: 'OTP generated successfully',
                user: {
                    userId,
                    email,
                    firstName,
                    lastName
                }
            })
        };
    } catch (error) {
        console.error('Error registering user:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Error registering user', error })
        };
    }
};