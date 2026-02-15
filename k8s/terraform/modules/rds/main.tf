# Security Group for RDS
resource "aws_security_group" "rds" {
  name        = "${var.project_name}-${var.environment}-rds"
  description = "Allow MySQL access from EKS nodes"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [var.eks_security_group_id]
  }
}

# RDS Instance
resource "aws_db_instance" "default" {
  identifier        = "${var.project_name}-${var.environment}-db"
  allocated_storage = 20
  storage_type      = "gp3"
  engine            = "mysql"
  engine_version    = "8.0"
  instance_class    = "db.t3.micro"
  db_name           = var.db_name
  username          = var.db_username
  password          = "ChangeMe123!" # In prod use Secrets Manager
  
  db_subnet_group_name   = aws_db_subnet_group.default.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  
  skip_final_snapshot = true
}

resource "aws_db_subnet_group" "default" {
  name       = "${var.project_name}-${var.environment}-main"
  subnet_ids = var.subnet_ids

  tags = {
    Name = "My DB subnet group"
  }
}

# RDS Proxy
resource "aws_iam_role" "rds_proxy_role" {
  name = "rds-proxy-role-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "rds.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_db_proxy" "proxy" {
  name                   = "${var.project_name}-proxy-${var.environment}"
  debug_logging          = false
  engine_family          = "MYSQL"
  idle_client_timeout    = 1800
  require_tls            = true
  role_arn               = aws_iam_role.rds_proxy_role.arn
  vpc_subnet_ids         = var.subnet_ids
  vpc_security_group_ids = [aws_security_group.rds.id]

  auth {
    auth_scheme = "SECRETS"
    description = "example"
    iam_auth    = "DISABLED"
    secret_arn  = "arn:aws:secretsmanager:region:account:secret:example" # Placeholder
  }
}

output "rds_endpoint" {
  value = aws_db_instance.default.endpoint
}

output "proxy_endpoint" {
  value = aws_db_proxy.proxy.endpoint
}
