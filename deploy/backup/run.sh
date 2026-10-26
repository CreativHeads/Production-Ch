#!/bin/bash
# Scheduler: one backup per day at BACKUP_HOUR (local TZ), restore test weekly (Sunday).
set -u
export TZ="${TZ:-Asia/Kolkata}"
HOUR="${BACKUP_HOUR:-2}"
last_day=""
echo "Backup scheduler started; daily at ${HOUR}:00 ${TZ}"
while true; do
  today=$(date +%F)
  if [ "$(date +%-H)" -ge "$HOUR" ] && [ "$today" != "$last_day" ]; then
    /usr/local/bin/backup.sh || true
    if [ "$(date +%u)" = "7" ]; then /usr/local/bin/restore-test.sh || true; fi
    last_day="$today"
  fi
  sleep 300
done
