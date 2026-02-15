# Kubernetes (K8s) & Helm Charts

Questa directory contiene tutto il necessario per deployare lo stack applicativo su Kubernetes.

## Struttura
*   **terraform/**: Infrastructure as Code (OpenTofu/Terraform) per creare il cluster EKS e risorse AWS correlate.
*   **charts/**: Helm charts per i componenti (app-backend, mysql, redis, frontend).
*   **app/**: Codice sorgente delle applicazioni containerizzate.

## 1. Deploy Infrastruttura (Terraform)

Il codice Terraform si trova nella directory `terraform/`.

### Inizializzazione e Apply
```bash
cd terraform
tofu init
tofu plan -out=tfplan
tofu apply tfplan
```
*Output attesi*: `cluster_endpoint`, `vpc_id`, `rds_endpoint`.

### Configurazione Kubectl
Dopo il deploy, configura `kubectl` per interagire con il nuovo cluster:
```bash
aws eks update-kubeconfig --region eu-west-1 --name devops-test-dev
```

## 2. Deploy Applicazioni (Helm)

Una volta che l'infrastruttura è pronta e `kubectl` è configurato:

### Preparazione Namespace
```bash
kubectl create ns production
```

### Deploy MySQL (Database)
```bash
helm install mysql ./charts/mysql -n production -f ./charts/mysql/values-prod.yaml
```

### Deploy Redis (Cache)
```bash
helm install redis ./charts/redis -n production -f ./charts/redis/values-prod.yaml
```

### 4. Deploy Backend
Attendi che MySQL e Redis siano pronti, poi:
```bash
helm install backend ./charts/app-backend -n production -f ./charts/app-backend/values-prod.yaml
```

### Deploy Frontend
```bash
helm install frontend ./charts/frontend -n production -f ./charts/frontend/values-prod.yaml
```

## Verifica
```bash
kubectl get pods -n production
kubectl get ingress -n production
```
