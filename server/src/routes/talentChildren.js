// Records hanging off a talent: photos, videos, links, guardians, consents (FR-020),
// contact notes (FR-017) and retention reviews.
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const config = require("../config");
const { db, nowDb, iso, bool, insertId } = require("../db");
const audit = require("../audit");
const { has, label } = require("../choices");
const { wrap, ValidationError, Conflict, notFound } = require("../errors");
const T = require("../services/talent");
const F = require("../services/filters");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024 } });

const empty = (v) => v === undefined || v === null || v === "" || v === "null";

// spec: {field: [type, arg, required]}
function clean(spec, body, partial) {
  const errors = {};
  const out = {};
  for (const [key, [type, arg, required]] of Object.entries(spec)) {
    if (!(key in body)) {
      if (!partial && required) errors[key] = ["This field is required."];
      continue;
    }
    const v = body[key];
    if (required && empty(v)) {
      errors[key] = ["This field may not be blank."];
      continue;
    }
    if (type === "str") {
      const s = empty(v) ? "" : String(v);
      if (arg && s.length > arg) errors[key] = [`Ensure this field has no more than ${arg} characters.`];
      out[key] = s;
    } else if (type === "url") {
      const s = empty(v) ? "" : String(v).trim();
      if (s && !/^https?:\/\/\S+$/i.test(s)) errors[key] = ["Enter a valid URL."];
      out[key] = s;
    } else if (type === "email") {
      const s = empty(v) ? "" : String(v).trim();
      if (s && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) errors[key] = ["Enter a valid email address."];
      out[key] = s;
    } else if (type === "choice") {
      if (empty(v) && !required) out[key] = "";
      else if (!has(arg, v)) errors[key] = [`"${v}" is not a valid choice.`];
      else out[key] = v;
    } else if (type === "bool") {
      out[key] = bool(v);
    } else if (type === "int") {
      const n = Number(v);
      if (empty(v)) out[key] = null;
      else if (!Number.isInteger(n)) errors[key] = ["A valid integer is required."];
      else out[key] = n;
    } else if (type === "date") {
      if (empty(v)) out[key] = null;
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errors[key] = ["Date has wrong format. Use YYYY-MM-DD."];
      else out[key] = String(v);
    } else if (type === "datetime") {
      if (empty(v)) out[key] = null;
      else {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) errors[key] = ["Datetime has wrong format."];
        else out[key] = d.toISOString().replace("T", " ").replace("Z", "");
      }
    } else if (type === "fk") {
      if (empty(v)) out[key] = null;
      else out[key] = Number(v);
    }
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return out;
}

async function requireTalent(id) {
  const t = id ? await db("talent").where({ id: Number(id) }).whereNull("deleted_at").first() : null;
  if (!t) throw new ValidationError({ talent: `Invalid pk "${id ?? ""}" - object does not exist.` });
  return t;
}

function saveUpload(file, dir) {
  const ext = path.extname(file.originalname || "").toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 8);
  const name = `${path.basename(file.originalname || "file", path.extname(file.originalname || "")).replace(/[^\w-]+/g, "_").slice(0, 60)}_${crypto.randomBytes(4).toString("hex")}${ext}`;
  return T.writeMedia(`${dir}/${name}`, file.buffer);
}

// ---------------------------------------------------------------- payloads
async function notePayload(rows) {
  if (!rows.length) return [];
  const users = await T.userNames(rows.map((n) => n.staff_id));
  const projects = new Map((await db("projects").whereIn("id", rows.map((n) => n.project_id).filter(Boolean))).map((p) => [p.id, p.title]));
  const talent = new Map((await db("talent").whereIn("id", rows.map((n) => n.talent_id))).map((t) => [t.id, t]));
  return rows.map((n) => ({
    id: n.id, talent: n.talent_id, talent_name: talent.get(n.talent_id)?.full_name, talent_cast_id: talent.get(n.talent_id)?.cast_id,
    kind: n.kind, result: n.result || "", content: n.content || "", staff: n.staff_id, staff_name: users.get(n.staff_id) || "—",
    interaction_at: iso(n.interaction_at), project: n.project_id, project_title: projects.get(n.project_id) || null,
    follow_up_on: n.follow_up_on || null, follow_up_done: bool(n.follow_up_done), created_at: iso(n.created_at), updated_at: iso(n.updated_at),
  }));
}

async function retentionPayload(rows) {
  if (!rows.length) return [];
  const talent = new Map((await db("talent").whereIn("id", rows.map((r) => r.talent_id))).map((t) => [t.id, t]));
  return rows.map((r) => ({
    id: r.id, talent: r.talent_id, talent_name: talent.get(r.talent_id)?.full_name, talent_cast_id: talent.get(r.talent_id)?.cast_id,
    consent: r.consent_id, reason: r.reason, status: r.status, due_on: r.due_on, resolution_notes: r.resolution_notes || "",
    resolved_at: iso(r.resolved_at), created_at: iso(r.created_at),
  }));
}

// ---------------------------------------------------------------- generic child CRUD
function childRoutes(r, { base, table, spec, payload, auditName, labelOf, beforeSave, afterSave, onDelete, files }) {
  const mw = files ? [upload.any()] : [];
  const one = async (id) => {
    const row = await db(table).where({ id: Number(id) || 0 }).first();
    if (!row) throw notFound();
    return row;
  };
  const after = async (req, row, verb) => {
    await T.refreshCompleteness(row.talent_id);
    const t = await db("talent").where({ id: row.talent_id }).first();
    await audit.log(req, `talent.${auditName}_${verb}`, { entityType: "talent", entityId: t.id, label: audit.talentLabel(t), message: labelOf ? labelOf(row) : "" });
  };

  r.get(`/${base}`, wrap(async (req, res) => {
    const q = db(table).orderBy("id");
    if (req.query.talent) q.where({ talent_id: Number(req.query.talent) });
    res.json((await q).map(payload));
  }));
  r.get(`/${base}/:id`, wrap(async (req, res) => res.json(payload(await one(req.params.id)))));

  r.post(`/${base}`, ...mw, wrap(async (req, res) => {
    const t = await requireTalent(req.body.talent);
    const data = clean(spec, req.body, false);
    if (beforeSave) await beforeSave(data, null, t, req);
    const now = nowDb();
    const id = await insertId(table, { ...data, talent_id: t.id, created_at: now, updated_at: now, created_by: req.user.id, updated_by: req.user.id });
    const row = await db(table).where({ id }).first();
    if (afterSave) await afterSave(row, null, req);
    await after(req, row, "added");
    res.status(201).json(payload(await db(table).where({ id }).first()));
  }));

  const update = wrap(async (req, res) => {
    const prev = await one(req.params.id);
    const data = clean(spec, req.body, true);
    const t = await db("talent").where({ id: prev.talent_id }).first();
    if (beforeSave) await beforeSave(data, prev, t, req);
    await db(table).where({ id: prev.id }).update({ ...data, updated_at: nowDb(), updated_by: req.user.id });
    const row = await db(table).where({ id: prev.id }).first();
    if (afterSave) await afterSave(row, prev, req);
    await after(req, row, "updated");
    res.json(payload(await db(table).where({ id: prev.id }).first()));
  });
  r.patch(`/${base}/:id`, ...mw, update);
  r.put(`/${base}/:id`, ...mw, update);

  r.delete(`/${base}/:id`, wrap(async (req, res) => {
    const row = await one(req.params.id);
    if (onDelete) await onDelete(row);
    await db(table).where({ id: row.id }).del();
    await T.refreshCompleteness(row.talent_id);
    const t = await db("talent").where({ id: row.talent_id }).first();
    await audit.log(req, `talent.${auditName}_removed`, { entityType: "talent", entityId: t.id, label: audit.talentLabel(t) });
    res.status(204).end();
  }));
}

module.exports = function (r) {
  // ------------------------------------------------ photos (created via /talent/:id/photos)
  r.get("/photos", wrap(async (req, res) => {
    const q = db("talent_photos").orderBy([{ column: "is_primary", order: "desc" }, "sort_order", "id"]);
    if (req.query.talent) q.where({ talent_id: Number(req.query.talent) });
    res.json((await q).map(T.photoPayload));
  }));
  r.get("/photos/:id", wrap(async (req, res) => {
    const p = await db("talent_photos").where({ id: req.params.id }).first();
    if (!p) throw notFound();
    res.json(T.photoPayload(p));
  }));
  const photoUpdate = wrap(async (req, res) => {
    const p = await db("talent_photos").where({ id: req.params.id }).first();
    if (!p) throw notFound();
    const data = clean({ label: ["str", 120], is_outdated: ["bool"], taken_on: ["date"], sort_order: ["int"] }, req.body, true);
    if (data.sort_order === null) delete data.sort_order;
    await db("talent_photos").where({ id: p.id }).update({ ...data, updated_at: nowDb(), updated_by: req.user.id });
    const t = await db("talent").where({ id: p.talent_id }).first();
    if ([true, "true", "1"].includes(req.body.is_primary)) {
      await db("talent_photos").where({ talent_id: p.talent_id, is_primary: true }).whereNot({ id: p.id }).update({ is_primary: false });
      await db("talent_photos").where({ id: p.id }).update({ is_primary: true });
      await T.refreshCompleteness(p.talent_id);
      await audit.log(req, "talent.primary_photo_changed", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t) });
    }
    if ("is_outdated" in req.body) {
      await audit.log(req, data.is_outdated ? "talent.photo_flagged" : "talent.photo_unflagged", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t) });
    }
    res.json(T.photoPayload(await db("talent_photos").where({ id: p.id }).first()));
  });
  r.patch("/photos/:id", photoUpdate);
  r.put("/photos/:id", photoUpdate);
  r.delete("/photos/:id", wrap(async (req, res) => {
    const p = await db("talent_photos").where({ id: req.params.id }).first();
    if (!p) throw notFound();
    if (bool(p.is_primary)) throw new Conflict("This is the primary photo. Choose or upload another primary photo before deleting it.", "primary_photo");
    for (const f of [p.master, p.profile, p.card, p.thumb]) T.deleteMedia(f);
    await db("talent_photos").where({ id: p.id }).del();
    await T.refreshCompleteness(p.talent_id);
    const t = await db("talent").where({ id: p.talent_id }).first();
    await audit.log(req, "talent.photo_removed", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t) });
    res.status(204).end();
  }));

  // ------------------------------------------------ featured videos (FR-008)
  childRoutes(r, {
    base: "videos",
    table: "featured_videos",
    files: true,
    spec: { position: ["int", null, true], title: ["str", 150, true], platform: ["choice", "video_platform"], url: ["url"], description: ["str"], thumbnail_url: ["url"] },
    payload: T.videoPayload,
    auditName: "video",
    labelOf: (v) => v.title,
    async beforeSave(data, prev, t, req) {
      const file = (req.files || []).find((f) => f.fieldname === "file");
      if (file) data.file = saveUpload(file, `talent/${t.cast_id}/videos`);
      const position = "position" in data ? data.position : prev?.position;
      const url = "url" in data ? data.url : prev?.url || "";
      if (!url && !data.file && !prev?.file) throw new ValidationError({ url: "Add a video link or upload a file." });
      if (![1, 2, 3].includes(position)) throw new ValidationError({ position: "Featured videos use positions 1, 2 and 3." });
      const clash = db("featured_videos").where({ talent_id: t.id, position });
      if (prev) clash.whereNot({ id: prev.id });
      if (await clash.first()) throw new ValidationError({ position: `Slot ${position} is already used. Reorder or replace it.` });
      if (url && !data.platform) data.platform = T.detectPlatform(url);
      if (data.file) data.platform = "upload";
      if (url && !data.thumbnail_url && "url" in data) data.thumbnail_url = T.videoThumbnail(url);
      if (!prev) {
        data.description = data.description || "";
        data.platform = data.platform || "youtube";
      }
    },
    onDelete: (v) => T.deleteMedia(v.file),
  });

  // ------------------------------------------------ portfolio links
  childRoutes(r, {
    base: "portfolio-links",
    table: "portfolio_links",
    spec: { title: ["str", 150, true], url: ["url", null, true], kind: ["str", 30] },
    payload: T.linkPayload,
    auditName: "link",
    labelOf: (l) => l.title,
  });

  // ------------------------------------------------ guardians
  childRoutes(r, {
    base: "guardians",
    table: "guardians",
    spec: {
      name: ["str", 150, true], relationship: ["str", 40, true], phone: ["str", 32, true], alt_phone: ["str", 32], email: ["email"],
      address: ["str"], id_verified: ["bool"], is_primary: ["bool"], notes: ["str"],
    },
    payload: T.guardianPayload,
    auditName: "guardian",
    labelOf: (g) => g.name,
    beforeSave(data, prev) {
      if (!prev) {
        data.address = data.address || "";
        data.notes = data.notes || "";
        if (!("is_primary" in data)) data.is_primary = true;
      }
    },
  });

  // ------------------------------------------------ consents (FR-020)
  childRoutes(r, {
    base: "consents",
    table: "consents",
    files: true,
    spec: {
      consent_type: ["choice", "consent_type", true], status: ["choice", "consent_status"], obtained_on: ["date"], method: ["choice", "consent_method"],
      scope: ["str"], given_by: ["str", 150], expires_on: ["date"], withdrawn_on: ["date"], notes: ["str"],
    },
    payload: T.consentPayload,
    auditName: "consent",
    async beforeSave(data, prev, t, req) {
      const status = data.status || prev?.status || "pending";
      if (!data.status && !prev) data.status = "pending";
      const obtained = "obtained_on" in data ? data.obtained_on : prev?.obtained_on;
      const method = "method" in data ? data.method : prev?.method;
      if (status === "granted" && !obtained) throw new ValidationError({ obtained_on: "Record the date the consent was obtained." });
      if (status === "granted" && !method) throw new ValidationError({ method: "Record how the consent was obtained." });
      const file = (req.files || []).find((f) => f.fieldname === "evidence");
      if (file) data.evidence = saveUpload(file, `talent/${t.cast_id}/consent`);
      if (!prev) {
        data.scope = data.scope || "";
        data.notes = data.notes || "";
      }
    },
    async afterSave(row, prev, req) {
      await T.onConsentChanged(row, prev ? prev.status : null, req.user);
      if (prev && prev.status !== row.status) {
        const t = await db("talent").where({ id: row.talent_id }).first();
        await audit.log(req, "talent.consent_status_changed", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t), changes: { [row.consent_type]: [prev.status, row.status] } });
      }
    },
    onDelete() {
      throw new Conflict("Consent records can't be deleted. Mark them withdrawn or expired instead, so the history is kept.", "consent_immutable");
    },
  });

  // ------------------------------------------------ contact notes (FR-017)
  const NOTE_SPEC = {
    kind: ["choice", "note_kind"], result: ["choice", "note_result"], content: ["str", null, true], interaction_at: ["datetime"],
    project: ["fk"], follow_up_on: ["date"], follow_up_done: ["bool"],
  };
  const noteData = (data) => {
    if ("project" in data) {
      data.project_id = data.project;
      delete data.project;
    }
    return data;
  };
  r.get("/notes", wrap(async (req, res) => {
    const p = req.query;
    const q = db("contact_notes");
    if (p.talent) q.where({ talent_id: Number(p.talent) });
    if (p.project) q.where({ project_id: Number(p.project) });
    if (p.kind) q.whereIn("kind", String(p.kind).split(","));
    if (p.follow_up === "due") q.where("follow_up_on", "<=", require("../db").localDate()).where({ follow_up_done: false }).orderBy("follow_up_on");
    else q.orderBy("interaction_at", "desc").orderBy("id", "desc");
    res.json(await F.paginate(q, p, notePayload));
  }));
  r.get("/notes/:id", wrap(async (req, res) => {
    const n = await db("contact_notes").where({ id: req.params.id }).first();
    if (!n) throw notFound();
    res.json((await notePayload([n]))[0]);
  }));
  r.post("/notes", wrap(async (req, res) => {
    const t = await requireTalent(req.body.talent);
    const data = noteData(clean(NOTE_SPEC, req.body, false));
    const now = nowDb();
    const id = await insertId("contact_notes", {
      kind: "note", result: "", follow_up_done: false, ...data, interaction_at: data.interaction_at || now, talent_id: t.id, staff_id: req.user.id,
      created_at: now, updated_at: now, created_by: req.user.id, updated_by: req.user.id,
    });
    const n = await db("contact_notes").where({ id }).first();
    await audit.log(req, "talent.note_added", {
      entityType: "talent", entityId: t.id, label: audit.talentLabel(t),
      message: label("note_kind", n.kind) + (n.result ? ` · ${label("note_result", n.result)}` : ""),
    });
    res.status(201).json((await notePayload([n]))[0]);
  }));
  const noteUpdate = wrap(async (req, res) => {
    const n = await db("contact_notes").where({ id: req.params.id }).first();
    if (!n) throw notFound();
    const data = noteData(clean(NOTE_SPEC, req.body, true));
    if (data.interaction_at === null) delete data.interaction_at;
    await db("contact_notes").where({ id: n.id }).update({ ...data, updated_at: nowDb(), updated_by: req.user.id });
    const t = await db("talent").where({ id: n.talent_id }).first();
    await audit.log(req, "talent.note_updated", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t) });
    res.json((await notePayload([await db("contact_notes").where({ id: n.id }).first()]))[0]);
  });
  r.patch("/notes/:id", noteUpdate);
  r.put("/notes/:id", noteUpdate);
  r.delete("/notes/:id", wrap(async (req, res) => {
    const n = await db("contact_notes").where({ id: req.params.id }).first();
    if (!n) throw notFound();
    const t = await db("talent").where({ id: n.talent_id }).first();
    await audit.log(req, "talent.note_deleted", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t), message: (n.content || "").slice(0, 200) });
    await db("contact_notes").where({ id: n.id }).del();
    res.status(204).end();
  }));

  // ------------------------------------------------ retention reviews
  r.get("/retention-reviews", wrap(async (req, res) => {
    const q = db("retention_reviews").orderBy(["status", "due_on"]);
    if (req.query.status) q.where({ status: req.query.status });
    res.json(await F.paginate(q, req.query, retentionPayload));
  }));
  const reviewUpdate = wrap(async (req, res) => {
    const rv = await db("retention_reviews").where({ id: req.params.id }).first();
    if (!rv) throw notFound();
    const data = clean({ status: ["choice", "retention_status"], due_on: ["date"], resolution_notes: ["str"] }, req.body, true);
    if (data.due_on === null) delete data.due_on;
    const upd = { ...data, updated_at: nowDb(), updated_by: req.user.id };
    const status = data.status || rv.status;
    if (status !== "open" && !rv.resolved_at) Object.assign(upd, { resolved_at: nowDb(), resolved_by: req.user.id });
    await db("retention_reviews").where({ id: rv.id }).update(upd);
    const after = await db("retention_reviews").where({ id: rv.id }).first();
    const t = await db("talent").where({ id: rv.talent_id }).first();
    await audit.log(req, "talent.retention_review", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t), changes: { status: after.status }, message: after.resolution_notes || "" });
    res.json((await retentionPayload([after]))[0]);
  });
  r.patch("/retention-reviews/:id", reviewUpdate);
  r.put("/retention-reviews/:id", reviewUpdate);
};

module.exports.notePayload = notePayload;
module.exports.retentionPayload = retentionPayload;
module.exports.clean = clean;
