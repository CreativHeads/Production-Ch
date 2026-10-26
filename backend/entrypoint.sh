#!/bin/sh
set -e

mkdir -p "$DATA_DIR/media" "$DATA_DIR/exports" "$DATA_DIR/imports" "$DATA_DIR/cache" "$DATA_DIR/backups"

# Only the web container (gunicorn) runs migrations; workers/cron just wait.
if [ "${RUN_MIGRATIONS:-1}" = "1" ]; then
  # First deploy only: generate initial migrations if the repo doesn't ship them yet.
  # Commit the generated files (backend/*/migrations/0001_initial.py) afterwards.
  if [ -z "$(ls core/migrations/0*.py 2>/dev/null)" ]; then
    echo "No migrations found — generating initial migrations"
    python manage.py makemigrations core accounts talent casting dataio --noinput
  fi
  python manage.py migrate --noinput
  python manage.py seed_defaults
  python manage.py collectstatic --noinput >/dev/null
fi

exec "$@"
