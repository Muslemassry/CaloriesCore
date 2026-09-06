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

const defaultGoalSetup = () => ({
    goal: "healthier",
    activity: "light",
    age: undefined,
    heightCm: undefined,
    weightKg: undefined,
    imperial: false,
    mealsPerDay: undefined,
    diet: "balanced"
});

const normalizeGoalSetup = (input = {}) => {
    const sanitized = defaultGoalSetup();
    const allowedGoals = ["lose", "muscle", "maintain", "healthier"];
    const allowedActivities = ["sedentary", "light", "active", "veryActive"];
    const allowedDiets = ["none", "highProtein", "lowCarb", "balanced"];

    if (input.goal && allowedGoals.includes(input.goal)) {
        sanitized.goal = input.goal;
    }

    if (input.activity && allowedActivities.includes(input.activity)) {
        sanitized.activity = input.activity;
    }

    if (input.imperial !== undefined) {
        sanitized.imperial = Boolean(input.imperial);
    }

    if (input.diet && allowedDiets.includes(input.diet)) {
        sanitized.diet = input.diet;
    }

    if (input.age !== undefined && Number.isFinite(Number(input.age))) {
        sanitized.age = Number(input.age);
    }

    if (input.heightCm !== undefined && Number.isFinite(Number(input.heightCm))) {
        sanitized.heightCm = Number(input.heightCm);
    }

    if (input.weightKg !== undefined && Number.isFinite(Number(input.weightKg))) {
        sanitized.weightKg = Number(input.weightKg);
    }

    if (input.mealsPerDay !== undefined && Number.isFinite(Number(input.mealsPerDay))) {
        sanitized.mealsPerDay = Number(input.mealsPerDay);
    }

    return sanitized;
};

const toUserProfile = (user = {}) => ({
    id: String(user.userId ?? user.email ?? ""),
    name: user.name || [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "",
    email: user.email || "",
    hasCompletedGoalSetup: Boolean(user.hasCompletedGoalSetup),
    isVerified: Boolean(user.verified)
});

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
    const httpMethod = event.httpMethod || "GET";
    const path = event.path || "";

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

        if (path.endsWith("/goal-setup") || path === "/goal-setup") {
            if (httpMethod === "GET") {
                const goalSetup = user.goalSetup || null;

                if (!goalSetup) {
                    return sendResponse(404, {
                        success: false,
                        error: {
                            code: "GOAL_SETUP_NOT_FOUND",
                            message: "No goal setup saved yet."
                        }
                    });
                }

                return sendResponse(200, goalSetup);
            }

            if (httpMethod === "PUT") {
                const body = parseRequestBody(event);
                const goalSetup = normalizeGoalSetup(body);

                await docClient.send(new UpdateCommand({
                    TableName: tableName,
                    Key: { userId },
                    UpdateExpression: "SET goalSetup = :goalSetup, updatedAt = :updatedAt",
                    ExpressionAttributeValues: {
                        ":goalSetup": goalSetup,
                        ":updatedAt": new Date().toISOString()
                    },
                    ReturnValues: "ALL_NEW"
                }));

                return sendResponse(200, goalSetup);
            }

            if (httpMethod === "PATCH") {
                const body = parseRequestBody(event);

                if (typeof body.hasCompletedGoalSetup !== "boolean") {
                    return sendResponse(422, {
                        success: false,
                        error: {
                            code: "VALIDATION_ERROR",
                            message: "hasCompletedGoalSetup must be a boolean."
                        }
                    });
                }

                const updated = await docClient.send(new UpdateCommand({
                    TableName: tableName,
                    Key: { userId },
                    UpdateExpression: "SET hasCompletedGoalSetup = :hasCompletedGoalSetup, updatedAt = :updatedAt",
                    ExpressionAttributeValues: {
                        ":hasCompletedGoalSetup": body.hasCompletedGoalSetup,
                        ":updatedAt": new Date().toISOString()
                    },
                    ReturnValues: "ALL_NEW"
                }));

                return sendResponse(200, toUserProfile(updated.Attributes || user));
            }
        }

        return sendResponse(404, {
            success: false,
            error: {
                code: "NOT_FOUND",
                message: "Endpoint not found."
            }
        });
    } catch (error) {
        console.error("ProfileLambda error:", error);
        return sendResponse(500, {
            success: false,
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "Unable to process the request."
            }
        });
    }
};
