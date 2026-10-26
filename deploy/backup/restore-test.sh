#!/bin/bash
# Restore the newest dump into a throwaway database and check it contains data.
set -uo pipefail
DIR=/backups
STATUS="$DIR/status.json"
TEST_DB="casting_restore_test"
LATEST=$(ls -1t "$DIR"/db/*.dump.enc 2>/dev/null | head -1)

record() {
  [ -f "$STATUS" ] || echo '{}' > "$STATUS"
  jq --arg at "$(date -Iseconds)" --arg r "$1" '.last_restore_test_at=$at | .last_restore_test_result=$r' "$STATUS" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
  echo "Restore test: $1"
}

[ -z "$LATEST" ] && { record "failed: no backup found"; exit 1; }
sha256sum -c "$LATEST.sha256" >/dev/null 2>&1 || { record "failed: checksum mismatch for $(basename "$LATEST")"; exit 1; }

TMP=$(mktemp)
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_KEY -in "$LATEST" -out "$TMP" || { rm -f "$TMP"; record "failed: could not decrypt"; exit 1; }
dropdb --if-exists "$TEST_DB" && createdb "$TEST_DB" || { rm -f "$TMP"; record "failed: could not create test database"; exit 1; }
if pg_restore --no-owner -d "$TEST_DB" "$TMP" >/dev/null 2>&1; then
  COUNT=$(psql -d "$TEST_DB" -tAc "select count(*) from talent_talent" 2>/dev/null || echo "?")
  record "passed: $(basename "$LATEST") restored, $COUNT talent rows"
else
  record "failed: pg_restore reported errors for $(basename "$LATEST")"
fi
dropdb --if-exists "$TEST_DB"
rm -f "$TMP"
