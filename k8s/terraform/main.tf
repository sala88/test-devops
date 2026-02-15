module "vpc" {
  source = "./modules/vpc"

  environment = var.environment
  cidr_block  = var.vpc_cidr
  region      = var.aws_region
}

module "eks" {
  source = "./modules/eks"

  environment     = var.environment
  cluster_name    = "${var.project_name}-${var.environment}"
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnet_ids
  instance_types  = var.node_instance_types
  min_size        = var.node_min_size
  max_size        = var.node_max_size
  desired_size    = var.node_desired_size
}

module "rds" {
  source = "./modules/rds"

  environment         = var.environment
  project_name        = var.project_name
  vpc_id              = module.vpc.vpc_id
  subnet_ids          = module.vpc.database_subnet_ids
  eks_security_group_id = module.eks.node_security_group_id
  db_name             = var.db_name
  db_username         = var.db_username
}

module "lambda" {
  source = "./modules/lambda"

  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  security_group_ids = [module.eks.node_security_group_id]
  rds_endpoint       = module.rds.rds_endpoint
}
