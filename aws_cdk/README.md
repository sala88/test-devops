# DevOps Technical Test - AWS Serverless Architecture (No-Ops)

## Overview
Questo progetto risponde ai requisiti del **DevOps Technical Test** implementando un'architettura **Cloud-Native Serverless** su AWS invece di Kubernetes.
Questa scelta architetturale è stata fatta per massimizzare l'efficienza operativa, ridurre i costi di gestione del cluster e sfruttare i servizi gestiti AWS (best practice moderne).

## Mappatura Requisiti (Test vs Soluzione)

| Requisito Test (Kubernetes) | Soluzione Implementata (AWS Serverless) | Vantaggio |
|---------------------------|-----------------------------------------|-----------|
| **Cluster K8s (EKS/GKE)** | **AWS CDK Stack (Serverless)** | Nessun overhead di gestione control-plane/nodi. |
| **Backend Deployment** | **AWS Lambda (Docker & Zip)** | Scaling automatico a zero, pay-per-use. |
| **MySQL StatefulSet** | **Amazon RDS MySQL** | Backup automatici, patch management, alta disponibilità gestita. |
| **Redis StatefulSet** | **Amazon ElastiCache Redis** | Performance stabili, gestione patch/versioni automatica. |
| **Frontend Nginx (DaemonSet)** | **S3 + CloudFront** | Performance globali (CDN), costi minimi, zero server maintenance. |
| **Ingress Controller** | **API Gateway + CloudFront** | Sicurezza nativa (WAF capable), throttling, gestione API. |
| **Helm Charts** | **CDK Constructs (TypeScript)** | Type-safety, logica imperativa reale, testabilità unitaria. |
| **PersistentVolume (PVC)** | **DynamoDB / S3** | Storage cloud-native, scalabilità infinita senza gestione dischi. |

## Architettura IaC (CDK)
L'infrastruttura è definita in [cdk-stack.ts](file:///infrastructure/lib/cdk-stack.ts).

### Componenti Principali:
- **Networking**: VPC con subnet isolate (Database/Redis) e private (Lambda) con NAT Gateway gestito (se necessario) o VPC Endpoints.
- **Compute (Serverless)**:
  - `BackendLambda`: API Node.js eseguita come Lambda (Docker Image).
  - `OrderProcessorLambda`: Microservizio Node.js per elaborazione ordini (Zip asset).
  - `API Gateway`: Entry point REST sicuro per le Lambda.
- **Frontend Hosting**:
  - `S3 Bucket`: Hosting statico (Next.js export).
  - `CloudFront`: CDN globale con caching ottimizzato e routing `/api` verso il backend.
- **Data & State**:
  - `RDS MySQL`: Database relazionale.
  - `ElastiCache Redis`: Caching layer.
  - `DynamoDB`: NoSQL per persistenza ordini ad alta velocità.
- **Event-Driven**:
  - `EventBridge`: Bus eventi per disaccoppiare i servizi (es. OrderCreated).

## Deployment
```bash
cd infrastructure
npm install
npx cdk deploy
```

## CI/CD (GitHub Actions)
La pipeline è definita in `.github/workflows/deploy.yml` e si attiva ad ogni push su `main`.

### Setup
1. Configura i seguenti **Secrets** nella repository GitHub:
   - `AWS_REGION`: es. `eu-south-1`
   - `AWS_ACCESS_KEY_ID`: Chiave d'accesso IAM.
   - `AWS_SECRET_ACCESS_KEY`: Segreto IAM.
   - (Opzionale) `AWS_ROLE_ARN`: Se usi OIDC (consigliato).

2. Il workflow esegue automaticamente:
   - Build del Frontend Next.js (`npm run build`).
   - Deploy dell'infrastruttura CDK (`npx cdk deploy`).
