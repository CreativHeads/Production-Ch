// Single-row table of staff-configurable behaviour, cached briefly.
const { db, json, bool } = require("./db");
const { DEFAULT_COMPLETENESS_FIELDS } = require("./choices");

let cache = null;
let cachedAt = 0;

function shape(row) {
  const fields = json(row.completeness_fields, []);
  return {
    session_idle_hours: Number(row.session_idle_hours ?? 8).toFixed(2),
    review_interval_days: Number(row.review_interval_days ?? 180),
    contact_review_interval_days: Number(row.contact_review_interval_days ?? 180),
    export_expiry_hours: Number(row.export_expiry_hours ?? 24),
    completeness_fields: fields.length ? fields : [...DEFAULT_COMPLETENESS_FIELDS],
    require_consent_for_all: bool(row.require_consent_for_all),
    default_currency: row.default_currency || "INR",
    default_country_code: row.default_country_code || "91",
    whatsapp_template: row.whatsapp_template || "",
    studio_name: row.studio_name || "TakeBoard Studio",
    studio_location: row.studio_location || "Kottakkal, Kerala",
    updated_at: row.updated_at,
  };
}

async function getSettings() {
  if (cache && Date.now() - cachedAt < 60000) return cache;
  const row = (await db("system_settings").where({ id: 1 }).first()) || {};
  cache = shape(row);
  cachedAt = Date.now();
  return cache;
}

function clearSettings() {
  cache = null;
}

module.exports = { getSettings, clearSettings };
