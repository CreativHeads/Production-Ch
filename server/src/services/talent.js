// Business rules for talent: serialization, completeness, duplicates, photos, consent.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const config = require("../config");
const { db, nowDb, iso, bool, nbool, money, json, toJson, localDate, addDays, sequenceNext, pad } = require("../db");
const { getSettings } = require("../settings");
const { COMPLETENESS_LABELS, label } = require("../choices");
const { normalizePhone, normalizeInstagram, instagramUrl, normalizeName, similarity } = require("../normalize");

const mediaUrl = (name) => (name ? `/media/${name}` : null);

// ---------------------------------------------------------------- relations
const M2M = { categories: "talent_categories", tags: "talent_tags", skills: "talent_skills" };

async function termMap(ids) {
  if (!ids.length) return new Map();
  const rows = await db("terms").whereIn("id", [...new Set(ids)]);
  return new Map(rows.map((t) => [t.id, t]));
}
const miniTerm = (t) => ({ id: t.id, name: t.name, color: t.color || "", system_key: t.system_key || "" });

function ageOf(t, today = localDate()) {
  if (t.date_of_birth) {
    const [y, m, d] = t.date_of_birth.split("-").map(Number);
    const [ty, tm, td] = today.split("-").map(Number);
    return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  }
  return t.approx_age ?? null;
}

// Attach categories/tags/(skills)/languages/photos/favorite/last contact to talent rows.
async function hydrate(rows, user, { detail = false } = {}) {
  if (!rows.length) return rows;
  const ids = rows.map((t) => t.id);
  const kinds = detail ? ["categories", "tags", "skills"] : ["categories", "tags"];
  const links = {};
  const termIds = [];
  for (const k of kinds) {
    links[k] = await db(M2M[k]).whereIn("talent_id", ids);
    termIds.push(...links[k].map((l) => l.term_id));
  }
  const langs = await db("talent_languages").whereIn("talent_id", ids).orderBy("id");
  termIds.push(...langs.map((l) => l.language_id));
  const terms = await termMap(termIds);
  const photos = detail
    ? await db("talent_photos").whereIn("talent_id", ids).orderBy([{ column: "is_primary", order: "desc" }, "sort_order", "id"])
    : await db("talent_photos").whereIn("talent_id", ids).where({ is_primary: true });
  const favs = user ? new Set((await db("favorites").where({ user_id: user.id }).whereIn("talent_id", ids)).map((f) => f.talent_id)) : new Set();
  const contacts = await db("contact_notes")
    .whereIn("talent_id", ids)
    .whereNot({ kind: "note" })
    .groupBy("talent_id")
    .select("talent_id")
    .max({ last: "interaction_at" });
  const lastContact = new Map(contacts.map((c) => [c.talent_id, c.last]));
  // Studio availability, consent state and video count for cards and reviews.
  const now = nowDb();
  const upcoming = await db("bookings").whereIn("talent_id", ids).whereIn("status", ["confirmed", "tentative"]).where("shoot_end", ">=", now).select("talent_id", "status");
  const holds = await db("availability").whereIn("talent_id", ids).whereNull("booking_id").whereIn("kind", ["unavailable", "tentative_hold"])
    .where("start", "<=", now).where("end", ">", now).select("talent_id");
  const booked = new Set(upcoming.filter((b) => b.status === "confirmed").map((b) => b.talent_id));
  const onHold = new Set([...upcoming.filter((b) => b.status === "tentative").map((b) => b.talent_id), ...holds.map((h) => h.talent_id)]);
  const consents = await db("consents").whereIn("talent_id", ids).where({ consent_type: "data_storage" }).orderBy("id");
  const consentBy = new Map(consents.map((c) => [c.talent_id, c]));
  const videoCounts = new Map((await db("featured_videos").whereIn("talent_id", ids).groupBy("talent_id").select("talent_id").count({ n: "*" })).map((v) => [v.talent_id, Number(v.n)]));
  const by = (list, key = "talent_id") => {
    const m = new Map();
    for (const x of list) {
      if (!m.has(x[key])) m.set(x[key], []);
      m.get(x[key]).push(x);
    }
    return m;
  };
  const linkBy = Object.fromEntries(kinds.map((k) => [k, by(links[k])]));
  const langBy = by(langs);
  const photoBy = by(photos);
  for (const t of rows) {
    for (const k of kinds) {
      t._terms = t._terms || {};
      t._terms[k] = (linkBy[k].get(t.id) || []).map((l) => terms.get(l.term_id)).filter(Boolean).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    }
    t._languages = (langBy.get(t.id) || []).map((l) => ({ ...l, term: terms.get(l.language_id) })).filter((l) => l.term);
    t._photos = photoBy.get(t.id) || [];
    t._is_favorite = favs.has(t.id);
    t._last_contact = lastContact.get(t.id) || null;
    t._availability = booked.has(t.id) ? "Booked" : onHold.has(t.id) ? "On hold" : "Available";
    const c = consentBy.get(t.id);
    t._consent = bool(t.consent_hold) || (c && c.status === "withdrawn") ? "Withdrawn" : c && consentEffective(c) ? "Recorded" : "Pending";
    t._videos = videoCounts.get(t.id) || 0;
  }
  return rows;
}

function isChild(t) {
  const a = ageOf(t);
  if (a !== null && a < 18) return true;
  return (t._terms?.categories || []).some((c) => c.system_key === "child");
}

function listPayload(t) {
  const p = t._photos.find((x) => bool(x.is_primary));
  return {
    id: t.id,
    cast_id: t.cast_id,
    full_name: t.full_name,
    screen_name: t.screen_name || "",
    photo: p ? { card: mediaUrl(p.card), thumb: mediaUrl(p.thumb), label: p.label || "" } : null,
    categories: t._terms.categories.map(miniTerm),
    tags: t._terms.tags.map(miniTerm),
    languages: t._languages.map((l) => l.term.name),
    gender: t.gender || "",
    age: ageOf(t),
    playing_age_min: t.playing_age_min,
    playing_age_max: t.playing_age_max,
    city: t.city || "",
    district: t.district || "",
    phone: t.phone || "",
    whatsapp: normalizePhone(t.whatsapp_phone || t.phone, t._cc || "91"),
    instagram: t.instagram || "",
    instagram_url: t.instagram ? instagramUrl(t.instagram) : null,
    talent_type: t.talent_type || "cast",
    social_reach: t.social_reach || "",
    influencer_niche: t.influencer_niche || "",
    primary_platform: t.primary_platform || "Instagram",
    expected_fee: money(t.expected_fee),
    expected_fee_max: money(t.expected_fee_max),
    fee_unknown: bool(t.fee_unknown),
    fee_type: t.fee_type || "",
    currency: t.currency || "INR",
    experience_level: t.experience_level || "",
    completeness: Number(t.completeness || 0),
    status: t.status,
    status_label: label("talent_status", t.status),
    is_archived: bool(t.is_archived),
    is_favorite: t._is_favorite,
    consent_hold: bool(t.consent_hold),
    last_contact_at: iso(t._last_contact),
    availability: t._availability,
    consent_state: t._consent,
    video_count: t._videos,
    missing_fields: json(t.missing_fields, []),
    rates_reviewed_at: iso(t.rates_reviewed_at),
    created_at: iso(t.created_at),
    updated_at: iso(t.updated_at),
  };
}

const photoPayload = (p) => ({
  id: p.id,
  label: p.label || "",
  is_primary: bool(p.is_primary),
  is_outdated: bool(p.is_outdated),
  taken_on: p.taken_on || null,
  sort_order: p.sort_order,
  width: p.width,
  height: p.height,
  profile_url: mediaUrl(p.profile),
  card_url: mediaUrl(p.card),
  thumb_url: mediaUrl(p.thumb),
  has_master: !!p.master,
  created_at: iso(p.created_at),
});
const videoPayload = (v) => ({
  id: v.id, talent: v.talent_id, position: v.position, title: v.title, platform: v.platform, url: v.url || "",
  file_url: mediaUrl(v.file), description: v.description || "", thumbnail_url: v.thumbnail_url || "",
});
const linkPayload = (l) => ({ id: l.id, talent: l.talent_id, title: l.title, url: l.url, kind: l.kind || "" });
const guardianPayload = (g) => ({
  id: g.id, talent: g.talent_id, name: g.name, relationship: g.relationship, phone: g.phone, alt_phone: g.alt_phone || "",
  email: g.email || "", address: g.address || "", id_verified: bool(g.id_verified), is_primary: bool(g.is_primary), notes: g.notes || "",
});
function consentEffective(c, today = localDate()) {
  if (c.status !== "granted") return false;
  if (c.expires_on && c.expires_on < today) return false;
  return true;
}
const consentPayload = (c) => ({
  id: c.id, talent: c.talent_id, consent_type: c.consent_type, type_label: label("consent_type", c.consent_type), status: c.status,
  status_label: label("consent_status", c.status), obtained_on: c.obtained_on || null, method: c.method || "", evidence_url: mediaUrl(c.evidence),
  scope: c.scope || "", given_by: c.given_by || "", expires_on: c.expires_on || null, withdrawn_on: c.withdrawn_on || null, notes: c.notes || "",
  is_effective: consentEffective(c), created_at: iso(c.created_at), updated_at: iso(c.updated_at),
});

async function userNames(ids) {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return new Map();
  const rows = await db("users").whereIn("id", clean);
  return new Map(rows.map((u) => [u.id, `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username]));
}

async function detailPayload(t) {
  const [videos, links, guardians, consents, names] = await Promise.all([
    db("featured_videos").where({ talent_id: t.id }).orderBy("position"),
    db("portfolio_links").where({ talent_id: t.id }).orderBy("id"),
    db("guardians").where({ talent_id: t.id }).orderBy("id"),
    db("consents").where({ talent_id: t.id }).orderBy([{ column: "consent_type" }, { column: "obtained_on", order: "desc" }, { column: "id", order: "desc" }]),
    userNames([t.created_by, t.updated_by]),
  ]);
  t._guardians = guardians;
  t._consents = consents;
  const missing = json(t.missing_fields, []);
  return {
    ...listPayload(t),
    languages: t._languages.map((l) => ({ id: l.id, language: l.language_id, name: l.term.name, fluency: l.fluency || "", accents: l.accents || "", can_dub: bool(l.can_dub) })),
    version: t.version,
    archived_at: iso(t.archived_at),
    archive_reason: t.archive_reason || "",
    date_of_birth: t.date_of_birth || null,
    age_verified: bool(t.age_verified),
    approx_age: t.approx_age,
    height_cm: t.height_cm,
    weight_kg: t.weight_kg,
    measurements: json(t.measurements, {}),
    complexion: t.complexion || "",
    hair: t.hair || "",
    eye_color: t.eye_color || "",
    appearance_notes: t.appearance_notes || "",
    alt_phone: t.alt_phone || "",
    whatsapp_phone: t.whatsapp_phone || "",
    email: t.email || "",
    instagram: t.instagram || "",
    address: t.address || "",
    state: t.state || "",
    country: t.country || "",
    contact_verified_at: iso(t.contact_verified_at),
    skills: t._terms.skills.map(miniTerm),
    experience_summary: t.experience_summary || "",
    fee_negotiable: nbool(t.fee_negotiable),
    fee_notes: t.fee_notes || "",
    rates_reviewed_at: iso(t.rates_reviewed_at),
    travel_willingness: t.travel_willingness || "",
    has_passport: nbool(t.has_passport),
    travel_notes: t.travel_notes || "",
    internal_notes: t.internal_notes || "",
    child_safety_verified: bool(t.child_safety_verified),
    child_safety_verified_at: iso(t.child_safety_verified_at),
    child_safety_notes: t.child_safety_notes || "",
    missing_fields: missing,
    missing: missing.map((m) => COMPLETENESS_LABELS[m] || m),
    photos: t._photos.map(photoPayload),
    featured_videos: videos.map(videoPayload),
    portfolio_links: links.map(linkPayload),
    guardians: guardians.map(guardianPayload),
    consents: consents.map(consentPayload),
    is_child: isChild(t),
    created_by_name: names.get(t.created_by) || null,
    updated_by_name: names.get(t.updated_by) || null,
  };
}

// Load one live talent row by numeric id or cast ID.
async function findTalent(idOrCast, { withDeleted = false } = {}) {
  const q = db("talent");
  if (!withDeleted) q.whereNull("deleted_at");
  const s = String(idOrCast || "");
  if (s.toUpperCase().startsWith("CH-")) q.where({ cast_id: s.toUpperCase() });
  else if (/^\d+$/.test(s)) q.where({ id: Number(s) });
  else return null;
  return q.first();
}

// ---------------------------------------------------------------- completeness (FR-019)
async function loadForRules(talentId) {
  const t = await db("talent").where({ id: talentId }).first();
  if (!t) return null;
  await hydrate([t], null, { detail: true });
  t._guardians = await db("guardians").where({ talent_id: t.id });
  t._consents = await db("consents").where({ talent_id: t.id });
  t._videoCount = Number((await db("featured_videos").where({ talent_id: t.id }).count({ n: "*" }).first()).n);
  return t;
}

function consentOk(t, settings) {
  const effective = new Set(t._consents.filter((c) => consentEffective(c)).map((c) => c.consent_type));
  if (isChild(t)) return effective.has("guardian") && t._guardians.length > 0;
  if (settings.require_consent_for_all) return effective.has("data_storage");
  return true;
}

function checks(settings) {
  return {
    primary_photo: (t) => t._photos.some((p) => bool(p.is_primary)),
    name: (t) => !!(t.full_name || "").trim(),
    phone: (t) => !!t.phone_normalized,
    location: (t) => !!(t.city || "").trim(),
    category: (t) => t._terms.categories.length > 0,
    age: (t) => !!(t.date_of_birth || t.approx_age || (t.playing_age_min && t.playing_age_max)),
    fee: (t) => (t.expected_fee !== null && t.expected_fee !== undefined) || bool(t.fee_unknown),
    languages: (t) => t._languages.length > 0,
    featured_video: (t) => t._videoCount > 0,
    consent: (t) => consentOk(t, settings),
    gender: (t) => !!t.gender,
    height: (t) => !!t.height_cm,
    skills: (t) => t._terms.skills.length > 0,
    instagram: (t) => !!t.instagram_normalized,
    experience: (t) => !!t.experience_level,
  };
}

// Recalculate completeness and move between Active / Needs Details.
async function refreshCompleteness(talentId) {
  const settings = await getSettings();
  const t = await loadForRules(talentId);
  if (!t) return null;
  const all = checks(settings);
  const fields = settings.completeness_fields.filter((f) => all[f]);
  const missing = fields.filter((f) => {
    try {
      return !all[f](t);
    } catch {
      return true;
    }
  });
  const score = fields.length ? Math.round((100 * (fields.length - missing.length)) / fields.length) : 100;
  const status = t.status === "staging" ? "staging" : missing.length ? "needs_details" : "active";
  await db("talent").where({ id: t.id }).update({ completeness: score, missing_fields: toJson(missing), status });
  return { score, missing };
}

// ---------------------------------------------------------------- duplicates (FR-021)
const STRENGTH = { exact: 0, strong: 1, possible: 2 };

async function findDuplicates({ full_name = "", phone = "", alt_phone = "", instagram = "", city = "", age = null, exclude_id = null, limit = 10 } = {}) {
  const cc = (await getSettings()).default_country_code;
  const primary = normalizePhone(phone, cc);
  const phones = [...new Set([primary, normalizePhone(alt_phone, cc)].filter(Boolean))];
  const insta = normalizeInstagram(instagram);
  const nameN = normalizeName(full_name);
  const base = () => {
    const q = db("talent");
    if (exclude_id) q.whereNot({ id: Number(exclude_id) });
    return q;
  };
  const found = new Map();
  const add = (t, reason, strength) => {
    if (!found.has(t.id)) found.set(t.id, { talent: t, reasons: [], strength });
    const rec = found.get(t.id);
    rec.reasons.push(reason);
    if (STRENGTH[strength] < STRENGTH[rec.strength]) rec.strength = strength;
  };
  if (phones.length) {
    const rows = await base().where((q) => q.whereIn("phone_normalized", phones).orWhereIn("alt_phone_normalized", phones));
    for (const t of rows) {
      if (primary && t.phone_normalized === primary) add(t, "Same phone number", "exact");
      else if (primary && t.alt_phone_normalized === primary) add(t, "Phone matches their alternate phone", "exact");
      else add(t, "Alternate phone number matches", "strong");
    }
  }
  if (insta) for (const t of await base().where({ instagram_normalized: insta })) add(t, "Same Instagram profile", "strong");
  if (nameN && nameN.length >= 3) {
    const first = nameN.split(" ")[0];
    const cand = await base().where((q) => q.where("name_normalized", "like", `%${first}%`).orWhere("name_normalized", "like", `%${nameN.slice(0, 4)}%`)).limit(500);
    const cityL = String(city || "").trim().toLowerCase();
    for (const t of cand) {
      const ratio = similarity(nameN, t.name_normalized || "");
      if (ratio < 0.82) continue;
      const sameCity = cityL && ((t.city || "").trim().toLowerCase() === cityL || (t.district || "").trim().toLowerCase() === cityL);
      const tAge = ageOf(t) ?? t.playing_age_min ?? null;
      const closeAge = age !== null && age !== undefined && age !== "" && tAge !== null && Math.abs(Number(age) - Number(tAge)) <= 3;
      if (sameCity) add(t, `Similar name in ${t.city}`, "possible");
      else if (closeAge) add(t, "Similar name and age", "possible");
      else if (ratio > 0.97) add(t, "Same name", "possible");
    }
  }
  const results = [...found.values()].sort((a, b) => STRENGTH[a.strength] - STRENGTH[b.strength]);
  for (const r of results) {
    if (r.talent.deleted_at) r.reasons.push("Record is in Trash");
    else if (bool(r.talent.is_archived)) r.reasons.push("Record is archived");
  }
  return results.slice(0, limit);
}

async function duplicatePayload(matches) {
  if (!matches.length) return [];
  const photos = await db("talent_photos").whereIn("talent_id", matches.map((m) => m.talent.id)).where({ is_primary: true });
  const pmap = new Map(photos.map((p) => [p.talent_id, p]));
  return matches.map((m) => ({
    id: m.talent.id,
    cast_id: m.talent.cast_id,
    full_name: m.talent.full_name,
    city: m.talent.city,
    phone: m.talent.phone,
    is_archived: bool(m.talent.is_archived),
    is_deleted: !!m.talent.deleted_at,
    photo: pmap.get(m.talent.id) ? mediaUrl(pmap.get(m.talent.id).thumb) : null,
    strength: m.strength,
    reasons: m.reasons,
  }));
}

// ---------------------------------------------------------------- photos (FR-007)
class PhotoError extends Error {}
const ALLOWED = { jpeg: "jpg", png: "png", webp: "webp" };
const VARIANTS = { profile: [1200, 1600], card: [480, 600], thumb: [160, 200] };

// Centre-crop box to 4:5 portrait, biased toward the top (faces).
function ratioBox(w, h, ratio = 0.8) {
  if (w / h > ratio) {
    const nw = Math.floor(h * ratio);
    return { left: Math.floor((w - nw) / 2), top: 0, width: nw, height: h };
  }
  const nh = Math.floor(w / ratio);
  return { left: 0, top: Math.max(0, Math.floor((h - nh) / 4)), width: w, height: nh };
}

function writeMedia(rel, buf) {
  const full = path.join(config.MEDIA_ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  return rel;
}
function deleteMedia(rel) {
  if (!rel) return;
  try {
    fs.unlinkSync(path.join(config.MEDIA_ROOT, rel));
  } catch {
    /* already gone */
  }
}

// Validate + normalise an uploaded image: fix EXIF orientation, rotate, crop,
// strip all metadata, and produce WebP variants.
async function processPhoto(raw, { crop = null, rotate = 0 } = {}) {
  if (!raw || !raw.length) throw new PhotoError("The photo file is empty.");
  let meta;
  try {
    meta = await sharp(raw).metadata();
  } catch {
    throw new PhotoError("This file isn't a readable image. Please upload a JPG, PNG or WebP photo.");
  }
  if (!ALLOWED[meta.format]) throw new PhotoError(`${(meta.format || "This").toUpperCase()} images aren't supported. Please upload a JPG, PNG or WebP photo.`);
  let buf = await sharp(raw).rotate().toBuffer(); // EXIF orientation
  const deg = ((Number(rotate) || 0) % 360 + 360) % 360;
  if (deg) buf = await sharp(buf).rotate(deg).toBuffer();
  let info = await sharp(buf).metadata();
  if (crop) {
    let x, y, w, h;
    try {
      x = Math.max(0, Math.floor(Number(crop.x)));
      y = Math.max(0, Math.floor(Number(crop.y)));
      w = Math.floor(Number(crop.width));
      h = Math.floor(Number(crop.height));
      if ([x, y, w, h].some((n) => !Number.isFinite(n))) throw new Error();
    } catch {
      throw new PhotoError("The crop area is invalid.");
    }
    w = Math.min(w, info.width - x);
    h = Math.min(h, info.height - y);
    if (w < 50 || h < 50) throw new PhotoError("The crop area is too small.");
    buf = await sharp(buf).extract({ left: x, top: y, width: w, height: h }).toBuffer();
    info = await sharp(buf).metadata();
  }
  if (info.width < 200 || info.height < 200) throw new PhotoError("This photo is too small. Please use an image at least 200×200 pixels.");
  const encode = (img) => img.flatten({ background: "#ffffff" }).webp({ quality: 84 }).toBuffer();
  const box = ratioBox(info.width, info.height);
  const fit = (s, [w, h]) => s.resize({ width: w, height: h, fit: "inside", withoutEnlargement: true });
  return {
    profile: await encode(fit(sharp(buf), VARIANTS.profile)),
    card: await encode(fit(sharp(buf).extract(box), VARIANTS.card)),
    thumb: await encode(fit(sharp(buf).extract(box), VARIANTS.thumb)),
    master: config.KEEP_MASTER_IMAGES ? { buf: raw, ext: ALLOWED[meta.format] } : null,
    width: info.width,
    height: info.height,
  };
}

async function addPhoto(talent, raw, { user = null, crop = null, rotate = 0, label: lbl = "", makePrimary = false } = {}) {
  const data = await processPhoto(raw, { crop, rotate });
  const stem = crypto.randomBytes(8).toString("hex");
  const dir = `talent/${talent.cast_id}/photos`;
  const files = {
    profile: writeMedia(`${dir}/profile/${stem}.webp`, data.profile),
    card: writeMedia(`${dir}/card/${stem}.webp`, data.card),
    thumb: writeMedia(`${dir}/thumb/${stem}.webp`, data.thumb),
    master: data.master ? writeMedia(`${dir}/master/${stem}.${data.master.ext}`, data.master.buf) : "",
  };
  const hasPrimary = await db("talent_photos").where({ talent_id: talent.id, is_primary: true }).first();
  const count = Number((await db("talent_photos").where({ talent_id: talent.id }).count({ n: "*" }).first()).n);
  const isPrimary = makePrimary || !hasPrimary;
  if (isPrimary) await db("talent_photos").where({ talent_id: talent.id, is_primary: true }).update({ is_primary: false });
  const now = nowDb();
  const [id] = await db("talent_photos").insert({
    talent_id: talent.id, ...files, width: data.width, height: data.height, label: lbl || talent.full_name, is_primary: isPrimary,
    is_outdated: false, sort_order: count, created_at: now, updated_at: now, created_by: user?.id || null, updated_by: user?.id || null,
  });
  return db("talent_photos").where({ id: Number(id) }).first();
}

// ---------------------------------------------------------------- videos (FR-008)
const YOUTUBE_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{6,})/;
function detectPlatform(url) {
  const u = String(url || "").toLowerCase();
  if (u.includes("youtu")) return "youtube";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("vimeo.com")) return "vimeo";
  if (u.includes("drive.google.com")) return "google_drive";
  if (u.includes("facebook.com") || u.includes("fb.watch")) return "facebook";
  return "other";
}
function videoThumbnail(url) {
  const m = String(url || "").match(YOUTUBE_RE);
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : "";
}

// ---------------------------------------------------------------- consent (FR-020)
const BLOCKING_CONSENTS = ["data_storage", "portfolio_use", "client_sharing", "guardian"];

async function onConsentChanged(consent, previousStatus, user) {
  if (consent.status === "withdrawn" && previousStatus !== "withdrawn") {
    if (!consent.withdrawn_on) await db("consents").where({ id: consent.id }).update({ withdrawn_on: localDate() });
    if (BLOCKING_CONSENTS.includes(consent.consent_type)) await db("talent").where({ id: consent.talent_id }).update({ consent_hold: true });
    const now = nowDb();
    await db("retention_reviews").insert({
      talent_id: consent.talent_id, consent_id: consent.id, reason: `${label("consent_type", consent.consent_type)} consent withdrawn`,
      status: "open", due_on: addDays(localDate(), 30), resolution_notes: "", created_at: now, updated_at: now, created_by: user?.id || null,
    });
  } else if (consent.status === "granted") {
    const all = await db("consents").where({ talent_id: consent.talent_id });
    const granted = new Set(all.filter((c) => c.status === "granted").map((c) => c.consent_type));
    const stillWithdrawn = all.some((c) => c.status === "withdrawn" && BLOCKING_CONSENTS.includes(c.consent_type) && !granted.has(c.consent_type));
    if (!stillWithdrawn) await db("talent").where({ id: consent.talent_id }).update({ consent_hold: false });
  }
}

// Reasons a talent cannot currently be booked: child artists need guardian details.
async function bookingBlockers(talentOrId) {
  const t = typeof talentOrId === "object" && talentOrId._consents ? talentOrId : await loadForRules(talentOrId.id || talentOrId);
  const problems = [];
  if (isChild(t) && !t._guardians.length) problems.push("Child artist: parent/guardian details are required.");
  return problems;
}

async function nextCastId() {
  return `CH-CAST-${pad(await sequenceNext("cast_id"), 6)}`;
}

module.exports = {
  mediaUrl,
  M2M,
  ageOf,
  hydrate,
  isChild,
  listPayload,
  detailPayload,
  photoPayload,
  videoPayload,
  linkPayload,
  guardianPayload,
  consentPayload,
  userNames,
  findTalent,
  refreshCompleteness,
  findDuplicates,
  duplicatePayload,
  PhotoError,
  addPhoto,
  deleteMedia,
  writeMedia,
  detectPlatform,
  videoThumbnail,
  onConsentChanged,
  bookingBlockers,
  nextCastId,
  loadForRules,
};
