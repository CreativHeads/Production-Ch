// Database access (Knex) plus the small conversions every serializer needs.
// Datetimes are stored as UTC text "YYYY-MM-DD HH:MM:SS.mmm" and dates as
// "YYYY-MM-DD", so MySQL and SQLite behave identically and compare correctly.
const fs = require("fs");
const path = require("path");
const knexLib = require("knex");
const config = require("./config");

function makeKnex() {
  if (config.DB_CLIENT === "mysql2") {
    return knexLib({
      client: "mysql2",
      connection: { ...config.DB, charset: "utf8mb4", dateStrings: true, timezone: "Z", supportBigNumbers: true, bigNumberStrings: false },
      pool: { min: 0, max: 8 },
    });
  }
  fs.mkdirSync(path.dirname(config.SQLITE_FILE), { recursive: true });
  return knexLib({
    client: "better-sqlite3",
    connection: { filename: config.SQLITE_FILE },
    useNullAsDefault: true,
    pool: { afterCreate: (conn, done) => { conn.pragma("foreign_keys = ON"); conn.pragma("journal_mode = WAL"); done(); } },
  });
}

const db = makeKnex();
const isMysql = config.DB_CLIENT === "mysql2";

// ---------------------------------------------------------------- time
const pad = (n, w = 2) => String(n).padStart(w, "0");

function toDb(value) {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace("T", " ").replace("Z", "");
}
const nowDb = () => toDb(new Date());

function iso(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  if (s.length === 10) return s;
  return s.replace(" ", "T") + (s.endsWith("Z") ? "" : "Z");
}

function parseDb(v) {
  if (!v) return null;
  return new Date(iso(v));
}

// Local (TIME_ZONE) calendar date, "YYYY-MM-DD".
function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return localDate(dt);
}
// Start of a local calendar day, as a DB datetime.
function dayStartDb(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return toDb(new Date(y, m - 1, d, 0, 0, 0));
}
function parseDate(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : s;
}

// ---------------------------------------------------------------- values
const bool = (v) => v === true || v === 1 || v === "1" || v === "true";
const nbool = (v) => (v === null || v === undefined ? null : bool(v));
function money(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}
function json(v, def) {
  if (v === null || v === undefined || v === "") return def;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return def;
  }
}
const toJson = (v) => JSON.stringify(v === undefined ? null : v);

// ---------------------------------------------------------------- helpers
async function insertId(table, row, trx = db) {
  const res = await trx(table).insert(row);
  return Array.isArray(res) ? Number(res[0]) : Number(res);
}

async function sequenceNext(name) {
  return db.transaction(async (trx) => {
    const row = await trx("sequences").where({ name }).forUpdate().first();
    if (!row) {
      await trx("sequences").insert({ name, value: 1 });
      return 1;
    }
    const value = Number(row.value) + 1;
    await trx("sequences").where({ name }).update({ value });
    return value;
  });
}

function slugify(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[-\s_]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

module.exports = {
  db,
  isMysql,
  toDb,
  nowDb,
  iso,
  parseDb,
  localDate,
  addDays,
  dayStartDb,
  parseDate,
  bool,
  nbool,
  money,
  json,
  toJson,
  insertId,
  sequenceNext,
  slugify,
  pad,
};
