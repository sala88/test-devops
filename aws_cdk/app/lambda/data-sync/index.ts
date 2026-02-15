declare const require: any;
declare const exports: any;
declare const process: any;

const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const AWSXRay = require('aws-xray-sdk-core');
const mysql = require("mysql2/promise");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const stream = require("stream");
const pipeline = promisify(stream.pipeline);

const s3 = AWSXRay.captureAWSv3Client(new S3Client());
const sns = AWSXRay.captureAWSv3Client(new SNSClient());
const secretsManager = AWSXRay.captureAWSv3Client(new SecretsManagerClient());

const BUCKET_NAME = process.env.DATA_LAKE_BUCKET_NAME;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
const DB_SECRET_ARN = process.env.DB_SECRET_ARN;

exports.handler = async (event: any) => {
  console.log("Starting Data Sync Service...");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tempFilePath = path.join("/tmp", `orders-backup-${timestamp}.json.gz`);
  const s3Key = `daily-backups/${new Date().getFullYear()}/${new Date().getMonth() + 1}/orders-${timestamp}.json.gz`;

  let connection: any;

  try {
    console.log("Retrieving DB credentials...");
    const secretResponse = await secretsManager.send(new GetSecretValueCommand({ SecretId: DB_SECRET_ARN }));
    const dbCredentials = JSON.parse(secretResponse.SecretString as string);

    console.log("Connecting to RDS...");
    const segment = AWSXRay.getSegment();
    const subsegment = segment.addNewSubsegment('MySQL Query');
    
    connection = await mysql.createConnection({
      host: dbCredentials.host,
      user: dbCredentials.username,
      password: dbCredentials.password,
      database: dbCredentials.dbname || 'appdb',
    });

    console.log("Querying data...");
    let rows: any[] = [];
    try {
      const [result] = await connection.execute("SELECT * FROM orders");
      rows = result as any[];
      subsegment.addAnnotation('recordCount', rows.length);
      console.log(`Fetched ${rows.length} records.`);
    } catch (dbError: any) {
      console.error("Database Query Failed:", dbError);
      subsegment.addError(dbError);
      throw dbError;
    } finally {
      subsegment.close();
    }

    console.log("Compressing data to /tmp...");
    await pipeline(
      stream.Readable.from(JSON.stringify(rows)),
      zlib.createGzip(),
      fs.createWriteStream(tempFilePath)
    );

    console.log(`Uploading to S3 bucket: ${BUCKET_NAME}, key: ${s3Key}...`);
    const fileStream = fs.createReadStream(tempFilePath);
    
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: fileStream,
      ServerSideEncryption: "AES256",
      ContentType: "application/gzip"
    }));

    console.log("Sending success notification...");
    await sns.send(new PublishCommand({
      TopicArn: SNS_TOPIC_ARN,
      Subject: "Data Sync Success",
      Message: `Successfully synced ${rows.length} records to s3://${BUCKET_NAME}/${s3Key}.`
    }));

    console.log("Data Sync completed successfully.");
    return { status: "success", recordsSynced: rows.length, s3Key };

  } catch (error: any) {
    console.error("Data Sync Failed:", error);

    try {
      await sns.send(new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject: "Data Sync FAILURE",
        Message: `Data Sync Service failed. Error: ${error.message}\nStack: ${error.stack}`
      }));
      console.log("Error notification sent.");
    } catch (snsError: any) {
      console.error("Failed to send error notification:", snsError);
    }

    throw error;
  } finally {
    if (connection) await connection.end();
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
  }
};
