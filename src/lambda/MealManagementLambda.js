const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
    DynamoDBDocumentClient,
    GetCommand,
    QueryCommand,
    PutCommand,
    UpdateCommand,
    DeleteCommand
} = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = process.env.MEAL_LOG_TABLE_NAME || "MealLog-dev";
const counterTableName = process.env.USER_ID_COUNTER_TABLE_NAME || "UserIdCounter-dev";

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

const safeDate = (value, fallback = new Date().toISOString()) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};

const normalizeMacros = (input = {}) => ({
    proteinG: Number(input.proteinG ?? 0),
    carbsG: Number(input.carbsG ?? 0),
    fatG: Number(input.fatG ?? 0),
    fiberG: Number(input.fiberG ?? 0)
});

const toMealResponse = (item = {}) => ({
    id: String(item.mealLogId ?? item.id ?? ""),
    name: item.name || "",
    type: item.type || "breakfast",
    source: item.source || "manual",
    loggedAt: item.loggedAt || new Date().toISOString(),
    photoUrl: item.photoUrl || null,
    macros: {
        proteinG: Number(item.macros?.proteinG ?? item.proteinG ?? 0),
        carbsG: Number(item.macros?.carbsG ?? item.carbsG ?? 0),
        fatG: Number(item.macros?.fatG ?? item.fatG ?? 0),
        fiberG: Number(item.macros?.fiberG ?? item.fiberG ?? 0)
    }
});

const getNextMealLogId = async () => {
    const result = await docClient.send(new UpdateCommand({
        TableName: counterTableName,
        Key: { counterName: "MealLogTable" },
        UpdateExpression: "ADD #value :increment",
        ExpressionAttributeNames: {
            "#value": "currentValue"
        },
        ExpressionAttributeValues: {
            ":increment": 1
        },
        ReturnValues: "UPDATED_NEW"
    }));

    return Number(result.Attributes?.currentValue || 0);
};

const readMealById = async (mealId) => {
    const result = await docClient.send(new GetCommand({
        TableName: tableName,
        Key: { mealLogId: Number(mealId) }
    }));

    return result.Item || null;
};

exports.handler = async (event = {}) => {
    const claims = getClaims(event);
    const userId = getUserIdFromClaims(claims);
    const method = event.httpMethod || "GET";
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
        if (method === "GET" && (path.endsWith("/meals") || path === "/meals")) {
            const query = event.queryStringParameters || {};
            const startDate = query.startDate;
            const endDate = query.endDate;

            const params = {
                TableName: tableName,
                IndexName: "UserAttributeIndex",
                KeyConditionExpression: "userId = :userId",
                ExpressionAttributeValues: {
                    ":userId": userId
                }
            };

            const result = await docClient.send(new QueryCommand(params));
            let meals = (result.Items || []).filter((item) => item.userId === userId);

            if (startDate || endDate) {
                meals = meals.filter((item) => {
                    const itemDate = item.loggedAt ? item.loggedAt.slice(0, 10) : "";
                    if (startDate && itemDate < startDate) return false;
                    if (endDate && itemDate > endDate) return false;
                    return true;
                });
            }

            return sendResponse(200, {
                meals: meals.map(toMealResponse)
            });
        }

        if (method === "POST" && (path.endsWith("/meals") || path === "/meals")) {
            const body = parseRequestBody(event);
            const required = ["name", "type", "source", "loggedAt", "macros"];
            const missing = required.filter((field) => body[field] === undefined);

            if (missing.length > 0) {
                return sendResponse(422, {
                    success: false,
                    error: {
                        code: "VALIDATION_ERROR",
                        message: `Missing required fields: ${missing.join(", ")}`
                    }
                });
            }

            const allowedTypes = ["breakfast", "lunch", "dinner", "snack"];
            const allowedSources = ["aiAnalysis", "manual"];

            if (!allowedTypes.includes(body.type)) {
                return sendResponse(422, {
                    success: false,
                    error: {
                        code: "VALIDATION_ERROR",
                        message: "Invalid meal type."
                    }
                });
            }

            if (!allowedSources.includes(body.source)) {
                return sendResponse(422, {
                    success: false,
                    error: {
                        code: "VALIDATION_ERROR",
                        message: "Invalid meal source."
                    }
                });
            }

            const mealId = await getNextMealLogId();
            if (Number.isNaN(new Date(body.loggedAt).getTime())) {
                return sendResponse(422, {
                    success: false,
                    error: {
                        code: "VALIDATION_ERROR",
                        message: "loggedAt must be a valid date-time."
                    }
                });
            }

            const now = safeDate(body.loggedAt, new Date().toISOString());
            const macros = normalizeMacros(body.macros || {});

            const item = {
                mealLogId: mealId,
                userId,
                name: String(body.name),
                type: body.type,
                source: body.source,
                loggedAt: now,
                photoUrl: body.photoUrl || null,
                macros,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await docClient.send(new PutCommand({
                TableName: tableName,
                Item: item
            }));

            return sendResponse(201, toMealResponse(item));
        }

        const match = (path || "").match(/\/meals\/([^/]+)$/);
        const mealId = match ? match[1] : null;

        if (!mealId) {
            return sendResponse(404, {
                success: false,
                error: {
                    code: "NOT_FOUND",
                    message: "Meal not found."
                }
            });
        }

        const item = await readMealById(mealId);

        if (!item) {
            return sendResponse(404, {
                success: false,
                error: {
                    code: "MEAL_NOT_FOUND",
                    message: "Meal not found."
                }
            });
        }

        if (item.userId !== userId) {
            return sendResponse(403, {
                success: false,
                error: {
                    code: "FORBIDDEN",
                    message: "You do not have access to this meal."
                }
            });
        }

        if (method === "GET") {
            return sendResponse(200, toMealResponse(item));
        }

        if (method === "PUT") {
            const body = parseRequestBody(event);
            const required = ["name", "type", "source", "loggedAt", "macros"];
            const missing = required.filter((field) => body[field] === undefined);

            if (missing.length > 0) {
                return sendResponse(422, {
                    success: false,
                    error: {
                        code: "VALIDATION_ERROR",
                        message: `Missing required fields: ${missing.join(", ")}`
                    }
                });
            }

            if (!['breakfast', 'lunch', 'dinner', 'snack'].includes(body.type) ||
                !['aiAnalysis', 'manual'].includes(body.source) ||
                Number.isNaN(new Date(body.loggedAt).getTime())) {
                return sendResponse(422, {
                    success: false,
                    error: {
                        code: "VALIDATION_ERROR",
                        message: "Invalid meal type, source, or loggedAt."
                    }
                });
            }

            const nextItem = {
                ...item,
                name: String(body.name),
                type: body.type,
                source: body.source,
                loggedAt: safeDate(body.loggedAt),
                photoUrl: body.photoUrl || null,
                macros: normalizeMacros(body.macros || {}),
                updatedAt: new Date().toISOString()
            };

            await docClient.send(new UpdateCommand({
                TableName: tableName,
                Key: { mealLogId: Number(mealId) },
                UpdateExpression: "SET #name = :name, #type = :type, #source = :source, #loggedAt = :loggedAt, photoUrl = :photoUrl, macros = :macros, updatedAt = :updatedAt",
                ExpressionAttributeNames: {
                    "#name": "name",
                    "#type": "type",
                    "#source": "source",
                    "#loggedAt": "loggedAt"
                },
                ExpressionAttributeValues: {
                    ":name": nextItem.name,
                    ":type": nextItem.type,
                    ":source": nextItem.source,
                    ":loggedAt": nextItem.loggedAt,
                    ":photoUrl": nextItem.photoUrl,
                    ":macros": nextItem.macros,
                    ":updatedAt": nextItem.updatedAt
                },
                ReturnValues: "ALL_NEW"
            }));

            return sendResponse(200, toMealResponse(nextItem));
        }

        if (method === "DELETE") {
            await docClient.send(new DeleteCommand({
                TableName: tableName,
                Key: { mealLogId: Number(mealId) }
            }));

            return {
                statusCode: 204,
                headers: {}
            };
        }

        return sendResponse(404, {
            success: false,
            error: {
                code: "NOT_FOUND",
                message: "Endpoint not found."
            }
        });
    } catch (error) {
        console.error("MealManagementLambda error:", error);
        return sendResponse(500, {
            success: false,
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "Unable to process the request."
            }
        });
    }
};
