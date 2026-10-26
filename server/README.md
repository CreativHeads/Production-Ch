# CreativHeads Casting Manager: Node.js server

The Node.js + MySQL port of the Django backend in `../backend`, built to run as a Hostinger **Web App** (Node.js hosting). It exposes the same `/api/*` endpoints, so the React frontend works unchanged. It also serves the built frontend from `public/` and the protected uploads from `/media/*`.

```
src/index.js        Express app: sessions, CSRF, auth gate, media, SPA fallback
src/schema.js       creates every table on first boot, seeds taxonomy, settings and the first admin
src/routes/         auth, core (settings/audit/dashboard/meta), terms, talent, talentChildren, casting, dataio
src/services/       talent rules, search filters and reminders, booking conflicts, import/export
scripts/            create-staff.js, smoke-test.js
public/             built frontend (vite build output)
```

## Local development

Local development uses SQLite, so no MySQL is needed.

```bash
npm install
APP_DEBUG=1 SECURE_COOKIES=0 PORT=3999 ADMIN_USERNAME=admin ADMIN_PASSWORD='choose-a-long-one' node src/index.js
# in another terminal: end-to-end API check
ADMIN_PASSWORD='choose-a-long-one' BASE=http://localhost:3999 node scripts/smoke-test.js
```

After changing the frontend, rebuild it into `public/`:

```bash
cd ../frontend && npx vite build --outDir ../server/public --emptyOutDir
```

## Production (Hostinger)

| Variable | Purpose |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MySQL. Written by hPanel's database setup. When `DB_HOST` is set, the server uses MySQL. |
| `SECRET_KEY` | Signs session cookies and password reset links. Keep it secret and stable. |
| `APP_BASE_URL` | Used in password reset emails, e.g. `https://production.creativheads.com`. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_EMAIL` | Only read on first boot, while the users table is empty. |
| `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL` | Optional SMTP for password reset emails. Without them, emails are written to the app log. |
| `DATA_DIR` | Uploads, exports and imports. Defaults to `~/casting-data`, outside the versioned app folder, so redeploys keep them. |

Deploy this folder as a Node.js app with entry file `src/index.js`. Tables are created automatically on start.

Hostinger's daily account backups cover both the database and `~/casting-data`. Backup operators can also download a full structured ZIP under **Import & export**.
