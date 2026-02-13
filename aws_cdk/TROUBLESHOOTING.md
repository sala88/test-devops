# AWS Serverless Troubleshooting Guide

Questa guida fornisce procedure pratiche per diagnosticare e risolvere problemi comuni nell'architettura Serverless (AWS CDK) implementata.

## 1. Backend API Errors (API Gateway + Lambda)

### Scenario: API Gateway restituisce 500/502 Error
**Possibili Cause:**
*   Eccezioni non gestite nel codice Node.js.
*   Timeout della Lambda (default 30s) per connessioni lente al DB.
*   Problemi di memoria (OOM).

**Diagnostica:**
1.  **CloudWatch Logs:**
    *   Vai su AWS Console -> CloudWatch -> Log groups.
    *   Filtra per `/aws/lambda/CdkStack-BackendLambda...`.
    *   Cerca stringhe come `Runtime.ImportModuleError`, `Error`, o `Timeout`.
2.  **Lambda Console:**
    *   Tab "Monitor" -> Visualizza grafici "Error count" e "Duration".
    *   Verifica se la durata media è vicina al timeout impostato.
3.  **X-Ray Traces:**
    *   Se attivo, usa X-Ray per vedere dove si blocca la richiesta (es. chiamata a RDS o Secrets Manager).

**Risoluzione:**
*   **Codice:** Fix bug basati sullo stack trace.
*   **Timeout:** Se è un timeout di connessione DB, verifica i Security Groups (vedi Sezione 3).
*   **Memoria:** Aumenta la memoria nella definizione CDK se i log indicano "Task timed out" con memoria satura.

---

## 2. Frontend Connectivity Issues (CloudFront)

### Scenario: Sito irraggiungibile o errori 403/404
**Sintomi:** `curl https://d123.cloudfront.net` fallisce o restituisce errore.

**Diagnostica:**
1.  **CloudFront Console:**
    *   Verifica Status: deve essere **Deployed** ed **Enabled**.
    *   Verifica Origins: L'origine S3 è configurata correttamente?
2.  **API Routing:**
    *   Se falliscono solo le chiamate `/api/*`: Controlla i "Behaviors" in CloudFront. Il path pattern `/api/*` deve puntare all'origine API Gateway.
3.  **Test Isolato:**
    *   Chiama direttamente l'API Gateway (`https://<api-id>.execute-api...`) per escludere problemi di CloudFront.

**Risoluzione:**
*   **403 Forbidden:** Verifica la OAI (Origin Access Identity) su S3 bucket policy. Il bucket non deve essere pubblico, ma accessibile solo da CloudFront.
*   **404 Not Found:** Verifica che i file statici (HTML/JS/CSS) siano effettivamente presenti nel bucket S3 (cartella `out/` di Next.js).

---

## 3. Database Connectivity (RDS MySQL)

### Scenario: Lambda non riesce a connettersi al DB
**Sintomi:** Log mostrano `SequelizeConnectionError`, `ETIMEDOUT` o `Connect Timeout`.

**Diagnostica:**
1.  **VPC Reachability Analyzer:**
    *   Crea un'analisi dal Network Interface della Lambda a quella di RDS (porta 3306).
2.  **Security Groups (Checklist):**
    *   **Lambda SG:** Deve permettere Outbound 0.0.0.0/0 (o specifico per subnet DB).
    *   **RDS SG:** Deve permettere **Inbound TCP 3306** specificamente dal Security Group ID della Lambda.
3.  **Subnet Configuration:**
    *   Verifica che la Lambda sia deployata in `vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }`.

**Risoluzione:**
*   Correggi le regole dei Security Group nel CDK (`allowDefaultPortFrom`).
*   Verifica che la password in Secrets Manager (`db-credentials`) sia sincronizzata con quella reale del DB.

---

## 4. Event-Driven Failures (EventBridge & Async Lambdas)

### Scenario: Ordine creato ma Email non inviata o Dati non sincronizzati
**Sintomi:** Flusso interrotto dopo la risposta 201 dell'API.

**Diagnostica:**
1.  **EventBridge Metrics:**
    *   Controlla `Invocations` e `FailedInvocations` per la regola `OrderCreatedRule`.
    *   Verifica se l'evento emesso matcha il pattern definito nella regola.
2.  **Dead Letter Queue (DLQ):**
    *   Controlla la coda SQS `EmailDlq`. Se ci sono messaggi, la Lambda ha fallito dopo i retry.
    *   Ispeziona il messaggio nella DLQ per vedere l'errore (es. `ses:SendEmail` permission denied).
3.  **X-Ray:**
    *   Segui la traccia: API Gateway -> Backend Lambda -> DynamoDB -> EventBridge -> Email Lambda. Identifica il punto di rottura.

**Risoluzione:**
*   **Permessi IAM:** Aggiungi policy mancanti (`events:PutEvents`, `ses:SendEmail`) al ruolo della Lambda.
*   **Payload Mismatch:** Assicurati che il JSON dell'evento abbia i campi `source` e `detail-type` corretti.

---

## 5. DLQ & Message Re-drive

### Scenario: Gestione messaggi falliti definitivamente
Il **DLQ Processor** archivia i fallimenti su S3 e notifica via SNS/Slack.

**Procedura di Recupero (Re-drive):**
1.  **Identifica:** Ricevi notifica SNS/Slack di un fallimento.
2.  **Analizza:** Scarica il log di errore dal bucket S3 (`dlq-archive/`).
3.  **Fix:** Risolvi la causa radice (es. bug nel template email, credenziali scadute).
4.  **Riprocessa:**
    *   Estrai il payload originale dal file S3.
    *   Invia nuovamente l'evento al bus `order-events` tramite AWS CLI o Console:
        ```bash
        aws events put-events --entries file://payload-corretto.json
        ```
