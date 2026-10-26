// Operational audit trail (FR-001, FR-006, FR-022) and field diffs.
const { db, nowDb, toJson } = require("./db");

function clientIp(req) {
  if (!req) return null;
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}

function snapshot(row, fields) {
  const out = {};
  for (const f of fields) {
    let v = row ? row[f] : null;
    if (v === undefined) v = null;
    out[f] = v;
  }
  return out;
}

function same(a, b) {
  if (a === b) return true;
  if ((a === null || a === "") && (b === null || b === "")) return true;
  if (typeof a === "number" || typeof b === "number") return a !== null && b !== null && Number(a) === Number(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

function diff(before, after) {
  const out = {};
  for (const k of Object.keys(after)) if (!same(before[k], after[k])) out[k] = [before[k] ?? null, after[k] ?? null];
  return out;
}

// ctx: an Express request (actor from session) or a user row (or null for system)
async function log(ctx, action, { entityType = "", entityId = "", label = "", changes = {}, message = "" } = {}) {
  const req = ctx && ctx.headers ? ctx : null;
  const user = req ? req.user : ctx;
  await db("audit_log").insert({
    created_at: nowDb(),
    actor_id: user ? user.id : null,
    actor_name: user ? user.username : "",
    action,
    entity_type: entityType,
    entity_id: String(entityId ?? ""),
    entity_label: String(label || "").slice(0, 255),
    changes: toJson(changes || {}),
    message: message || "",
    ip_address: clientIp(req),
    user_agent: req ? String(req.headers["user-agent"] || "").slice(0, 255) : "",
  });
}

const talentLabel = (t) => `${t.full_name} (${t.cast_id})`;
const projectLabel = (p) => `${p.code} · ${p.title}`;

module.exports = { log, snapshot, diff, clientIp, talentLabel, projectLabel };
