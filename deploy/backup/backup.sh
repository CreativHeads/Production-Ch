#!/bin/bash
# FR-022: encrypted database dump + media snapshot, off-site copy, retention, status file.
set -uo pipefail

DIR=/backups
STATUS="$DIR/status.json"
RETENTION="${BACKUP_RETENTION_DAYS:-30}"
REMOTE="${BACKUP_REMOTE:-}"          # e.g. b2:creativheads-casting  (rclone remote:path)
KEY="${BACKUP_ENCRYPTION_KEY:-}"
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$DIR/db" "$DIR/media"

status() { # result error dbfile size
  local prev_ok="null"
  [ -f "$STATUS" ] && prev_ok=$(jq -r '.last_success_at // empty' "$STATUS" 2>/dev/null | sed 's/.*/"&"/')
  [ -z "$prev_ok" ] && prev_ok="null"
  local ok="$prev_ok"
  [ "$1" = "success" ] && ok="\"$(date -Iseconds)\""
  local rt="null" rtr="null"
  if [ -f "$STATUS" ]; then
    rt=$(jq '.last_restore_test_at // null' "$STATUS"); rtr=$(jq '.last_restore_test_result // null' "$STATUS")
  fi
  jq -n --arg run "$(date -Iseconds)" --arg res "$1" --arg err "$2" --arg f "$3" --arg sz "$4" \
     --arg off "${REMOTE:-}" --argjson ret "$RETENTION" --argjson ok "$ok" --argjson rt "$rt" --argjson rtr "$rtr" \
     '{last_run_at:$run,last_result:$res,last_error:$err,last_success_at:$ok,last_db_file:$f,last_db_size:$sz,offsite:$off,retention_days:$ret,last_restore_test_at:$rt,last_restore_test_result:$rtr}' > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

fail() {
  echo "BACKUP FAILED: $1" >&2
  status "failed" "$1" "" ""
  [ -n "${BACKUP_HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 "${BACKUP_HEALTHCHECK_URL}/fail" >/dev/null || true
  exit 1
}

[ -z "$KEY" ] && fail "BACKUP_ENCRYPTION_KEY is not set"

FILE="$DIR/db/casting-$STAMP.dump.enc"
echo "Dumping database…"
pg_dump --format=custom --no-owner | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_KEY -out "$FILE" \
  || fail "pg_dump or encryption failed"
[ -s "$FILE" ] || fail "dump file is empty"
sha256sum "$FILE" > "$FILE.sha256"

echo "Snapshotting media…"
# Hard-linked incremental snapshot is not available on all volumes; use a dated tarball
MEDIA_FILE="$DIR/media/media-$STAMP.tar.gz.enc"
tar -C /data -czf - media 2>/dev/null | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_KEY -out "$MEDIA_FILE" \
  || fail "media archive failed"

echo "Applying ${RETENTION}-day retention…"
find "$DIR/db" "$DIR/media" -type f -mtime +"$RETENTION" -delete

if [ -n "$REMOTE" ]; then
  echo "Copying off-site to $REMOTE…"
  rclone copy "$DIR/db" "$REMOTE/db" --max-age 48h || fail "off-site copy (db) failed"
  rclone copy "$DIR/media" "$REMOTE/media" --max-age 48h || fail "off-site copy (media) failed"
  rclone delete "$REMOTE" --min-age "${RETENTION}d" || true
fi

status "success" "" "$(basename "$FILE")" "$(du -h "$FILE" | cut -f1)"
[ -n "${BACKUP_HEALTHCHECK_URL:-}" ] && curl -fsS -m 10 "$BACKUP_HEALTHCHECK_URL" >/dev/null || true
echo "Backup complete: $FILE"
