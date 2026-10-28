// FR-003 / FR-010 directory search and FR-019 review reminders.
// AND across different fields; OR within a multi-select field (comma-separated).
const { db, nowDb, toDb, localDate, dayStartDb, addDays, parseDate } = require("../db");
const { getSettings } = require("../settings");
const { C } = require("../choices");

const multi = (p, key) => {
  const raw = p[key];
  const vals = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  return vals.map((v) => String(v).trim()).filter(Boolean);
};
const ints = (p, key) => multi(p, key).map(Number).filter(Number.isInteger);
const int = (p, key) => {
  const n = parseInt(p[key], 10);
  return Number.isNaN(n) ? null : n;
};
const dec = (p, key) => {
  if (p[key] === undefined || p[key] === null || p[key] === "") return null;
  const n = Number(p[key]);
  return Number.isNaN(n) ? null : n;
};

// Correlated "last real contact" subquery, usable in where/order.
const LAST_CONTACT = "(SELECT MAX(cn.interaction_at) FROM contact_notes cn WHERE cn.talent_id = talent.id AND cn.kind <> 'note')";

function daysAgoDb(days) {
  return toDb(new Date(Date.now() - days * 86400e3));
}

// Each reminder is a named filter so the dashboard, reminders page and
// directory (?review=<key>) share one definition.
// Synchronous on purpose: Knex builders are thenables, so an async function
// returning one would execute it. Pass the settings in.
function applyReminder(q, key, s) {
  const today = localDate();
  if (key === "incomplete") return q.where("talent.completeness", "<", 100);
  if (key === "rates_stale") {
    const cutoff = daysAgoDb(s.review_interval_days);
    return q.where((w) => w.whereNull("talent.rates_reviewed_at").orWhere("talent.rates_reviewed_at", "<", cutoff));
  }
  if (key === "contact_stale") {
    const cutoff = daysAgoDb(s.contact_review_interval_days);
    return q.where((w) => w.whereNull("talent.contact_verified_at").orWhere("talent.contact_verified_at", "<", cutoff));
  }
  if (key === "photo_outdated") return q.whereExists(db("talent_photos").whereRaw("talent_photos.talent_id = talent.id").where("talent_photos.is_outdated", true));
  if (key === "consent_missing") return q.where("talent.missing_fields", "like", '%"consent"%');
  if (key === "follow_up_due") {
    return q.whereExists(
      db("contact_notes").whereRaw("contact_notes.talent_id = talent.id").whereNotNull("follow_up_on").where("follow_up_on", "<=", today).where("follow_up_done", false),
    );
  }
  if (key === "consent_withdrawn") return q.where("talent.consent_hold", true);
  return q;
}

// Booked = a confirmed booking that hasn't ended. On hold = otherwise a
// tentative booking ahead, or a manual hold/unavailability covering now.
function bookedQ() {
  return db("bookings").whereRaw("bookings.talent_id = talent.id").where("bookings.status", "confirmed").where("bookings.shoot_end", ">=", nowDb());
}
function holdQ() {
  const now = nowDb();
  return (w) =>
    w.whereExists(db("bookings").whereRaw("bookings.talent_id = talent.id").where("bookings.status", "tentative").where("bookings.shoot_end", ">=", now))
      .orWhereExists(db("availability").whereRaw("availability.talent_id = talent.id").whereNull("availability.booking_id")
        .whereIn("availability.kind", ["unavailable", "tentative_hold"]).where("availability.start", "<=", now).where("availability.end", ">", now));
}
function applyAvailability(q, value) {
  if (value === "booked") return q.whereExists(bookedQ());
  if (value === "hold") return q.whereNotExists(bookedQ()).where(holdQ());
  return q.whereNotExists(bookedQ()).whereNot(holdQ());
}

const baseLive = () => db("talent").whereNull("talent.deleted_at").where("talent.is_archived", false).whereNot("talent.status", "staging");

async function reminderCounts() {
  const s = await getSettings();
  const out = [];
  for (const [key, lbl] of C.reminders) {
    const q = applyReminder(baseLive(), key, s);
    const row = await q.count({ n: "talent.id" }).first();
    out.push({ key, label: lbl, count: Number(row.n) });
  }
  return out;
}

async function remindersFor(talentId) {
  const s = await getSettings();
  const out = [];
  for (const [key, lbl] of C.reminders) {
    const q = applyReminder(db("talent").where("talent.id", talentId), key, s);
    if (await q.first("talent.id")) out.push({ key, label: lbl });
  }
  return out;
}

const SORTS = {
  name: [["talent.full_name", "asc"], ["talent.id", "asc"]],
  "-name": [["talent.full_name", "desc"], ["talent.id", "desc"]],
  newest: [["talent.created_at", "desc"], ["talent.id", "desc"]],
  oldest: [["talent.created_at", "asc"], ["talent.id", "asc"]],
  updated: [["talent.updated_at", "desc"], ["talent.id", "desc"]],
  age: [["raw", "CASE WHEN talent.playing_age_min IS NULL THEN 1 ELSE 0 END, talent.playing_age_min ASC"], ["talent.full_name", "asc"]],
  "-age": [["raw", "CASE WHEN talent.playing_age_max IS NULL THEN 1 ELSE 0 END, talent.playing_age_max DESC"], ["talent.full_name", "asc"]],
  fee: [["raw", "CASE WHEN talent.expected_fee IS NULL THEN 1 ELSE 0 END, talent.expected_fee ASC"], ["talent.full_name", "asc"]],
  "-fee": [["raw", "CASE WHEN talent.expected_fee IS NULL THEN 1 ELSE 0 END, talent.expected_fee DESC"], ["talent.full_name", "asc"]],
  completeness: [["talent.completeness", "asc"], ["talent.full_name", "asc"]],
  last_contact: [["raw", `CASE WHEN ${LAST_CONTACT} IS NULL THEN 1 ELSE 0 END, ${LAST_CONTACT} DESC`], ["talent.full_name", "asc"]],
};

function linkExists(table, ids, col = "term_id") {
  return db(table).whereRaw(`${table}.talent_id = talent.id`).whereIn(`${table}.${col}`, ids);
}

// Apply every supported filter to a live-talent query. `p` is a plain object;
// `s` is the system settings (needed by ?review=).
function filterTalent(p, user, s) {
  const q = db("talent").whereNull("talent.deleted_at").select("talent.*");
  const archived = p.archived || "exclude";
  if (archived === "only") q.where("talent.is_archived", true);
  else if (archived !== "include") q.where("talent.is_archived", false);
  const status = p.status;
  if (status === "staging") q.where("talent.status", "staging");
  else {
    q.whereNot("talent.status", "staging");
    if (status === "active" || status === "needs_details") q.where("talent.status", status);
  }

  const talentType = p.type;
  if (talentType === "influencer") {
    q.where((w) =>
      w.where("talent.talent_type", "influencer")
        .orWhere("talent.talent_type", "both")
        .orWhereExists(db("talent_categories").whereRaw("talent_categories.talent_id = talent.id")
          .whereExists(db("terms").whereRaw("terms.id = talent_categories.term_id").whereIn("terms.slug", ["influencer", "content-creator"])))
    );
  } else if (talentType === "cast") {
    q.where((w) =>
      w.where("talent.talent_type", "cast")
        .orWhere("talent.talent_type", "both")
        .orWhereNull("talent.talent_type")
        .orWhere("talent.talent_type", "")
    );
  }

  if (p.niche) {
    q.where("talent.influencer_niche", "like", `%${p.niche}%`);
  }
  if (p.platform) {
    q.where("talent.primary_platform", "like", `%${p.platform}%`);
  }

  const text = String(p.q || "").trim();
  if (text) {
    for (const word of text.split(/\s+/).slice(0, 6)) {
      const like = `%${word}%`;
      q.where((w) => {
        w.where("talent.full_name", "like", like)
          .orWhere("talent.screen_name", "like", like)
          .orWhere("talent.cast_id", "like", like)
          .orWhere("talent.city", "like", like)
          .orWhere("talent.district", "like", like)
          .orWhere("talent.phone_normalized", "like", like);
        for (const table of ["talent_categories", "talent_tags", "talent_skills"]) {
          w.orWhereExists(db(table).join("terms", "terms.id", `${table}.term_id`).whereRaw(`${table}.talent_id = talent.id`).where("terms.name", "like", like));
        }
        w.orWhereExists(
          db("talent_languages").join("terms", "terms.id", "talent_languages.language_id").whereRaw("talent_languages.talent_id = talent.id")
            .where((x) => x.where("terms.name", "like", like).orWhere("talent_languages.accents", "like", like)),
        );
      });
    }
  }

  for (const [key, table] of [["category", "talent_categories"], ["tag", "talent_tags"], ["skill", "talent_skills"]]) {
    const ids = ints(p, key);
    if (ids.length) q.whereExists(linkExists(table, ids));
  }
  const langIds = ints(p, "language");
  if (langIds.length) q.whereExists(linkExists("talent_languages", langIds, "language_id"));
  const accents = multi(p, "accent");
  if (accents.length) {
    q.whereExists(db("talent_languages").whereRaw("talent_languages.talent_id = talent.id").where((w) => accents.forEach((a) => w.orWhere("accents", "like", `%${a}%`))));
  }

  for (const [key, field] of [["gender", "gender"], ["experience", "experience_level"], ["fee_type", "fee_type"], ["travel", "travel_willingness"]]) {
    const vals = multi(p, key);
    if (key === "gender" && vals.includes("unspecified")) vals.push(""); // blank means not specified
    if (vals.length) q.whereIn(`talent.${field}`, vals);
  }
  const cities = multi(p, "city");
  if (cities.length) {
    q.where((w) => {
      cities.forEach((c) => {
        const cl = c.toLowerCase();
        w.orWhereRaw("LOWER(talent.city) = ?", [cl])
         .orWhereRaw("LOWER(talent.city) LIKE ?", [`%${cl}%`]);
      });
    });
  }
  const districts = multi(p, "district");
  if (districts.length) q.where((w) => districts.forEach((d) => w.orWhereRaw("LOWER(talent.district) = ?", [d.toLowerCase()])));
  const location = String(p.location || "").trim();
  if (location) {
    const like = `%${location}%`;
    q.where((w) => w.where("talent.city", "like", like).orWhere("talent.district", "like", like).orWhere("talent.state", "like", like));
  }
  const order = C.travel.map(([v]) => v);
  if (order.includes(p.travel_min)) q.whereIn("talent.travel_willingness", order.slice(order.indexOf(p.travel_min)));

  // Playing age: overlap of the talent's range with the requested range.
  const amin = int(p, "age_min");
  const amax = int(p, "age_max");
  if (amin !== null) q.where((w) => w.where("talent.playing_age_max", ">=", amin).orWhere((x) => x.whereNull("talent.playing_age_max").where("talent.playing_age_min", ">=", amin)));
  if (amax !== null) q.where((w) => w.where("talent.playing_age_min", "<=", amax).orWhere((x) => x.whereNull("talent.playing_age_min").where("talent.playing_age_max", "<=", amax)));
  if ((amin !== null || amax !== null) && p.age_strict === "1") q.where((w) => w.whereNotNull("talent.playing_age_min").orWhereNotNull("talent.playing_age_max"));

  const fmin = dec(p, "fee_min");
  const fmax = dec(p, "fee_max");
  if (fmin !== null) q.where((w) => w.where("talent.expected_fee", ">=", fmin).orWhere("talent.expected_fee_max", ">=", fmin));
  if (fmax !== null) q.where("talent.expected_fee", "<=", fmax);
  if (p.fee_unknown === "1") q.where("talent.fee_unknown", true);

  // Real age (date of birth, else approximate age), as opposed to playing age.
  const rmin = int(p, "actual_age_min");
  const rmax = int(p, "actual_age_max");
  if (rmin !== null || rmax !== null) {
    const today = localDate();
    const yearsAgo = (n) => `${Number(today.slice(0, 4)) - n}${today.slice(4)}`;
    q.where((w) => {
      w.where((x) => {
        x.whereNotNull("talent.date_of_birth");
        if (rmin !== null) x.where("talent.date_of_birth", "<=", yearsAgo(rmin));
        if (rmax !== null) x.where("talent.date_of_birth", ">", yearsAgo(rmax + 1));
      }).orWhere((x) => {
        x.whereNull("talent.date_of_birth").whereNotNull("talent.approx_age");
        if (rmin !== null) x.where("talent.approx_age", ">=", rmin);
        if (rmax !== null) x.where("talent.approx_age", "<=", rmax);
      });
    });
  }

  // Studio availability: booked / on hold / available (derived from bookings and holds).
  if (["available", "hold", "booked"].includes(p.availability)) applyAvailability(q, p.availability);

  if ((p.favorite === "1" || p.favorite === "true") && user) {
    q.whereExists(db("favorites").whereRaw("favorites.talent_id = talent.id").where("favorites.user_id", user.id));
  }

  if (p.completeness === "complete") q.where("talent.completeness", ">=", 100);
  else if (p.completeness === "incomplete") q.where("talent.completeness", "<", 100);
  const cmin = int(p, "completeness_min");
  if (cmin !== null) q.where("talent.completeness", ">=", cmin);

  const day = parseDate(p.available_on);
  if (day) {
    const start = dayStartDb(day);
    const end = dayStartDb(addDays(day, 1));
    q.whereNotExists(db("availability").whereRaw("availability.talent_id = talent.id").where("start", "<", end).where("end", ">", start).whereIn("kind", ["unavailable", "confirmed_booking"]));
    if (p.available_strict === "1") {
      q.whereExists(db("availability").whereRaw("availability.talent_id = talent.id").where("start", "<", end).where("end", ">", start).where("kind", "available"));
    }
  }

  const now = nowDb();
  const bk = () => db("bookings").whereRaw("bookings.talent_id = talent.id");
  if (p.booking_status === "booked_upcoming") q.whereExists(bk().where("status", "confirmed").where("shoot_end", ">=", now));
  else if (p.booking_status === "on_hold") q.whereExists(bk().where("status", "tentative").where("shoot_end", ">=", now));
  else if (p.booking_status === "previously_booked") q.whereExists(bk().whereIn("status", ["confirmed", "completed"]));
  else if (p.booking_status === "never_booked") q.whereNotExists(bk().whereIn("status", ["confirmed", "completed"]));

  const lcBefore = parseDate(p.last_contact_before);
  const lcAfter = parseDate(p.last_contact_after);
  if (lcBefore) q.where((w) => w.whereRaw(`${LAST_CONTACT} < ?`, [dayStartDb(lcBefore)]).orWhereRaw(`${LAST_CONTACT} IS NULL`));
  if (lcAfter) q.whereRaw(`${LAST_CONTACT} >= ?`, [dayStartDb(lcAfter)]);
  if (p.never_contacted === "1") q.whereRaw(`${LAST_CONTACT} IS NULL`);

  const addedAfter = parseDate(p.added_after);
  if (addedAfter) q.where("talent.created_at", ">=", dayStartDb(addedAfter));

  if (p.review) applyReminder(q, p.review, s);

  const ids = ints(p, "ids");
  if (ids.length) q.whereIn("talent.id", ids);
  return q;
}

function applySort(q, sort, type) {
  if (!type) {
    q.orderByRaw("CASE WHEN talent.type = 'cast' THEN 0 ELSE 1 END ASC");
  }
  for (const [col, dir] of SORTS[sort] || SORTS.name) {
    if (col === "raw") q.orderByRaw(dir);
    else q.orderBy(col, dir);
  }
  return q;
}

// Paginate a query in the DRF shape the frontend expects.
async function paginate(q, p, serialize, { defaultSize = 24 } = {}) {
  const size = Math.min(200, Math.max(1, parseInt(p.page_size, 10) || defaultSize));
  const countRow = await db.count({ n: "*" }).from(q.clone().clearSelect().clearOrder().select(db.raw("1 as x")).as("sub")).first();
  const count = Number(countRow.n);
  const pages = Math.max(1, Math.ceil(count / size));
  const page = parseInt(p.page, 10) || 1;
  if (page < 1 || (page > pages && count > 0)) {
    const { HttpError } = require("../errors");
    throw new HttpError(404, "Invalid page.", "not_found");
  }
  const rows = await q.limit(size).offset((page - 1) * size);
  return { count, page, pages, page_size: size, results: await serialize(rows) };
}

module.exports = { filterTalent, applySort, applyReminder, applyAvailability, reminderCounts, remindersFor, baseLive, paginate, LAST_CONTACT };
