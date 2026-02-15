module "serverless" {
  source = "../../terraform/modules/serverless"

  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = var.vpc_id
  private_subnet_ids = var.private_subnet_ids
  security_group_ids = var.security_group_ids
  rds_endpoint       = var.rds_endpoint
  cache_endpoint     = var.cache_endpoint
}
