# Kubernetes Provider configuration is already in provider.tf
# This file can be used for specific Kubernetes resources managed via Terraform (not Helm)

resource "kubernetes_namespace" "production" {
  metadata {
    name = "production"
    labels = {
      environment = var.environment
    }
  }
}
