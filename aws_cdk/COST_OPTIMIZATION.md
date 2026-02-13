# AWS Serverless Cost Optimization

Questa analisi dettaglia i costi stimati dell'architettura **Serverless** implementata e le strategie adottate per l'ottimizzazione (FinOps).

## Stima Costi Mensili (Region: eu-south-1 / Milan)

### Soluzione Implementata (AWS CDK Serverless)
| Servizio | Configurazione (Pay-per-Use) | Costo Mensile (Est.) |
|----------|------------------------------|----------------------|
| **Compute (Lambda)** | 1M richieste, 512MB RAM, 200ms avg | ~$3.00 |
| **API Gateway** | 1M richieste REST API | ~$3.50 |
| **Frontend (S3+CF)** | Hosting Statico + 10GB Data Transfer | ~$1.00 |
| **RDS MySQL** | db.t3.micro (Single AZ) | ~$13.00 |
| **ElastiCache Redis** | cache.t3.micro | ~$12.00 |
| **DynamoDB** | Pay-per-request (On-Demand) | < $1.00 (per bassi volumi) |
| **VPC Networking** | NAT Gateway (per Lambda private) | ~$32.00 |
| **EventBridge** | Custom Events (1M events) | ~$1.00 |
| **TOTALE** | | **~$66.50 / mese** |

> **Nota:** Il costo principale è il **NAT Gateway** per permettere alle Lambda private di uscire su internet. In ambienti dev, si può risparmiare usando VPC Endpoints o solo subnet pubbliche (se la security policy lo permette), abbattendo il costo a ~$35/mese.

---

## Strategie di Ottimizzazione Costi Implementate

### 1. Compute: Lambda vs Containers
*   **Strategia:** Utilizzo esclusivo di AWS Lambda (FaaS).
*   **Impatto:** Costo zero quando l'applicazione non è utilizzata (idle). Nessun costo fisso per server EC2 o cluster EKS Control Plane (~$73/mese risparmiati solo di control plane).

### 2. Networking: CloudFront vs Load Balancer
*   **Strategia:** Sostituzione dell'Application Load Balancer (ALB) con CloudFront per il frontend.
*   **Impatto:** Risparmio di ~$18/mese (costo fisso ALB). CloudFront ha un generoso Free Tier e costa solo per il traffico uscente.

### 3. Database: On-Demand & Burstable
*   **Strategia:**
    *   **DynamoDB:** Modalità `PAY_PER_REQUEST` per evitare costi di provisioned capacity non utilizzata.
    *   **RDS/Redis:** Utilizzo di istanze della famiglia `t3` (burstable) che offrono il miglior rapporto prezzo/prestazioni per carichi variabili.

### 4. Storage: S3 Tiering
*   **Strategia:** Hosting statico su S3 invece che container Nginx.
*   **Impatto:** Costo storage trascurabile ($0.023/GB) rispetto a volumi EBS provisioned ($0.08/GB).

### 5. Log Retention (CloudWatch)
*   **Strategia:** Configurazione esplicita della retention dei log a **30 giorni** (o 1 settimana in dev).
*   **Impatto:** Evita costi esponenziali di storage log per dati vecchi non necessari ("Log Waste").

### 6. Reserved Concurrency
*   **Strategia:** Limiti di concorrenza impostati sulle Lambda (es. `BackendLambda: 50`).
*   **Impatto:** Previene costi imprevisti dovuti a loop infiniti o attacchi DDoS che potrebbero scalare le Lambda all'infinito.
