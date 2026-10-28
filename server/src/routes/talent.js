// FR-003 – FR-011: talent directory, profiles, quick add, editing, archive/trash, favourites.
const multer = require("multer");
const config = require("../config");
const { db, nowDb, iso, bool, json, toJson, localDate, insertId } = require("../db");
const audit = require("../audit");
const { getSettings } = require("../settings");
const { has, label } = require("../choices");
const { wrap, ValidationError, Conflict, HttpError, notFound } = require("../errors");
const { normalizePhone, normalizeInstagram, normalizeName } = require("../normalize");
const T = require("../services/talent");
const F = require("../services/filters");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024 } });

const AUDITED_FIELDS = [
  "full_name", "screen_name", "gender", "date_of_birth", "approx_age", "playing_age_min", "playing_age_max", "height_cm",
  "phone", "alt_phone", "whatsapp_phone", "email", "instagram", "address", "city", "district", "state",
  "expected_fee", "expected_fee_max", "fee_unknown", "fee_type", "fee_negotiable", "travel_willingness",
  "experience_level", "child_safety_verified", "age_verified", "internal_notes",
  "talent_type", "social_reach", "influencer_niche", "primary_platform",
];

// field -> [type, options]
const FIELDS = {
  full_name: ["str", 150], screen_name: ["str", 150], gender: ["choice", "gender"], date_of_birth: ["date"], age_verified: ["bool"],
  approx_age: ["int", 0, 120], playing_age_min: ["int", 0, 120], playing_age_max: ["int", 0, 120], height_cm: ["int", 30, 260],
  weight_kg: ["int", 0, 500], measurements: ["dict"], complexion: ["str", 40], hair: ["str", 60], eye_color: ["str", 30],
  appearance_notes: ["text"], phone: ["str", 32], alt_phone: ["str", 32], whatsapp_phone: ["str", 32], email: ["email"],
  instagram: ["str", 200], address: ["text"], city: ["str", 80], district: ["str", 80], state: ["str", 80], country: ["str", 60],
  experience_level: ["choice", "experience"], experience_summary: ["text"], expected_fee: ["money"], expected_fee_max: ["money"],
  fee_unknown: ["bool"], fee_type: ["choice", "fee_type"], currency: ["str", 3], fee_negotiable: ["nbool"], fee_notes: ["str", 255],
  travel_willingness: ["choice", "travel"], has_passport: ["nbool"], travel_notes: ["text"], internal_notes: ["text"],
  child_safety_verified: ["bool"], child_safety_notes: ["text"],
  talent_type: ["str", 20], social_reach: ["str", 80], influencer_niche: ["str", 120], primary_platform: ["str", 40],
};
const TEXT_FIELDS = Object.entries(FIELDS).filter(([, [t]]) => t === "text").map(([k]) => k);

function parseList(v) {
  if (v === undefined || v === null || v === "") return [];
  if (Array.isArray(v)) return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return String(v).split(",").filter(Boolean);
  }
}

function cleanField(key, raw, errors) {
  const [type, a, b] = FIELDS[key];
  const empty = raw === null || raw === undefined || raw === "";
  switch (type) {
    case "str":
    case "text": {
      const s = empty ? "" : String(raw);
      if (type === "str" && s.length > a) errors[key] = [`Ensure this field has no more than ${a} characters.`];
      return s;
    }
    case "email": {
      const s = empty ? "" : String(raw).trim();
      if (s && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) errors[key] = ["Enter a valid email address."];
      return s;
    }
    case "choice":
      if (empty) return "";
      if (!has(a, raw)) errors[key] = [`"${raw}" is not a valid choice.`];
      return raw;
    case "int": {
      if (empty) return null;
      const n = Number(raw);
      if (!Number.isInteger(n)) errors[key] = ["A valid integer is required."];
      else if (n < a) errors[key] = [`Ensure this value is greater than or equal to ${a}.`];
      else if (n > b) errors[key] = [`Ensure this value is less than or equal to ${b}.`];
      return n;
    }
    case "money": {
      if (empty) return null;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) errors[key] = ["A valid number is required."];
      return n;
    }
    case "bool":
      return bool(raw);
    case "nbool":
      return empty ? null : bool(raw);
    case "date":
      if (empty) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) errors[key] = ["Date has wrong format. Use YYYY-MM-DD."];
      return String(raw);
    case "dict":
      return toJson(raw && typeof raw === "object" ? raw : {});
    default:
      return raw;
  }
}

// PATCH-friendly validation (FR-006): only fields sent are touched.
async function validateWrite(body, inst) {
  const errors = {};
  const data = {};
  for (const key of Object.keys(FIELDS)) if (key in body) data[key] = cleanField(key, body[key], errors);
  const rel = {};
  for (const [key, kind] of [["categories", "category"], ["tags", "tag"], ["skills", "skill"]]) {
    if (!(key in body)) continue;
    const ids = parseList(body[key]).map(Number);
    if (ids.some((x) => !Number.isInteger(x))) {
      errors[key] = ["Incorrect type."];
      continue;
    }
    const found = ids.length ? await db("terms").whereIn("id", ids).where({ kind }) : [];
    const missing = ids.filter((x) => !found.some((f) => f.id === x));
    if (missing.length) errors[key] = [`Invalid pk "${missing[0]}" - object does not exist.`];
    rel[key] = [...new Set(ids)];
  }
  if ("languages" in body) {
    const langs = parseList(body.languages);
    const out = [];
    for (const l of langs) {
      const id = Number(l && l.language);
      const term = id ? await db("terms").where({ id, kind: "language" }).first() : null;
      if (!term) {
        errors.languages = [`Invalid pk "${l && l.language}" - object does not exist.`];
        break;
      }
      if (l.fluency && !has("fluency", l.fluency)) {
        errors.languages = [`"${l.fluency}" is not a valid choice.`];
        break;
      }
      out.push({ language_id: id, fluency: l.fluency || "", accents: String(l.accents || "").slice(0, 200), can_dub: bool(l.can_dub) });
    }
    if (new Set(out.map((l) => l.language_id)).size !== out.length) errors.languages = ["Each language can only be listed once."];
    rel.languages = out;
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);

  const get = (k) => (k in data ? data[k] : inst ? inst[k] : null);
  const lo = get("playing_age_min");
  const hi = get("playing_age_max");
  if (lo !== null && hi !== null && lo !== undefined && hi !== undefined && Number(lo) > Number(hi)) {
    throw new ValidationError({ playing_age_max: "Playing age 'to' must be at least the 'from' age." });
  }
  const fmin = get("expected_fee");
  const fmax = get("expected_fee_max");
  if (fmin !== null && fmax !== null && fmin !== undefined && fmax !== undefined && Number(fmax) < Number(fmin)) {
    throw new ValidationError({ expected_fee_max: "The upper fee must be at least the lower fee." });
  }
  if ("phone" in data && !String(data.phone || "").trim()) throw new ValidationError({ phone: "A primary phone number is required." });
  const dob = get("date_of_birth");
  if (dob && dob > localDate()) throw new ValidationError({ date_of_birth: "Date of birth can't be in the future." });
  return { data, rel };
}

async function derived(data) {
  const cc = (await getSettings()).default_country_code;
  const out = {};
  if ("full_name" in data) out.name_normalized = normalizeName(data.full_name);
  if ("phone" in data) out.phone_normalized = normalizePhone(data.phone, cc);
  if ("alt_phone" in data) out.alt_phone_normalized = normalizePhone(data.alt_phone, cc);
  if ("instagram" in data) out.instagram_normalized = normalizeInstagram(data.instagram);
  return out;
}

async function saveRelations(talentId, rel, trx = db) {
  for (const key of ["categories", "tags", "skills"]) {
    if (!(key in rel)) continue;
    const table = T.M2M[key];
    await trx(table).where({ talent_id: talentId }).del();
    if (rel[key].length) await trx(table).insert(rel[key].map((term_id) => ({ talent_id: talentId, term_id })));
  }
  if ("languages" in rel) {
    await trx("talent_languages").where({ talent_id: talentId }).del();
    if (rel.languages.length) await trx("talent_languages").insert(rel.languages.map((l) => ({ talent_id: talentId, ...l })));
  }
}

async function createTalent({ data, rel }, user, extra = {}) {
  const now = nowDb();
  const row = { ...data, ...(await derived({ full_name: "", phone: "", alt_phone: "", instagram: "", ...data })), ...extra };
  for (const k of TEXT_FIELDS) if (row[k] === undefined) row[k] = "";
  if (row.measurements === undefined) row.measurements = "{}";
  row.cast_id = await T.nextCastId();
  row.missing_fields = "[]";
  Object.assign(row, { created_at: now, updated_at: now, created_by: user?.id || null, updated_by: user?.id || null });
  const id = await insertId("talent", row);
  await saveRelations(id, rel);
  return db("talent").where({ id }).first();
}

async function checkDuplicatesOrRaise(data, acknowledged, excludeId) {
  const matches = await T.findDuplicates({
    full_name: data.full_name || "", phone: data.phone || "", alt_phone: data.alt_phone || "", instagram: data.instagram || "",
    city: data.city || "", age: data.approx_age ?? null, exclude_id: excludeId,
  });
  const ack = new Set(parseList(acknowledged).map(Number).filter(Number.isInteger));
  const unacked = matches.filter((m) => !ack.has(m.talent.id));
  if (unacked.length) {
    const exact = unacked.some((m) => m.strength === "exact");
    throw new Conflict(exact ? "This phone number already belongs to another profile." : "This looks like it may already be in the database.", "duplicate", {
      duplicates: await T.duplicatePayload(matches),
      has_exact: exact,
    });
  }
  return matches;
}

async function detail(id, user) {
  const t = await db("talent").where({ id }).first();
  const cc = (await getSettings()).default_country_code;
  await T.hydrate([t], user, { detail: true });
  t._cc = cc;
  const data = await T.detailPayload(t);
  data.reminders = await F.remindersFor(t.id);
  data.booking_blockers = await T.bookingBlockers(t);
  return data;
}

async function getTalentOr404(id) {
  const t = await T.findTalent(id);
  if (!t) throw notFound();
  return t;
}

const parseCrop = (v) => {
  if (!v) return null;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

module.exports = function (r) {
  // ------------------------------------------------ collection routes
  r.get("/talent", wrap(async (req, res) => {
    const settings = await getSettings();
    const q = F.filterTalent(req.query, req.user, settings);
    F.applySort(q, req.query.sort || "name", req.query.type);
    const cc = settings.default_country_code;
    res.json(await F.paginate(q, req.query, async (rows) => (await T.hydrate(rows, req.user)).map((t) => T.listPayload(Object.assign(t, { _cc: cc })))));
  }));

  r.get("/talent/cities", wrap(async (req, res) => {
    const rows = await db("talent").whereNull("deleted_at").where({ is_archived: false }).select("city", "district");
    const title = (s) => s.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    const splitAndClean = (rawList) => {
      const items = [];
      for (const str of rawList) {
        if (!str || !str.trim()) continue;
        const parts = str.split(",");
        for (const p of parts) {
          const t = title(p);
          if (t && !items.includes(t)) items.push(t);
        }
      }
      return items.sort();
    };
    res.json({ cities: splitAndClean(rows.map((x) => x.city)), districts: splitAndClean(rows.map((x) => x.district)) });
  }));

  r.get("/talent/trash", wrap(async (req, res) => {
    const q = db("talent").whereNotNull("deleted_at").orderBy("deleted_at", "desc");
    res.json(await F.paginate(q, req.query, async (rows) => {
      const names = new Map((await db("users").whereIn("id", rows.map((t) => t.deleted_by).filter(Boolean))).map((u) => [u.id, u.username]));
      return rows.map((t) => ({ id: t.id, cast_id: t.cast_id, full_name: t.full_name, city: t.city, deleted_at: iso(t.deleted_at), deleted_by: names.get(t.deleted_by) || null }));
    }));
  }));

  r.post("/talent/trash/:tid/restore", wrap(async (req, res) => {
    const t = await db("talent").where({ id: req.params.tid }).whereNotNull("deleted_at").first();
    if (!t) throw notFound();
    await db("talent").where({ id: t.id }).update({ deleted_at: null, deleted_by: null });
    await audit.log(req, "talent.restored", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t) });
    res.json({ ok: true, id: t.id });
  }));

  r.post("/talent/duplicate-check", wrap(async (req, res) => {
    const d = req.body;
    const matches = await T.findDuplicates({
      full_name: d.full_name || "", phone: d.phone || "", alt_phone: d.alt_phone || "", instagram: d.instagram || "", city: d.city || "",
      age: d.approx_age || null, exclude_id: d.exclude_id || null,
    });
    res.json({ duplicates: await T.duplicatePayload(matches), has_exact: matches.some((m) => m.strength === "exact") });
  }));

  // Full form create
  r.post("/talent", wrap(async (req, res) => {
    const v = await validateWrite(req.body, null);
    for (const f of ["full_name", "phone"]) if (!v.data[f]) throw new ValidationError({ [f]: "This field is required." });
    await checkDuplicatesOrRaise({ ...req.body, ...v.data }, req.body.acknowledge_duplicates);
    const t = await createTalent(v, req.user);
    await T.refreshCompleteness(t.id);
    await audit.log(req, "talent.created", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t) });
    res.status(201).json(await detail(t.id, req.user));
  }));

  // Quick add: flexible creation without mandatory blockages.
  r.post("/talent/quick-add", upload.single("photo"), wrap(async (req, res) => {
    const b = req.body;
    let name = String(b.full_name || "").trim();
    const phone = String(b.phone || "").trim();
    const city = String(b.city || "").trim();
    let insta = String(b.instagram || "").trim();
    const cats = parseList(b.categories);

    // Auto-clean handle if full URL or leading @ was sent
    if (insta) {
      insta = insta.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").replace(/^@+/, "").trim();
    }

    // Auto-clean full_name if full URL was sent
    if (/^https?:\/\//i.test(name)) {
      const ext = name.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").replace(/^@+/, "").trim();
      if (ext) {
        name = ext.charAt(0).toUpperCase() + ext.slice(1);
        if (!insta) insta = ext;
      }
    }

    if (!name && insta) {
      name = insta.charAt(0).toUpperCase() + insta.slice(1);
    }
    if (!name && phone) {
      name = `Creator ${phone}`;
    }
    if (!name) {
      name = "New Profile";
    }

    const payload = { full_name: name, phone, city, district: b.district || "", gender: b.gender || "", instagram: insta, categories: cats };
    for (const opt of ["playing_age_min", "playing_age_max", "approx_age", "talent_type", "social_reach", "influencer_niche", "primary_platform"]) if (b[opt] !== undefined && b[opt] !== "") payload[opt] = b[opt];
    const v = await validateWrite(payload, null);
    await checkDuplicatesOrRaise(v.data, b.acknowledge_duplicates);
    const t = await createTalent(v, req.user);
    if (req.file) {
      try {
        await T.addPhoto(t, req.file.buffer, { user: req.user, crop: parseCrop(b.crop), rotate: b.rotate || 0, makePrimary: true });
      } catch (e) {
        if (e instanceof T.PhotoError) throw new ValidationError({ photo: e.message });
        throw e;
      }
    }
    await T.refreshCompleteness(t.id);
    await audit.log(req, "talent.created", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t), message: "Quick add" });
    res.status(201).json(await detail(t.id, req.user));
  }));

  // ------------------------------------------------ single talent
  r.get("/talent/:id", wrap(async (req, res) => {
    const t = await getTalentOr404(req.params.id);
    res.json(await detail(t.id, req.user));
  }));

  const update = wrap(async (req, res) => {
    const t = await getTalentOr404(req.params.id);
    const b = req.body;
    if (b.version !== undefined && b.version !== null && Number(b.version) !== Number(t.version)) {
      throw new Conflict("Someone else updated this profile while you were editing. Reload to see their changes, then re-apply yours.", "stale_version", { current_version: t.version });
    }
    // Clean full_name or instagram if sent as URL
    if (b.full_name && /^https?:\/\//i.test(b.full_name)) {
      const ext = b.full_name.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").replace(/^@+/, "").trim();
      if (ext) {
        b.full_name = ext.charAt(0).toUpperCase() + ext.slice(1);
        if (!b.instagram && !t.instagram) b.instagram = ext;
      }
    }
    if (b.instagram) {
      b.instagram = b.instagram.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").replace(/^@+/, "").trim();
    }
    const v = await validateWrite(b, t);
    if (["phone", "alt_phone", "instagram", "full_name"].some((k) => k in v.data)) {
      const merged = Object.fromEntries(["phone", "alt_phone", "instagram"].map((f) => [f, f in b ? b[f] : t[f]]));
      // Only phone/Instagram collisions matter on edit; ignore fuzzy name matches.
      const matches = (await T.findDuplicates({ ...merged, exclude_id: t.id })).filter((m) => m.strength === "exact" || m.strength === "strong");
      const ack = new Set(parseList(b.acknowledge_duplicates).map(Number));
      if (matches.some((m) => !ack.has(m.talent.id))) {
        throw new Conflict("Another profile already uses this phone number or Instagram.", "duplicate", { duplicates: await T.duplicatePayload(matches) });
      }
    }
    const before = audit.snapshot(t, AUDITED_FIELDS);
    const [before2] = await T.hydrate([{ ...t }], null, { detail: true });
    const beforeM2m = Object.fromEntries(["categories", "tags", "skills"].map((k) => [k, before2._terms[k].map((x) => x.name).sort()]));
    const now = nowDb();
    const upd = { ...v.data, ...(await derived(v.data)), updated_by: req.user.id, updated_at: now, version: (t.version || 1) + 1 };
    if (["expected_fee", "fee_unknown", "fee_type"].some((k) => k in v.data)) upd.rates_reviewed_at = now;
    if (["phone", "alt_phone", "email"].some((k) => k in v.data)) upd.contact_verified_at = now;
    if (v.data.child_safety_verified && !t.child_safety_verified_at) upd.child_safety_verified_at = now;
    await db("talent").where({ id: t.id }).update(upd);
    await saveRelations(t.id, v.rel);
    const after = await db("talent").where({ id: t.id }).first();
    const changes = audit.diff(before, audit.snapshot(after, AUDITED_FIELDS));
    const [h] = await T.hydrate([{ ...after }], null, { detail: true });
    for (const k of ["categories", "tags", "skills"]) {
      if (k in v.rel) {
        const names = h._terms[k].map((x) => x.name).sort();
        if (JSON.stringify(names) !== JSON.stringify(beforeM2m[k])) changes[k] = [beforeM2m[k], names];
      }
    }
    if ("languages" in v.rel) changes.languages = ["…", h._languages.map((l) => l.term.name)];
    await T.refreshCompleteness(t.id);
    if (Object.keys(changes).length) await audit.log(req, "talent.updated", { entityType: "talent", entityId: t.id, label: audit.talentLabel(after), changes });
    res.json(await detail(t.id, req.user));
  });
  r.patch("/talent/:id", update);
  r.put("/talent/:id", update);

  r.delete("/talent/:id", wrap(async (req, res) => {
    const t = await getTalentOr404(req.params.id);
    await db("talent").where({ id: t.id }).update({ deleted_at: nowDb(), deleted_by: req.user.id });
    await audit.log(req, "talent.deleted", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t), message: (req.body && req.body.reason) || "" });
    res.status(204).end();
  }));

  r.post("/talent/:id/archive", wrap(async (req, res) => {
    const t = await getTalentOr404(req.params.id);
    const reason = String(req.body.reason || "").slice(0, 255);
    await db("talent").where({ id: t.id }).update({ is_archived: true, archived_at: nowDb(), archive_reason: reason, updated_at: nowDb() });
    await audit.log(req, "talent.archived", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t), message: reason });
    res.json(await detail(t.id, req.user));
  }));

  r.post("/talent/:id/unarchive", wrap(async (req, res) => {
    const t = await getTalentOr404(req.params.id);
    await db("talent").where({ id: t.id }).update({ is_archived: false, archived_at: null, updated_at: nowDb() });
    await audit.log(req, "talent.unarchived", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t) });
    res.json(await detail(t.id, req.user));
  }));

  // FR-011 favourites
  r.post("/talent/:id/favorite", wrap(async (req, res) => {
    const t = await getTalentOr404(req.params.id);
    if (!(await db("favorites").where({ user_id: req.user.id, talent_id: t.id }).first())) {
      await db("favorites").insert({ user_id: req.user.id, talent_id: t.id, created_at: nowDb() });
    }
    res.json({ is_favorite: true });
  }));
  r.delete("/talent/:id/favorite", wrap(async (req, res) => {
    const t = await getTalentOr404(req.params.id);
    await db("favorites").where({ user_id: req.user.id, talent_id: t.id }).del();
    res.json({ is_favorite: false });
  }));

  // FR-019 review marks
  r.post("/talent/:id/mark-reviewed", wrap(async (req, res) => {
    const t = await getTalentOr404(req.params.id);
    const what = req.body.what;
    const now = nowDb();
    const upd = {};
    if (what === "rates" || what === "all") upd.rates_reviewed_at = now;
    if (what === "contact" || what === "all") upd.contact_verified_at = now;
    if (!Object.keys(upd).length) throw new ValidationError({ what: "Use 'rates', 'contact' or 'all'." });
    await db("talent").where({ id: t.id }).update({ ...upd, updated_at: now });
    await audit.log(req, "talent.reviewed", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t), changes: { reviewed: what } });
    res.json(await detail(t.id, req.user));
  }));

  // Move an import-staging record into the live directory.
  r.post("/talent/:id/publish", wrap(async (req, res) => {
    const t = await getTalentOr404(req.params.id);
    if (t.status !== "staging") return res.json(await detail(t.id, req.user));
    if (!(await db("talent_photos").where({ talent_id: t.id, is_primary: true }).first())) {
      throw new Conflict("Add a primary photo before publishing this profile.", "photo_required");
    }
    await db("talent").where({ id: t.id }).update({ status: "needs_details", updated_at: nowDb() });
    await T.refreshCompleteness(t.id);
    await audit.log(req, "talent.published", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t) });
    res.json(await detail(t.id, req.user));
  }));

  // FR-007 photos
  r.post("/talent/:id/photos", upload.fields([{ name: "photo", maxCount: 20 }, { name: "photos", maxCount: 20 }]), wrap(async (req, res) => {
    const t = await getTalentOr404(req.params.id);
    const files = [...((req.files && req.files.photo) || []), ...((req.files && req.files.photos) || [])];
    if (!files.length) throw new ValidationError({ photo: "Choose a photo to upload." });
    const crop = parseCrop(req.body.crop);
    const created = [];
    try {
      for (const f of files) {
        created.push(await T.addPhoto(t, f.buffer, {
          user: req.user, crop: files.length === 1 ? crop : null, rotate: req.body.rotate || 0, label: req.body.label || "",
          makePrimary: ["1", "true"].includes(String(req.body.make_primary)),
        }));
      }
    } catch (e) {
      if (e instanceof T.PhotoError) throw new ValidationError({ photo: e.message });
      throw e;
    }
    await T.refreshCompleteness(t.id);
    await audit.log(req, "talent.photo_added", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t), changes: { count: created.length } });
    res.status(201).json(created.map(T.photoPayload));
  }));

  // FR-008: reorder the three featured video slots.
  r.post("/talent/:id/videos/reorder", wrap(async (req, res) => {
    const t = await getTalentOr404(req.params.id);
    const videos = await db("featured_videos").where({ talent_id: t.id });
    const ids = (req.body.order || []).map(Number);
    const byId = new Map(videos.map((v) => [v.id, v]));
    if (new Set(ids).size !== ids.length || ids.some((i) => !byId.has(i)) || ids.length > 3) throw new ValidationError({ order: "Invalid video order." });
    await db.transaction(async (trx) => {
      // move out of the 1..3 range first so the unique constraint never trips
      for (const v of videos) await trx("featured_videos").where({ id: v.id }).update({ position: v.position + 10 });
      for (const [i, id] of ids.entries()) await trx("featured_videos").where({ id }).update({ position: i + 1 });
      const leftover = videos.filter((v) => !ids.includes(v.id));
      const free = [1, 2, 3].filter((p) => p > ids.length);
      for (const [i, v] of leftover.entries()) if (free[i]) await trx("featured_videos").where({ id: v.id }).update({ position: free[i] });
    });
    await audit.log(req, "talent.videos_reordered", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t) });
    res.json((await db("featured_videos").where({ talent_id: t.id }).orderBy("position")).map(T.videoPayload));
  }));

  r.get("/talent/:id/history", wrap(async (req, res) => {
    const t = await getTalentOr404(req.params.id);
    const rows = await db("audit_log").where({ entity_type: "talent", entity_id: String(t.id) }).orderBy("created_at", "desc").orderBy("id", "desc").limit(200);
    res.json(rows.map((e) => ({ id: e.id, at: iso(e.created_at), actor: e.actor_name || "system", action: e.action, changes: json(e.changes, {}), message: e.message || "" })));
  }));

  // FR-016 projects & booking history for a profile.
  r.get("/talent/:id/casting", wrap(async (req, res) => {
    const t = await getTalentOr404(req.params.id);
    const bookings = await db("bookings").where("bookings.talent_id", t.id)
      .join("projects", "projects.id", "bookings.project_id").join("roles", "roles.id", "bookings.role_id")
      .orderBy("bookings.shoot_start", "desc")
      .select("bookings.*", "projects.title as project_title", "projects.code as project_code", "projects.client_name", "roles.name as role_name");
    const shortlists = await db("shortlist_entries").where("shortlist_entries.talent_id", t.id)
      .join("roles", "roles.id", "shortlist_entries.role_id").join("projects", "projects.id", "roles.project_id")
      .orderBy("shortlist_entries.created_at", "desc")
      .select("shortlist_entries.*", "roles.name as role_name", "roles.project_id", "projects.title as project_title");
    const { money } = require("../db");
    res.json({
      bookings: bookings.map((b) => ({
        id: b.id, project_id: b.project_id, project: b.project_title, project_code: b.project_code, client: b.client_name || "", role: b.role_name,
        status: b.status, status_label: label("booking_status", b.status), shoot_start: iso(b.shoot_start), shoot_end: iso(b.shoot_end),
        proposed_fee: money(b.proposed_fee), agreed_fee: money(b.agreed_fee), fee_basis: b.fee_basis || "", currency: b.currency,
        travel_charges: money(b.travel_charges), accommodation_charges: money(b.accommodation_charges), outcome: label("booking_outcome", b.outcome),
        completed_on: b.completed_on || null, deliverable_url: b.deliverable_url || "",
      })),
      shortlists: shortlists.map((s) => ({
        id: s.id, role_id: s.role_id, role: s.role_name, project_id: s.project_id, project: s.project_title, status: s.status,
        status_label: label("shortlist_status", s.status), is_removed: bool(s.is_removed), proposed_fee: money(s.proposed_fee), created_at: iso(s.created_at),
      })),
    });
  }));
};

module.exports.validateWrite = validateWrite;
module.exports.createTalent = createTalent;
module.exports.saveRelations = saveRelations;
