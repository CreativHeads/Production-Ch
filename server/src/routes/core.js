// Settings, audit log, dashboard (FR-002), reminders, choices and backup status.
const fs = require("fs");
const config = require("../config");
const { db, nowDb, iso, json, toJson, localDate, addDays, toDb } = require("../db");
const audit = require("../audit");
const { getSettings, clearSettings } = require("../settings");
const { COMPLETENESS_LABELS, OPEN_PROJECT_STATUSES, asOptions } = require("../choices");
const { wrap, ValidationError, forbidden } = require("../errors");
const T = require("../services/talent");
const F = require("../services/filters");
const { notePayload, retentionPayload } = require("./talentChildren");

const canBackup = (u) => !!(u && (Number(u.is_superuser) || Number(u.can_manage_backups)));

const SETTING_FIELDS = [
  "session_idle_hours", "review_interval_days", "contact_review_interval_days", "export_expiry_hours", "completeness_fields",
  "require_consent_for_all", "default_currency", "default_country_code", "whatsapp_template", "studio_name", "studio_location",
];

async function settingsPayload() {
  const s = await getSettings();
  return { ...s, updated_at: iso(s.updated_at), completeness_options: Object.entries(COMPLETENESS_LABELS).map(([key, label]) => ({ key, label })) };
}

const auditRow = (e) => ({
  id: e.id, at: iso(e.created_at), actor: e.actor_name || "system", action: e.action, entity_type: e.entity_type,
  entity_id: e.entity_id, label: e.entity_label, changes: json(e.changes, {}), message: e.message || "", ip: e.ip_address,
});

module.exports = function (r) {
  r.get("/health", wrap(async (req, res) => {
    try {
      await db.raw("select 1");
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  }));

  // ------------------------------------------------ settings
  r.get("/settings", wrap(async (req, res) => res.json(await settingsPayload())));

  r.patch("/settings", wrap(async (req, res) => {
    const b = req.body;
    const before = await getSettings();
    const upd = {};
    const errors = {};
    for (const f of SETTING_FIELDS) {
      if (!(f in b)) continue;
      const v = b[f];
      if (f === "session_idle_hours") {
        const n = Number(v);
        if (!(n >= 0.25 && n <= 72)) errors[f] = ["Choose between 15 minutes and 72 hours."];
        else upd[f] = n;
      } else if (f === "completeness_fields") {
        const list = Array.isArray(v) ? v : [];
        const bad = list.filter((x) => !COMPLETENESS_LABELS[x]);
        if (bad.length) errors[f] = [`Unknown checklist fields: ${bad.join(", ")}`];
        else if (!list.length) errors[f] = ["Keep at least one checklist field."];
        else upd[f] = toJson(list);
      } else if (["review_interval_days", "contact_review_interval_days", "export_expiry_hours"].includes(f)) {
        const n = parseInt(v, 10);
        if (!(n >= 0)) errors[f] = ["Enter a whole number."];
        else upd[f] = n;
      } else if (f === "require_consent_for_all") {
        upd[f] = v === true || v === "true" || v === 1 || v === "1";
      } else {
        upd[f] = String(v ?? "").trim();
      }
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);
    if (Object.keys(upd).length) {
      upd.updated_at = nowDb();
      await db("system_settings").where({ id: 1 }).update(upd);
      clearSettings();
    }
    const after = await getSettings();
    const changes = {};
    for (const f of SETTING_FIELDS) if (JSON.stringify(before[f]) !== JSON.stringify(after[f])) changes[f] = [before[f], after[f]];
    await audit.log(req, "settings.updated", { entityType: "settings", entityId: "1", label: "System settings", changes });
    if ("completeness_fields" in changes || "require_consent_for_all" in changes) {
      for (const { id } of await db("talent").select("id")) await T.refreshCompleteness(id);
    }
    res.json(await settingsPayload());
  }));

  // ------------------------------------------------ audit log
  r.get("/audit", wrap(async (req, res) => {
    const p = req.query;
    const q = db("audit_log").orderBy("created_at", "desc").orderBy("id", "desc");
    if (p.action) q.where("action", "like", `${p.action}%`);
    if (p.entity_type) q.where({ entity_type: p.entity_type });
    if (p.entity_id) q.where({ entity_id: p.entity_id });
    if (p.actor) q.whereRaw("LOWER(actor_name) = ?", [String(p.actor).toLowerCase()]);
    if (p.q) {
      const like = `%${p.q}%`;
      q.where((w) => w.where("entity_label", "like", like).orWhere("message", "like", like).orWhere("action", "like", like));
    }
    res.json(await F.paginate(q, p, async (rows) => rows.map(auditRow)));
  }));

  // ------------------------------------------------ dashboard (FR-002)
  r.get("/dashboard", wrap(async (req, res) => {
    const now = nowDb();
    const count = async (q) => Number((await q.count({ n: "talent.id" }).first()).n);
    const live = F.baseLive;
    const upcomingQ = () => db("bookings").where("bookings.shoot_end", ">=", now).whereIn("bookings.status", ["confirmed", "tentative"]);
    const upcoming = await upcomingQ()
      .join("talent", "talent.id", "bookings.talent_id")
      .join("projects", "projects.id", "bookings.project_id")
      .join("roles", "roles.id", "bookings.role_id")
      .orderBy("bookings.shoot_start")
      .limit(8)
      .select("bookings.*", "talent.full_name as talent_name", "projects.title as project_title", "roles.name as role_name");
    const recent = await live().orderBy("talent.created_at", "desc").limit(8).select("talent.*");
    const favs = await live()
      .whereExists(db("favorites").whereRaw("favorites.talent_id = talent.id").where("favorites.user_id", req.user.id))
      .orderBy("talent.full_name").limit(8).select("talent.*");
    const reminders = await F.reminderCounts();
    const reviewIds = new Set();
    const settings = await getSettings();
    for (const rm of reminders) {
      if (rm.key !== "incomplete" && rm.count) {
        const rows = await F.applyReminder(live(), rm.key, settings).select("talent.id");
        rows.forEach((x) => reviewIds.add(x.id));
      }
    }
    const activity = await db("audit_log")
      .where((w) => w.where("action", "like", "shortlist.%").orWhere("action", "like", "booking.%").orWhere("action", "like", "project.%")
        .orWhereIn("action", ["talent.created", "talent.note_added"]))
      .orderBy("created_at", "desc").orderBy("id", "desc").limit(15);
    const monthAgo = toDb(new Date(Date.now() - 30 * 86400e3));
    const cc = (await getSettings()).default_country_code;
    const ser = async (rows) => (await T.hydrate(rows, req.user)).map((t) => T.listPayload(Object.assign(t, { _cc: cc })));
    res.json({
      metrics: {
        active_talent: { count: await count(live()), link: "/talent" },
        needs_completion: { count: await count(live().where("talent.completeness", "<", 100)), link: "/talent?completeness=incomplete" },
        upcoming_bookings: { count: Number((await upcomingQ().count({ n: "*" }).first()).n), link: "/bookings?upcoming=1" },
        open_projects: {
          count: Number((await db("projects").whereNull("deleted_at").whereIn("status", OPEN_PROJECT_STATUSES).count({ n: "*" }).first()).n),
          link: "/projects?status=open",
        },
        recently_added: { count: await count(live().where("talent.created_at", ">=", monthAgo)), link: `/talent?sort=newest&added_after=${addDays(localDate(), -30)}` },
        favorites: { count: await count(live().whereExists(db("favorites").whereRaw("favorites.talent_id = talent.id").where("favorites.user_id", req.user.id))), link: "/talent?favorite=1" },
        requiring_review: { count: reviewIds.size, link: "/reminders" },
        staging: { count: await count(db("talent").whereNull("deleted_at").where({ status: "staging", is_archived: false })), link: "/talent?status=staging" },
      },
      reminders,
      upcoming_bookings: upcoming.map((b) => ({
        id: b.id, talent: b.talent_name, talent_id: b.talent_id, project: b.project_title, project_id: b.project_id, role: b.role_name,
        status: b.status, shoot_start: iso(b.shoot_start), shoot_end: iso(b.shoot_end),
      })),
      recent_talent: await ser(recent),
      favorites: await ser(favs),
      activity: activity.map((e) => ({
        id: e.id, at: iso(e.created_at), actor: e.actor_name || "system", action: e.action, label: e.entity_label,
        entity_type: e.entity_type, entity_id: e.entity_id, message: e.message || "",
      })),
    });
  }));

  r.get("/reminders", wrap(async (req, res) => {
    const s = await getSettings();
    const due = await db("contact_notes").where("follow_up_on", "<=", localDate()).where({ follow_up_done: false }).orderBy("interaction_at", "desc").limit(50);
    const reviews = await db("retention_reviews").where({ status: "open" }).orderBy("due_on").limit(50);
    res.json({
      counts: await F.reminderCounts(),
      follow_ups: await notePayload(due),
      retention_reviews: await retentionPayload(reviews),
      intervals: { rates_days: s.review_interval_days, contact_days: s.contact_review_interval_days },
    });
  }));

  r.get("/meta", wrap(async (req, res) => {
    const s = await getSettings();
    res.json({
      gender: asOptions("gender"),
      experience: asOptions("experience"),
      fee_type: asOptions("fee_type"),
      travel: asOptions("travel"),
      fluency: asOptions("fluency"),
      video_platform: asOptions("video_platform"),
      note_kind: asOptions("note_kind"),
      note_result: asOptions("note_result"),
      consent_type: asOptions("consent_type"),
      consent_status: asOptions("consent_status"),
      consent_method: asOptions("consent_method"),
      project_status: asOptions("project_status"),
      production_type: asOptions("production_type"),
      role_gender: asOptions("role_gender"),
      shortlist_status: asOptions("shortlist_status"),
      availability_type: asOptions("availability_type"),
      availability_source: asOptions("availability_source"),
      booking_status: asOptions("booking_status"),
      booking_outcome: asOptions("booking_outcome"),
      fee_basis: asOptions("fee_basis"),
      reminders: asOptions("reminders"),
      whatsapp_template: s.whatsapp_template,
      default_currency: s.default_currency,
      default_country_code: s.default_country_code,
    });
  }));

  // FR-022: status only; backups are taken outside the app (Hostinger daily backups).
  r.get("/backups/status", wrap(async (req, res) => {
    if (!canBackup(req.user)) throw forbidden("Backup access is restricted to backup operators.");
    let status = { configured: false };
    if (fs.existsSync(config.BACKUP_STATUS_FILE)) {
      try {
        status = { ...JSON.parse(fs.readFileSync(config.BACKUP_STATUS_FILE, "utf8")), configured: true };
      } catch {
        status = { configured: true, error: "Backup status file is unreadable." };
      }
    }
    const last = status.last_success_at ? new Date(status.last_success_at) : null;
    const stale = !last || Number.isNaN(last.getTime()) || Date.now() - last.getTime() > 26 * 3600e3;
    status.healthy = !!last && !stale && status.last_result === "success";
    await audit.log(req, "backup.status_viewed", { entityType: "backup", label: "Backup status" });
    res.json(status);
  }));
};

module.exports.canBackup = canBackup;
