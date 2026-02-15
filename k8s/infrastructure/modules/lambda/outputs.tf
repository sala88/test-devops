output "order_processor_function_name" {
  value = module.serverless.order_processor_function_name
}

output "email_notifier_function_name" {
  value = module.serverless.email_notifier_function_name
}

output "data_sync_function_name" {
  value = module.serverless.data_sync_function_name
}

output "dlq_processor_function_name" {
  value = module.serverless.dlq_processor_function_name
}

output "order_events_bus_arn" {
  value = module.serverless.order_events_bus_arn
}

