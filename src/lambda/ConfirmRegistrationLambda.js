const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const {
    CognitoIdentityProviderClient,
    AdminConfirmSignUpCommand
} = require("@aws-sdk/client-cognito-identity-provider");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const cognitoClient = new CognitoIdentityProviderClient({});
const tableName = process.env.USER_TABLE_NAME || 'UserTable-dev';
const userPoolId = process.env.USER_POOL_ID;

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
    const email = body.email || body.Email;
    const otp = body.otp || body.OTP || body.Otp;

    if (!email || !otp) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                message: 'Request body must include email and otp',
                received: body
            })
        };
    }

    try {
        const queryResult = await docClient.send(new QueryCommand({
            TableName: tableName,
            IndexName: 'EmailIndex',
            KeyConditionExpression: 'email = :email',
            ExpressionAttributeValues: {
                ':email': email
            }
        }));

        const user = queryResult.Items?.[0];

        if (!user) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: 'Invalid Credentials' })
            };
        }

        if (user.verified) {
            return {
                statusCode: 409,
                body: JSON.stringify({ message: 'Invalid Credentials' })
            };
        }

        if (user.otp !== otp) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Invalid Credentials' })
            };
        }

        const now = new Date().toISOString();
        const otpExpiresAt = user.otpExpiresAt;

        if (otpExpiresAt && now > otpExpiresAt) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: 'Invalid Credentials' })
            };
        }

        await docClient.send(new UpdateCommand({
            TableName: tableName,
            Key: { userId: user.userId },
            UpdateExpression: 'SET verified = :verified, updatedAt = :updatedAt REMOVE otp, otpExpiresAt',
            ExpressionAttributeValues: {
                ':verified': true,
                ':updatedAt': new Date().toISOString()
            }
        }));

        // Add user to Cognito User Pool
        try {
            await cognitoClient.send(new AdminConfirmSignUpCommand({
                UserPoolId: userPoolId,
                Username: email
            }));
            console.log('User confirmed in Cognito User Pool:', email);
        } catch (cognitoError) {
            console.error('Error confirming user in Cognito:', cognitoError);
            // Continue even if Cognito confirmation fails, as user is already verified in DynamoDB
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'User confirmed successfully', email })
        };
    } catch (error) {
        console.error('Error confirming registration:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Error confirming registration' })
        };
    }
};