const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient } = require("@aws-sdk/lib-dynamodb");

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const tableName = "HistoryIntake-dev";

exports.handler = async (event = {}) => {
    const bucketName = event?.detail?.bucket?.name
        ?? event?.Records?.[0]?.s3?.bucket?.name
        ?? null;

    const objectKey = event?.detail?.object?.key
        ?? event?.Records?.[0]?.s3?.object?.key
        ?? null;

    const fileName = objectKey
        ? objectKey.split("/").filter(Boolean).pop() || objectKey
        : null;

    console.log("Extracted S3 event data:", { bucketName, objectKey, fileName });

    return {
        bucketName,
        objectKey,
        fileName,
        tableName,
    };
};