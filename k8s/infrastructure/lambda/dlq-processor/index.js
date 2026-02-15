const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
const axios = require("axios");

const s3 = new S3Client();
const sns = new SNSClient();

const S3_BUCKET = process.env.DLQ_ARCHIVE_BUCKET;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

exports.handler = async (event) => {
  console.log(`Processing ${event.Records.length} DLQ messages...`);

  const results = await Promise.allSettled(event.Records.map(async (record) => {
    const messageId = record.messageId;
    const timestamp = new Date().toISOString();
    
    try {
      const datePath = timestamp.split("T")[0].replace(/-/g, "/");
      const key = `dlq-archive/${datePath}/${messageId}.json`;
      
      const content = {
        messageId,
        timestamp,
        attributes: record.attributes,
        messageAttributes: record.messageAttributes,
        body: record.body,
        error: "Processed from DLQ"
      };

      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: JSON.stringify(content, null, 2),
        ContentType: "application/json"
      }));

      console.log(`Archived message ${messageId} to s3://${S3_BUCKET}/${key}`);

      const subject = `DLQ Alert: Message ${messageId}`;
      const message = `A message has failed processing and was captured in the DLQ.\n\nMessage ID: ${messageId}\nTimestamp: ${timestamp}\nArchived at: s3://${S3_BUCKET}/${key}\n\nBody Preview: ${record.body.substring(0, 200)}...`;

      await sns.send(new PublishCommand({
        TopicArn: SNS_TOPIC_ARN,
        Subject: subject,
        Message: message
      }));

      if (SLACK_WEBHOOK_URL) {
        await axios.post(SLACK_WEBHOOK_URL, {
          text: `🚨 *DLQ Alert* 🚨\n*Message ID:* ${messageId}\n*Archived:* \`${key}\`\n*Preview:* \`${record.body.substring(0, 100)}...\``
        });
        console.log(`Sent Slack notification for ${messageId}`);
      }

      return { status: "success", messageId };

    } catch (error) {
      console.error(`Failed to process DLQ message ${messageId}:`, error);
      throw error;
    }
  }));

  const successes = results.filter(r => r.status === 'fulfilled').length;
  const failures = results.filter(r => r.status === 'rejected').length;
  console.log(`Batch complete. Success: ${successes}, Failed: ${failures}`);

  if (failures > 0) {
    throw new Error(`${failures} messages failed to process in DLQ handler.`);
  }
};

