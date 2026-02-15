#!/bin/bash
set -e

# Configuration
NAMESPACE="production"
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
MYSQL_POD=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=mysql -o jsonpath='{.items[0].metadata.name}')
DB_USER="root"
DB_PASS="changeme" # In prod: retrieve from secret
DB_NAME="appdb"

mkdir -p "$BACKUP_DIR"

echo "============================================"
echo "📦 Starting MySQL Backup: $TIMESTAMP"
echo "============================================"

if [ -z "$MYSQL_POD" ]; then
  echo "❌ Error: MySQL Pod not found!"
  exit 1
fi

echo "   Target Pod: $MYSQL_POD"
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.sql.gz"

# Execute dump and pipe to local file
kubectl exec -n "$NAMESPACE" "$MYSQL_POD" -- mysqldump -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" | gzip > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  echo "✅ Backup created successfully: $BACKUP_FILE"
  echo "   Size: $(du -h "$BACKUP_FILE" | cut -f1)"
else
  echo "❌ Backup failed!"
  exit 1
fi

# Retention policy: Delete backups older than 7 days
find "$BACKUP_DIR" -name "backup_*.sql.gz" -mtime +7 -delete
echo "🧹 Cleaned up backups older than 7 days."
