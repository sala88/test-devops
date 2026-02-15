# VPC Module using AWS standard module for simplicity and best practices
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "${var.environment}-vpc"
  cidr = var.cidr_block

  azs             = ["${var.region}a", "${var.region}b", "${var.region}c"]
  private_subnets = [for i in [0, 1, 2] : cidrsubnet(var.cidr_block, 8, i)]
  public_subnets  = [for i in [0, 1, 2] : cidrsubnet(var.cidr_block, 8, i + 100)]
  database_subnets = [for i in [0, 1, 2] : cidrsubnet(var.cidr_block, 8, i + 200)]

  enable_nat_gateway   = true
  single_nat_gateway   = true # Save costs for dev/test
  enable_dns_hostnames = true
  enable_dns_support   = true

  # Tagging for EKS auto-discovery
  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "private_subnet_ids" {
  value = module.vpc.private_subnets
}

output "public_subnet_ids" {
  value = module.vpc.public_subnets
}

output "database_subnet_ids" {
  value = module.vpc.database_subnets
}
