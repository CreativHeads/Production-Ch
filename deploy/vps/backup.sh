#!/usr/bin/env bash
# Nightly backup of the casting database and photos; keeps the last 14 days.
# Cron (root):  30 2 * * * /opt/casting-manager/deploy/vps/backup.sh >> /var/log/casting-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
OUT=/root/creativheads-backups/casting
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p "$OUT"
DB=$(grep '^DB_NAME=' .env | cut -d= -f2)
docker compose exec -T db sh -c "mariadb-dump -uroot -p\"\$MARIADB_ROOT_PASSWORD\" --single-transaction --routines $DB" | gzip > "$OUT/db-$STAMP.sql.gz"
docker compose exec -T app tar -czf - -C /data media > "$OUT/media-$STAMP.tgz"
find "$OUT" -type f -mtime +14 -delete
echo "$STAMP backup ok: $(du -sh "$OUT" | cut -f1)"
