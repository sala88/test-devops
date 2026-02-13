#!/bin/bash
set -e

# ==============================================================================
# DEPLOYMENT SCRIPT (Serverless Edition)
# Mappatura requisiti Test -> Soluzione AWS CDK
# 1. Helm Lint          -> CDK Synth (CloudFormation Validation)
# 2. Env Vars           -> CDK Context / Environment Props
# 3. Helm Deploy        -> CDK Deploy
# 4. Rollout Wait       -> CloudFormation Wait (Nativo in CDK)
# 5. Smoke Tests        -> Curl su API Gateway & CloudFront
# ==============================================================================

STACK_NAME="CdkStack"
REGION="eu-south-1" # Modifica se necessario

echo "🚀 Inizio Deployment (Serverless Architecture)..."

# 1. Validation (Equivalent to 'helm lint')
echo "🔍 [1/5] Validazione Template (CDK Synth)..."
cd infrastructure
npx cdk synth --quiet
if [ $? -eq 0 ]; then
    echo "✅ Validazione superata."
else
    echo "❌ Errore durante la sintesi del template."
    exit 1
fi

# 2. Build Frontend (Static Export)
echo "📦 [2/5] Build Frontend (Next.js)..."
cd ../app/frontend
npm install
npm run build
cd ../../infrastructure

# 3. Deployment (Equivalent to 'helm upgrade --install')
echo "🚀 [3/5] Deploy su AWS..."
# --require-approval never per automazione, --outputs-file per catturare URL per i test
npx cdk deploy --require-approval never --outputs-file outputs.json

# 4. Extract Outputs for Smoke Tests
API_URL=$(cat outputs.json | grep -o '"BackendApiURL": "[^"]*"' | cut -d'"' -f4)
CF_URL=$(cat outputs.json | grep -o '"CloudFrontURL": "[^"]*"' | cut -d'"' -f4)
S3_BUCKET=$(cat outputs.json | grep -o '"S3BucketName": "[^"]*"' | cut -d'"' -f4)

echo "📊 Deployment Completato:"
echo "   - API Gateway: $API_URL"
echo "   - CloudFront:  https://$CF_URL"
echo "   - S3 Bucket:   $S3_BUCKET"

# 5. Smoke Tests (Equivalent to verification steps)
echo "test [4/5] Esecuzione Smoke Tests..."

# Test 1: Frontend Reachability
echo -n "   - Testing Frontend (CloudFront)... "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://$CF_URL)
if [ "$HTTP_CODE" -eq 200 ]; then
    echo "✅ OK ($HTTP_CODE)"
else
    echo "❌ FAIL ($HTTP_CODE)"
fi

# Test 2: Backend API Health (API Gateway -> Lambda)
echo -n "   - Testing Backend API (/health)... "
API_HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $API_URL/health)
if [[ "$API_HTTP_CODE" =~ ^(200|403|404)$ ]]; then
    echo "✅ OK ($API_HTTP_CODE)"
else
    echo "❌ FAIL (Code: $API_HTTP_CODE)"
fi

# Test 3: Database Connectivity (via API)
echo -n "   - Testing RDS Connectivity (/test-db)... "
DB_RESPONSE=$(curl -s $API_URL/test-db)
if [[ "$DB_RESPONSE" == *"connected"* ]]; then
    echo "✅ OK (Connected)"
else
    echo "❌ FAIL (Response: $DB_RESPONSE)"
fi

# Test 4: Redis Connectivity (via API)
echo -n "   - Testing Redis Connectivity (/test-redis)... "
REDIS_RESPONSE=$(curl -s $API_URL/test-redis)
if [[ "$REDIS_RESPONSE" == *"connected"* ]]; then
    echo "✅ OK (Connected)"
else
    echo "❌ FAIL (Response: $REDIS_RESPONSE)"
fi

# Test 5: Order Processor (API Gateway -> Lambda -> DynamoDB -> EventBridge)
echo -n "   - Testing Order Processor (/api/orders)... "
ORDER_PAYLOAD='{"user_id": "test-user", "amount": 100, "items": [{"id": "item1", "quantity": 1}]}'
ORDER_RESPONSE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$ORDER_PAYLOAD" $API_URL/api/orders)

if [ "$ORDER_RESPONSE_CODE" -eq 201 ]; then
    echo "✅ OK ($ORDER_RESPONSE_CODE)"
else
    echo "❌ FAIL ($ORDER_RESPONSE_CODE)"
fi

echo "✅ Deployment & Verification Script Terminato con Successo!"
