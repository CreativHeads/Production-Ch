// FR-018 import wizard and private, expiring exports.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const config = require("../config");
const { db, nowDb, iso, bool, json, toJson, insertId, pad } = require("../db");
const audit = require("../audit");
const { getSettings } = require("../settings");
const { has } = require("../choices");
const { wrap, ValidationError, Conflict, HttpError, notFound, forbidden } = require("../errors");
const D = require("../services/dataio");
const F = require("../services/filters");
const { canBackup } = require("./core");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: Math.max(config.MAX_UPLOAD_MB, 200) * 1024 * 1024 } });

function batchPayload(b, rows = null) {
  const out = {
    id: b.id, original_name: b.original_name, status: b.status, headers: json(b.headers, []), mapping: json(b.mapping, {}), total_rows: b.total_rows,
    summary: json(b.summary, {}), created_at: iso(b.created_at), completed_at: iso(b.completed_at), has_photos_zip: !!b.photos_zip, error: b.error || "",
    fields: Object.entries(D.IMPORT_FIELDS).map(([key, [label]]) => ({ key, label })),
  };
  if (rows) {
    out.rows = rows.map((r) => ({
      id: r.id, row_number: r.row_number, data: json(r.data, {}), raw: json(r.raw, {}), errors: json(r.errors, []), warnings: json(r.warnings, []),
      duplicates: json(r.duplicates, []), action: r.action, duplicate_acknowledged: bool(r.duplicate_acknowledged), result: r.result || "",
      result_message: r.result_message || "", talent: r.talent_id,
    }));
  }
  return out;
}

async function batchRows(b, filter) {
  const rows = await db("import_rows").where({ batch_id: b.id }).orderBy("row_number").limit(5000);
  const pick = rows.filter((r) => {
    if (filter === "errors") return json(r.errors, []).length > 0;
    if (filter === "duplicates") return json(r.duplicates, []).length > 0;
    if (filter === "staging") return r.action === "staging";
    return true;
  });
  return pick.slice(0, 1000);
}

function saveImportFile(file) {
  const d = new Date();
  const rel = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${crypto.randomBytes(6).toString("hex")}-${path.basename(file.originalname).replace(/[^\w.-]+/g, "_")}`;
  const full = D.importPath(rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, file.buffer);
  return rel;
}

function exportPayload(j, creators) {
  const expired = bool(j.purged) || nowDb() >= j.expires_at;
  return {
    id: j.id, format: j.format, filename: j.filename, row_count: j.row_count, created_at: iso(j.created_at), expires_at: iso(j.expires_at),
    is_expired: expired, download_count: j.download_count, params: json(j.params, {}), created_by: creators.get(j.created_by) || null,
    download_url: expired ? null : `/api/exports/${j.id}/download/`,
  };
}
async function creatorNames(jobs) {
  const ids = jobs.map((j) => j.created_by).filter(Boolean);
  return new Map((ids.length ? await db("users").whereIn("id", ids) : []).map((u) => [u.id, u.username]));
}

const truthy = (v) => v === true || v === "true" || v === "1" || v === 1;

module.exports = function (r) {
  r.get("/imports", wrap(async (req, res) => {
    res.json((await db("import_batches").orderBy("created_at", "desc").limit(50)).map((b) => batchPayload(b)));
  }));

  // A blank CSV with recommended headers.
  r.get("/imports/template", (req, res) => {
    const headers = Object.values(D.IMPORT_FIELDS).map(([l]) => l);
    const sample = ["Anjali Menon", "", "+91 98470 12345", "", "", "", "@anjali.menon", "Kochi", "Ernakulam", "Kerala", "Female",
      "14/02/1996", "", "24", "30", "", "162", "Actor, Model", "Corporate Look", "Classical dance", "Malayalam, English, Tamil",
      "Experienced", "15000", "Per day", "State", "", "", "", "anjali.jpg", "https://youtu.be/xxxx", "", ""];
    const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="talent-import-template.csv"');
    res.send("﻿" + headers.map(q).join(",") + "\r\n" + sample.map(q).join(",") + "\r\n");
  });

  r.post("/imports", upload.fields([{ name: "file", maxCount: 1 }, { name: "photos_zip", maxCount: 1 }]), wrap(async (req, res) => {
    const f = req.files && req.files.file && req.files.file[0];
    if (!f) throw new ValidationError({ file: "Choose a CSV or XLSX file." });
    let table;
    try {
      table = await D.readTable(f.buffer, f.originalname);
    } catch (e) {
      if (e instanceof D.ImportFileError) throw new ValidationError({ file: e.message });
      throw e;
    }
    const z = req.files.photos_zip && req.files.photos_zip[0];
    if (z && !z.originalname.toLowerCase().endsWith(".zip")) throw new ValidationError({ photos_zip: "Photos must be uploaded as a .zip file." });
    const id = await insertId("import_batches", {
      created_at: nowDb(), created_by: req.user.id, original_name: f.originalname.slice(0, 255), file: saveImportFile(f), photos_zip: z ? saveImportFile(z) : "",
      headers: toJson(table.headers), mapping: toJson(D.autoMapping(table.headers)), status: "uploaded", total_rows: table.data.length, summary: "{}", error: "",
    });
    for (let i = 0; i < table.data.length; i += 200) {
      await db("import_rows").insert(table.data.slice(i, i + 200).map((row, j) => ({
        batch_id: id, row_number: i + j + 2, raw: toJson(row), data: "{}", errors: "[]", warnings: "[]", duplicates: "[]", action: "create",
        duplicate_acknowledged: false, result: "", result_message: "",
      })));
    }
    const b = await db("import_batches").where({ id }).first();
    await audit.log(req, "import.uploaded", { entityType: "import", entityId: id, label: b.original_name, changes: { rows: table.data.length } });
    res.status(201).json(batchPayload(b));
  }));

  const getBatch = async (id) => {
    const b = await db("import_batches").where({ id: Number(id) || 0 }).first();
    if (!b) throw notFound();
    return b;
  };

  r.get("/imports/:id", wrap(async (req, res) => {
    const b = await getBatch(req.params.id);
    res.json(batchPayload(b, await batchRows(b, req.query.rows)));
  }));

  r.delete("/imports/:id", wrap(async (req, res) => {
    const b = await getBatch(req.params.id);
    if (["importing", "completed"].includes(b.status)) throw new Conflict("This import has already run and can't be cancelled.");
    await db("import_batches").where({ id: b.id }).update({ status: "cancelled" });
    for (const f of [b.file, b.photos_zip]) if (f) fs.rmSync(D.importPath(f), { force: true });
    res.status(204).end();
  }));

  // Apply the field mapping and produce the validation + duplicate preview.
  r.post("/imports/:id/validate", wrap(async (req, res) => {
    const b = await getBatch(req.params.id);
    if (!["uploaded", "mapped"].includes(b.status)) throw new Conflict("This import can no longer be changed.");
    const headers = json(b.headers, []);
    const raw = req.body.mapping || json(b.mapping, {});
    const mapping = Object.fromEntries(Object.entries(raw).filter(([h, k]) => headers.includes(h) && D.IMPORT_FIELDS[k]));
    const used = Object.values(mapping);
    const dupes = [...new Set(used.filter((k, i) => used.indexOf(k) !== i))];
    if (dupes.length) throw new ValidationError({ mapping: `Each field can only be mapped once: ${dupes.sort().join(", ")}` });
    const missing = ["full_name", "phone", "city", "categories"].filter((k) => !used.includes(k));
    if (missing.length) throw new ValidationError({ mapping: `Map these required fields: ${missing.map((k) => D.IMPORT_FIELDS[k][0]).join(", ")}` });
    await D.validateBatch(b, mapping);
    const after = await getBatch(b.id);
    res.json(batchPayload(after, await batchRows(after)));
  }));

  // Per-row decision: action and explicit duplicate acknowledgement.
  r.patch("/imports/:id/rows/:rowId", wrap(async (req, res) => {
    const row = await db("import_rows").where({ id: Number(req.params.rowId) || 0, batch_id: Number(req.params.id) || 0 }).first();
    if (!row) throw notFound();
    const b = await getBatch(row.batch_id);
    if (b.status !== "mapped") throw new Conflict("Validate the import before changing rows.");
    const upd = {};
    const action = req.body.action;
    if (action) {
      if (!has("import_action", action)) throw new ValidationError({ action: "Unknown action." });
      if (action !== "skip" && json(row.errors, []).length) throw new ValidationError({ action: "Fix the errors in the source file first; this row can only be skipped." });
      if (action === "create" && !("photo_filename" in json(row.data, {}))) throw new ValidationError({ action: "This row has no photo, so it can only go to import staging." });
      upd.action = action;
    }
    if ("duplicate_acknowledged" in req.body) upd.duplicate_acknowledged = !!req.body.duplicate_acknowledged;
    if (Object.keys(upd).length) await db("import_rows").where({ id: row.id }).update(upd);
    const after = await db("import_rows").where({ id: row.id }).first();
    res.json({ id: after.id, action: after.action, duplicate_acknowledged: bool(after.duplicate_acknowledged) });
  }));

  r.post("/imports/:id/confirm", wrap(async (req, res) => {
    const b = await getBatch(req.params.id);
    if (b.status !== "mapped") throw new Conflict("Validate the import before confirming it.");
    const summary = await D.runImport(b, req.user, req);
    const after = await getBatch(b.id);
    res.json({ ...batchPayload(after, await batchRows(after)), summary });
  }));

  // ------------------------------------------------ exports
  r.get("/exports", wrap(async (req, res) => {
    const q = db("export_jobs").orderBy("created_at", "desc").limit(50);
    if (!canBackup(req.user)) q.whereNot({ format: "backup" });
    const jobs = await q;
    const names = await creatorNames(jobs);
    res.json(jobs.map((j) => exportPayload(j, names)));
  }));

  r.post("/exports", wrap(async (req, res) => {
    const b = req.body;
    const fmt = b.format || "xlsx";
    if (!has("export_format", fmt)) throw new ValidationError({ format: "Choose CSV, XLSX or full backup." });
    const hours = (await getSettings()).export_expiry_hours;
    const expires = new Date(Date.now() + hours * 3600e3).toISOString().replace("T", " ").replace("Z", "");
    if (fmt === "backup") {
      if (!canBackup(req.user)) throw forbidden("Full backups are restricted to backup operators.");
      const includeMedia = b.include_media === undefined ? true : !!b.include_media;
      const id = await insertId("export_jobs", {
        created_at: nowDb(), created_by: req.user.id, format: "backup", params: toJson({ include_media: includeMedia }), include_internal: true, expires_at: expires,
        file: "", filename: "", row_count: 0, download_count: 0, purged: false,
      });
      await D.buildBackup({ id }, includeMedia);
      const job = await db("export_jobs").where({ id }).first();
      await audit.log(req, "export.backup_created", { entityType: "export", entityId: id, label: job.filename, changes: { rows: job.row_count } });
      return res.status(201).json(exportPayload(job, await creatorNames([job])));
    }
    const audience = b.audience || "internal";
    const include = new Set(
      audience === "internal"
        ? ["contact", "fees", "internal"].filter((g) => (b[`include_${g}`] === undefined ? g !== "internal" : truthy(b[`include_${g}`])))
        : ["contact", "fees"].filter((g) => truthy(b[`include_${g}`])), // client-facing: never internal notes
    );
    const filters = b.filters || {};
    const ids = (b.ids || []).map(Number).filter(Number.isInteger);
    let q;
    if (ids.length) q = db("talent").whereNull("deleted_at").whereIn("id", ids).orderBy("full_name");
    else q = F.applySort(F.filterTalent(filters, req.user, await getSettings()), filters.sort || "name");
    if (audience === "client") q.where("talent.consent_hold", false);
    const talents = await q;
    const id = await insertId("export_jobs", {
      created_at: nowDb(), created_by: req.user.id, format: fmt, params: toJson({ filters, ids, audience, include: [...include].sort() }),
      include_internal: include.has("internal"), expires_at: expires, file: "", filename: "", row_count: 0, download_count: 0, purged: false,
    });
    await D.buildExport({ id, format: fmt }, talents, include);
    const job = await db("export_jobs").where({ id }).first();
    await audit.log(req, "export.created", { entityType: "export", entityId: id, label: job.filename, changes: { rows: job.row_count, audience, include: [...include].sort() } });
    res.status(201).json(exportPayload(job, await creatorNames([job])));
  }));

  r.get("/exports/:id/download", wrap(async (req, res) => {
    const job = await db("export_jobs").where({ id: Number(req.params.id) || 0 }).first();
    if (!job) throw notFound();
    if (job.format === "backup" && !canBackup(req.user)) throw forbidden("Full backups are restricted to backup operators.");
    const full = job.file ? path.join(config.EXPORT_ROOT, job.file) : null;
    if (bool(job.purged) || nowDb() >= job.expires_at || !full || !fs.existsSync(full)) {
      throw new HttpError(410, "This export link has expired. Create a new export.", "expired");
    }
    await db("export_jobs").where({ id: job.id }).update({ download_count: job.download_count + 1, last_downloaded_at: nowDb() });
    await audit.log(req, "export.downloaded", { entityType: "export", entityId: job.id, label: job.filename });
    res.setHeader("Cache-Control", "no-store");
    res.download(full, job.filename);
  }));
};
