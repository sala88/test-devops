variable "region" {
  description = "AWS Region"
  type        = string
  default     = "eu-south-1"
}

variable "project_name" {
  description = "Nome del progetto"
  type        = string
  default     = "devops-test"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "vpc_cidr" {
  description = "CIDR block per la VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "cluster_name" {
  description = "Nome del cluster EKS"
  type        = string
  default     = "devops-cluster"
}

variable "node_instance_types" {
  description = "Tipi di istanza EC2 per i nodi EKS"
  type        = list(string)
  default     = ["t3.medium"]
}

variable "desired_size" {
  description = "Numero desiderato di nodi"
  type        = number
  default     = 2
}

variable "min_size" {
  description = "Numero minimo di nodi"
  type        = number
  default     = 1
}

variable "max_size" {
  description = "Numero massimo di nodi"
  type        = number
  default     = 3
}
