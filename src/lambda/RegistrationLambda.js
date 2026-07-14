const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");

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

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

exports.handler = async (event = {}) => {
    const body = parseRequestBody(event);
    const email = body.email || body.Email;
    const firstName = body.firstName || body.first_name || body['first name'];
    const lastName = body.lastName || body.last_name || body['last name'];
    const age = body.age ?? body.aga;
    const gender = body.gender || body.Gender;

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
        const existingUsersResponse = await docClient.send(new ScanCommand({
            TableName: tableName,
            FilterExpression: 'email = :email',
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
        const params = {
            TableName: tableName,
            Item: {
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
                    email,
                    firstName,
                    lastName,
                    otp
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