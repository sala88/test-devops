data "archive_file" "shared_layer" {
  type        = "zip"
  source_dir  = "${path.module}/../../../app/backend/shared-layer"
  output_path = "${path.module}/build/shared-layer.zip"
}

data "archive_file" "order_processor" {
  type        = "zip"
  source_dir  = "${path.module}/../../../infrastructure/lambda/order-processor"
  output_path = "${path.module}/build/order-processor.zip"
}

data "archive_file" "email_notifier" {
  type        = "zip"
  source_dir  = "${path.module}/../../../infrastructure/lambda/email-notifier"
  output_path = "${path.module}/build/email-notifier.zip"
}

data "archive_file" "data_sync" {
  type        = "zip"
  source_dir  = "${path.module}/../../../infrastructure/lambda/data-sync"
  output_path = "${path.module}/build/data-sync.zip"
}

data "archive_file" "dlq_processor" {
  type        = "zip"
  source_dir  = "${path.module}/../../../infrastructure/lambda/dlq-processor"
  output_path = "${path.module}/build/dlq-processor.zip"
}

resource "aws_lambda_layer_version" "shared" {
  layer_name          = "${var.project_name}-${var.environment}-shared-layer"
  compatible_runtimes = ["nodejs20.x"]
  filename            = data.archive_file.shared_layer.output_path
}

resource "aws_dynamodb_table" "orders" {
  name         = "${var.project_name}-${var.environment}-orders"
  billing_mode = "PAY_PER_REQUEST"

  hash_key = "id"

  attribute {
    name = "id"
    type = "S"
  }
}

resource "aws_iam_role" "order_processor" {
  name = "${var.project_name}-${var.environment}-order-processor-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "order_processor_basic" {
  role       = aws_iam_role.order_processor.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "order_processor_vpc" {
  role       = aws_iam_role.order_processor.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "order_processor_dynamodb_events" {
  name = "${var.project_name}-${var.environment}-order-processor-policy"
  role = aws_iam_role.order_processor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.orders.arn
      },
      {
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_lambda_function" "order_processor" {
  function_name = "${var.project_name}-${var.environment}-order-processor"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.order_processor.arn

  filename         = data.archive_file.order_processor.output_path
  source_code_hash = data.archive_file.order_processor.output_base64sha256

  memory_size                    = 512
  timeout                        = 30
  reserved_concurrent_executions = 10

  layers = [aws_lambda_layer_version.shared.arn]

  tracing_config {
    mode = "Active"
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = var.security_group_ids
  }

  ephemeral_storage {
    size = 512
  }

  environment {
    variables = {
      DYNAMODB_TABLE  = aws_dynamodb_table.orders.name
      DB_HOST         = var.rds_endpoint
      CACHE_ENDPOINT  = var.cache_endpoint
      EVENT_BUS_NAME  = aws_cloudwatch_event_bus.order_events.name
      NODE_ENV        = var.environment
    }
  }
}

resource "aws_lambda_alias" "order_processor_prod" {
  name             = "prod"
  function_name    = aws_lambda_function.order_processor.function_name
  function_version = aws_lambda_function.order_processor.version
}

resource "aws_lambda_provisioned_concurrency_config" "order_processor" {
  function_name                     = aws_lambda_alias.order_processor_prod.function_name
  qualifier                         = aws_lambda_alias.order_processor_prod.name
  provisioned_concurrent_executions = 5
}

resource "aws_sqs_queue" "email_dlq" {
  name                       = "${var.project_name}-${var.environment}-email-dlq"
  message_retention_seconds  = 1209600
  visibility_timeout_seconds = 60
}

resource "aws_iam_role" "email_notifier" {
  name = "${var.project_name}-${var.environment}-email-notifier-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "email_notifier_basic" {
  role       = aws_iam_role.email_notifier.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "email_notifier_ses" {
  name = "${var.project_name}-${var.environment}-email-notifier-policy"
  role = aws_iam_role.email_notifier.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.email_dlq.arn
      }
    ]
  })
}

resource "aws_lambda_function" "email_notifier" {
  function_name = "${var.project_name}-${var.environment}-email-notifier"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.email_notifier.arn

  filename         = data.archive_file.email_notifier.output_path
  source_code_hash = data.archive_file.email_notifier.output_base64sha256

  memory_size = 256
  timeout     = 60

  dead_letter_config {
    target_arn = aws_sqs_queue.email_dlq.arn
  }

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      SENDER_EMAIL = "noreply@example.com"
      NODE_ENV     = var.environment
    }
  }
}

resource "aws_iam_role" "data_sync" {
  name = "${var.project_name}-${var.environment}-data-sync-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "data_sync_basic" {
  role       = aws_iam_role.data_sync.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "data_sync_vpc" {
  role       = aws_iam_role.data_sync.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy_attachment" "data_sync_s3" {
  role       = aws_iam_role.data_sync.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
}

resource "aws_iam_role_policy_attachment" "data_sync_sns" {
  role       = aws_iam_role.data_sync.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSNSFullAccess"
}

resource "aws_lambda_function" "data_sync" {
  function_name = "${var.project_name}-${var.environment}-data-sync"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.data_sync.arn

  filename         = data.archive_file.data_sync.output_path
  source_code_hash = data.archive_file.data_sync.output_base64sha256

  memory_size                    = 3008
  timeout                        = 900
  reserved_concurrent_executions = 2

  ephemeral_storage {
    size = 1024
  }

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = var.security_group_ids
  }

  tracing_config {
    mode = "Active"
  }

  environment {
    variables = {
      DB_HOST = var.rds_endpoint
    }
  }
}

resource "aws_iam_role" "dlq_processor" {
  name = "${var.project_name}-${var.environment}-dlq-processor-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = { Service = "lambda.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "dlq_processor_basic" {
  role       = aws_iam_role.dlq_processor.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "dlq_processor_sqs" {
  role       = aws_iam_role.dlq_processor.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSQSFullAccess"
}

resource "aws_lambda_function" "dlq_processor" {
  function_name = "${var.project_name}-${var.environment}-dlq-processor"
  runtime       = "nodejs20.x"
  handler       = "index.handler"
  role          = aws_iam_role.dlq_processor.arn

  filename         = data.archive_file.dlq_processor.output_path
  source_code_hash = data.archive_file.dlq_processor.output_base64sha256

  memory_size = 512
  timeout     = 120

  tracing_config {
    mode = "Active"
  }
}

resource "aws_lambda_event_source_mapping" "dlq_processor_source" {
  event_source_arn = aws_sqs_queue.email_dlq.arn
  function_name    = aws_lambda_function.dlq_processor.arn
  batch_size       = 10
  enabled          = true
}

resource "aws_cloudwatch_event_bus" "order_events" {
  name = "order-events"
}

resource "aws_cloudwatch_event_archive" "order_events_archive" {
  name             = "${var.project_name}-${var.environment}-order-events-archive"
  event_source_arn = aws_cloudwatch_event_bus.order_events.arn
  retention_days   = 30
}

resource "aws_cloudwatch_event_rule" "order_created" {
  name           = "${var.project_name}-${var.environment}-order-created"
  event_bus_name = aws_cloudwatch_event_bus.order_events.name

  event_pattern = jsonencode({
    source      = ["com.myapp.orders"]
    "detail-type" = ["OrderCreated"]
  })
}

resource "aws_cloudwatch_event_target" "order_created_email" {
  rule           = aws_cloudwatch_event_rule.order_created.name
  event_bus_name = aws_cloudwatch_event_bus.order_events.name
  target_id      = "email-notifier"
  arn            = aws_lambda_function.email_notifier.arn

  retry_policy {
    maximum_retry_attempts       = 2
    maximum_event_age_in_seconds = 3600
  }

  dead_letter_config {
    arn = aws_sqs_queue.email_dlq.arn
  }
}

resource "aws_lambda_permission" "allow_eventbridge_email" {
  statement_id  = "AllowExecutionFromEventBridgeEmail"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.email_notifier.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.order_created.arn
}

resource "aws_cloudwatch_event_rule" "data_sync" {
  name                = "${var.project_name}-${var.environment}-data-sync"
  schedule_expression = "cron(0 2 * * ? *)"
}

resource "aws_cloudwatch_event_target" "data_sync_target" {
  rule      = aws_cloudwatch_event_rule.data_sync.name
  target_id = "data-sync"
  arn       = aws_lambda_function.data_sync.arn
}

resource "aws_lambda_permission" "allow_eventbridge_data_sync" {
  statement_id  = "AllowExecutionFromEventBridgeDataSync"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.data_sync.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.data_sync.arn
}
