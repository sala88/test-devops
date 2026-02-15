# Modulo Network (VPC)
module "network" {
  source = "./modules/network"

  vpc_cidr     = var.vpc_cidr
  project_name = var.project_name
  environment  = var.environment
  cluster_name = var.cluster_name
}

# Modulo IAM (Roles & Policies)
module "iam" {
  source = "./modules/iam"

  project_name = var.project_name
  environment  = var.environment
}

# Modulo EKS Cluster
module "eks" {
  source = "./modules/eks"

  cluster_name    = var.cluster_name
  project_name    = var.project_name
  environment     = var.environment
  vpc_id          = module.network.vpc_id
  subnet_ids      = module.network.private_subnet_ids
  cluster_role_arn = module.iam.eks_cluster_role_arn
  node_role_arn    = module.iam.eks_node_role_arn
  
  node_instance_types = var.node_instance_types
  desired_size        = var.desired_size
  min_size            = var.min_size
  max_size            = var.max_size
}

# Modulo RDS (MySQL)
module "rds" {
  source = "./modules/rds"

  project_name       = var.project_name
  environment        = var.environment
  vpc_id             = module.network.vpc_id
  subnet_ids         = module.network.database_subnet_ids
  eks_security_group_id = module.eks.cluster_security_group_id
}
