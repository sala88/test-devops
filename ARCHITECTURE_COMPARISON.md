# Confronto Architetturale: K8s vs Serverless (AWS)

Questo documento confronta l’architettura Kubernetes (EKS/GKE) implementata in `k8s/` con l’architettura Serverless (Lambda + EventBridge + API Gateway) presente in `aws_cdk/`. Il focus è soprattutto su **modello architetturale e operativo**, con una sezione finale dedicata ai costi.

---

## 1. Panoramica implementazioni

- **K8s (`k8s/`)**
  - Cluster EKS/GKE con VPC dedicata, node group gestito e NAT.
  - Backend Node.js, MySQL e Redis deployati via Helm (Deployment/StatefulSet + PVC).
  - Ingress (ALB/GCE) con TLS e path `/` e `/api/*`.
  - Osservabilità con Prometheus + Fluent‑bit e script `deploy.sh`/backup/DR.

- **Serverless (`aws_cdk/`)**
  - API Gateway REST con Lambda `OrderProcessor` per gestione ordini.
  - EventBridge `order-events` con regole per Email Notifier, Data Sync e DLQ.
  - Storage gestito: DynamoDB per ordini, RDS MySQL, ElastiCache Redis, S3 per statici e data‑lake.
  - Frontend su S3 + CloudFront, path `/api/*` verso API Gateway.

## 2. Flussi principali

- **K8s – richiesta web classica**
  - Utente → DNS → Ingress/LB → Nginx frontend → backend → MySQL/Redis.

- **Serverless – ordine sincrono**
  - Client → API Gateway `/api/orders` → Lambda `OrderProcessor` → DynamoDB.
  - In parallelo pubblica evento `OrderCreated` su EventBridge.

- **Serverless – email asincrona**
  - Evento `OrderCreated` → regola `order.created` → Lambda `EmailNotifier` → SES.
  - Errori dopo i retry → SQS DLQ → `DLQProcessor` (S3 + SNS/Slack).

- **Serverless – data sync**
  - Regola cron EventBridge (2:00) → `DataSync` → RDS → dump compresso su S3 + notifica SNS.

## 3. Confronto Architetturale

- **Modello di esecuzione**
  - K8s: pod sempre attivi, ideale per traffico costante e servizi long‑running.
  - Serverless: funzioni on‑demand con cold start ma scaling molto rapido.
    Cold start rilevante solo per funzioni VPC-attached e workload sporadici; mitigabile con provisioned concurrency o architettura ibrida.

- **Gestione stato**
  - K8s: DB/cache vicini al cluster (StatefulSet + PV/PVC) o servizi gestiti esterni. In produzione reale, DB e cache vengono quasi sempre esternalizzati (RDS / ElastiCache), riducendo il vantaggio “tutto in cluster”.
  - Serverless: DB/cache sempre servizi gestiti; funzioni totalmente stateless.

- **Event‑driven**
  - K8s: principalmente request/response; per event‑driven servono code/bus aggiuntivi (Kafka/NATS/RabbitMQ).
  - Serverless: EventBridge, SQS, SNS e DLQ sono primi cittadini dell’architettura.

- **Osservabilità**
  - K8s: Prometheus, Fluent‑bit, ServiceMonitor, dashboard custom → grande controllo ma più manutenzione.
  - Serverless: CloudWatch, X‑Ray, metriche EventBridge → meno componenti, strumenti legati al provider.

- **Resilienza e DR**
  - K8s: cluster multi‑AZ, snapshot RDS/PV e script DR (`deploy.sh`, Terraform).
  - Serverless: servizi HA di default; DR via replica dati e redeploy CDK.

- **Portabilità e lock‑in**
  - K8s: portabilità multi‑cloud elevata (chart simili su GKE/EKS).
  - Serverless: forte lock‑in AWS ma con drastica riduzione della gestione infrastrutturale.

- **Complessità operativa**
  - K8s: richiede skill Kubernetes e gestione sicurezza/versioni del cluster.
  - Serverless: complessità spostata su design di flussi, permessi IAM e limiti dei servizi.

---

## 4. Confronto Costi (Scenario ~1M richieste/mese)

I numeri sottostanti riassumono i dettagli presenti in:

- `k8s/COST_OPTIMIZATION.md` (cluster K8s su AWS/GCP)
- `aws_cdk/COST_OPTIMIZATION.md` (stack Serverless AWS)

### 4.1 Riepilogo numerico

| Voce di costo     | K8s (EKS, 2 nodi) | Serverless (AWS)              | Note principali                          |
|-------------------|-------------------|-------------------------------|------------------------------------------|
| Control plane     | ~$73/mese         | 0                             | EKS/GKE fatturano il control plane       |
| Worker compute    | ~$60/mese         | ~$3/mese (Lambda)            | 2× t3.medium vs 1M invocazioni Lambda    |
| Ingress / API     | ~$18/mese (ALB)   | ~$3.5/mese (API Gateway)     | L7 LB vs API GW pay‑per‑request          |
| NAT / egress      | ~$32+/mese        | ~$32/mese (NAT per Lambda VPC)| Entrambe usano NAT in VPC privata        |
| Database MySQL    | ~$13/mese         | ~$13/mese                    | RDS t3.micro in entrambi i casi          |
| Cache Redis       | ~$12/mese         | ~$12/mese                    | ElastiCache cache.t3.micro               |
| Storage / S3      | ~$3/mese          | ~$1–3/mese                   | Root disk vs S3 per statici/dump         |
| DynamoDB          | n/a               | < $1/mese                    | Ordini pay‑per‑request                   |
| EventBridge/SNS   | n/a               | ~ $1–2/mese                  | Event bus + eventi + notifiche           |
| **Totale stimato**| **~200–210$/mese**| **~60–70$/mese**             | Scenario 1M richieste/mese               |

Con ottimizzazioni (Spot/Preemptible, GKE control plane gratis, VPC Endpoints ecc.):

- **K8s** può scendere intorno a **~110–150$/mese** a seconda della piattaforma (soprattutto grazie al control plane GKE gratuito e ai nodi Spot).
- **Serverless** può scendere verso **~35–40$/mese** riducendo il costo del NAT (VPC Endpoints o subnet pubbliche in dev) e con carichi reali inferiori a 1M richieste.

### 4.2 Lettura del confronto

- A parità di traffico moderato (~1M richieste/mese), lo stack Serverless costa **circa 1/3** rispetto al cluster K8s.
- La differenza maggiore è data da:
  - costi fissi di **control plane + worker nodes** in K8s,
  - modello **pay‑per‑use** di Lambda/API Gateway nel serverless.
- I servizi condivisi (RDS, Redis, NAT) pesano in modo simile in entrambe le architetture.
 - Oltre ~10–20M richieste/mese con traffico costante, K8s tende a diventare più conveniente del serverless.

### 4.3 Quando scegliere cosa

- **Preferire K8s se:**
  - Hai molti servizi eterogenei, job batch complessi, componenti di terze parti che devono girare come container.
  - Vuoi portabilità tra cloud o ambienti on‑prem.
  - Hai già un team con forte skill su Kubernetes.
- **Preferire Serverless se:**
  - Il carico è variabile o moderato e vuoi minimizzare i costi a basso traffico.
  - Il dominio è naturalmente event‑driven (eventi `OrderCreated`, DLQ, job schedulati).
  - Vuoi ridurre al minimo la gestione di server/cluster e concentrarti sul codice applicativo.
