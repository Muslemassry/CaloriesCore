const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

const s3Client = new S3Client({});
const tableName = "HistoryIntake-dev";

const getImageBuffer = async (bucketName, objectKey) => {
    const getObjectCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
    });

    const response = await s3Client.send(getObjectCommand);

    if (!response.Body) {
        throw new Error(`S3 object is empty for ${bucketName}/${objectKey}`);
    }

    const imageBuffer = await response.Body.transformToByteArray();
    return Buffer.from(imageBuffer);
};

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

    if (!bucketName || !objectKey) {
        return {
            statusCode: 400,
            body: JSON.stringify({
                message: "Missing S3 bucket or object key",
                bucketName,
                objectKey,
            }),
        };
    }

    const imageBuffer = await getImageBuffer(bucketName, objectKey);
    const imageBase64 = imageBuffer.toString("base64");

    return {
        bucketName,
        objectKey,
        fileName,
        contentType: "image/jpeg",
        imageSize: imageBuffer.length,
        imageBase64,
        tableName,
    };
};