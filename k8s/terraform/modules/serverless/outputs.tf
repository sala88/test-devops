output "order_processor_function_name" {
  value = aws_lambda_function.order_processor.function_name
}

output "email_notifier_function_name" {
  value = aws_lambda_function.email_notifier.function_name
}

output "data_sync_function_name" {
  value = aws_lambda_function.data_sync.function_name
}

output "dlq_processor_function_name" {
  value = aws_lambda_function.dlq_processor.function_name
}

output "order_events_bus_arn" {
  value = aws_cloudwatch_event_bus.order_events.arn
}

