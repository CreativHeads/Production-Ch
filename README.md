# CreativHeads Casting Manager

An internal web app where CreativHeads staff manage talent, casting projects, shortlists and bookings. It implements FR-001 to FR-022 of the functional requirements.

- **Backend:** Django 5.1 + Django REST Framework, PostgreSQL (SQLite for local development)
- **Frontend:** React 18 + Vite (no UI framework, no router dependency)
- **Deployment:** Docker Compose with these services:
  - `db`: Postgres
  - `web`: gunicorn
  - `proxy`: nginx, which serves the app and protected media
  - `cron`: housekeeping jobs
  - `backup`: encrypted daily backups with an off-site copy and restore tests

```
backend/            Django project
  config/           settings, urls
  core/             audit log, settings, protected media, dashboard, management commands
  accounts/         staff login/logout, password change and reset, staff admin
  talent/           talent, taxonomy, photos, videos, notes, consent, duplicates, reminders, search
  casting/          projects, roles, shortlists, availability, bookings, conflicts
  dataio/           CSV/XLSX import wizard, exports, full structured backup export
frontend/           React app (src/pages, src/components, src/lib)
deploy/backup/      backup, restore-test and scheduler scripts
docker-compose.yml
```

---

## 1. Run it locally (development)

You need Python 3.12+ and Node 20+.

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export DJANGO_DEBUG=1 SECURE_COOKIES=0                   # Windows PowerShell: $env:DJANGO_DEBUG=1; $env:SECURE_COOKIES=0
python manage.py makemigrations core accounts talent casting dataio
python manage.py migrate
python manage.py seed_defaults
python manage.py create_staff admin --name "Your Name" --email you@creativheads.com --admin --backup-operator
python manage.py runserver

# Frontend (second terminal)
cd frontend
npm install
npm run dev            # http://localhost:5173 (proxies /api and /media to Django)
```

> **Commit the migrations.** The repo doesn't ship migrations yet. The first time you run `makemigrations`, commit the generated `*/migrations/0001_initial.py` files (and any later ones) to git. From then on, every server runs exactly the same schema.

## 2. Deploy (Hostinger VPS or any Docker host)

```bash
git clone <your repo> casting-manager && cd casting-manager
cp .env.example .env              # fill in every value, especially secrets
cp deploy/backup/rclone.conf.example deploy/backup/rclone.conf   # optional off-site remote
docker compose up -d --build
docker compose exec web python manage.py create_staff admin --name "Admin" --email you@creativheads.com --admin --backup-operator
```

The app now listens on `HTTP_PORT` (8080 by default). Put it behind HTTPS by pointing Caddy, Traefik or Hostinger's reverse proxy at that port. Keep `SECURE_COOKIES=1` whenever HTTPS is in front of the app.

To update: `git pull && docker compose up -d --build`. Migrations run automatically when `web` starts.

### Staff accounts (FR-001)
- There is no sign-up page. Administrators add staff under **Staff accounts** in the app, or with `create_staff`.
- Password recovery sends a single-use link to the account's email address, valid for 1 hour. Set the `EMAIL_*` values in `.env`. An administrator can also set a new password from **Staff accounts**.
- Sessions end after 8 hours of inactivity. Change this under **Settings**.
- Deactivating an account signs that person out immediately.
- Logins, failed logins, account changes, exports, downloads and every important edit are recorded in the **Audit log**.

### Backups (FR-022)
The `backup` container runs every day at `BACKUP_HOUR`:
1. `pg_dump`, encrypted with AES-256 (passphrase `BACKUP_ENCRYPTION_KEY`), plus a checksum.
2. An encrypted archive of all media (photos, videos, consent evidence).
3. Deletes local backups older than `BACKUP_RETENTION_DAYS`.
4. Copies both files off-site with rclone (`BACKUP_REMOTE`), if configured.
5. Writes `status.json`, which backup operators can see under **Settings → Backups**. It can also ping a monitoring URL (`BACKUP_HEALTHCHECK_URL`) on success or failure.
6. Every Sunday it runs a **restore test**: it decrypts the latest dump, restores it into a throwaway database, counts the rows and records the result.

Backup files sit in their own Docker volume and are never served by the app. Only superusers, and staff given the "manage backups" permission (`create_staff … --backup-operator`), can see backup status or download a full structured export.

**Keep a copy of `BACKUP_ENCRYPTION_KEY` somewhere other than the server.** Without it, the backups can't be decrypted.

Manual restore:
```bash
docker compose exec backup sh -c 'openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_KEY -in /backups/db/<file>.dump.enc -out /tmp/r.dump && pg_restore --clean --no-owner -d $PGDATABASE /tmp/r.dump'
```

Deleted talent and projects go to **Trash** and can be restored from there.

---

## 3. How the requirements are covered

| FR | Where |
|---|---|
| 001 Auth | `accounts/views.py`: login lockout, logout, password change and email reset. `core/middleware.py`: configurable idle timeout. Every API route and `/media/*` requires a session. Staff admin is superuser-only. Account changes are audited. |
| 002 Dashboard | `core/views.py DashboardView`: 7 metrics plus the import-staging count, each linking to a filtered list. Archived records are excluded. |
| 003 Directory | `pages/Directory.jsx` with photo cards or a compact list (remembered per browser), 24 per page, 9 sort orders. Filters live in the URL, so they're still there when you come back from a profile. Bulk shortlist and export. |
| 004 Profile | Immutable `CH-CAST-000001` IDs come from a locked counter (`core.Sequence`). `pages/TalentProfile.jsx` has tabs for every section and the Edit / Favourite / Contact / Shortlist / Archive / History actions. |
| 005 Quick add | `POST /api/talent/quick-add/` checks the 5 required fields, runs duplicate detection, and sets the profile to *Needs Details* automatically. Save & view, Save & add another, Cancel. |
| 006 Editing | PATCH sends only the fields that changed. Optimistic locking (`version`) stops two people overwriting each other. Field-level audit diffs. |
| 007 Photos | JPG/PNG/WebP and the phone camera. Crop and rotate in the browser, applied on the server. EXIF orientation is fixed and all metadata stripped. Profile, card and thumbnail variants in WebP. Optional private master. The primary photo can't be deleted. Labels/alt text and an "outdated" flag. |
| 008 Videos | Three numbered slots, unique positions (DB constraint), reorder, YouTube thumbnails, links or uploads. Extra portfolio links are stored separately. |
| 009 Taxonomy | One `Term` model for categories, tags, skills and languages, linked by id, so renames show everywhere. Merge and archive. "Child Artist" turns on the guardian rules. |
| 010 Search | `talent/filters.py`: AND across fields, OR within a field. Covers every listed filter, including availability on a date, booking status and last contact. |
| 011 Favourites & contact | Per-staff favourites. Call, WhatsApp (chat or pre-filled message, never auto-sent), Instagram, copy phone and copy contact details. Nothing is logged automatically; a "Log a call" shortcut opens the note form. |
| 012–013 Projects & roles | Seven project states and auto project codes. Role requirements feed **Find talent**, which opens the directory with those filters already set. |
| 014 Shortlists | One talent can be on many roles. Priority order, status, notes, proposed fee and availability confirmation. Removing someone is a soft remove, with an immutable event history. |
| 015 Availability & booking | Availability is tracked separately from shortlists. Bookings mirror themselves into availability. Overlapping confirmed bookings are **blocked** unless an override with a reason is given (audited). Holds and unavailability raise warnings that must be acknowledged. |
| 016 Fees | Proposed and agreed fees, basis, currency, travel and stay charges, outcome, completion date and video link are all stored on the booking, so later profile edits never change them. |
| 017 Notes | Contact types and results as specified, staff member, time, project and follow-up date. Internal only, and excluded from client exports. |
| 018 Import/export | Upload, column mapping (auto-guessed), validation preview, duplicate preview, row-level errors, a decision per row, then a confirmed import. Rows without a photo go to a restricted **import staging** area. CSV/XLSX exports of filters or selected profiles, with an internal or client audience. Exports are private, expire and are logged. The full structured backup ZIP is for backup operators only. |
| 019 Completeness & reviews | A configurable checklist (Settings) and a cached score. Review queue for incomplete profiles, stale rates and contacts (180 days by default), outdated photos, missing consent and follow-ups. |
| 020 Consent | Consent records with evidence files that can't be deleted. Withdrawing consent puts the profile on hold (blocks shortlisting, booking and client export) and opens a retention review. Child artists need a guardian, guardian consent, DOB or verified age, and a child-safety check before they can be booked. |
| 021 Duplicates | Normalised phone and alternate phone, Instagram handle, and fuzzy name matching combined with location or age. Archived and trashed records are included. Exact phone matches are never saved silently; staff must explicitly acknowledge them. |
| 022 Backups & audit | See above. Soft delete with Trash, an append-only audit log (read-only in Django admin), and friendly error messages from `core/exceptions.py`. |

## 4. Notes and limits of this version
- Every staff member has the same permissions (V1). Administrators also get Staff accounts, and backup operators get backup access.
- Imports and exports run while you wait on the page. That's fine up to a few thousand rows. Imports are capped at 5,000 rows per file, and the preview shows the first 1,000 rows.
- Daily media backups are full archives. For very large media libraries, switch to `rclone sync` of `/data/media`.
- The Django admin is at `/django-admin/` for superusers. The audit log can't be edited there.
#   P r o d u c t i o n - C h  
 #   P r o d u c t i o n - C h  
 