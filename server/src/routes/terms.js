// FR-009 taxonomy: categories, tags, skills and languages share one table.
// Relationships point at the term id, so renames show everywhere.
const { db, nowDb, bool, slugify } = require("../db");
const audit = require("../audit");
const { has } = require("../choices");
const { wrap, ValidationError, notFound } = require("../errors");

const TALENT_LINK = { category: "talent_categories", tag: "talent_tags", skill: "talent_skills" };
const ROLE_LINK = { category: "role_categories", tag: "role_tags", skill: "role_skills", language: "role_languages" };

async function termPayload(t, usage) {
  const merged = t.merged_into_id ? await db("terms").where({ id: t.merged_into_id }).first() : null;
  const out = {
    id: t.id, kind: t.kind, name: t.name, slug: t.slug, description: t.description || "", color: t.color || "", sort_order: t.sort_order,
    is_archived: bool(t.is_archived), merged_into: t.merged_into_id || null, merged_into_name: merged ? merged.name : null, system_key: t.system_key || "",
  };
  if (usage !== undefined) out.usage = usage;
  return out;
}

async function validateName(kind, name, excludeId) {
  if (!name) throw new ValidationError({ name: "This field may not be blank." });
  if (name.length > 80) throw new ValidationError({ name: "Ensure this field has no more than 80 characters." });
  const q = db("terms").where({ kind, slug: slugify(name).slice(0, 90) || "term" });
  if (excludeId) q.whereNot({ id: excludeId });
  if (await q.first()) throw new ValidationError({ name: `A ${kind} named “${name}” already exists. Use merge instead.` });
}

module.exports = function (r) {
  r.get("/terms", wrap(async (req, res) => {
    const p = req.query;
    const q = db("terms").orderBy(["kind", "sort_order", "name"]);
    if (p.kind) q.where({ kind: p.kind });
    if (p.archived !== "include") q.where({ is_archived: false });
    const rows = await q;
    let usage = null;
    if (p.usage === "1") {
      usage = new Map();
      const bump = (rowsIn, col) => rowsIn.forEach((x) => usage.set(x[col], (usage.get(x[col]) || 0) + Number(x.n)));
      for (const table of Object.values(TALENT_LINK)) bump(await db(table).groupBy("term_id").select("term_id").count({ n: "*" }), "term_id");
      bump(await db("talent_languages").groupBy("language_id").select("language_id").count({ n: "*" }), "language_id");
    }
    const names = new Map(rows.map((t) => [t.id, t.name]));
    res.json(rows.map((t) => ({
      id: t.id, kind: t.kind, name: t.name, slug: t.slug, description: t.description || "", color: t.color || "", sort_order: t.sort_order,
      is_archived: bool(t.is_archived), merged_into: t.merged_into_id || null, merged_into_name: t.merged_into_id ? names.get(t.merged_into_id) || null : null,
      system_key: t.system_key || "", ...(usage ? { usage: usage.get(t.id) || 0 } : {}),
    })));
  }));

  r.get("/terms/:id", wrap(async (req, res) => {
    const t = await db("terms").where({ id: req.params.id }).first();
    if (!t) throw notFound();
    res.json(await termPayload(t));
  }));

  r.post("/terms", wrap(async (req, res) => {
    const b = req.body;
    const kind = b.kind;
    if (!has("term_kind", kind)) throw new ValidationError({ kind: `"${kind || ""}" is not a valid choice.` });
    const name = String(b.name || "").trim();
    await validateName(kind, name);
    const now = nowDb();
    const [id] = await db("terms").insert({
      kind, name, slug: slugify(name).slice(0, 90) || "term", description: String(b.description || ""), color: String(b.color || ""),
      sort_order: Number(b.sort_order) || 0, is_archived: bool(b.is_archived), system_key: "",
      created_at: now, updated_at: now, created_by: req.user.id, updated_by: req.user.id,
    });
    const t = await db("terms").where({ id: Number(id) }).first();
    await audit.log(req, `${t.kind}.created`, { entityType: "term", entityId: t.id, label: t.name });
    res.status(201).json(await termPayload(t));
  }));

  const update = wrap(async (req, res) => {
    const t = await db("terms").where({ id: req.params.id }).first();
    if (!t) throw notFound();
    const b = req.body;
    const upd = {};
    if ("name" in b) {
      const name = String(b.name || "").trim();
      await validateName(t.kind, name, t.id);
      upd.name = name;
      upd.slug = slugify(name).slice(0, 90) || "term";
    }
    for (const f of ["description", "color"]) if (f in b) upd[f] = String(b[f] || "");
    if ("sort_order" in b) upd.sort_order = Number(b.sort_order) || 0;
    if ("is_archived" in b) upd.is_archived = bool(b.is_archived);
    upd.updated_at = nowDb();
    upd.updated_by = req.user.id;
    await db("terms").where({ id: t.id }).update(upd);
    const after = await db("terms").where({ id: t.id }).first();
    const changes = audit.diff({ name: t.name, is_archived: bool(t.is_archived) }, { name: after.name, is_archived: bool(after.is_archived) });
    if (Object.keys(changes).length) await audit.log(req, `${t.kind}.updated`, { entityType: "term", entityId: t.id, label: after.name, changes });
    res.json(await termPayload(after));
  });
  r.patch("/terms/:id", update);
  r.put("/terms/:id", update);

  r.delete("/terms/:id", wrap(async (req, res) => {
    const t = await db("terms").where({ id: req.params.id }).first();
    if (!t) throw notFound();
    await db("terms").where({ id: t.id }).update({ is_archived: true, updated_at: nowDb() });
    await audit.log(req, `${t.kind}.archived`, { entityType: "term", entityId: t.id, label: t.name });
    res.status(204).end();
  }));

  // Move every relationship from this term into `into`, then archive it.
  r.post("/terms/:id/merge", wrap(async (req, res) => {
    const source = await db("terms").where({ id: req.params.id }).first();
    if (!source) throw notFound();
    const target = await db("terms").where({ id: Number(req.body.into) || 0, kind: source.kind }).first();
    if (!target) throw notFound();
    if (target.id === source.id) throw new ValidationError({ into: "Choose a different term to merge into." });
    let moved = 0;
    await db.transaction(async (trx) => {
      const moveLinks = async (table, owner, col = "term_id") => {
        const rows = await trx(table).where({ [col]: source.id });
        for (const row of rows) {
          const exists = await trx(table).where({ [owner]: row[owner], [col]: target.id }).first();
          if (exists) await trx(table).where({ [owner]: row[owner], [col]: source.id }).del();
          else await trx(table).where({ [owner]: row[owner], [col]: source.id }).update({ [col]: target.id });
        }
        return rows.length;
      };
      if (TALENT_LINK[source.kind]) moved = await moveLinks(TALENT_LINK[source.kind], "talent_id");
      else moved = await moveLinks("talent_languages", "talent_id", "language_id");
      await moveLinks(ROLE_LINK[source.kind], "role_id");
      await trx("terms").where({ id: source.id }).update({ merged_into_id: target.id, is_archived: true, updated_at: nowDb() });
    });
    await audit.log(req, `${source.kind}.merged`, { entityType: "term", entityId: source.id, label: source.name, changes: { into: target.name, moved } });
    res.json({ moved, into: await termPayload(target) });
  }));
};
