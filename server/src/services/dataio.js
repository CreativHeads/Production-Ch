// FR-018 import & export, FR-022 full structured backup.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const ExcelJS = require("exceljs");
const { parse: parseCsv } = require("csv-parse/sync");
const config = require("../config");
const { db, nowDb, iso, bool, money, json, toJson, localDate, slugify, insertId, pad } = require("../db");
const audit = require("../audit");
const { getSettings } = require("../settings");
const { C, label } = require("../choices");
const { normalizePhone } = require("../normalize");
const T = require("./talent");

// ---------------------------------------------------------------- field catalogue
const IMPORT_FIELDS = {
  full_name: ["Full name", ["name", "full name", "talent name", "artist name"]],
  screen_name: ["Screen name", ["screen name", "stage name"]],
  phone: ["Primary phone", ["phone", "mobile", "phone number", "contact", "contact number", "mobile number", "whatsapp number"]],
  alt_phone: ["Alternate phone", ["alternate phone", "alt phone", "phone 2", "secondary phone", "other phone"]],
  whatsapp_phone: ["WhatsApp (if different)", ["whatsapp"]],
  email: ["Email", ["email", "e-mail", "mail"]],
  instagram: ["Instagram", ["instagram", "insta", "ig", "instagram link", "instagram url"]],
  city: ["City / current location", ["city", "location", "place", "current location", "town"]],
  district: ["District", ["district"]],
  state: ["State", ["state"]],
  gender: ["Gender", ["gender", "sex"]],
  date_of_birth: ["Date of birth", ["dob", "date of birth", "birth date", "birthday"]],
  approx_age: ["Age", ["age"]],
  playing_age_min: ["Playing age from", ["playing age min", "playing age from", "min age"]],
  playing_age_max: ["Playing age to", ["playing age max", "playing age to", "max age"]],
  playing_age: ["Playing age range (e.g. 25-32)", ["playing age", "age range"]],
  height_cm: ["Height (cm)", ["height", "height cm"]],
  categories: ["Categories (comma separated)", ["category", "categories", "type"]],
  tags: ["Tags (comma separated)", ["tags", "tag", "looks"]],
  skills: ["Skills (comma separated)", ["skills", "skill", "talents"]],
  languages: ["Languages (comma separated)", ["languages", "language", "languages known"]],
  experience_level: ["Experience level", ["experience", "experience level"]],
  expected_fee: ["Expected fee", ["fee", "expected fee", "rate", "remuneration", "charges"]],
  fee_type: ["Fee type", ["fee type", "rate type", "fee basis"]],
  travel_willingness: ["Travel willingness", ["travel", "willing to travel"]],
  appearance_notes: ["Appearance notes", ["appearance", "look", "appearance notes"]],
  experience_summary: ["Experience / credits", ["credits", "previous work", "experience summary", "portfolio"]],
  internal_notes: ["Internal notes", ["notes", "remarks", "comments"]],
  photo_filename: ["Photo filename (inside ZIP)", ["photo", "photo filename", "image", "photo file"]],
  video_1: ["Featured video 1 URL", ["video", "video 1", "video link", "showreel"]],
  video_2: ["Featured video 2 URL", ["video 2"]],
  video_3: ["Featured video 3 URL", ["video 3"]],
};

const GENDER_MAP = { m: "male", male: "male", man: "male", boy: "male", f: "female", female: "female", woman: "female", girl: "female", nb: "non_binary", "non-binary": "non_binary", "non binary": "non_binary", other: "other" };
const FEE_TYPE_MAP = { day: "per_day", "per day": "per_day", daily: "per_day", shoot: "per_shoot", "per shoot": "per_shoot", project: "per_project", "per project": "per_project", hour: "per_hour", "per hour": "per_hour", hourly: "per_hour" };
const TRAVEL_MAP = { local: "local", no: "local", district: "district", state: "state", kerala: "state", yes: "national", india: "national", national: "national", anywhere: "national", international: "international", abroad: "international" };
const EXPERIENCE_MAP = { ...Object.fromEntries(C.experience.map(([k]) => [k, k])), new: "fresher", pro: "professional" };

const normHeader = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().replace(/\s+/g, " ");

function autoMapping(headers) {
  const mapping = {};
  const used = new Set();
  for (const h of headers) {
    const nh = normHeader(h);
    for (const [key, [lbl, aliases]] of Object.entries(IMPORT_FIELDS)) {
      if (used.has(key)) continue;
      if (nh === key.replace(/_/g, " ") || nh === normHeader(lbl) || aliases.includes(nh)) {
        mapping[h] = key;
        used.add(key);
        break;
      }
    }
  }
  return mapping;
}

// ---------------------------------------------------------------- reading files
class ImportFileError extends Error {}

function cell(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return localDate(new Date(v.getTime() + v.getTimezoneOffset() * 60000));
  if (typeof v === "object") {
    if (v.text) return String(v.text).trim();
    if (v.result !== undefined) return cell(v.result);
    if (v.richText) return v.richText.map((x) => x.text).join("").trim();
    if (v.hyperlink) return String(v.hyperlink).trim();
  }
  if (typeof v === "number" && Number.isInteger(v)) return String(v);
  return String(v).trim();
}

async function readTable(buffer, name) {
  const ext = path.extname(name.toLowerCase());
  let rows;
  if (ext === ".csv") {
    let text;
    if (buffer[0] === 0xff && buffer[1] === 0xfe) text = buffer.toString("utf16le");
    else {
      text = buffer.toString("utf8");
      if (text.includes("�")) text = buffer.toString("latin1");
    }
    text = text.replace(/^﻿/, "");
    const sample = text.slice(0, 4096);
    const delimiter = [",", ";", "\t"].sort((a, b) => sample.split(b).length - sample.split(a).length)[0];
    try {
      rows = parseCsv(text, { delimiter, relax_column_count: true, relax_quotes: true, skip_empty_lines: false });
    } catch {
      throw new ImportFileError("We couldn't read the text in this CSV. Save it as UTF-8 and try again.");
    }
  } else if (ext === ".xlsx" || ext === ".xlsm") {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer);
    } catch {
      throw new ImportFileError("This Excel file couldn't be opened. Make sure it's a valid .xlsx file.");
    }
    const ws = wb.worksheets[0];
    rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      for (let i = 1; i <= row.cellCount; i++) vals.push(cell(row.getCell(i).value));
      rows.push(vals);
    });
  } else {
    throw new ImportFileError("Upload a .csv or .xlsx file.");
  }
  rows = rows.filter((r) => r.some((c) => String(c ?? "").trim()));
  if (rows.length < 2) throw new ImportFileError("The file needs a header row and at least one data row.");
  const headers = rows[0].map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`);
  const seen = {};
  headers.forEach((h, i) => {
    if (seen[h]) {
      seen[h] += 1;
      headers[i] = `${h} (${seen[h]})`;
    } else seen[h] = 1;
  });
  const data = rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, cell(r[i])])));
  if (data.length > 5000) throw new ImportFileError("Imports are limited to 5,000 rows at a time. Split the file and try again.");
  return { headers, data };
}

// ---------------------------------------------------------------- validation
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function parseImportDate(s) {
  s = String(s || "").trim();
  if (!s) return null;
  const ok = (y, m, d) => {
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
  };
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    const r = ok(+m[1], +m[2], +m[3]);
    if (r) return r;
  }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
    const r = ok(+m[3], +m[2], +m[1]) || ok(+m[3], +m[1], +m[2]);
    if (r) return r;
  }
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/))) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) {
      const r = ok(+m[3], mi + 1, +m[1]);
      if (r) return r;
    }
  }
  throw new Error(`“${s}” isn't a date we recognise (use DD/MM/YYYY).`);
}

function parseInt2(s, lbl, lo, hi) {
  s = String(s || "").trim();
  if (!s) return null;
  const m = s.match(/\d+/);
  if (!m) throw new Error(`${lbl} “${s}” isn't a number.`);
  const v = Number(m[0]);
  if (v < lo || v > hi) throw new Error(`${lbl} ${v} looks wrong.`);
  return v;
}

function parseMoney(s) {
  s = String(s || "").trim().toLowerCase().replace(/,/g, "").replace(/₹/g, "").replace(/rs/g, "").replace(/inr/g, "").trim();
  if (!s) return null;
  let mult = 1;
  if (s.endsWith("k")) {
    mult = 1000;
    s = s.slice(0, -1);
  } else if (s.endsWith("lakh") || s.endsWith("l")) {
    mult = 100000;
    s = s.replace(/lakh$|l$/, "");
  }
  const n = Number(s.trim());
  if (!s.trim() || !Number.isFinite(n)) throw new Error(`Fee “${s}” isn't a number.`);
  return (n * mult).toFixed(2);
}

const split = (s) => String(s || "").split(/[,;/|]/).map((p) => p.trim()).filter(Boolean);

function mappedValues(row, mapping) {
  const out = {};
  for (const [header, key] of Object.entries(mapping)) if (key && header in row && String(row[header]).trim()) out[key] = String(row[header]).trim();
  return out;
}

function validateRow(values, photoNames, seenPhones, cc) {
  const errors = [];
  const warnings = [];
  const data = {};
  data.full_name = values.full_name || "";
  if (!data.full_name) errors.push("Full name is missing.");
  data.phone = values.phone || "";
  const norm = normalizePhone(data.phone, cc);
  if (!norm) errors.push("Primary phone is missing.");
  else if (norm.length < 10) errors.push(`Phone “${data.phone}” looks incomplete.`);
  else if (norm in seenPhones) errors.push(`Same phone as row ${seenPhones[norm]} in this file.`);
  data.city = values.city || "";
  if (!data.city) errors.push("City / current location is missing.");
  data.categories = split(values.categories);
  if (!data.categories.length) errors.push("At least one category is required.");
  for (const k of ["screen_name", "alt_phone", "whatsapp_phone", "email", "instagram", "district", "state", "appearance_notes", "experience_summary", "internal_notes"]) {
    if (values[k]) data[k] = values[k];
  }
  for (const k of ["tags", "skills", "languages"]) if (values[k]) data[k] = split(values[k]);
  if (values.gender) {
    const g = GENDER_MAP[values.gender.trim().toLowerCase()];
    if (g) data.gender = g;
    else warnings.push(`Gender “${values.gender}” not recognised — left blank.`);
  }
  try {
    const dob = parseImportDate(values.date_of_birth);
    if (dob) {
      if (dob > localDate()) throw new Error("Date of birth is in the future.");
      data.date_of_birth = dob;
    }
  } catch (e) {
    errors.push(e.message);
  }
  for (const [k, lbl, hi] of [["approx_age", "Age", 120], ["playing_age_min", "Playing age from", 120], ["playing_age_max", "Playing age to", 120], ["height_cm", "Height", 260]]) {
    try {
      const v = parseInt2(values[k], lbl, 0, hi);
      if (v !== null) data[k] = v;
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (values.playing_age && !("playing_age_min" in data)) {
    const nums = values.playing_age.match(/\d+/g) || [];
    if (nums.length >= 2) [data.playing_age_min, data.playing_age_max] = [Number(nums[0]), Number(nums[1])];
    else if (nums.length) data.playing_age_min = data.playing_age_max = Number(nums[0]);
  }
  if (data.playing_age_min && data.playing_age_max && data.playing_age_min > data.playing_age_max) errors.push("Playing age 'from' is greater than 'to'.");
  if (values.height_cm && data.height_cm && data.height_cm < 100 && values.height_cm.includes(".")) {
    const [ft, inch] = values.height_cm.split(".");
    if (/^\d+$/.test(ft) && /^\d+$/.test(inch)) {
      data.height_cm = Math.round(Number(ft) * 30.48 + Number(inch) * 2.54);
      warnings.push(`Height converted from feet to ${data.height_cm} cm.`);
    }
  }
  try {
    const fee = parseMoney(values.expected_fee);
    if (fee !== null) data.expected_fee = fee;
  } catch (e) {
    errors.push(e.message);
  }
  for (const [k, table] of [["fee_type", FEE_TYPE_MAP], ["travel_willingness", TRAVEL_MAP], ["experience_level", EXPERIENCE_MAP]]) {
    if (!values[k]) continue;
    const v = table[values[k].trim().toLowerCase()];
    if (v) data[k] = v;
    else warnings.push(`${k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} “${values[k]}” not recognised — left blank.`);
  }
  const videos = [1, 2, 3].map((i) => values[`video_${i}`]).filter(Boolean);
  const good = [];
  for (const v of videos) {
    if (/^https?:\/\//.test(v)) good.push(v);
    else warnings.push(`Video “${v.slice(0, 40)}” isn't a web link — skipped.`);
  }
  if (good.length) data.videos = good;
  const photo = values.photo_filename || "";
  if (photo) {
    const base = path.basename(photo).toLowerCase();
    if (photoNames[base]) data.photo_filename = photoNames[base];
    else warnings.push(`Photo “${photo}” wasn't found in the ZIP.`);
  }
  return { data, errors, warnings, norm };
}

const importPath = (rel) => path.join(config.IMPORT_ROOT, rel);

function zipNames(batch) {
  if (!batch.photos_zip) return {};
  try {
    const zip = new AdmZip(importPath(batch.photos_zip));
    const out = {};
    for (const e of zip.getEntries()) {
      const base = path.basename(e.entryName);
      if (!e.isDirectory && /\.(jpe?g|png|webp)$/i.test(base) && !base.startsWith(".")) out[base.toLowerCase()] = e.entryName;
    }
    return out;
  } catch {
    return {};
  }
}

async function validateBatch(batch, mapping) {
  const photoNames = zipNames(batch);
  const seen = {};
  const counts = { ok: 0, errors: 0, duplicates: 0, staging: 0, warnings: 0 };
  const cc = (await getSettings()).default_country_code;
  const rows = await db("import_rows").where({ batch_id: batch.id }).orderBy("row_number");
  for (const row of rows) {
    const values = mappedValues(json(row.raw, {}), mapping);
    const { data, errors, warnings, norm } = validateRow(values, photoNames, seen, cc);
    if (norm && !(norm in seen)) seen[norm] = row.row_number;
    let dups = [];
    if (!errors.length) {
      const matches = await T.findDuplicates({
        full_name: data.full_name, phone: data.phone, alt_phone: data.alt_phone || "", instagram: data.instagram || "", city: data.city,
        age: data.approx_age ?? null, limit: 5,
      });
      dups = matches.map((m) => ({ id: m.talent.id, cast_id: m.talent.cast_id, full_name: m.talent.full_name, city: m.talent.city, strength: m.strength, reasons: m.reasons }));
    }
    const strong = dups.some((d) => d.strength === "exact" || d.strength === "strong");
    let action;
    if (errors.length) {
      action = "skip";
      counts.errors += 1;
    } else if (strong) {
      action = "skip"; // never silently create — staff must choose
      counts.duplicates += 1;
    } else if (!data.photo_filename) {
      action = "staging";
      counts.staging += 1;
    } else {
      action = "create";
      counts.ok += 1;
    }
    if (dups.length && !strong) counts.duplicates += 1;
    if (warnings.length) counts.warnings += 1;
    await db("import_rows").where({ id: row.id }).update({
      data: toJson(data), errors: toJson(errors), warnings: toJson(warnings), duplicates: toJson(dups), action, duplicate_acknowledged: false,
    });
  }
  await db("import_batches").where({ id: batch.id }).update({ mapping: toJson(mapping), status: "mapped", summary: toJson(counts) });
  return counts;
}

async function termsFor(kind, names, user, createdLog) {
  const out = [];
  for (const n of names) {
    const slug = slugify(n).slice(0, 90);
    if (!slug) continue;
    let t = await db("terms").where({ kind, slug }).first();
    if (t && t.merged_into_id) t = await db("terms").where({ id: t.merged_into_id }).first();
    if (!t) {
      const name = n === n.toLowerCase() ? n.trim().replace(/\b\w/g, (c) => c.toUpperCase()) : n.trim();
      const now = nowDb();
      const id = await insertId("terms", { kind, name, slug, description: "", color: "", sort_order: 0, is_archived: false, system_key: "", created_at: now, updated_at: now, created_by: user.id, updated_by: user.id });
      t = await db("terms").where({ id }).first();
      createdLog.push(`${kind}: ${t.name}`);
    }
    if (!out.some((x) => x.id === t.id)) out.push(t);
  }
  return out;
}

async function createFromRow(row, data, user, zip, createdTerms) {
  const { createTalent } = require("../routes/talent");
  const staging = row.action === "staging" || !data.photo_filename;
  const simple = {};
  for (const k of [
    "full_name", "screen_name", "phone", "alt_phone", "whatsapp_phone", "email", "instagram", "city", "district", "state", "gender", "approx_age",
    "playing_age_min", "playing_age_max", "height_cm", "expected_fee", "fee_type", "travel_willingness", "experience_level", "appearance_notes",
    "experience_summary", "internal_notes", "date_of_birth",
  ]) if (k in data) simple[k] = data[k];
  if ("expected_fee" in simple) {
    simple.expected_fee = Number(simple.expected_fee);
    simple.rates_reviewed_at = nowDb();
  }
  const cats = await termsFor("category", data.categories || [], user, createdTerms);
  const tags = await termsFor("tag", data.tags || [], user, createdTerms);
  const skills = await termsFor("skill", data.skills || [], user, createdTerms);
  const langs = await termsFor("language", data.languages || [], user, createdTerms);
  const rel = {
    categories: cats.map((t) => t.id), tags: tags.map((t) => t.id), skills: skills.map((t) => t.id),
    languages: langs.map((t) => ({ language_id: t.id, fluency: "", accents: "", can_dub: false })),
  };
  const t = await createTalent({ data: simple, rel }, user, { status: staging ? "staging" : "needs_details" });
  try {
    const now = nowDb();
    for (const [i, url] of (data.videos || []).slice(0, 3).entries()) {
      await db("featured_videos").insert({
        talent_id: t.id, position: i + 1, title: `Video ${i + 1}`, url, platform: T.detectPlatform(url), thumbnail_url: T.videoThumbnail(url), description: "",
        file: "", created_at: now, updated_at: now, created_by: user.id, updated_by: user.id,
      });
    }
    if (!staging && zip) {
      const entry = zip.getEntry(data.photo_filename);
      await T.addPhoto(t, entry.getData(), { user, makePrimary: true });
    }
    if (data.internal_notes) {
      await db("contact_notes").insert({
        talent_id: t.id, kind: "note", result: "", content: `Imported note: ${data.internal_notes}`, staff_id: user.id, interaction_at: now,
        follow_up_done: false, created_at: now, updated_at: now, created_by: user.id,
      });
    }
  } catch (e) {
    for (const table of ["talent_categories", "talent_tags", "talent_skills", "talent_languages", "featured_videos", "talent_photos", "contact_notes"]) {
      await db(table).where({ talent_id: t.id }).del();
    }
    await db("talent").where({ id: t.id }).del();
    throw e;
  }
  await T.refreshCompleteness(t.id);
  return db("talent").where({ id: t.id }).first();
}

async function runImport(batch, user, req) {
  await db("import_batches").where({ id: batch.id }).update({ status: "importing" });
  let created = 0, staged = 0, skipped = 0, failed = 0;
  const createdTerms = [];
  let zip = null;
  if (batch.photos_zip) {
    try {
      zip = new AdmZip(importPath(batch.photos_zip));
    } catch {
      zip = null;
    }
  }
  const rows = await db("import_rows").where({ batch_id: batch.id }).orderBy("row_number");
  for (const row of rows) {
    const errors = json(row.errors, []);
    const dups = json(row.duplicates, []);
    let result, message, talentId = null;
    if (row.action === "skip" || errors.length) {
      [result, message] = ["skipped", errors.length ? errors.join("; ") : "Skipped by staff"];
      skipped += 1;
    } else if (dups.length && !bool(row.duplicate_acknowledged)) {
      [result, message] = ["skipped", "Possible duplicate not acknowledged"];
      skipped += 1;
    } else {
      try {
        const t = await createFromRow(row, json(row.data, {}), user, zip, createdTerms);
        talentId = t.id;
        if (t.status === "staging") {
          [result, message] = ["staged", `${t.cast_id} in import staging (photo needed)`];
          staged += 1;
        } else {
          [result, message] = ["created", t.cast_id];
          created += 1;
        }
      } catch (e) {
        [result, message] = ["failed", (e instanceof T.PhotoError ? `Photo problem: ${e.message}` : `Couldn't save this row: ${e.message}`).slice(0, 255)];
        failed += 1;
      }
    }
    await db("import_rows").where({ id: row.id }).update({ result, result_message: message, talent_id: talentId });
  }
  const summary = { ...json(batch.summary, {}), created, staged, skipped, failed, new_terms: createdTerms };
  await db("import_batches").where({ id: batch.id }).update({ status: "completed", completed_at: nowDb(), summary: toJson(summary) });
  await audit.log(req || user, "import.completed", { entityType: "import", entityId: batch.id, label: batch.original_name, changes: summary });
  return summary;
}

// ---------------------------------------------------------------- export
const EXPORT_COLUMNS = [
  ["cast_id", "Cast ID", null], ["full_name", "Full name", null], ["screen_name", "Screen name", null], ["categories", "Categories", null],
  ["tags", "Tags", null], ["skills", "Skills", null], ["languages", "Languages", null], ["gender", "Gender", null], ["age", "Age", null],
  ["playing_age", "Playing age", null], ["height_cm", "Height (cm)", null], ["city", "City", null], ["district", "District", null],
  ["state", "State", null], ["experience_level", "Experience", null], ["travel_willingness", "Travel", null], ["instagram", "Instagram", "contact"],
  ["phone", "Phone", "contact"], ["alt_phone", "Alternate phone", "contact"], ["email", "Email", "contact"], ["expected_fee", "Expected fee", "fees"],
  ["fee_type", "Fee type", "fees"], ["fee_negotiable", "Negotiable", "fees"], ["videos", "Featured videos", null],
  ["completeness", "Profile completeness %", "internal"], ["status", "Status", "internal"], ["internal_notes", "Internal performance notes", "internal"],
  ["last_note", "Latest contact note", "internal"], ["created_at", "Added on", "internal"],
];

async function rowsFor(talents, include) {
  await T.hydrate(talents, null, { detail: true });
  const ids = talents.map((t) => t.id);
  const videos = ids.length ? await db("featured_videos").whereIn("talent_id", ids).orderBy("position") : [];
  const notes = include.has("internal") && ids.length ? await db("contact_notes").whereIn("talent_id", ids).orderBy("interaction_at", "desc").orderBy("id", "desc") : [];
  const fmtDay = (v) => new Date(iso(v)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return talents.map((t) => {
    const n = notes.find((x) => x.talent_id === t.id);
    return {
      cast_id: t.cast_id, full_name: t.full_name, screen_name: t.screen_name || "",
      categories: t._terms.categories.map((c) => c.name).join(", "), tags: t._terms.tags.map((c) => c.name).join(", "), skills: t._terms.skills.map((c) => c.name).join(", "),
      languages: t._languages.map((l) => `${l.term.name}${l.accents ? ` (${l.accents})` : ""}`).join(", "),
      gender: t.gender ? label("gender", t.gender) : "", age: T.ageOf(t) || "",
      playing_age: t.playing_age_min || t.playing_age_max ? `${t.playing_age_min || ""}–${t.playing_age_max || ""}` : "",
      height_cm: t.height_cm || "", city: t.city || "", district: t.district || "", state: t.state || "",
      experience_level: t.experience_level ? label("experience", t.experience_level) : "", travel_willingness: t.travel_willingness ? label("travel", t.travel_willingness) : "",
      instagram: t.instagram || "", phone: t.phone || "", alt_phone: t.alt_phone || "", email: t.email || "",
      expected_fee: bool(t.fee_unknown) ? "Unknown" : money(t.expected_fee) || "", fee_type: t.fee_type ? label("fee_type", t.fee_type) : "",
      fee_negotiable: t.fee_negotiable === null || t.fee_negotiable === undefined ? "" : bool(t.fee_negotiable) ? "Yes" : "No",
      videos: videos.filter((v) => v.talent_id === t.id && v.url).map((v) => v.url).join(" | "),
      completeness: t.completeness, status: label("talent_status", t.status), internal_notes: t.internal_notes || "",
      last_note: n ? `${fmtDay(n.interaction_at)} ${label("note_kind", n.kind)}: ${(n.content || "").slice(0, 200)}` : "",
      created_at: localDate(new Date(iso(t.created_at))),
    };
  });
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function writeExport(name, buf) {
  const d = new Date();
  const rel = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${crypto.randomBytes(4).toString("hex")}-${name}`;
  const full = path.join(config.EXPORT_ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  return rel;
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// include: Set of {"contact", "fees", "internal"}
async function buildExport(job, talents, include) {
  const cols = EXPORT_COLUMNS.filter(([, , g]) => g === null || include.has(g));
  const rows = await rowsFor(talents, include);
  let buf;
  let name;
  if (job.format === "csv") {
    const lines = [cols.map(([, l]) => csvCell(l)).join(",")];
    for (const r of rows) lines.push(cols.map(([k]) => csvCell(r[k])).join(","));
    buf = Buffer.from("﻿" + lines.join("\r\n") + "\r\n", "utf8");
    name = `creativheads-talent-${stamp()}.csv`;
  } else {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Talent", { views: [{ state: "frozen", xSplit: 2, ySplit: 1 }] });
    ws.addRow(cols.map(([, l]) => l));
    ws.getRow(1).eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
    });
    for (const r of rows) ws.addRow(cols.map(([k]) => r[k]));
    cols.forEach(([k, l], i) => {
      ws.getColumn(i + 1).width = Math.min(50, Math.max(l.length, ...rows.slice(0, 200).map((r) => String(r[k] ?? "").length)) + 2);
    });
    buf = Buffer.from(await wb.xlsx.writeBuffer());
    name = `creativheads-talent-${stamp()}.xlsx`;
  }
  await db("export_jobs").where({ id: job.id }).update({ filename: name, row_count: rows.length, file: writeExport(name, buf) });
}

const BACKUP_TABLES = [
  "users", "system_settings", "sequences", "audit_log", "terms", "talent", "talent_categories", "talent_tags", "talent_skills", "talent_languages",
  "talent_photos", "featured_videos", "portfolio_links", "favorites", "contact_notes", "guardians", "consents", "retention_reviews",
  "projects", "roles", "role_languages", "role_categories", "role_tags", "role_skills", "shortlist_entries", "shortlist_events", "availability", "bookings",
];

// Full structured export: JSON per table + manifest (+ media) in one ZIP.
async function buildBackup(job, includeMedia) {
  const zip = new AdmZip();
  const manifest = { created_at: new Date().toISOString(), app: "creativheads-casting-manager", models: {} };
  for (const table of BACKUP_TABLES) {
    let rows = await db(table).select("*");
    if (table === "users") rows = rows.map(({ password_hash, ...u }) => u); // never export password hashes
    zip.addFile(`data/${table}.json`, Buffer.from(JSON.stringify(rows, null, 1)));
    manifest.models[table] = rows.length;
  }
  if (includeMedia && fs.existsSync(config.MEDIA_ROOT)) {
    let count = 0;
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else {
          zip.addLocalFile(full, path.join("media", path.relative(config.MEDIA_ROOT, dir)).replace(/\\/g, "/"));
          count += 1;
        }
      }
    };
    walk(config.MEDIA_ROOT);
    manifest.media_files = count;
  }
  zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
  const name = `creativheads-full-backup-${stamp()}.zip`;
  const rows = Object.values(manifest.models).reduce((a, b) => a + b, 0);
  await db("export_jobs").where({ id: job.id }).update({ filename: name, row_count: rows, file: writeExport(name, zip.toBuffer()) });
}

// Delete expired export files and abandoned import uploads.
async function purgeExpired() {
  const now = nowDb();
  for (const job of await db("export_jobs").where({ purged: false }).where("expires_at", "<=", now)) {
    if (job.file) fs.rmSync(path.join(config.EXPORT_ROOT, job.file), { force: true });
    await db("export_jobs").where({ id: job.id }).update({ purged: true, file: "" });
  }
  const weekAgo = new Date(Date.now() - 7 * 86400e3).toISOString().replace("T", " ").replace("Z", "");
  for (const b of await db("import_batches").whereIn("status", ["uploaded", "mapped"]).where("created_at", "<=", weekAgo)) {
    for (const f of [b.file, b.photos_zip]) if (f) fs.rmSync(importPath(f), { force: true });
    await db("import_batches").where({ id: b.id }).update({ status: "cancelled" });
  }
}

module.exports = {
  IMPORT_FIELDS, autoMapping, readTable, ImportFileError, validateBatch, runImport, buildExport, buildBackup, purgeExpired, importPath,
};
