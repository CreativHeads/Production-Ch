// Aggregates for the studio UI: header stats, and projects with their roles,
// shortlists, confirmed cast and cast-change log in one call.
const { db, iso, bool, money } = require("../db");
const { OPEN_PROJECT_STATUSES } = require("../choices");
const { wrap } = require("../errors");
const F = require("../services/filters");
const T = require("../services/talent");

// Studio wording for project statuses (the API keeps its own codes).
const STUDIO_STATUS = { draft: "Planning", casting: "Casting", ready: "Shortlisting", in_production: "Confirmed", completed: "Completed", cancelled: "Completed", archived: "Completed" };
const CLOSED = ["completed", "cancelled", "archived"];

module.exports = function (r) {
  r.get("/studio/summary", wrap(async (req, res) => {
    const count = async (q) => Number((await q.count({ n: "talent.id" }).first()).n);
    const live = F.baseLive;
    res.json({
      total: await count(live()),
      available: await count(F.applyAvailability(live(), "available")),
      active_projects: Number((await db("projects").whereNull("deleted_at").whereIn("status", OPEN_PROJECT_STATUSES).count({ n: "*" }).first()).n),
      favorites: await count(live().whereExists(db("favorites").whereRaw("favorites.talent_id = talent.id").where("favorites.user_id", req.user.id))),
      consent_pending: await count(live().whereNotExists(
        db("consents").whereRaw("consents.talent_id = talent.id").where({ consent_type: "data_storage", status: "granted" }),
      )),
    });
  }));

  r.get("/studio/projects", wrap(async (req, res) => {
    const scope = req.query.scope || "all";
    const q = db("projects").whereNull("deleted_at").orderBy("shoot_start").orderBy("id");
    if (scope === "active") q.whereNotIn("status", CLOSED);
    else if (scope === "completed") q.whereIn("status", CLOSED);
    const projects = await q;
    const pids = projects.map((p) => p.id);
    const roles = pids.length ? await db("roles").whereIn("project_id", pids).orderBy(["sort_order", "id"]) : [];
    const rids = roles.map((x) => x.id);
    const entries = rids.length ? await db("shortlist_entries").whereIn("role_id", rids).where({ is_removed: false }).orderBy(["priority", "id"]) : [];
    const bookings = rids.length ? await db("bookings").whereIn("role_id", rids).orderBy("created_at", "desc").orderBy("id", "desc") : [];
    const tids = [...new Set([...entries.map((e) => e.talent_id), ...bookings.map((b) => b.talent_id)])];
    const talentRows = tids.length ? await db("talent").whereIn("id", tids) : [];
    const thumbs = new Map((tids.length ? await db("talent_photos").whereIn("talent_id", tids).where({ is_primary: true }) : []).map((p) => [p.talent_id, p]));
    const talent = {};
    for (const t of talentRows) {
      const p = thumbs.get(t.id);
      talent[t.id] = {
        id: t.id, cast_id: t.cast_id, full_name: t.full_name, city: t.city, expected_fee: money(t.expected_fee),
        photo: p ? T.mediaUrl(p.card) : null, thumb: p ? T.mediaUrl(p.thumb) : null, is_archived: bool(t.is_archived), deleted: !!t.deleted_at,
      };
    }
    const name = (id) => (talent[id] ? talent[id].full_name : "Talent");
    const rupees = (v) => `₹${Number(v || 0).toLocaleString("en-IN")}`;
    res.json({
      talent,
      projects: projects.map((p) => ({
        id: p.id, code: p.code, title: p.title, client_name: p.client_name || "", production_type: p.production_type, description: p.description || "",
        shoot_start: p.shoot_start, shoot_end: p.shoot_end, location: p.location || "", status: p.status, studio_status: STUDIO_STATUS[p.status] || p.status,
        is_closed: CLOSED.includes(p.status), created_at: iso(p.created_at),
        roles: roles.filter((x) => x.project_id === p.id).map((role) => {
          const mine = bookings.filter((b) => b.role_id === role.id);
          const confirmed = mine.find((b) => b.status === "confirmed" || b.status === "completed");
          const log = mine.map((b) => {
            const note = (b.confirmation_notes || "").trim();
            if (b.status === "cancelled") {
              return { text: `${b.outcome === "replaced" ? "Replaced" : "Cancelled"} ${name(b.talent_id)}${note ? `: ${note}` : ""}`, date: iso(b.updated_at) };
            }
            return { text: `Confirmed ${name(b.talent_id)} · ${rupees(b.agreed_fee ?? b.proposed_fee)}${note ? ` · ${note}` : ""}`, date: iso(b.created_at) };
          });
          return {
            id: role.id, name: role.name, description: role.description || "", budget: money(role.budget), gender_preference: role.gender_preference,
            age_min: role.age_min, age_max: role.age_max,
            shortlist: entries.filter((e) => e.role_id === role.id).map((e) => ({ entry_id: e.id, talent_id: e.talent_id, status: e.status })),
            confirmed: confirmed ? { booking_id: confirmed.id, talent_id: confirmed.talent_id, agreed_fee: money(confirmed.agreed_fee ?? confirmed.proposed_fee), status: confirmed.status } : null,
            log,
          };
        }),
      })),
    });
  }));
};

module.exports.STUDIO_STATUS = STUDIO_STATUS;
