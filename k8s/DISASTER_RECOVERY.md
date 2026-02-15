# Disaster Recovery Plan

## 1. MySQL Recovery

### Procedura di Backup
Eseguire lo script automatico:
```bash
./k8s/scripts/backup_mysql.sh
```
Questo crea un dump compresso in `k8s/backups/`.

### Procedura di Restore
Per ripristinare il database da un backup:

1.  **Copiare il file di backup nel pod MySQL:**
    ```bash
    kubectl cp k8s/backups/backup_YYYYMMDD_HHMMSS.sql.gz production/<mysql-pod>:/tmp/backup.sql.gz
    ```

2.  **Eseguire il restore:**
    ```bash
    kubectl exec -it -n production <mysql-pod> -- /bin/bash -c "gunzip < /tmp/backup.sql.gz | mysql -u root -pchangeme appdb"
    ```

---

## 2. Redis Recovery
Poiché Redis è configurato con AOF (`appendonly yes`) e PVC persistente:
1.  In caso di crash del pod, Kubernetes lo riavvia e i dati vengono ricaricati dal disco.
2.  In caso di corruzione del PVC, eliminare il PVC e ripartire da zero (cache miss iniziale) o ripristinare snapshot (se disponibile su AWS/GCP).

---

## 3. Full Cluster Recovery
In caso di perdita totale del cluster (es. regione AWS giù):

1.  **Infrastruttura**:
    ```bash
    cd k8s/terraform
    tofu apply -var="region=nuova-regione"
    ```

2.  **Applicazioni**:
    ```bash
    ./k8s/deploy.sh
    ```

3.  **Dati**:
    *   Ripristinare snapshot RDS/EBS dall'ultima copia cross-region.
    *   O usare la procedura MySQL Restore sopra se si hanno i dump.
