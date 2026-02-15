import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as schemas from 'aws-cdk-lib/aws-eventschemas';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. VPC Configuration
    const vpc = new ec2.Vpc(this, 'DevOpsVpc', {
      maxAzs: 2,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: 'database', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // 2. Managed Services: RDS MySQL & ElastiCache Redis
    const dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
      secretName: 'db-credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'admin' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\',
      },
    });

    const dbInstance = new rds.DatabaseInstance(this, 'MySQLInstance', {
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: 'myapp',
    });

    // 3. Redis (ElastiCache)

    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis',
      subnetIds: vpc.privateSubnets.map(subnet => subnet.subnetId),
    });

    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc,
      description: 'Security Group for Redis',
      allowAllOutbound: true,
    });

    const redisCluster = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
      cacheNodeType: 'cache.t3.micro',
      engine: 'redis',
      numCacheNodes: 1,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
    });

    // 4. Backend (Lambda Docker + API Gateway)
    
    // Grant Access to DB Secrets
    const secret = secretsmanager.Secret.fromSecretNameV2(this, 'ImportedDbSecret', 'db-credentials');

    // Backend Lambda
    const backendLambda = new lambda.Function(this, 'BackendLambda', {
      runtime: lambda.Runtime.FROM_IMAGE,
      handler: lambda.Handler.FROM_IMAGE,
      code: lambda.Code.fromAssetImage(path.join(__dirname, '../../app/backend')),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      reservedConcurrentExecutions: 50,
      tracing: lambda.Tracing.ACTIVE,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: {
        DB_HOST: dbInstance.dbInstanceEndpointAddress,
        DB_NAME: 'myapp',
        DB_USER: 'admin',
        REDIS_HOST: redisCluster.attrRedisEndpointAddress,
        REDIS_PORT: redisCluster.attrRedisEndpointPort,
        DB_PASSWORD_SECRET_ARN: secret.secretArn,
      },
    });

    // Grant Access to DB Secrets (Read Permission)
    secret.grantRead(backendLambda);

    // Allow Lambda to connect to RDS & Redis
    dbInstance.connections.allowDefaultPortFrom(backendLambda);
    redisSecurityGroup.addIngressRule(backendLambda.connections.securityGroups[0], ec2.Port.tcp(6379));

    // Aggiungi policy IAM esplicita per permettere alla Lambda di creare ENI nella VPC (necessario per Lambda in VPC)
    backendLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:CreateNetworkInterface',
        'ec2:DescribeNetworkInterfaces',
        'ec2:DeleteNetworkInterface',
        'ec2:AssignPrivateIpAddresses',
        'ec2:UnassignPrivateIpAddresses'
      ],
      resources: ['*'] // Le azioni EC2 di rete richiedono Resource: *
    }));

    // API Gateway (Main Entry Point)
    const api = new apigateway.LambdaRestApi(this, 'BackendApi', {
      handler: backendLambda,
      proxy: false,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // Backend Integration
    const backendIntegration = new apigateway.LambdaIntegration(backendLambda);

    // 5. Order Processor Lambda (Microservice)
    
    // EventBridge Custom Bus
    const orderEventsBus = new events.EventBus(this, 'OrderEventsBus', {
      eventBusName: 'order-events',
    });

    // Archive (30 days retention)
    orderEventsBus.archive('OrderEventsArchive', {
      archiveName: 'OrderEventsArchive',
      description: 'Archive for order-events bus',
      eventPattern: {
        account: [cdk.Stack.of(this).account],
      },
      retention: cdk.Duration.days(30),
    });

    // Enable Schema Discovery
    new schemas.CfnDiscoverer(this, 'OrderEventsDiscoverer', {
      sourceArn: orderEventsBus.eventBusArn,
      description: 'Schema Discovery for Order Events',
    });

    // Schema Registry
    const registry = new schemas.CfnRegistry(this, 'OrderEventsRegistry', {
      registryName: 'order-events-registry',
      description: 'Registry for Order Events',
    });

    // OrderCreated Schema (Validated)
    new schemas.CfnSchema(this, 'OrderCreatedSchema', {
      registryName: registry.registryName || 'order-events-registry',
      schemaName: 'OrderCreated',
      type: 'JSONSchemaDraft4',
      content: JSON.stringify({
        "$schema": "http://json-schema.org/draft-04/schema#",
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "totalAmount": { "type": "number" },
          "items": { 
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "productId": { "type": "string" },
                "quantity": { "type": "integer" }
              },
              "required": ["productId", "quantity"]
            }
          },
          "status": { "type": "string" },
          "createdAt": { "type": "string" }
        },
        "required": ["id", "items", "status", "createdAt"]
      }),
    });

    // DynamoDB Table for Orders
    const ordersTableNode = new dynamodb.Table(this, 'OrdersTableNode', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev/test only
    });

    // Order DLQ
    const orderDlq = new sqs.Queue(this, 'OrderDlq', {
      retentionPeriod: cdk.Duration.days(14),
    });

    // Order Processor Lambda
    const orderProcessorLambda = new lambda.Function(this, 'OrderProcessorLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../app/lambda/order-processor')),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      reservedConcurrentExecutions: 10,
      tracing: lambda.Tracing.ACTIVE,
      deadLetterQueue: orderDlq,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      environment: {
        DYNAMODB_TABLE: ordersTableNode.tableName,
        DB_HOST: dbInstance.dbInstanceEndpointAddress,
        REDIS_HOST: redisCluster.attrRedisEndpointAddress,
        DB_PASSWORD_SECRET_ARN: secret.secretArn, // Accesso a RDS completo
        EVENT_BUS_NAME: orderEventsBus.eventBusName,
      },
    });

    // Provisioned Concurrency (Alias)
    const orderProcessorAlias = new lambda.Alias(this, 'OrderProcessorProd', {
      aliasName: 'prod',
      version: orderProcessorLambda.currentVersion,
      provisionedConcurrentExecutions: 5,
    });

    // IAM Permissions
    ordersTableNode.grantWriteData(orderProcessorLambda);
    secret.grantRead(orderProcessorLambda); // Grant read secret
    
    // EventBridge Permission (PutEvents)
    orderEventsBus.grantPutEventsTo(orderProcessorLambda);
    
    // VPC Permissions
    orderProcessorLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:CreateNetworkInterface',
        'ec2:DescribeNetworkInterfaces',
        'ec2:DeleteNetworkInterface',
        'ec2:AssignPrivateIpAddresses',
        'ec2:UnassignPrivateIpAddresses'
      ],
      resources: ['*']
    }));

    // 1. Root Handler & Proxy (for non-/api routes)
    api.root.addMethod('ANY', backendIntegration);
    
    // 2. /api Resource
    const apiResource = api.root.addResource('api');
    
    // 3. /api/orders (POST) -> Order Processor
    const ordersApiResource = apiResource.addResource('orders');
    ordersApiResource.addMethod('POST', new apigateway.LambdaIntegration(orderProcessorAlias));

    // 4. /api/{proxy+} -> Backend Lambda (for other API routes)
    apiResource.addProxy({
      defaultIntegration: backendIntegration,
      anyMethod: true,
    });

    // 5. Root {proxy+} -> Backend Lambda (fallback for everything else)
    // Note: Must be added LAST to avoid conflicts or shadowing, though CDK handles dependency order.
    // However, addProxy adds {proxy+} resource.
    api.root.addProxy({
      defaultIntegration: backendIntegration,
      anyMethod: true,
    });

    // 6. Email Notifier Lambda (Event-Driven)
    
    // Dead Letter Queue (DLQ)
    const emailDlq = new sqs.Queue(this, 'EmailDlq', {
      retentionPeriod: cdk.Duration.days(14),
    });

    // Email Notifier Lambda
    const emailNotifierLambda = new lambda.Function(this, 'EmailNotifierLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../app/lambda/email-notifier')),
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      reservedConcurrentExecutions: 10,
      tracing: lambda.Tracing.ACTIVE,
      retryAttempts: 2, // Automatic retry
      deadLetterQueue: emailDlq,
      environment: {
        SENDER_EMAIL: 'noreply@myapp.com',
      },
      // No VPC needed for SES (AWS managed service)
    });

    // Grant SES Permissions
    emailNotifierLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'], // In prod, restrict to specific identity ARNs
    }));

    // EventBridge Rule: Trigger on "order.created"
    const orderCreatedRule = new events.Rule(this, 'OrderCreatedRule', {
      eventBus: orderEventsBus,
      eventPattern: {
        source: ['com.myapp.orders'],
        detailType: ['OrderCreated'],
      },
    });

    orderCreatedRule.addTarget(new targets.LambdaFunction(emailNotifierLambda, {
      maxEventAge: cdk.Duration.hours(1), // Retention policy: 1 ora (Retry window)
      retryAttempts: 2,
    }));

    // 7. Data Sync Service (Scheduled)
    
    // Data Lake Bucket
    const dataLakeBucket = new s3.Bucket(this, 'DataLakeBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For dev/test
      autoDeleteObjects: true,
    });

    // SNS Topic for Notifications
    const dataSyncTopic = new sns.Topic(this, 'DataSyncTopic', {
      displayName: 'Data Sync Notifications',
    });

    // Data Sync DLQ
    const dataSyncDlq = new sqs.Queue(this, 'DataSyncDlq', {
      retentionPeriod: cdk.Duration.days(14),
    });

    // Data Sync Lambda
    const dataSyncLambda = new lambda.Function(this, 'DataSyncLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../app/lambda/data-sync')),
      memorySize: 3008, // High memory for processing
      timeout: cdk.Duration.seconds(900), // 15 minutes
      reservedConcurrentExecutions: 2,
      deadLetterQueue: dataSyncDlq,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      ephemeralStorageSize: cdk.Size.mebibytes(1024), // /tmp storage
      tracing: lambda.Tracing.ACTIVE, // X-Ray
      environment: {
        DATA_LAKE_BUCKET_NAME: dataLakeBucket.bucketName,
        SNS_TOPIC_ARN: dataSyncTopic.topicArn,
        DB_SECRET_ARN: dbSecret.secretArn,
      },
    });

    // Permissions
    dataLakeBucket.grantWrite(dataSyncLambda);
    dataSyncTopic.grantPublish(dataSyncLambda);
    dbSecret.grantRead(dataSyncLambda);
    dbInstance.connections.allowDefaultPortFrom(dataSyncLambda);

    // EventBridge Rule: Schedule (Daily at 2 AM)
    const dataSyncRule = new events.Rule(this, 'DataSyncRule', {
      schedule: events.Schedule.expression('cron(0 2 * * ? *)'),
    });

    dataSyncRule.addTarget(new targets.LambdaFunction(dataSyncLambda));

    // 8. DLQ Processor (Monitoring)
    
    // DLQ Processor Lambda
    const dlqProcessorLambda = new lambda.Function(this, 'DLQProcessorLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../app/lambda/dlq-processor')),
      memorySize: 512,
      timeout: cdk.Duration.seconds(120),
      reservedConcurrentExecutions: 5,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        DLQ_ARCHIVE_BUCKET: dataLakeBucket.bucketName, // Reuse Data Lake for archives
        SNS_TOPIC_ARN: dataSyncTopic.topicArn, // Reuse SNS Topic for alerts
        SLACK_WEBHOOK_URL: '', // To be populated via Context or Secrets in real prod
      },
    });

    // Trigger: SQS (Email DLQ)
    dlqProcessorLambda.addEventSource(new lambdaEventSources.SqsEventSource(emailDlq));
    
    // Grant Permissions
    dataLakeBucket.grantWrite(dlqProcessorLambda);
    dataSyncTopic.grantPublish(dlqProcessorLambda);
    emailDlq.grantConsumeMessages(dlqProcessorLambda);

    // 9. Frontend (S3 + CloudFront)
    const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      websiteIndexDocument: 'index.html',
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI');
    frontendBucket.grantRead(oai);

    const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(frontendBucket, { originAccessIdentity: oai }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(`${api.restApiId}.execute-api.${this.region}.amazonaws.com`, {
            originPath: '/prod',
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
      },
      defaultRootObject: 'index.html',
      comment: 'CloudFront Distribution for Frontend S3 + Backend API',
    });

    // Deploy Frontend Assets to S3
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../app/frontend/out'))],
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // Outputs
    new cdk.CfnOutput(this, 'BackendApiURL', { value: api.url });
    new cdk.CfnOutput(this, 'CloudFrontURL', { value: distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'S3BucketName', { value: frontendBucket.bucketName });
  }
}
