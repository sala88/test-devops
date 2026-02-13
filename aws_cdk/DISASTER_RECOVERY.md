# AWS Serverless Disaster Recovery & Business Continuity

Questa guida definisce le strategie di backup, ripristino e monitoraggio per l'infrastruttura Serverless implementata con AWS CDK.

## 1. Backup Strategy (RPO/RTO)

| Servizio | Strategia Backup | RPO (Data Loss Max) | RTO (Recovery Time) |
|----------|------------------|---------------------|---------------------|
| **RDS MySQL** | Automated Snapshots (7 giorni) | 5 minuti (Point-in-Time) | < 30 minuti |
| **DynamoDB** | Point-in-Time Recovery (PITR) | 1 secondo | < 15 minuti |
| **S3 (Data Lake)** | Versioning + Replication (Opz.) | 0 (Immediato) | Immediato |
| **Code/Infra** | Git Repository (GitHub) | Last Commit | ~10 min (CDK Deploy) |

---

## 2. Procedure di Ripristino (DR)

### Database Recovery (RDS MySQL)
In caso di corruzione dati o cancellazione accidentale tabella:
1.  **Identifica:** Trova il timestamp esatto prima dell'incidente.
2.  **Restore:**
    *   Console AWS -> RDS -> Backups -> Automated backups.
    *   Seleziona l'istanza DB -> Actions -> **Restore to point in time**.
    *   Specifica il timestamp e un nuovo DB Identifier (es. `myapp-db-restored`).
3.  **Switchover:**
    *   Aggiorna lo stack CDK o il Secret `db-credentials` per puntare al nuovo endpoint.
    *   Opzionale: Rinomina il vecchio DB e promuovi il nuovo (richiede reboot).

### DynamoDB Recovery
1.  **Restore:**
    *   Console AWS -> DynamoDB -> Backups -> **Point-in-time recovery**.
    *   Seleziona la tabella -> Restore.
    *   Scegli "Latest possible time" o "Custom date and time".
2.  **Update:**
    *   La tabella restaurata avrà un nome nuovo. Aggiorna la variabile d'ambiente `DYNAMODB_TABLE` nelle Lambda via CDK o Console per puntare alla nuova tabella.

### Frontend Rollback (S3 + CloudFront)
Se un deploy introduce bug critici nel frontend:
1.  **Via GitHub Actions (Consigliato):**
    *   Vai su Actions -> Workflow `Deploy to AWS`.
    *   Seleziona l'ultimo run verde -> **Re-run jobs**.
2.  **Via S3 Versioning (Emergenza):**
    *   Il bucket S3 ha il versioning abilitato. Puoi ripristinare la versione precedente di `index.html` e asset critici tramite CLI o Console.
    *   Invalidare la cache CloudFront: `aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"`.

---

## 3. High Availability & Region Failover

### Architettura Multi-AZ (Attiva)
*   **RDS:** Configurato come Multi-AZ (se in prod) per failover automatico in caso di problemi hardware.
*   **Lambda/DynamoDB/S3:** Servizi regionali intrinsecamente HA. AWS gestisce la replica su più AZ automaticamente.

### Disaster Recovery Regionale (Passive)
Se l'intera region `eu-south-1` (Milano) diventa indisponibile:
1.  **Deploy in nuova Region:**
    *   Cambia `REGION="eu-central-1"` (Francoforte) nella pipeline.
    *   Esegui `cdk deploy`.
2.  **Dati:**
    *   *Nota:* Senza Cross-Region Replication (CRR) attiva su S3 e RDS (costo extra), i dati storici non saranno disponibili.
    *   Con CRR attiva: Promuovi le repliche di Francoforte a Master.

---

## 4. Monitoring & Observability (Serverless Native)

Invece di sidecar (Prometheus/Fluentd), utilizziamo servizi AWS nativi completamente gestiti:

### Logging (CloudWatch Logs)
*   **Centralizzazione:** Tutti i log di Lambda, API Gateway e CodeBuild finiscono automaticamente in CloudWatch Log Groups.
*   **Insights:** Usa **CloudWatch Logs Insights** per query avanzate:
    ```sql
    fields @timestamp, @message
    | filter @message like /Error/
    | sort @timestamp desc
    ```

### Metrics & Alarms (CloudWatch Metrics)
*   **Dashboard:** Monitoraggio unificato di:
    *   Lambda: `Duration`, `Invocations`, `Errors`, `Throttles`.
    *   API Gateway: `4xxError`, `5xxError`, `Latency`.
    *   RDS: `CPUUtilization`, `FreeStorageSpace`.
*   **Allarmi Critici:**
    *   `LambdaErrorRate > 1%` (Notifica SNS).
    *   `RDS CPU > 80%`.

### Tracing (AWS X-Ray)
*   Abilitato (`Tracing.ACTIVE`) su tutte le Lambda.
*   Fornisce "Service Map" visuale per identificare colli di bottiglia (es. query SQL lente o chiamate esterne) e tracciare la richiesta dall'utente fino al DB.
