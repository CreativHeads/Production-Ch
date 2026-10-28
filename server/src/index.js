// TakeBoard by CreativHeads: Express API + protected media + the built React app.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");

const config = require("./config");
const { db } = require("./db");
const { ensureSchema } = require("./schema");
const { getSettings } = require("./settings");
const audit = require("./audit");
const { HttpError, errorHandler, wrap, notFound } = require("./errors");

if (!config.SECRET_KEY) {
  console.error("SECRET_KEY must be set (or APP_DEBUG=1 for local development).");
  process.exit(1);
}
for (const dir of [config.MEDIA_ROOT, config.EXPORT_ROOT, config.IMPORT_ROOT]) fs.mkdirSync(dir, { recursive: true });

// ---------------------------------------------------------------- sessions
class KnexStore extends session.Store {
  get(sid, cb) {
    db("sessions").where({ sid }).first()
      .then((row) => cb(null, row && Number(row.expires) > Date.now() ? JSON.parse(row.sess) : null))
      .catch(cb);
  }
  set(sid, sess, cb) {
    const expires = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 8 * 3600e3;
    const row = { sid, sess: JSON.stringify(sess), expires, user_id: sess.userId || null };
    db("sessions").insert(row).onConflict("sid").merge()
      .then(() => cb && cb(null))
      .catch((e) => cb && cb(e));
  }
  destroy(sid, cb) {
    db("sessions").where({ sid }).del().then(() => cb && cb(null)).catch((e) => cb && cb(e));
  }
  touch(sid, sess, cb) {
    this.set(sid, sess, cb);
  }
}

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});

app.use(
  "/api",
  express.json({ limit: "5mb" }),
  express.urlencoded({ extended: false, limit: "5mb" }),
  session({
    name: "sessionid",
    secret: config.SECRET_KEY,
    store: new KnexStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: "lax", secure: config.SECURE_COOKIES, maxAge: 8 * 3600e3 },
  }),
);
app.use("/media", session({
  name: "sessionid",
  secret: config.SECRET_KEY,
  store: new KnexStore(),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: config.SECURE_COOKIES },
}));

// CSRF: double-submit cookie, read by the SPA and echoed in X-CSRFToken.
app.use("/api", (req, res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  req.cookies = cookies;
  if (!cookies.csrftoken) {
    const token = crypto.randomBytes(24).toString("hex");
    cookies.csrftoken = token;
    req.newCsrf = token;
    res.cookie("csrftoken", token, { sameSite: "lax", secure: config.SECURE_COOKIES, maxAge: 365 * 86400e3 });
  }
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const header = req.headers["x-csrftoken"];
  if (!header || req.newCsrf || header !== cookies.csrftoken) {
    return res.status(403).json({ detail: "Your security token has expired. Reload the page and try again.", code: "csrf" });
  }
  next();
});

// Load the signed-in staff member and slide the idle timeout (FR-001).
async function loadUser(req) {
  if (!req.session || !req.session.userId) return null;
  const u = await db("users").where({ id: req.session.userId }).first();
  if (!u || !u.is_active) return null;
  return u;
}
app.use(["/api", "/media"], wrap(async (req, res, next) => {
  req.user = await loadUser(req);
  if (req.user) {
    const hours = Number((await getSettings()).session_idle_hours) || 8;
    req.session.cookie.maxAge = Math.round(hours * 3600e3);
  }
  next();
}));

// ---------------------------------------------------------------- routes
const PUBLIC_API = new Set(["/auth/csrf/", "/auth/login/", "/auth/password/reset/", "/auth/password/reset/confirm/", "/health/"]);
app.use("/api", (req, res, next) => {
  if (PUBLIC_API.has(req.path) || req.user) return next();
  res.status(403).json({ detail: "Your session has ended. Please sign in again.", code: "not_authenticated" });
});

const api = express.Router();
require("./routes/auth")(api);
require("./routes/core")(api);
require("./routes/terms")(api);
require("./routes/talent")(api);
require("./routes/talentChildren")(api);
require("./routes/casting")(api);
require("./routes/dataio")(api);
require("./routes/studio")(api);
app.use("/api", api);
app.use("/api", (req, res) => res.status(404).json({ detail: "Not found.", code: "not_found" }));

// Protected media: every file requires a signed-in staff member.
app.get("/media/*", wrap(async (req, res) => {
  if (!req.user) return res.status(403).send("Sign in to view this file.");
  const rel = decodeURIComponent(req.params[0] || "");
  const root = path.resolve(config.MEDIA_ROOT);
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) throw notFound();
  if (rel.includes("/master/") || rel.includes("/consent/")) {
    await audit.log(req, "media.sensitive_viewed", { entityType: "file", entityId: rel.slice(0, 64), label: rel });
  }
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.sendFile(full);
}));

// Built React app (SPA fallback for client-side routes).
if (fs.existsSync(path.join(config.PUBLIC_DIR, "index.html"))) {
  app.use(express.static(config.PUBLIC_DIR, { index: false, maxAge: "7d", setHeaders: (res, p) => {
    if (p.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  } }));
  app.get("*", (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(config.PUBLIC_DIR, "index.html"));
  });
}

app.use((err, req, res, next) => {
  if (err instanceof HttpError || req.path.startsWith("/api") || req.originalUrl.startsWith("/api")) return errorHandler(err, req, res, next);
  console.error(err);
  res.status(500).send("Something went wrong.");
});

ensureSchema()
  .then(() => {
    app.listen(config.PORT, () => console.log(`TakeBoard by CreativHeads listening on :${config.PORT} (${config.DB_CLIENT})`));
    // Housekeeping: expired sessions and exports, hourly.
    const { purgeExpired } = require("./services/dataio");
    const sweep = () => {
      db("sessions").where("expires", "<", Date.now()).del().catch(() => {});
      purgeExpired().catch((e) => console.error("Purge failed", e));
    };
    sweep();
    setInterval(sweep, 3600e3).unref();
  })
  .catch((e) => {
    console.error("Database setup failed", e);
    process.exit(1);
  });
