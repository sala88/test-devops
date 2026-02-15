# App Backend Helm Chart

This Helm chart deploys the Backend API application.

## Structure

- `templates/deployment.yaml`: Main application Deployment
- `templates/service.yaml`: ClusterIP Service
- `templates/ingress.yaml`: Ingress configuration
- `templates/hpa.yaml`: Horizontal Pod Autoscaler
- `templates/configmap.yaml`: Environment variables
- `templates/secret.yaml`: Sensitive data (passwords, tokens)

## Values

See `values.yaml` for default configuration.
Use `values-prod.yaml` or `values-staging.yaml` for environment specific overrides.
