#!/bin/bash
set -e

NAMESPACE="production"
CHARTS_DIR="./charts"

echo "============================================"
echo "🚀 Starting Deployment Process..."
echo "============================================"

# 1. Valida i charts Helm
echo "🔍 Validating Helm Charts..."
for chart in "$CHARTS_DIR"/*; do
  if [ -d "$chart" ]; then
    echo "   Linting $(basename "$chart")..."
    helm lint "$chart"
  fi
done

# 2. Preparazione Namespace
echo "🛠 Ensuring Namespace '$NAMESPACE' exists..."
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# 3. Deploy con Helm
echo "📦 Deploying Applications..."

# MySQL
echo "   Deploying MySQL..."
helm upgrade --install mysql "$CHARTS_DIR/mysql" \
  --namespace "$NAMESPACE" \
  -f "$CHARTS_DIR/mysql/values-prod.yaml" \
  --wait

# Redis
echo "   Deploying Redis..."
helm upgrade --install redis "$CHARTS_DIR/redis" \
  --namespace "$NAMESPACE" \
  -f "$CHARTS_DIR/redis/values-prod.yaml" \
  --wait

# Backend
echo "   Deploying Backend..."
helm upgrade --install backend "$CHARTS_DIR/app-backend" \
  --namespace "$NAMESPACE" \
  -f "$CHARTS_DIR/app-backend/values-prod.yaml" \
  --wait

# Frontend
echo "   Deploying Frontend..."
helm upgrade --install frontend "$CHARTS_DIR/frontend" \
  --namespace "$NAMESPACE" \
  -f "$CHARTS_DIR/frontend/values-prod.yaml" \
  --wait

# 4. Attendi che i rollout siano completi (ridondante con --wait ma utile per verifica esplicita)
echo "⏳ Verifying Rollouts..."
kubectl rollout status statefulset/mysql -n "$NAMESPACE"
kubectl rollout status statefulset/redis -n "$NAMESPACE"
kubectl rollout status deployment/app-backend -n "$NAMESPACE"
kubectl rollout status daemonset/frontend -n "$NAMESPACE"

# 5. Esegui smoke tests di base
echo "🔥 Running Smoke Tests..."

# Verifica Pods Running
echo "   Checking Pod Status..."
NOT_RUNNING=$(kubectl get pods -n "$NAMESPACE" --field-selector=status.phase!=Running,status.phase!=Succeeded --no-headers | wc -l)
if [ "$NOT_RUNNING" -ne 0 ]; then
  echo "❌ Error: Some pods are not running!"
  kubectl get pods -n "$NAMESPACE"
  exit 1
else
  echo "✅ All pods are running."
fi

# Verifica Ingress
echo "   Checking Ingress..."
INGRESS_HOST=$(kubectl get ingress app-backend -n "$NAMESPACE" -o jsonpath='{.spec.rules[0].host}')
if [ -z "$INGRESS_HOST" ]; then
  echo "⚠️ Warning: Ingress host not found immediately (might take time for DNS/LB)."
else
  echo "✅ Ingress Host: $INGRESS_HOST"
fi

# Test Endpoint Health (Simulato tramite port-forward se ingress non è raggiungibile da locale)
echo "   Testing API Health (via internal port-forward)..."
# Start port-forward in background
kubectl port-forward svc/app-backend -n "$NAMESPACE" 8080:80 > /dev/null 2>&1 &
PF_PID=$!
sleep 5
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/health)
kill $PF_PID

if [ "$HTTP_STATUS" == "200" ]; then
  echo "✅ API Health Check Passed (200 OK)"
else
  echo "❌ API Health Check Failed (Status: $HTTP_STATUS)"
fi

# Verifica Connessione MySQL
echo "   Testing MySQL Connection..."
MYSQL_POD=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=mysql -o jsonpath='{.items[0].metadata.name}')
if kubectl exec -n "$NAMESPACE" "$MYSQL_POD" -- mysqladmin ping -u root -pchangeme --silent; then
  echo "✅ MySQL Connection Successful"
else
  echo "❌ MySQL Connection Failed"
fi

# Verifica Connessione Redis
echo "   Testing Redis Connection..."
REDIS_POD=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=redis -o jsonpath='{.items[0].metadata.name}')
REDIS_PING=$(kubectl exec -n "$NAMESPACE" "$REDIS_POD" -- redis-cli -a changeme ping)
if [[ "$REDIS_PING" == "PONG" ]]; then
  echo "✅ Redis Connection Successful (PONG)"
else
  echo "❌ Redis Connection Failed: $REDIS_PING"
fi

echo "============================================"
echo "🎉 Deployment Completed Successfully!"
echo "============================================"
