# AWS CDK Infrastructure

Questa directory contiene il codice Infrastructure as Code (IaC) basato su AWS CDK (TypeScript).

## Struttura
*   **infrastructure/**: Codice CDK per EKS, VPC, etc.
*   **app/**: Codice sorgente originale (backend/frontend) e Lambda functions.

## Deploy Infrastruttura (EKS)

### Prerequisiti
*   Node.js installato
*   AWS CLI configurata

### Passaggi
1.  Entra nella directory infrastructure:
    ```bash
    cd infrastructure
    ```
2.  Installa dipendenze:
    ```bash
    npm install
    ```
3.  Esegui il deploy dello stack EKS:
    ```bash
    npx cdk deploy EksStack
    ```
4.  Configura `kubectl` (usa il comando dall'output del deploy):
    ```bash
    aws eks update-kubeconfig --name devops-cluster --region <tua-regione>
    ```

## Lambda Functions (Opzionale)
Se desideri deployare anche le Lambda functions (parte serverless):
```bash
npx cdk deploy CdkStack
```
