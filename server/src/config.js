// Everything deployment-specific comes from environment variables, so the same
// code runs locally (SQLite) and on Hostinger (MySQL).
const os = require("os");
const path = require("path");

const env = (name, def) => (process.env[name] === undefined || process.env[name] === "" ? def : process.env[name]);
const envBool = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
};

process.env.TZ = env("TIME_ZONE", "Asia/Kolkata");

const ROOT = path.resolve(__dirname, "..");
const DEBUG = envBool("APP_DEBUG", false);
// Uploads must live outside the deployed app folder, or a redeploy wipes them.
// Hostinger publishes each build into its own version folder, so production
// defaults to the account's home directory.
const DATA_DIR = path.resolve(env("DATA_DIR", DEBUG ? path.join(ROOT, "..", "casting-data") : path.join(os.homedir(), "casting-data")));

module.exports = {
  ROOT,
  DEBUG,
  PORT: Number(env("PORT", 3000)),
  TIME_ZONE: process.env.TZ,
  SECRET_KEY: env("SECRET_KEY", DEBUG ? "dev-insecure-key" : null),
  DB_CLIENT: env("DB_CLIENT", env("DB_HOST") ? "mysql2" : "better-sqlite3"),
  DB: {
    // "localhost" can resolve to IPv6 (::1), which not every MySQL user is granted.
    host: env("DB_HOST", "127.0.0.1") === "localhost" ? "127.0.0.1" : env("DB_HOST", "127.0.0.1"),
    port: Number(env("DB_PORT", 3306)),
    user: env("DB_USER", ""),
    password: env("DB_PASSWORD", ""),
    database: env("DB_NAME", ""),
  },
  SQLITE_FILE: env("SQLITE_FILE", path.join(DATA_DIR, "dev.sqlite3")),
  DATA_DIR,
  MEDIA_ROOT: path.join(DATA_DIR, "media"),
  EXPORT_ROOT: path.join(DATA_DIR, "exports"),
  IMPORT_ROOT: path.join(DATA_DIR, "imports"),
  BACKUP_STATUS_FILE: env("BACKUP_STATUS_FILE", path.join(DATA_DIR, "backups", "status.json")),
  PUBLIC_DIR: path.join(ROOT, "public"),
  KEEP_MASTER_IMAGES: envBool("KEEP_MASTER_IMAGES", true),
  MAX_UPLOAD_MB: Number(env("MAX_UPLOAD_MB", 25)),
  SECURE_COOKIES: envBool("SECURE_COOKIES", !DEBUG),
  LOGIN_MAX_ATTEMPTS: Number(env("LOGIN_MAX_ATTEMPTS", 5)),
  LOGIN_LOCKOUT_MINUTES: Number(env("LOGIN_LOCKOUT_MINUTES", 15)),
  APP_BASE_URL: env("APP_BASE_URL", "http://localhost:3000"),
  EMAIL: {
    host: env("EMAIL_HOST", ""),
    port: Number(env("EMAIL_PORT", 587)),
    user: env("EMAIL_HOST_USER", ""),
    password: env("EMAIL_HOST_PASSWORD", ""),
    secure: envBool("EMAIL_USE_SSL", false),
    from: env("DEFAULT_FROM_EMAIL", "TakeBoard by CreativHeads <no-reply@creativheads.com>"),
  },
  // First boot only: creates this administrator when the users table is empty.
  BOOTSTRAP_ADMIN: {
    username: env("ADMIN_USERNAME", ""),
    password: env("ADMIN_PASSWORD", ""),
    email: env("ADMIN_EMAIL", ""),
    name: env("ADMIN_NAME", ""),
  },
};
