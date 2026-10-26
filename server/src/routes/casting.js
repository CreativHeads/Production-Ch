// FR-012 – FR-016: projects, roles, shortlists, availability and bookings.
const { db, nowDb, iso, bool, money, json, toDb, parseDate, dayStartDb, addDays, insertId, sequenceNext, pad } = require("../db");
const audit = require("../audit");
const { has, label, OPEN_PROJECT_STATUSES } = require("../choices");
const { wrap, ValidationError, Conflict, notFound } = require("../errors");
const F = require("../services/filters");
const S = require("../services/casting");
const T = require("../services/talent");
const { clean } = require("./talentChildren");

const PROJECT_AUDIT = ["title", "client_name", "code", "status", "shoot_start", "shoot_end", "budget", "location"];
const ROLE_LINKS = { languages: ["role_languages", "language"], categories: ["role_categories", "category"], tags: ["role_tags", "tag"], skills: ["role_skills", "skill"] };

function moneyField(body, key, errors, out) {
  if (!(key in body)) return;
  const v = body[key];
  if (v === null || v === "" || v === undefined) out[key] = null;
  else if (!Number.isFinite(Number(v))) errors[key] = ["A valid number is required."];
  else out[key] = Number(v);
}

// ---------------------------------------------------------------- projects
async function projectPayloads(rows) {
  if (!rows.length) return [];
  const stats = await db("roles").whereIn("project_id", rows.map((p) => p.id)).groupBy("project_id")
    .select("project_id").count({ n: "*" }).sum({ positions: "positions_needed" });
  const byId = new Map(stats.map((s) => [s.project_id, s]));
  return rows.map((p) => ({
    id: p.id, title: p.title, client_name: p.client_name || "", code: p.code, description: p.description || "", production_type: p.production_type,
    production_type_label: label("production_type", p.production_type), shoot_start: p.shoot_start || null, shoot_end: p.shoot_end || null,
    location: p.location || "", budget: money(p.budget), currency: p.currency, status: p.status, status_label: label("project_status", p.status),
    notes: p.notes || "", role_count: Number(byId.get(p.id)?.n || 0), positions_needed: byId.get(p.id) ? Number(byId.get(p.id).positions) : null,
    selected_count: null, booking_count: null, created_at: iso(p.created_at), updated_at: iso(p.updated_at),
  }));
}

async function validateProject(body, inst) {
  const data = clean({
    title: ["str", 200, true], client_name: ["str", 200], description: ["str"], production_type: ["choice", "production_type"],
    shoot_start: ["date"], shoot_end: ["date"], location: ["str", 200], currency: ["str", 3], status: ["choice", "project_status"], notes: ["str"],
  }, body, !!inst);
  const errors = {};
  moneyField(body, "budget", errors, data);
  if ("code" in body) {
    const code = String(body.code || "").trim().toUpperCase();
    if (code.length > 30) errors.code = ["Ensure this field has no more than 30 characters."];
    else if (code) {
      const q = db("projects").where({ code });
      if (inst) q.whereNot({ id: inst.id });
      if (await q.first()) errors.code = ["Another project already uses this code."];
    }
    data.code = code;
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const s = "shoot_start" in data ? data.shoot_start : inst?.shoot_start;
  const e = "shoot_end" in data ? data.shoot_end : inst?.shoot_end;
  if (s && e && e < s) throw new ValidationError({ shoot_end: "The shoot end date must be on or after the start date." });
  return data;
}

async function getProject(id) {
  const p = await db("projects").where({ id: Number(id) || 0 }).whereNull("deleted_at").first();
  if (!p) throw notFound();
  return p;
}

// ---------------------------------------------------------------- roles
async function rolePayloads(roles, { counts = false } = {}) {
  if (!roles.length) return [];
  const ids = roles.map((r) => r.id);
  const links = {};
  const termIds = [];
  for (const [key, [table]] of Object.entries(ROLE_LINKS)) {
    links[key] = await db(table).whereIn("role_id", ids);
    termIds.push(...links[key].map((l) => l.term_id));
  }
  const terms = new Map((termIds.length ? await db("terms").whereIn("id", [...new Set(termIds)]) : []).map((t) => [t.id, t]));
  const projects = new Map((await db("projects").whereIn("id", roles.map((r) => r.project_id))).map((p) => [p.id, p.title]));
  let stats = new Map();
  if (counts) {
    const rows = await db("shortlist_entries").whereIn("role_id", ids).where({ is_removed: false }).groupBy("role_id")
      .select("role_id").count({ n: "*" }).sum({ sel: db.raw("CASE WHEN status = 'selected' THEN 1 ELSE 0 END") });
    stats = new Map(rows.map((x) => [x.role_id, x]));
  }
  return roles.map((r) => {
    const pick = (key) => links[key].filter((l) => l.role_id === r.id).map((l) => terms.get(l.term_id)).filter(Boolean);
    return {
      id: r.id, project: r.project_id, project_title: projects.get(r.project_id), name: r.name, description: r.description || "",
      positions_needed: r.positions_needed, gender_preference: r.gender_preference, age_min: r.age_min, age_max: r.age_max,
      languages: pick("languages").map((t) => t.id), language_names: pick("languages").map((t) => t.name), accent_requirements: r.accent_requirements || "",
      categories: pick("categories").map((t) => t.id), category_names: pick("categories").map((t) => t.name),
      tags: pick("tags").map((t) => t.id), tag_names: pick("tags").map((t) => t.name),
      skills: pick("skills").map((t) => t.id), skill_names: pick("skills").map((t) => t.name),
      location: r.location || "", travel_requirement: r.travel_requirement || "", travel_notes: r.travel_notes || "", budget: money(r.budget),
      fee_basis: r.fee_basis || "", shoot_start: r.shoot_start || null, shoot_end: r.shoot_end || null, notes: r.notes || "", sort_order: r.sort_order,
      shortlist_count: counts ? Number(stats.get(r.id)?.n || 0) : null, selected_count: counts ? Number(stats.get(r.id)?.sel || 0) : null,
    };
  });
}

async function validateRole(body, inst) {
  const data = clean({
    name: ["str", 150, true], description: ["str"], positions_needed: ["int"], gender_preference: ["choice", "role_gender"], age_min: ["int"], age_max: ["int"],
    accent_requirements: ["str", 200], location: ["str", 150], travel_requirement: ["choice", "travel"], travel_notes: ["str", 255],
    fee_basis: ["choice", "fee_basis"], shoot_start: ["date"], shoot_end: ["date"], notes: ["str"], sort_order: ["int"],
  }, body, !!inst);
  if (data.positions_needed === null) delete data.positions_needed;
  if (data.sort_order === null) delete data.sort_order;
  const errors = {};
  moneyField(body, "budget", errors, data);
  const rel = {};
  for (const [key, [, kind]] of Object.entries(ROLE_LINKS)) {
    if (!(key in body)) continue;
    const ids = (Array.isArray(body[key]) ? body[key] : String(body[key] || "").split(",").filter(Boolean)).map(Number);
    const found = ids.length ? await db("terms").whereIn("id", ids).where({ kind }) : [];
    const missing = ids.filter((x) => !found.some((f) => f.id === x));
    if (missing.length) errors[key] = [`Invalid pk "${missing[0]}" - object does not exist.`];
    rel[key] = [...new Set(ids)];
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const lo = "age_min" in data ? data.age_min : inst?.age_min;
  const hi = "age_max" in data ? data.age_max : inst?.age_max;
  if (lo !== null && hi !== null && lo !== undefined && hi !== undefined && lo > hi) throw new ValidationError({ age_max: "The upper age must be at least the lower age." });
  const s = "shoot_start" in data ? data.shoot_start : inst?.shoot_start;
  const e = "shoot_end" in data ? data.shoot_end : inst?.shoot_end;
  if (s && e && e < s) throw new ValidationError({ shoot_end: "The end date must be on or after the start date." });
  return { data, rel };
}

async function saveRoleLinks(roleId, rel) {
  for (const [key, ids] of Object.entries(rel)) {
    const table = ROLE_LINKS[key][0];
    await db(table).where({ role_id: roleId }).del();
    if (ids.length) await db(table).insert(ids.map((term_id) => ({ role_id: roleId, term_id })));
  }
}

async function getRole(id) {
  const r = await db("roles").where({ id: Number(id) || 0 }).first();
  if (!r) throw notFound();
  return r;
}

// ---------------------------------------------------------------- availability
const availPayload = async (rows) => {
  if (!rows.length) return [];
  const names = new Map((await db("talent").whereIn("id", rows.map((a) => a.talent_id))).map((t) => [t.id, t.full_name]));
  return rows.map((a) => ({
    id: a.id, talent: a.talent_id, talent_name: names.get(a.talent_id), start: iso(a.start), end: iso(a.end), kind: a.kind,
    kind_label: label("availability_type", a.kind), confirmed_at: iso(a.confirmed_at), source: a.source || "", notes: a.notes || "",
    booking: a.booking_id, project: a.project_id, is_booking: a.booking_id !== null && a.booking_id !== undefined, created_at: iso(a.created_at),
  }));
};

// Accept full datetimes or plain dates (start of day / start of next day).
function parseRange(p) {
  const asDt = (v) => {
    if (!v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    return toDb(v);
  };
  let start = asDt(p.start);
  let end = asDt(p.end);
  if (!start && parseDate(p.start)) start = dayStartDb(p.start);
  if (!end && parseDate(p.end)) end = dayStartDb(addDays(p.end, 1));
  return { start, end };
}

const truthy = (v) => v === true || v === "true" || v === "1" || v === 1;
const bookingFlags = (b) => ({ override: truthy(b.override), override_reason: b.override_reason || "", acknowledge_warnings: truthy(b.acknowledge_warnings) });

const BOOKING_SPEC = {
  shoot_start: ["datetime", null, true], shoot_end: ["datetime", null, true], schedule_notes: ["str"], status: ["choice", "booking_status"],
  fee_basis: ["choice", "fee_basis"], currency: ["str", 3], other_charges_notes: ["str", 255], confirmation_source: ["choice", "availability_source"],
  confirmation_notes: ["str"], outcome: ["choice", "booking_outcome"], completed_on: ["date"], deliverable_url: ["url"],
};
const BOOKING_MONEY = ["proposed_fee", "agreed_fee", "travel_charges", "accommodation_charges"];
const BOOKING_AUDIT = ["status", "shoot_start", "shoot_end", "agreed_fee", "proposed_fee", "outcome", "travel_charges", "accommodation_charges"];

module.exports = function (r) {
  // ------------------------------------------------ projects
  r.get("/projects", wrap(async (req, res) => {
    const p = req.query;
    const q = db("projects").whereNull("deleted_at");
    if (p.status === "open") q.whereIn("status", OPEN_PROJECT_STATUSES);
    else if (p.status) q.whereIn("status", String(p.status).split(","));
    else if (p.archived !== "include") q.whereNot("status", "archived");
    const text = String(p.q || "").trim();
    if (text) {
      const like = `%${text}%`;
      q.where((w) => w.where("title", "like", like).orWhere("client_name", "like", like).orWhere("code", "like", like).orWhere("location", "like", like));
    }
    const allowed = new Set(["-created_at", "created_at", "title", "-title", "shoot_start", "-shoot_start", "status"]);
    const sort = allowed.has(p.sort) ? p.sort : "-created_at";
    q.orderBy(sort.replace(/^-/, ""), sort.startsWith("-") ? "desc" : "asc").orderBy("id", "desc");
    res.json(await F.paginate(q, p, projectPayloads));
  }));

  r.get("/projects/trash", wrap(async (req, res) => {
    const rows = await db("projects").whereNotNull("deleted_at").orderBy("deleted_at", "desc").limit(200);
    res.json(rows.map((p) => ({ id: p.id, code: p.code, title: p.title, deleted_at: iso(p.deleted_at) })));
  }));

  r.post("/projects/trash/:pid/restore", wrap(async (req, res) => {
    const p = await db("projects").where({ id: req.params.pid }).whereNotNull("deleted_at").first();
    if (!p) throw notFound();
    await db("projects").where({ id: p.id }).update({ deleted_at: null, deleted_by: null });
    await audit.log(req, "project.restored", { entityType: "project", entityId: p.id, label: audit.projectLabel(p) });
    res.json({ ok: true, id: p.id });
  }));

  r.post("/projects", wrap(async (req, res) => {
    const data = await validateProject(req.body, null);
    if (!data.code) {
      const year = new Date().getFullYear();
      data.code = `CH-PRJ-${year}-${pad(await sequenceNext(`project_${year}`), 4)}`;
    }
    const now = nowDb();
    const id = await insertId("projects", {
      description: "", notes: "", production_type: "ad_film", status: "draft", ...data, created_at: now, updated_at: now, created_by: req.user.id, updated_by: req.user.id,
    });
    const p = await db("projects").where({ id }).first();
    await audit.log(req, "project.created", { entityType: "project", entityId: p.id, label: audit.projectLabel(p) });
    res.status(201).json((await projectPayloads([p]))[0]);
  }));

  r.get("/projects/:id", wrap(async (req, res) => res.json((await projectPayloads([await getProject(req.params.id)]))[0])));

  const projectUpdate = wrap(async (req, res) => {
    const p = await getProject(req.params.id);
    const data = await validateProject(req.body, p);
    if ("code" in data && !data.code) delete data.code;
    await db("projects").where({ id: p.id }).update({ ...data, updated_at: nowDb(), updated_by: req.user.id });
    const after = await db("projects").where({ id: p.id }).first();
    const norm = (x) => ({ ...audit.snapshot(x, PROJECT_AUDIT), budget: money(x.budget) });
    const changes = audit.diff(norm(p), norm(after));
    if (Object.keys(changes).length) await audit.log(req, "project.updated", { entityType: "project", entityId: p.id, label: audit.projectLabel(after), changes });
    res.json((await projectPayloads([after]))[0]);
  });
  r.patch("/projects/:id", projectUpdate);
  r.put("/projects/:id", projectUpdate);

  r.delete("/projects/:id", wrap(async (req, res) => {
    const p = await getProject(req.params.id);
    await db("projects").where({ id: p.id }).update({ deleted_at: nowDb(), deleted_by: req.user.id });
    await audit.log(req, "project.deleted", { entityType: "project", entityId: p.id, label: audit.projectLabel(p) });
    res.status(204).end();
  }));

  // Everything needed for the project page in one call.
  r.get("/projects/:id/board", wrap(async (req, res) => {
    const p = await getProject(req.params.id);
    const roles = await db("roles").where({ project_id: p.id }).orderBy(["sort_order", "id"]);
    const entries = roles.length
      ? await db("shortlist_entries").whereIn("role_id", roles.map((x) => x.id)).orderBy(["role_id", "is_removed", "priority", "id"])
      : [];
    const bookings = await db("bookings").where({ project_id: p.id }).orderBy("shoot_start", "desc");
    res.json({
      project: (await projectPayloads([p]))[0],
      roles: await rolePayloads(roles, { counts: true }),
      shortlist: await S.entryPayloads(entries),
      bookings: await S.bookingPayloads(bookings),
    });
  }));

  r.get("/projects/:id/history", wrap(async (req, res) => {
    const p = await getProject(req.params.id);
    const rows = await db("audit_log").where({ entity_type: "project", entity_id: String(p.id) }).orderBy("created_at", "desc").limit(200);
    res.json(rows.map((e) => ({ id: e.id, at: iso(e.created_at), actor: e.actor_name, action: e.action, changes: json(e.changes, {}), message: e.message || "" })));
  }));

  // ------------------------------------------------ roles (FR-013)
  r.get("/roles", wrap(async (req, res) => {
    const q = db("roles").orderBy(["sort_order", "id"]);
    if (req.query.project) q.where({ project_id: Number(req.query.project) });
    res.json(await rolePayloads(await q));
  }));

  r.post("/roles", wrap(async (req, res) => {
    const project = await db("projects").where({ id: Number(req.body.project) || 0 }).first();
    if (!project) throw new ValidationError({ project: `Invalid pk "${req.body.project ?? ""}" - object does not exist.` });
    const { data, rel } = await validateRole(req.body, null);
    const now = nowDb();
    const id = await insertId("roles", {
      description: "", notes: "", gender_preference: "any", positions_needed: 1, ...data, project_id: project.id,
      created_at: now, updated_at: now, created_by: req.user.id, updated_by: req.user.id,
    });
    await saveRoleLinks(id, rel);
    const role = await db("roles").where({ id }).first();
    await audit.log(req, "project.role_added", { entityType: "project", entityId: project.id, label: audit.projectLabel(project), message: role.name });
    res.status(201).json((await rolePayloads([role]))[0]);
  }));

  r.get("/roles/:id", wrap(async (req, res) => res.json((await rolePayloads([await getRole(req.params.id)]))[0])));

  const roleUpdate = wrap(async (req, res) => {
    const role = await getRole(req.params.id);
    const { data, rel } = await validateRole(req.body, role);
    await db("roles").where({ id: role.id }).update({ ...data, updated_at: nowDb(), updated_by: req.user.id });
    await saveRoleLinks(role.id, rel);
    const after = await db("roles").where({ id: role.id }).first();
    const project = await db("projects").where({ id: role.project_id }).first();
    await audit.log(req, "project.role_updated", { entityType: "project", entityId: project.id, label: audit.projectLabel(project), message: after.name });
    res.json((await rolePayloads([after]))[0]);
  });
  r.patch("/roles/:id", roleUpdate);
  r.put("/roles/:id", roleUpdate);

  r.delete("/roles/:id", wrap(async (req, res) => {
    const role = await getRole(req.params.id);
    if (await db("bookings").where({ role_id: role.id }).first()) {
      throw new Conflict("This role has bookings, so it can't be deleted. Cancel the bookings or keep the role.", "role_has_bookings");
    }
    if (await db("shortlist_entries").where({ role_id: role.id }).first()) {
      throw new Conflict("This role has a shortlist history. Remove it only after clearing candidates, or rename the role instead.", "role_has_shortlist");
    }
    const project = await db("projects").where({ id: role.project_id }).first();
    await audit.log(req, "project.role_removed", { entityType: "project", entityId: project.id, label: audit.projectLabel(project), message: role.name });
    for (const [table] of Object.values(ROLE_LINKS)) await db(table).where({ role_id: role.id }).del();
    await db("roles").where({ id: role.id }).del();
    res.status(204).end();
  }));

  // FR-013: role requirements as pre-filled directory filters.
  r.get("/roles/:id/search-filters", wrap(async (req, res) => {
    const role = await getRole(req.params.id);
    const [rp] = await rolePayloads([role]);
    const f = {};
    if (role.gender_preference && role.gender_preference !== "any") f.gender = role.gender_preference;
    if (role.age_min !== null) f.age_min = role.age_min;
    if (role.age_max !== null) f.age_max = role.age_max;
    for (const [key, list] of [["category", rp.categories], ["tag", rp.tags], ["skill", rp.skills], ["language", rp.languages]]) {
      if (list.length) f[key] = list.join(",");
    }
    if (role.accent_requirements) f.accent = role.accent_requirements;
    if (role.travel_requirement) f.travel_min = role.travel_requirement;
    if (role.shoot_start) f.available_on = role.shoot_start;
    if (role.budget !== null && role.budget !== undefined) f.fee_max = money(role.budget);
    res.json({ filters: f, role: { id: role.id, name: role.name, project: rp.project_title, project_id: role.project_id } });
  }));

  // ------------------------------------------------ shortlist (FR-014): never hard-deleted
  r.get("/shortlist", wrap(async (req, res) => {
    const p = req.query;
    const q = db("shortlist_entries").select("shortlist_entries.*").orderBy(["shortlist_entries.priority", "shortlist_entries.id"]);
    if (p.role) q.where("shortlist_entries.role_id", Number(p.role));
    if (p.project) q.join("roles", "roles.id", "shortlist_entries.role_id").where("roles.project_id", Number(p.project));
    if (p.talent) q.where("shortlist_entries.talent_id", Number(p.talent));
    if (p.include_removed !== "1") q.where("shortlist_entries.is_removed", false);
    res.json(await S.entryPayloads(await q));
  }));

  r.post("/shortlist/add", wrap(async (req, res) => {
    const role = await getRole(req.body.role);
    const project = await db("projects").where({ id: role.project_id }).first();
    const ids = req.body.talent_ids || (req.body.talent ? [req.body.talent] : []);
    const added = [];
    const errors = [];
    for (const tid of ids) {
      const t = await db("talent").where({ id: Number(tid) || 0 }).whereNull("deleted_at").first();
      if (!t) {
        errors.push({ talent: tid, detail: "Talent not found." });
        continue;
      }
      try {
        const { entry, created } = await S.addToShortlist(role, t, req.user, req.body.notes || "");
        added.push({ id: entry.id, talent: t.id, created });
        await audit.log(req, "shortlist.added", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t), message: `${project.title} — ${role.name}` });
        await audit.log(req, "project.shortlist_added", { entityType: "project", entityId: project.id, label: audit.projectLabel(project), message: `${t.full_name} → ${role.name}` });
      } catch (e) {
        if (!(e instanceof Conflict)) throw e;
        errors.push({ talent: tid, name: t.full_name, detail: e.detail });
      }
    }
    res.status(added.length ? 201 : 400).json({ added, errors });
  }));

  r.post("/shortlist/reorder", wrap(async (req, res) => {
    const role = await getRole(req.body.role);
    const order = (req.body.order || []).map(Number);
    const entries = new Map((await db("shortlist_entries").where({ role_id: role.id }).whereIn("id", order)).map((e) => [e.id, e]));
    for (const [i, eid] of order.entries()) {
      const e = entries.get(eid);
      if (e && e.priority !== i + 1) {
        await S.recordEvent(e.id, "priority", req.user, e.priority, i + 1);
        await db("shortlist_entries").where({ id: e.id }).update({ priority: i + 1, updated_at: nowDb() });
      }
    }
    res.json({ ok: true });
  }));

  const getEntry = async (id) => {
    const e = await db("shortlist_entries").where({ id: Number(id) || 0 }).first();
    if (!e) throw notFound();
    return e;
  };

  r.get("/shortlist/:id", wrap(async (req, res) => res.json((await S.entryPayloads([await getEntry(req.params.id)]))[0])));

  const entryUpdate = wrap(async (req, res) => {
    const entry = await getEntry(req.params.id);
    const data = clean({
      priority: ["int"], status: ["choice", "shortlist_status"], notes: ["str"], fee_basis: ["choice", "fee_basis"],
      availability_confirmed: ["bool"], availability_notes: ["str", 255],
    }, req.body, true);
    if (data.priority === null) delete data.priority;
    const errors = {};
    moneyField(req.body, "proposed_fee", errors, data);
    if (Object.keys(errors).length) throw new ValidationError(errors);
    if (data.availability_confirmed && !bool(entry.availability_confirmed)) data.availability_confirmed_at = nowDb();
    if ("availability_confirmed" in data && !data.availability_confirmed) data.availability_confirmed_at = null;
    await db("shortlist_entries").where({ id: entry.id }).update({ ...data, updated_at: nowDb(), updated_by: req.user.id });
    const after = await getEntry(entry.id);
    const note = req.body.event_note || "";
    if (entry.status !== after.status) {
      await S.recordEvent(entry.id, "status", req.user, entry.status, after.status, note);
      const t = await db("talent").where({ id: entry.talent_id }).first();
      const role = await db("roles").where({ id: entry.role_id }).first();
      const project = await db("projects").where({ id: role.project_id }).first();
      await audit.log(req, "shortlist.status", {
        entityType: "talent", entityId: t.id, label: audit.talentLabel(t), changes: { status: [entry.status, after.status] }, message: `${project.title} — ${role.name}`,
      });
    }
    if (money(entry.proposed_fee) !== money(after.proposed_fee)) await S.recordEvent(entry.id, "fee", req.user, money(entry.proposed_fee), money(after.proposed_fee));
    if (bool(entry.availability_confirmed) !== bool(after.availability_confirmed)) {
      await S.recordEvent(entry.id, "availability", req.user, bool(entry.availability_confirmed), bool(after.availability_confirmed), after.availability_notes);
    }
    if ((entry.notes || "") !== (after.notes || "")) await S.recordEvent(entry.id, "note", req.user, "", "", after.notes);
    res.json((await S.entryPayloads([after]))[0]);
  });
  r.patch("/shortlist/:id", entryUpdate);
  r.put("/shortlist/:id", entryUpdate);

  r.post("/shortlist/:id/remove", wrap(async (req, res) => {
    const entry = await getEntry(req.params.id);
    const reason = String(req.body.reason || "").slice(0, 255);
    await db("shortlist_entries").where({ id: entry.id }).update({ is_removed: true, removed_at: nowDb(), removed_reason: reason, updated_by: req.user.id, updated_at: nowDb() });
    await S.recordEvent(entry.id, "removed", req.user, "", "", reason);
    res.json((await S.entryPayloads([await getEntry(entry.id)]))[0]);
  }));

  r.post("/shortlist/:id/restore", wrap(async (req, res) => {
    const entry = await getEntry(req.params.id);
    await db("shortlist_entries").where({ id: entry.id }).update({ is_removed: false, removed_at: null, updated_by: req.user.id, updated_at: nowDb() });
    await S.recordEvent(entry.id, "restored", req.user);
    res.json((await S.entryPayloads([await getEntry(entry.id)]))[0]);
  }));

  r.get("/shortlist/:id/history", wrap(async (req, res) => {
    const entry = await getEntry(req.params.id);
    const events = await db("shortlist_events").where({ entry_id: entry.id }).orderBy("created_at", "desc").orderBy("id", "desc");
    const names = await T.userNames(events.map((e) => e.actor_id));
    res.json(events.map((e) => ({
      id: e.id, action: e.action, from_value: e.from_value || "", to_value: e.to_value || "", note: e.note || "",
      actor_name: names.get(e.actor_id) || "system", created_at: iso(e.created_at),
    })));
  }));

  // ------------------------------------------------ availability (FR-015)
  const AVAIL_SPEC = { start: ["datetime", null, true], end: ["datetime", null, true], kind: ["choice", "availability_type", true], confirmed_at: ["datetime"], source: ["choice", "availability_source"], notes: ["str"], project: ["fk"] };
  const availData = (d) => {
    if ("project" in d) {
      d.project_id = d.project;
      delete d.project;
    }
    return d;
  };
  const checkAvail = (data, inst) => {
    const s = data.start || inst?.start;
    const e = data.end || inst?.end;
    if (s && e && e <= s) throw new ValidationError({ end: "End must be after start." });
    const kind = data.kind || inst?.kind;
    if (kind === "confirmed_booking" && !(inst && inst.booking_id)) {
      throw new ValidationError({ kind: "Confirmed bookings are created from a project role booking, so fee and schedule are recorded." });
    }
  };

  r.get("/availability", wrap(async (req, res) => {
    const q = db("availability").orderBy("start");
    if (req.query.talent) q.where({ talent_id: Number(req.query.talent) });
    const { start, end } = parseRange(req.query);
    if (start) q.where("end", ">", start);
    if (end) q.where("start", "<", end);
    res.json(await availPayload(await q));
  }));

  r.post("/availability", wrap(async (req, res) => {
    const t = await db("talent").where({ id: Number(req.body.talent) || 0 }).whereNull("deleted_at").first();
    if (!t) throw new ValidationError({ talent: `Invalid pk "${req.body.talent ?? ""}" - object does not exist.` });
    const data = availData(clean(AVAIL_SPEC, req.body, false));
    checkAvail(data, null);
    const now = nowDb();
    if (data.source && !data.confirmed_at) data.confirmed_at = now;
    const id = await insertId("availability", { notes: "", source: "", ...data, talent_id: t.id, created_at: now, updated_at: now, created_by: req.user.id, updated_by: req.user.id });
    const a = await db("availability").where({ id }).first();
    const fmt = (v) => new Date(iso(v)).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    await audit.log(req, "talent.availability_added", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t), message: `${label("availability_type", a.kind)} ${fmt(a.start)} – ${fmt(a.end)}` });
    const [payload] = await availPayload([a]);
    const others = await db("availability").where({ talent_id: t.id }).whereNot({ id: a.id }).where("start", "<", a.end).where("end", ">", a.start);
    payload.overlaps = others.map((o) => ({ id: o.id, kind: o.kind, label: label("availability_type", o.kind), start: iso(o.start), end: iso(o.end) }));
    res.status(201).json(payload);
  }));

  const getAvail = async (id) => {
    const a = await db("availability").where({ id: Number(id) || 0 }).first();
    if (!a) throw notFound();
    return a;
  };
  r.get("/availability/:id", wrap(async (req, res) => res.json((await availPayload([await getAvail(req.params.id)]))[0])));
  const availUpdate = wrap(async (req, res) => {
    const a = await getAvail(req.params.id);
    if (a.booking_id) throw new Conflict("This entry mirrors a booking. Change the booking instead.", "booking_managed");
    const data = availData(clean(AVAIL_SPEC, req.body, true));
    checkAvail(data, a);
    await db("availability").where({ id: a.id }).update({ ...data, updated_at: nowDb(), updated_by: req.user.id });
    const t = await db("talent").where({ id: a.talent_id }).first();
    await audit.log(req, "talent.availability_updated", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t) });
    res.json((await availPayload([await getAvail(a.id)]))[0]);
  });
  r.patch("/availability/:id", availUpdate);
  r.put("/availability/:id", availUpdate);
  r.delete("/availability/:id", wrap(async (req, res) => {
    const a = await getAvail(req.params.id);
    if (a.booking_id) throw new Conflict("This entry mirrors a booking. Cancel the booking instead.", "booking_managed");
    const t = await db("talent").where({ id: a.talent_id }).first();
    await audit.log(req, "talent.availability_removed", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t) });
    await db("availability").where({ id: a.id }).del();
    res.status(204).end();
  }));

  // ------------------------------------------------ bookings (FR-015 / FR-016)
  r.get("/bookings", wrap(async (req, res) => {
    const p = req.query;
    const q = db("bookings");
    if (p.project) q.where({ project_id: Number(p.project) });
    if (p.talent) q.where({ talent_id: Number(p.talent) });
    if (p.status) q.whereIn("status", String(p.status).split(","));
    if (p.upcoming === "1") q.where("shoot_end", ">=", nowDb()).whereNot({ status: "cancelled" }).orderBy("shoot_start");
    else q.orderBy("shoot_start", "desc");
    const { start, end } = parseRange(p);
    if (start) q.where("shoot_end", ">", start);
    if (end) q.where("shoot_start", "<", end);
    res.json(await F.paginate(q, p, S.bookingPayloads));
  }));

  r.post("/bookings/check-conflicts", wrap(async (req, res) => {
    const t = await db("talent").where({ id: Number(req.body.talent) || 0 }).whereNull("deleted_at").first();
    if (!t) throw notFound();
    const start = toDb(req.body.shoot_start);
    const end = toDb(req.body.shoot_end);
    if (!start || !end) throw new ValidationError({ shoot_start: "Give a start and end date/time." });
    const { blocking, warnings } = await S.findConflicts(t.id, start, end, req.body.exclude);
    res.json({ conflicts: blocking, warnings, blockers: await T.bookingBlockers(t.id) });
  }));

  r.post("/bookings", wrap(async (req, res) => {
    const b = req.body;
    const role = await db("roles").where({ id: Number(b.role) || 0 }).first();
    const t = await db("talent").where({ id: Number(b.talent) || 0 }).whereNull("deleted_at").first();
    if (!role || !t) throw new ValidationError({ role: "Choose the project role and talent." });
    const data = clean(BOOKING_SPEC, b, false);
    const errors = {};
    for (const k of BOOKING_MONEY) moneyField(b, k, errors, data);
    if (Object.keys(errors).length) throw new ValidationError(errors);
    let entry = b.shortlist_entry ? await db("shortlist_entries").where({ id: Number(b.shortlist_entry) }).first() : null;
    const booking = {
      schedule_notes: "", status: "tentative", currency: "INR", other_charges_notes: "", confirmation_notes: "", outcome: "pending", override_reason: "",
      ...data, project_id: role.project_id, role_id: role.id, talent_id: t.id, shortlist_entry_id: entry ? entry.id : null,
    };
    if (booking.proposed_fee === null || booking.proposed_fee === undefined) {
      entry = entry || (await db("shortlist_entries").where({ role_id: role.id, talent_id: t.id }).first());
      booking.shortlist_entry_id = entry ? entry.id : null;
      booking.proposed_fee = entry && entry.proposed_fee !== null ? entry.proposed_fee : t.expected_fee;
    }
    if (!booking.fee_basis) booking.fee_basis = t.fee_type || role.fee_basis || "";
    const { booking: saved, warnings } = await S.saveBooking(booking, req.user, req, bookingFlags(b));
    const project = await db("projects").where({ id: role.project_id }).first();
    await audit.log(req, "booking.created", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t), message: `${project.title} — ${role.name} (${label("booking_status", saved.status)})` });
    await audit.log(req, "project.booking_created", { entityType: "project", entityId: project.id, label: audit.projectLabel(project), message: `${t.full_name} as ${role.name}` });
    if (saved.shortlist_entry_id && saved.status === "confirmed") {
      const se = await db("shortlist_entries").where({ id: saved.shortlist_entry_id }).first();
      if (se && se.status !== "selected") {
        await db("shortlist_entries").where({ id: se.id }).update({ status: "selected", updated_at: nowDb() });
        await S.recordEvent(se.id, "status", req.user, se.status, "selected", "Booked");
      }
    }
    const [payload] = await S.bookingPayloads([saved]);
    res.status(201).json({ ...payload, warnings });
  }));

  const getBooking = async (id) => {
    const bk = await db("bookings").where({ id: Number(id) || 0 }).first();
    if (!bk) throw notFound();
    return bk;
  };
  r.get("/bookings/:id", wrap(async (req, res) => res.json((await S.bookingPayloads([await getBooking(req.params.id)]))[0])));

  const bookingUpdate = wrap(async (req, res) => {
    const current = await getBooking(req.params.id);
    const b = req.body;
    if ("talent" in b && Number(b.talent) !== current.talent_id) {
      throw new ValidationError({ talent: "A booking's talent can't be changed. Cancel it and create a new booking." });
    }
    const data = clean(BOOKING_SPEC, b, true);
    const errors = {};
    for (const k of BOOKING_MONEY) moneyField(b, k, errors, data);
    if (Object.keys(errors).length) throw new ValidationError(errors);
    if ("role" in b) {
      const role = await db("roles").where({ id: Number(b.role) || 0 }).first();
      if (!role) throw new ValidationError({ role: "Choose the project role and talent." });
      data.role_id = role.id;
    }
    if ("shortlist_entry" in b) data.shortlist_entry_id = b.shortlist_entry ? Number(b.shortlist_entry) : null;
    const norm = (x) => ({ ...audit.snapshot(x, BOOKING_AUDIT), ...Object.fromEntries(BOOKING_MONEY.filter((k) => BOOKING_AUDIT.includes(k)).map((k) => [k, money(x[k])])) });
    const before = norm(current);
    const { created_at, created_by, ...rest } = current;
    const { booking: saved, warnings } = await S.saveBooking({ ...rest, ...data }, req.user, req, bookingFlags(b));
    const changes = audit.diff(before, norm(saved));
    if (Object.keys(changes).length) {
      const t = await db("talent").where({ id: saved.talent_id }).first();
      const project = await db("projects").where({ id: saved.project_id }).first();
      const role = await db("roles").where({ id: saved.role_id }).first();
      await audit.log(req, "booking.updated", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t), changes, message: `${project.title} — ${role.name}` });
    }
    const [payload] = await S.bookingPayloads([saved]);
    res.json({ ...payload, warnings });
  });
  r.patch("/bookings/:id", bookingUpdate);
  r.put("/bookings/:id", bookingUpdate);

  r.delete("/bookings/:id", wrap(async (req, res) => {
    const bk = await getBooking(req.params.id);
    const upd = { status: "cancelled", updated_by: req.user.id, updated_at: nowDb() };
    if (bk.outcome === "pending") upd.outcome = has("booking_outcome", req.body && req.body.outcome) ? req.body.outcome : "cancelled_client";
    const reason = String((req.body && req.body.reason) || "").trim();
    if (reason) upd.confirmation_notes = reason;
    await db("bookings").where({ id: bk.id }).update(upd);
    const saved = await getBooking(bk.id);
    await S.syncAvailability(saved, req.user);
    const t = await db("talent").where({ id: bk.talent_id }).first();
    const project = await db("projects").where({ id: bk.project_id }).first();
    const role = await db("roles").where({ id: bk.role_id }).first();
    await audit.log(req, "booking.cancelled", { entityType: "talent", entityId: t.id, label: audit.talentLabel(t), message: `${project.title} — ${role.name}` });
    res.json((await S.bookingPayloads([saved]))[0]);
  }));
};
