const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const sesClient = new SESClient({ region: "us-east-1" });
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

const sendOtpEmail = async (recipientEmail, otpCode) => {
  const params = {
    Source: "m.amaragy@gmail.com", // Must be a verified identity in SES
    Destination: {
      ToAddresses: [recipientEmail],
    },
    Message: {
      Subject: {
        Data: "Your Verification Code",
        Charset: "UTF-8",
      },
      Body: {
        Html: {
          Data: `
            <h1>Registration Verification</h1>
            <p>Your OTP code is: <strong>${otpCode}</strong></p>
            <p>This code expires in 10 minutes.</p>
          `,
          Charset: "UTF-8",
        },
        Text: {
          Data: `Your OTP code is: ${otpCode}`,
          Charset: "UTF-8",
        },
      },
    },
  };

  const command = new SendEmailCommand(params);
  return await sesClient.send(command);
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

const EMAIL_REGEX = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;

const validateRegistration = ({ name, email, password } = {}) => {
    const normalizedName = typeof name === 'string' ? name.trim() : '';
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!normalizedName) {
        return { error: 'Name is required.' };
    }

    if (!EMAIL_REGEX.test(normalizedEmail)) {
        return { error: 'A valid email address is required.' };
    }

    if (
        typeof password !== 'string' ||
        password.length < 8 ||
        !/[A-Z]/.test(password) ||
        !/[0-9]/.test(password)
    ) {
        return { error: 'Password must be at least 8 characters long and include at least one uppercase letter and one number.' };
    }

    return { name: normalizedName, email: normalizedEmail };
};

const sendError = (statusCode, code, message) => ({
    statusCode,
    body: JSON.stringify({
        success: false,
        error: { code, message }
    })
});

exports.handler = async (event = {}) => {
    const body = parseRequestBody(event);
    const validation = validateRegistration(body);

    if (validation.error) {
        return sendError(422, 'VALIDATION_ERROR', validation.error);
    }

    const { name, email } = validation;

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
            return sendError(409, 'ACCOUNT_ALREADY_EXISTS', 'This account already exists. Please sign in.');
        }

        const otp = generateOtp();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        const userId = existingUser?.userId || await getNextUserId();

        // The password is validated above but intentionally not stored here:
        // Cognito owns credentials and issues the real password during
        // /auth/verify-email (ConfirmRegistrationLambda).
        const params = {
            TableName: tableName,
            Item: {
                userId,
                email,
                name,
                createdAt: existingUser?.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                verified: false,
                otp,
                otpExpiresAt
            }
        };

        await sendOtpEmail(email, otp);
        await docClient.send(new PutCommand(params));

        return {
            statusCode: 201,
            body: JSON.stringify({ email })
        };
    } catch (error) {
        console.error('Error registering user:', error);
        return sendError(500, 'INTERNAL_ERROR', 'Error registering user');
    }
};