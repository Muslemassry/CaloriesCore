const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env.USER_TABLE_NAME || "UserTable-dev";

const parseRequestBody = (event = {}) => {
    if (!event.body) {
        return {};
    }

    if (typeof event.body === "string") {
        try {
            return JSON.parse(event.body);
        } catch (error) {
            console.error("Invalid JSON body:", error);
            return {};
        }
    }

    return event.body;
};

const getClaims = (event = {}) =>
    event.requestContext?.authorizer?.claims ??
    event.requestContext?.authorizer?.jwt?.claims ?? {};

const getUserIdFromClaims = (claims = {}) => {
    const raw = claims["custom:user_id"] ?? claims.userId;
    if (raw === undefined || raw === null || raw === "") {
        return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
};

const sendResponse = (statusCode, payload) => ({
    statusCode,
    headers: {
        "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
});

const defaultGoals = () => ({
    dailyCalories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0
});

const normalizeGoals = (input = {}) => {
    const goals = defaultGoals();

    const keys = ["dailyCalories", "proteinG", "carbsG", "fatG", "fiberG"];
    for (const key of keys) {
        const value = Number(input[key]);
        if (Number.isFinite(value)) {
            goals[key] = value;
        }
    }

    return goals;
};

const getUserById = async (userId) => {
    const result = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: { userId }
    }));

    return result.Item || null;
};

exports.handler = async (event = {}) => {
    const claims = getClaims(event);
    const userId = getUserIdFromClaims(claims);
    const method = event.httpMethod || "GET";

    if (!userId) {
        return sendResponse(401, {
            success: false,
            error: {
                code: "UNAUTHORIZED",
                message: "Authentication required."
            }
        });
    }

    try {
        const user = await getUserById(userId);
        if (!user) {
            return sendResponse(404, {
                success: false,
                error: {
                    code: "USER_NOT_FOUND",
                    message: "User not found."
                }
            });
        }

        if (method === "GET") {
            const goals = user.goals || defaultGoals();
            return sendResponse(200, goals);
        }

        if (method === "PUT") {
            const body = parseRequestBody(event);
            const goals = normalizeGoals(body);

            if (Object.keys(body).length === 0) {
                return sendResponse(422, {
                    success: false,
                    error: {
                        code: "VALIDATION_ERROR",
                        message: "Request body is required."
                    }
                });
            }

            const result = await docClient.send(new UpdateCommand({
                TableName: tableName,
                Key: { userId },
                UpdateExpression: "SET goals = :goals, updatedAt = :updatedAt",
                ExpressionAttributeValues: {
                    ":goals": goals,
                    ":updatedAt": new Date().toISOString()
                },
                ReturnValues: "ALL_NEW"
            }));

            return sendResponse(200, result.Attributes?.goals || goals);
        }

        return sendResponse(404, {
            success: false,
            error: {
                code: "NOT_FOUND",
                message: "Endpoint not found."
            }
        });
    } catch (error) {
        console.error("GoalsLambda error:", error);
        return sendResponse(500, {
            success: false,
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "Unable to process the request."
            }
        });
    }
};
