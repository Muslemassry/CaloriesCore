const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const sesClient = new SESClient({ region: "us-east-1" });
const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env.USER_TABLE_NAME || 'UserTable-dev';
const sourceEmail = process.env.SOURCE_EMAIL || "m.amaragy@gmail.com";

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

const sendOtpEmail = async (recipientName, recipientEmail, otpCode) => {
    const params = {
        Source: sourceEmail, // Must be a verified identity in SES
        Destination: {
            ToAddresses: [recipientEmail],
        },
        Message: {
            Subject: {
                Data: "Your BiteIQ password reset code",
                Charset: "UTF-8",
            },
            Body: {
                Html: {
                    Data: `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 8px;">
              <h2 style="color: #16a34a; margin: 0 0 16px;">BiteIQ — Reset your password</h2>
              <p style="color: #374151;">Hi ${recipientName},</p>
              <p style="color: #374151;">Use the verification code below to reset your BiteIQ password:</p>
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111827; background: #f3f4f6; padding: 16px; text-align: center; border-radius: 8px; margin: 24px 0;">${otpCode}</div>
              <p style="color: #6b7280; font-size: 14px;">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
            </div>
          `,
                    Charset: "UTF-8",
                },
                Text: {
                    Data: [
                        `Hi ${recipientName},`,
                        ``,
                        `Use the following code to reset your BiteIQ password: ${otpCode}`,
                        ``,
                        `This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.`
                    ].join("\n"),
                    Charset: "UTF-8",
                },
            },
        },
    };

    const command = new SendEmailCommand(params);
    return await sesClient.send(command);
};

const EMAIL_REGEX = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;

const sendError = (statusCode, code, message) => ({
    statusCode,
    body: JSON.stringify({
        success: false,
        error: { code, message }
    })
});

const successResponse = () => ({
    statusCode: 200,
    body: JSON.stringify({
        message: "If an account exists for this email address, a verification code has been sent."
    })
});

exports.handler = async (event = {}) => {
    const body = parseRequestBody(event);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!email) {
        return sendError(422, 'VALIDATION_ERROR', 'Email is required.');
    }

    if (!EMAIL_REGEX.test(email)) {
        return sendError(422, 'VALIDATION_ERROR', 'A valid email address is required.');
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
            // Do not reveal whether an account exists for the given email.
            console.log('Forgot password requested for unknown email');
            return successResponse();
        }

        const otp = generateOtp();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        const updatedAt = new Date().toISOString();

        await sendOtpEmail(user.name, email, otp);
        await docClient.send(new UpdateCommand({
            TableName: tableName,
            Key: { userId: user.userId },
            UpdateExpression: 'SET forgotPasswortOTP = :otp, forgotPasswortOTPExpiresAt = :expiresAt, forgotPasswortOTPVerified = :verified, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':otp': otp,
                ':expiresAt': otpExpiresAt,
                ':verified': false,
                ':updatedAt': updatedAt
            }
        }));

        return successResponse();
    } catch (error) {
        console.error('Error processing forgot password request:', error);
        // Return the same generic response on failure to avoid leaking account existence.
        return successResponse();
    }
};
