# Cost Optimization & Estimation (AWS & GCP)

## 1. Strategie di Ottimizzazione

### Calcolo (Compute)
*   **Spot / Preemptible VMs**:
    *   **AWS**: Utilizzare nodi Spot per i Node Group EKS stateless (Backend/Frontend), risparmiando fino al 90%. Configurazione: `capacity-type: SPOT`.
    *   **GCP**: Utilizzare **Spot VMs** (ex Preemptible) per i node pool GKE. Risparmio simile (60-91%). Configurazione: `spot: true` nel node pool.
*   **Auto Scaling**:
    *   Scalare a zero i nodi di sviluppo fuori orario lavorativo usando Cluster Autoscaler o Karpenter (AWS) / NAP (GCP).
*   **Right Sizing**: Monitorare CPU/RAM reali con Prometheus e aggiustare `requests/limits` per evitare over-provisioning.
*   **GCP Custom Machine Types**: Su GCP, creare VM con CPU/RAM esatte necessarie se le taglie standard sono troppo grandi.

### Database (RDS / Cloud SQL)
*   **Stop/Start Schedule**: Spegnere le istanze DB di sviluppo di notte e nel weekend (risparmio ~60%).
*   **Reserved / Committed Use**:
    *   **AWS**: Reserved Instances (1-3 anni).
    *   **GCP**: Committed Use Discounts (CUD) per 1 o 3 anni.
*   **Storage**:
    *   **AWS**: Usare `gp3` invece di `io1`.
    *   **GCP**: Usare Standard Persistent Disk o Balanced PD invece di SSD se gli IOPS non sono critici.

### Networking
*   **Traffic Interno**:
    *   **AWS**: Usare Gateway Endpoints per S3/DynamoDB (gratuiti).
    *   **GCP**: Private Google Access permette alle VM senza IP pubblico di raggiungere le API Google internamente.
*   **NAT Gateway / Cloud NAT**:
    *   **AWS**: Costoso (~$32/mese + traffico). Condividere un NAT Gateway per tutte le AZ in dev.
    *   **GCP**: Cloud NAT ha un costo fisso basso ma si paga per il traffico. Usare istanze con IP pubblico effimero in Dev (con firewall stretti) per azzerare costi NAT.

---

## 2. Stima Costi Mensili (Esempio Small Cluster)

Questa stima considera un ambiente di test/produzione leggero (es. `eu-west-1` o `europe-west1`).

| Voce di Costo | AWS (Stimato) | GCP (Stimato) | Note |
| :--- | :--- | :--- | :--- |
| **Control Plane** | $73.00 (EKS) | ~$73.00 (GKE Standard) | GKE Autopilot o Zonal (gratis 1 cluster) |
| **Worker Nodes** | $60.00 (2x t3.medium) | ~$50.00 (2x e2-medium) | e2-medium è shared core simile a t3 |
| **Storage (Root)** | $3.20 (40GB gp3) | ~$3.00 (40GB Std PD) | |
| **Load Balancer** | $18.00 (ALB) | ~$18.00 (L7 LB) | Costo base + forwarding rules |
| **NAT / Egress** | $32.00+ (NAT GW) | $15.00+ (Cloud NAT) | GCP NAT non ha costo orario fisso alto come AWS |
| **Database** | $13.00 (RDS t3.micro) | ~$15.00 (SQL db-f1-micro) | Cloud SQL micro è shared core |
| **Cache** | $12.00 (ElastiCache) | ~$12.00 (Memorystore) | O Redis su container per dev (Gratis) |
| **TOTALE** | **~$211.20** | **~$186.00** | **GKE Zonal gratuito risparmia $73** |

### Note Specifiche
*   **GCP Free Tier**: GKE offre un cluster Zonale gratuito (si pagano solo i nodi). Questo ridurrebbe il totale GCP a **~$113.00**.
*   **Spot Savings**: L'uso di Spot/Preemptible VMs ridurrebbe la voce Worker Nodes di circa il 60-70% su entrambi.
