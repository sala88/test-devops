declare const require: any;
declare const exports: any;
declare const process: any;

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const { EventBridgeClient, PutEventsCommand } = require("@aws-sdk/client-eventbridge");
const { v4: uuidv4 } = require("uuid");

type ValidationResult = {
  isValid: boolean;
  message?: string;
};

const validateOrder = (order: any): ValidationResult => {
  if (!order.items || !Array.isArray(order.items) || order.items.length === 0) {
    return { isValid: false, message: "Order must contain at least one item" };
  }
  if (!order.totalAmount || order.totalAmount <= 0) {
    return { isValid: false, message: "Total amount must be positive" };
  }
  return { isValid: true };
};

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const ebClient = new EventBridgeClient({});

exports.handler = async (event: any) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  try {
    const body = JSON.parse(event.body);
    
    let validation: ValidationResult = { isValid: true };
    try {
      validation = validateOrder(body);
    } catch (e) {
      console.log("Shared layer utils not found or error, proceeding with basic check");
      if (!body.items || body.items.length === 0) validation = { isValid: false, message: "No items" };
    }

    if (!validation.isValid) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: validation.message }),
      };
    }

    const orderId = uuidv4();
    const order = {
      id: orderId,
      ...body,
      status: "CREATED",
      createdAt: new Date().toISOString(),
    };

    // 2. Persistenza su DynamoDB
    await docClient.send(new PutCommand({
      TableName: process.env.DYNAMODB_TABLE,
      Item: order,
    }));

    // 3. Pubblicazione evento su EventBridge
    await ebClient.send(new PutEventsCommand({
      Entries: [{
        Source: "com.myapp.orders",
        DetailType: "OrderCreated",
        Detail: JSON.stringify(order),
        EventBusName: process.env.EVENT_BUS_NAME || "default",
      }],
    }));

    return {
      statusCode: 201,
      body: JSON.stringify({ message: "Order created", orderId }),
    };

  } catch (error: any) {
    console.error("Error processing order:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal Server Error", error: error.message }),
    };
  }
};
