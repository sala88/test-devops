# Troubleshooting Guide & Debugging Scenarios

## 1. Pod in CrashLoopBackOff

Il `CrashLoopBackOff` indica che il container si avvia ma termina quasi subito con un errore, e Kubernetes continua a provare a riavviarlo.

### Diagnostica
Comandi per investigare:
```bash
# 1. Controlla lo stato dei pod
kubectl get pods -n production

# 2. Leggi i log del pod (corrente e precedente)
kubectl logs <pod-name> -n production
kubectl logs <pod-name> -n production --previous

# 3. Ispeziona gli eventi e la configurazione
kubectl describe pod <pod-name> -n production
```

### Possibili cause (API Backend)
*   **Configurazione errata**: Variabili d'ambiente mancanti o errate (es. `DB_HOST`, `DB_PASSWORD`).
*   **Dipendenze non pronte**: Il database non è ancora raggiungibile e l'app non gestisce il retry.
*   **Errori applicativi**: Eccezioni non gestite all'avvio (es. migrazioni fallite).
*   **Health Check falliti**: Liveness probe configurata male o troppo aggressiva che uccide il pod prima che sia pronto.

---

## 2. Ingress non riceve traffico

### Verifica Configurazione
```bash
# 1. Controlla lo stato dell'Ingress (Address assegnato?)
kubectl get ingress -n production

# 2. Dettagli Ingress (Backend services corretti?)
kubectl describe ingress <ingress-name> -n production

# 3. Log dell'Ingress Controller (Nginx/ALB)
kubectl logs -n kube-system -l app.kubernetes.io/name=ingress-nginx
```

### Test Routing
```bash
# Test diretto con Host Header (se DNS non propagato)
curl -v -H "Host: api.example.com" http://<LOAD_BALANCER_IP>/api/health
```

---

## 3. MySQL non si connette

### Verifica Connectivity
Dal pod backend:
```bash
# 1. Apri una shell nel pod backend
kubectl exec -it <backend-pod> -n production -- /bin/sh

# 2. Test risoluzione DNS
nslookup mysql-service

# 3. Test connessione TCP (se telnet/nc installati)
nc -zv mysql-service 3306
```

### Network Policies
Verifica se ci sono policy che bloccano il traffico:
```bash
kubectl get networkpolicies -n production
kubectl describe networkpolicy <policy-name> -n production
```
*   **Causa comune**: Una `DefaultDeny` policy è attiva e manca una regola `Allow` specifica per il traffico `Backend -> MySQL` sulla porta 3306.
