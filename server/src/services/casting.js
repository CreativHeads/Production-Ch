// Booking conflicts, availability sync and shortlist history (FR-014 – FR-016).
const { db, nowDb, iso, bool, money, localDate, insertId } = require("../db");
const audit = require("../audit");
const { label } = require("../choices");
const { Conflict } = require("../errors");
const T = require("./talent");

// Return {blocking, warnings}. Blocking = other confirmed/completed bookings.
async function findConflicts(talentId, start, end, excludeBookingId = null) {
  const blocking = [];
  const warnings = [];
  const q = db("bookings")
    .where("bookings.talent_id", talentId).where("bookings.shoot_start", "<", end).where("bookings.shoot_end", ">", start)
    .whereNot("bookings.status", "cancelled")
    .join("projects", "projects.id", "bookings.project_id").join("roles", "roles.id", "bookings.role_id")
    .select("bookings.*", "projects.title as project_title", "roles.name as role_name");
  if (excludeBookingId) q.whereNot("bookings.id", Number(excludeBookingId));
  for (const b of await q) {
    const item = { type: "booking", id: b.id, status: b.status, label: `${b.project_title} — ${b.role_name}`, start: iso(b.shoot_start), end: iso(b.shoot_end) };
    (["confirmed", "completed"].includes(b.status) ? blocking : warnings).push(item);
  }
  const avail = await db("availability").where({ talent_id: talentId }).whereNull("booking_id")
    .where("start", "<", end).where("end", ">", start).whereIn("kind", ["unavailable", "tentative_hold", "confirmed_booking"]);
  for (const a of avail) {
    warnings.push({
      type: "availability", id: a.id, status: a.kind,
      label: label("availability_type", a.kind) + (a.notes ? ` — ${a.notes.slice(0, 60)}` : ""), start: iso(a.start), end: iso(a.end),
    });
  }
  return { blocking, warnings };
}

// Keep one availability row mirroring each active booking.
async function syncAvailability(booking, user) {
  if (booking.status === "cancelled") {
    await db("availability").where({ booking_id: booking.id }).del();
    return;
  }
  const project = await db("projects").where({ id: booking.project_id }).first();
  const role = await db("roles").where({ id: booking.role_id }).first();
  const row = {
    talent_id: booking.talent_id, start: booking.shoot_start, end: booking.shoot_end,
    kind: ["confirmed", "completed"].includes(booking.status) ? "confirmed_booking" : "tentative_hold",
    confirmed_at: booking.confirmed_at, source: booking.confirmation_source || "system", notes: `${project.title} — ${role.name}`,
    project_id: booking.project_id, updated_by: user?.id || null, updated_at: nowDb(),
  };
  const existing = await db("availability").where({ booking_id: booking.id }).first();
  if (existing) await db("availability").where({ id: existing.id }).update(row);
  else await db("availability").insert({ ...row, booking_id: booking.id, created_at: nowDb(), created_by: user?.id || null });
}

// Validate and persist a booking row (plain object; id present when updating).
// Talent can be booked on any date, including several shoots on the same day,
// so overlapping bookings never block. Child artists still need guardian details.
async function saveBooking(b, user, req) {
  if (!(b.shoot_end > b.shoot_start)) throw new Conflict("The shoot must end after it starts.", "invalid_dates");
  if (["tentative", "confirmed"].includes(b.status)) {
    const problems = await T.bookingBlockers(b.talent_id);
    if (problems.length) throw new Conflict("This talent can't be booked yet: " + problems.join(" "), "booking_blocked", { blockers: problems });
  }
  const warnings = [];
  const confirming = ["confirmed", "completed"].includes(b.status);
  if (confirming && !b.confirmed_at) b.confirmed_at = nowDb();
  if (b.status === "completed" && b.outcome === "pending") b.outcome = "completed";
  if (b.status === "completed" && !b.completed_on) b.completed_on = localDate();
  b.updated_by = user.id;
  b.updated_at = nowDb();
  if (b.id) {
    const { id, ...rest } = b;
    await db("bookings").where({ id }).update(rest);
  } else {
    b.created_by = user.id;
    b.created_at = b.updated_at;
    b.id = await insertId("bookings", b);
  }
  const saved = await db("bookings").where({ id: b.id }).first();
  await syncAvailability(saved, user);
  return { booking: saved, warnings };
}

async function recordEvent(entryId, action, user, fromValue = "", toValue = "", note = "") {
  const s = (v) => (v === null || v === undefined || v === false ? (v === false ? "False" : "") : v === true ? "True" : String(v)).slice(0, 120);
  await db("shortlist_events").insert({ entry_id: entryId, action, from_value: s(fromValue), to_value: s(toValue), note: note || "", actor_id: user?.id || null, created_at: nowDb() });
}

function shortlistBlockers(t) {
  const problems = [];
  if (bool(t.is_archived)) problems.push("This talent is archived. Restore them first.");
  if (t.status === "staging") problems.push("This talent is still in import staging. Add a primary photo to publish them first.");
  return problems;
}

async function addToShortlist(role, t, user, notes = "") {
  const problems = shortlistBlockers(t);
  if (problems.length) throw new Conflict(problems.join(" "), "shortlist_blocked");
  const existing = await db("shortlist_entries").where({ role_id: role.id, talent_id: t.id }).first();
  if (existing) {
    if (bool(existing.is_removed)) {
      await db("shortlist_entries").where({ id: existing.id }).update({ is_removed: false, removed_at: null, status: "shortlisted", updated_by: user.id, updated_at: nowDb() });
      await recordEvent(existing.id, "restored", user, "", "", notes);
    }
    return { entry: existing, created: false };
  }
  const max = await db("shortlist_entries").where({ role_id: role.id }).max({ p: "priority" }).first();
  const now = nowDb();
  const id = await insertId("shortlist_entries", {
    role_id: role.id, talent_id: t.id, priority: Number(max.p || 0) + 1, status: "shortlisted", notes: notes || "",
    proposed_fee: t.expected_fee, fee_basis: t.fee_type || role.fee_basis || "", availability_confirmed: false, availability_notes: "",
    is_removed: false, removed_reason: "", created_at: now, updated_at: now, created_by: user.id, updated_by: user.id,
  });
  await recordEvent(id, "added", user, "", "shortlisted", notes);
  return { entry: await db("shortlist_entries").where({ id }).first(), created: true };
}

// ---------------------------------------------------------------- payloads
async function primaryThumbs(talentIds) {
  if (!talentIds.length) return new Map();
  const rows = await db("talent_photos").whereIn("talent_id", [...new Set(talentIds)]).where({ is_primary: true });
  return new Map(rows.map((p) => [p.talent_id, T.mediaUrl(p.thumb)]));
}

async function entryPayloads(entries) {
  if (!entries.length) return [];
  const talent = new Map((await db("talent").whereIn("id", entries.map((e) => e.talent_id))).map((t) => [t.id, t]));
  const roles = new Map((await db("roles").whereIn("id", entries.map((e) => e.role_id))).map((r) => [r.id, r]));
  const thumbs = await primaryThumbs(entries.map((e) => e.talent_id));
  const booked = new Set((await db("bookings").whereIn("shortlist_entry_id", entries.map((e) => e.id)).whereNot({ status: "cancelled" })).map((b) => b.shortlist_entry_id));
  return entries.map((e) => {
    const t = talent.get(e.talent_id);
    const role = roles.get(e.role_id);
    return {
      id: e.id, role: e.role_id, role_name: role?.name, project_id: role?.project_id, talent: e.talent_id,
      talent_detail: t && {
        id: t.id, cast_id: t.cast_id, full_name: t.full_name, city: t.city, phone: t.phone, expected_fee: money(t.expected_fee), fee_type: t.fee_type || "",
        playing_age_min: t.playing_age_min, playing_age_max: t.playing_age_max, gender: t.gender || "", consent_hold: bool(t.consent_hold), photo: thumbs.get(t.id) || null,
      },
      priority: e.priority, status: e.status, status_label: label("shortlist_status", e.status), notes: e.notes || "", proposed_fee: money(e.proposed_fee),
      fee_basis: e.fee_basis || "", availability_confirmed: bool(e.availability_confirmed), availability_confirmed_at: iso(e.availability_confirmed_at),
      availability_notes: e.availability_notes || "", is_removed: bool(e.is_removed), removed_at: iso(e.removed_at), removed_reason: e.removed_reason || "",
      has_booking: booked.has(e.id), created_at: iso(e.created_at), updated_at: iso(e.updated_at),
    };
  });
}

async function bookingPayloads(rows) {
  if (!rows.length) return [];
  const talent = new Map((await db("talent").whereIn("id", rows.map((b) => b.talent_id))).map((t) => [t.id, t]));
  const projects = new Map((await db("projects").whereIn("id", rows.map((b) => b.project_id))).map((p) => [p.id, p]));
  const roles = new Map((await db("roles").whereIn("id", rows.map((b) => b.role_id))).map((r) => [r.id, r]));
  const users = new Map((await db("users").whereIn("id", rows.map((b) => b.override_by).filter(Boolean))).map((u) => [u.id, u.username]));
  const thumbs = await primaryThumbs(rows.map((b) => b.talent_id));
  return rows.map((b) => {
    const t = talent.get(b.talent_id) || {};
    const p = projects.get(b.project_id) || {};
    return {
      id: b.id, project: b.project_id, project_title: p.title, project_code: p.code, role: b.role_id, role_name: roles.get(b.role_id)?.name,
      talent: b.talent_id, talent_name: t.full_name, talent_cast_id: t.cast_id, talent_phone: t.phone, talent_photo: thumbs.get(b.talent_id) || null,
      shortlist_entry: b.shortlist_entry_id, shoot_start: iso(b.shoot_start), shoot_end: iso(b.shoot_end), schedule_notes: b.schedule_notes || "",
      status: b.status, status_label: label("booking_status", b.status), proposed_fee: money(b.proposed_fee), agreed_fee: money(b.agreed_fee),
      fee_basis: b.fee_basis || "", currency: b.currency, travel_charges: money(b.travel_charges), accommodation_charges: money(b.accommodation_charges),
      other_charges_notes: b.other_charges_notes || "", confirmed_at: iso(b.confirmed_at), confirmation_source: b.confirmation_source || "",
      confirmation_notes: b.confirmation_notes || "", outcome: b.outcome, outcome_label: label("booking_outcome", b.outcome), completed_on: b.completed_on || null,
      deliverable_url: b.deliverable_url || "", conflict_override: bool(b.conflict_override), override_reason: b.override_reason || "",
      override_by_name: users.get(b.override_by) || null, override_at: iso(b.override_at), created_at: iso(b.created_at), updated_at: iso(b.updated_at),
    };
  });
}

module.exports = { findConflicts, syncAvailability, saveBooking, recordEvent, addToShortlist, entryPayloads, bookingPayloads, primaryThumbs };
