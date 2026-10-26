// End-to-end API smoke test against a running server.
//   BASE=http://localhost:3999 ADMIN_USERNAME=admin ADMIN_PASSWORD=... node scripts/smoke-test.js
const sharp = require("sharp");

const BASE = process.env.BASE || "http://localhost:3999";
let cookies = {};
let failures = 0;

function cookieHeader() {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
}
async function call(method, path, body, { form } = {}) {
  const headers = { cookie: cookieHeader() };
  if (method !== "GET") headers["X-CSRFToken"] = cookies.csrftoken || "";
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + "/api/" + path, { method, headers, body: payload });
  for (const c of res.headers.getSetCookie()) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    cookies[kv.slice(0, i)] = kv.slice(i + 1);
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}
function check(name, cond, extra) {
  if (cond) console.log("  ok  ", name);
  else {
    failures += 1;
    console.log("  FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : "");
  }
}
async function photo(color = "#888") {
  return sharp({ create: { width: 800, height: 1000, channels: 3, background: color } }).jpeg().toBuffer();
}

(async () => {
  await call("GET", "auth/csrf/");
  check("csrf cookie set", !!cookies.csrftoken);
  let r = await call("GET", "dashboard/");
  check("unauthenticated is 403", r.status === 403, r);
  r = await call("POST", "auth/login/", { username: "admin", password: "wrong" });
  check("bad login 400", r.status === 400, r);
  r = await call("POST", "auth/login/", { username: process.env.ADMIN_USERNAME || "admin", password: process.env.ADMIN_PASSWORD });
  check("login", r.status === 200 && r.data.is_superuser, r);
  r = await call("GET", "auth/me/");
  check("me", r.status === 200, r);
  r = await call("GET", "meta/");
  check("meta", r.status === 200 && r.data.gender.length === 5, r);
  r = await call("GET", "terms/");
  check("terms seeded", r.status === 200 && r.data.length > 40, r.data && r.data.length);
  const terms = r.data;
  const cat = (n) => terms.find((t) => t.kind === "category" && t.name === n).id;
  const lang = (n) => terms.find((t) => t.kind === "language" && t.name === n).id;
  r = await call("POST", "terms/", { kind: "tag", name: "Smoke Tag" });
  check("create term", r.status === 201, r);
  const tagId = r.data.id;
  r = await call("POST", "terms/", { kind: "tag", name: "Smoke tag" });
  check("dup term rejected", r.status === 400, r);

  // Quick add
  const fd = new FormData();
  fd.append("full_name", "Arjun Menon");
  fd.append("phone", "98470 11111");
  fd.append("city", "Kozhikode");
  fd.append("categories", JSON.stringify([cat("Actor")]));
  fd.append("playing_age_min", "25");
  fd.append("playing_age_max", "32");
  fd.append("photo", new Blob([await photo()], { type: "image/jpeg" }), "a.jpg");
  r = await call("POST", "talent/quick-add/", null, { form: fd });
  check("quick add", r.status === 201 && r.data.cast_id.startsWith("CH-CAST-") && r.data.photos.length === 1, r);
  const t1 = r.data;
  check("quick add status needs_details", t1.status === "needs_details" && t1.completeness > 0, t1.completeness);

  // Duplicate detection
  const fd2 = new FormData();
  fd2.append("full_name", "Someone Else");
  fd2.append("phone", "+91 9847011111");
  fd2.append("city", "Kochi");
  fd2.append("categories", String(cat("Model")));
  fd2.append("photo", new Blob([await photo("#456")], { type: "image/jpeg" }), "b.jpg");
  r = await call("POST", "talent/quick-add/", null, { form: fd2 });
  check("exact duplicate blocked", r.status === 409 && r.data.has_exact, r);
  r = await call("POST", "talent/duplicate-check/", { full_name: "Arjun Menon", city: "Kozhikode" });
  check("fuzzy duplicate check", r.status === 200 && r.data.duplicates.length === 1, r);

  // Full create
  r = await call("POST", "talent/", {
    full_name: "Meera Nair", phone: "9847022222", city: "Kochi", categories: [cat("Model")], tags: [tagId], gender: "female", approx_age: 24,
    languages: [{ language: lang("Malayalam"), fluency: "native" }], expected_fee: 8000, fee_type: "per_day",
  });
  check("full create", r.status === 201 && r.data.languages.length === 1 && r.data.expected_fee === "8000.00", r);
  const t2 = r.data;

  // Patch with version
  r = await call("PATCH", `talent/${t2.id}/`, { version: t2.version, height_cm: 165, skills: [] });
  check("patch", r.status === 200 && r.data.height_cm === 165 && r.data.version === t2.version + 1, r);
  r = await call("PATCH", `talent/${t2.id}/`, { version: t2.version, height_cm: 170 });
  check("stale version 409", r.status === 409 && r.data.code === "stale_version", r);
  r = await call("GET", `talent/${t2.cast_id}/`);
  check("lookup by cast id", r.status === 200 && r.data.id === t2.id, r);

  // Directory
  r = await call("GET", "talent/?q=meera");
  check("search", r.status === 200 && r.data.count === 1, r.data);
  r = await call("GET", `talent/?category=${cat("Actor")}&age_min=20&age_max=30&sort=-fee`);
  check("filters", r.status === 200 && r.data.count === 1 && r.data.results[0].id === t1.id, r.data);
  r = await call("GET", "talent/?sort=last_contact&review=rates_stale&completeness=incomplete");
  check("review filter", r.status === 200, r);
  r = await call("POST", `talent/${t1.id}/favorite/`);
  check("favorite", r.data.is_favorite === true, r);
  r = await call("GET", "talent/?favorite=1");
  check("favorite filter", r.data.count === 1, r.data);
  r = await call("GET", "talent/cities/");
  check("cities", r.data.cities.includes("Kochi"), r.data);

  // Photos
  const pf = new FormData();
  pf.append("photo", new Blob([await photo("#222")], { type: "image/jpeg" }), "c.jpg");
  r = await call("POST", `talent/${t1.id}/photos/`, null, { form: pf });
  check("add photo", r.status === 201 && r.data.length === 1 && !r.data[0].is_primary, r);
  const p2 = r.data[0];
  const primary = t1.photos[0];
  r = await call("DELETE", `photos/${primary.id}/`);
  check("primary photo not deletable", r.status === 409, r);
  r = await call("PATCH", `photos/${p2.id}/`, { is_primary: true, is_outdated: true });
  check("set primary + flag", r.status === 200 && r.data.is_primary && r.data.is_outdated, r);
  r = await call("DELETE", `photos/${primary.id}/`);
  check("delete old photo", r.status === 204, r);
  const media = await fetch(BASE + p2.card_url, { headers: { cookie: cookieHeader() } });
  check("protected media served", media.status === 200 && media.headers.get("content-type").includes("webp"));
  const anon = await fetch(BASE + p2.card_url);
  check("media needs sign-in", anon.status === 403);

  // Videos, links, guardians, consents
  r = await call("POST", "videos/", { talent: t1.id, position: 1, title: "Showreel", url: "https://youtu.be/dQw4w9WgXcQ" });
  check("video", r.status === 201 && r.data.platform === "youtube" && r.data.thumbnail_url.includes("dQw4w9WgXcQ"), r);
  r = await call("POST", "videos/", { talent: t1.id, position: 1, title: "Again", url: "https://vimeo.com/1" });
  check("video slot clash", r.status === 400, r);
  r = await call("POST", "portfolio-links/", { talent: t1.id, title: "IMDb", url: "https://imdb.com/x" });
  check("link", r.status === 201, r);
  const cf = new FormData();
  Object.entries({ talent: t1.id, consent_type: "data_storage", status: "granted", obtained_on: "2026-10-01", method: "signed_form", expires_on: "" }).forEach(([k, v]) => cf.append(k, v));
  cf.append("evidence", new Blob([Buffer.from("%PDF-1.4 test")], { type: "application/pdf" }), "form.pdf");
  r = await call("POST", "consents/", null, { form: cf });
  check("consent granted", r.status === 201 && r.data.is_effective && r.data.evidence_url, r);
  const consent = r.data;
  r = await call("DELETE", `consents/${consent.id}/`);
  check("consent immutable", r.status === 409, r);

  // Notes
  r = await call("POST", "notes/", { talent: t1.id, kind: "call", result: "interested", content: "Spoke about ad", follow_up_on: "2026-01-01" });
  check("note", r.status === 201 && r.data.staff_name, r);
  const note = r.data;
  r = await call("GET", `notes/?talent=${t1.id}&page_size=100`);
  check("notes list", r.data.count === 1, r.data);
  r = await call("GET", "reminders/");
  check("reminders follow-up due", r.status === 200 && r.data.follow_ups.length === 1, r.data);
  r = await call("PATCH", `notes/${note.id}/`, { follow_up_done: true });
  check("note update", r.data.follow_up_done === true, r);

  // Withdraw consent → hold + retention review
  r = await call("PATCH", `consents/${consent.id}/`, { status: "withdrawn" });
  check("consent withdrawn", r.status === 200 && r.data.withdrawn_on, r);
  r = await call("GET", `talent/${t1.id}/`);
  check("consent hold set", r.data.consent_hold, r.data);
  r = await call("GET", "retention-reviews/?status=open");
  check("retention review opened", r.data.count === 1, r.data);
  await call("PATCH", `retention-reviews/${r.data.results[0].id}/`, { status: "retained", resolution_notes: "Contract" });
  r = await call("PATCH", `consents/${consent.id}/`, { status: "granted" });
  r = await call("GET", `talent/${t1.id}/`);
  check("consent hold cleared", !r.data.consent_hold, r.data.consent_hold);

  // Availability
  r = await call("POST", "availability/", { talent: t2.id, start: "2026-12-10T00:00", end: "2026-12-12T00:00", kind: "unavailable", source: "call" });
  check("availability", r.status === 201 && r.data.confirmed_at, r);
  r = await call("POST", "availability/", { talent: t2.id, start: "2026-12-10T00:00", end: "2026-12-12T00:00", kind: "confirmed_booking" });
  check("manual confirmed_booking rejected", r.status === 400, r);
  r = await call("GET", "talent/?available_on=2026-12-11");
  check("available_on filter", r.data.results.every((x) => x.id !== t2.id), r.data);

  // Projects / roles / shortlist / bookings
  r = await call("POST", "projects/", { title: "The smile he held back", client_name: "Elite Dental", status: "casting", shoot_start: "2026-12-10", shoot_end: "2026-12-11" });
  check("project", r.status === 201 && /^CH-PRJ-\d{4}-0001$/.test(r.data.code), r);
  const project = r.data;
  r = await call("POST", "roles/", { project: project.id, name: "Lead", gender_preference: "female", age_min: 20, age_max: 30, categories: [cat("Model")], languages: [lang("Malayalam")], budget: 10000, shoot_start: "2026-12-10" });
  check("role", r.status === 201 && r.data.category_names[0] === "Model", r);
  const role = r.data;
  r = await call("GET", `roles/${role.id}/search-filters/`);
  check("role filters", r.data.filters.gender === "female" && r.data.filters.fee_max === "10000.00", r.data);
  r = await call("POST", "shortlist/add/", { role: role.id, talent_ids: [t1.id, t2.id] });
  check("shortlist add", r.status === 201 && r.data.added.length === 2, r);
  r = await call("GET", `projects/${project.id}/board/`);
  check("board", r.status === 200 && r.data.shortlist.length === 2 && r.data.roles[0].shortlist_count === 2, r.data);
  const entry = r.data.shortlist.find((e) => e.talent === t2.id);
  r = await call("PATCH", `shortlist/${entry.id}/`, { status: "contacted", proposed_fee: 9000, event_note: "Called" });
  check("shortlist update", r.data.status === "contacted" && r.data.proposed_fee === "9000.00", r);
  r = await call("POST", "shortlist/reorder/", { role: role.id, order: [entry.id] });
  r = await call("GET", `shortlist/${entry.id}/history/`);
  check("shortlist history", r.data.length >= 3, r.data);

  // Holds and other bookings never block: talent can do several shoots on one day.
  r = await call("POST", "bookings/", { role: role.id, talent: t2.id, shoot_start: "2026-12-10T09:00", shoot_end: "2026-12-10T18:00", status: "confirmed" });
  check("booking created", r.status === 201 && r.data.proposed_fee === "9000.00" && r.data.status === "confirmed", r);
  const booking = r.data;
  r = await call("POST", "bookings/", { role: role.id, talent: t2.id, shoot_start: "2026-12-10T12:00", shoot_end: "2026-12-10T20:00", status: "confirmed" });
  check("same-day second booking allowed", r.status === 201 && r.data.status === "confirmed", r);
  const b2 = r.data;
  r = await call("GET", `shortlist/${entry.id}/`);
  check("booking marks selected", r.data.status === "selected" && r.data.has_booking, r.data);
  r = await call("PATCH", `bookings/${booking.id}/`, { agreed_fee: 9500 });
  check("booking update", r.status === 200 && r.data.agreed_fee === "9500.00", r);
  r = await call("DELETE", `bookings/${b2.id}/`);
  check("booking cancel", r.data.status === "cancelled", r);
  r = await call("GET", "bookings/?start=2026-12-01&end=2026-12-31&page_size=200");
  check("bookings range", r.data.count === 2, r.data);
  r = await call("POST", "bookings/check-conflicts/", { talent: t2.id, shoot_start: "2026-12-10T10:00", shoot_end: "2026-12-10T11:00" });
  check("check conflicts", r.data.conflicts.length === 1, r.data);
  r = await call("GET", `talent/${t2.id}/casting/`);
  check("talent casting history", r.data.bookings.length === 2 && r.data.shortlists.length === 1, r.data);
  r = await call("DELETE", `roles/${role.id}/`);
  check("role with bookings not deletable", r.status === 409, r);
  r = await call("GET", "projects/?status=open&page_size=100");
  check("projects list", r.data.count === 1 && r.data.results[0].role_count === 1, r.data);

  // Dashboard & settings
  r = await call("GET", "dashboard/");
  check("dashboard", r.status === 200 && r.data.metrics.active_talent.count === 2 && r.data.upcoming_bookings.length === 1, r.data && r.data.metrics);
  r = await call("PATCH", "settings/", { session_idle_hours: 100 });
  check("settings validation", r.status === 400, r);
  r = await call("PATCH", "settings/", { completeness_fields: ["name", "phone"] });
  check("settings update + recompute", r.status === 200, r);
  r = await call("GET", `talent/${t2.id}/`);
  check("completeness recomputed", r.data.completeness === 100 && r.data.status === "active", r.data.completeness);

  // Import
  const csv = "Name,Phone,City,Category,Languages,Fee,DOB\nRahul Krishnan,9847033333,Thrissur,Actor,\"Malayalam, Tamil\",7k,14/02/1995\nBad Row,,Kochi,Actor,,,\n";
  const imf = new FormData();
  imf.append("file", new Blob([csv], { type: "text/csv" }), "talent.csv");
  r = await call("POST", "imports/", null, { form: imf });
  check("import upload", r.status === 201 && r.data.total_rows === 2 && r.data.mapping.Name === "full_name", r);
  const batch = r.data;
  r = await call("POST", `imports/${batch.id}/validate/`, { mapping: batch.mapping });
  check("import validate", r.status === 200 && r.data.summary.errors === 1 && r.data.summary.staging === 1, r.data && r.data.summary);
  r = await call("POST", `imports/${batch.id}/confirm/`);
  check("import confirm", r.status === 200 && r.data.summary.staged === 1, r.data && r.data.summary);
  r = await call("GET", "talent/?status=staging");
  check("staged talent", r.data.count === 1 && r.data.results[0].expected_fee === "7000.00", r.data);

  // Export
  r = await call("POST", "exports/", { format: "xlsx", audience: "client", filters: {} });
  check("export xlsx", r.status === 201 && r.data.row_count === 2, r);
  const dl = await fetch(BASE + r.data.download_url, { headers: { cookie: cookieHeader() } });
  check("export download", dl.status === 200 && (await dl.arrayBuffer()).byteLength > 1000);
  r = await call("POST", "exports/", { format: "csv", ids: [t1.id] });
  check("export csv", r.status === 201 && r.data.row_count === 1, r);
  r = await call("POST", "exports/", { format: "backup", include_media: true });
  check("backup zip", r.status === 201 && r.data.row_count > 50, r);

  // Staff
  r = await call("POST", "auth/staff/", { username: "anjali", first_name: "Anjali", password: "short" });
  check("weak password rejected", r.status === 400, r);
  r = await call("POST", "auth/staff/", { username: "anjali", first_name: "Anjali", email: "a@example.test", password: "Kerala-Casting-77" });
  check("staff create", r.status === 201, r);
  r = await call("PATCH", `auth/staff/${r.data.id}/`, { is_active: false });
  check("staff deactivate", r.status === 200 && !r.data.is_active, r);

  // Archive / trash
  r = await call("POST", `talent/${t1.id}/archive/`, { reason: "Moved abroad" });
  check("archive", r.data.is_archived, r);
  r = await call("POST", `talent/${t1.id}/unarchive/`);
  r = await call("DELETE", `talent/${t1.id}/`);
  check("soft delete", r.status === 204, r);
  r = await call("GET", "talent/trash/?page_size=100");
  check("trash", r.data.count === 1, r.data);
  r = await call("POST", `talent/trash/${t1.id}/restore/`);
  check("restore", r.data.ok, r);
  r = await call("POST", `terms/${tagId}/merge/`, { into: terms.find((t) => t.kind === "tag" && t.name === "Comedy").id });
  check("merge term", r.status === 200 && r.data.moved === 1, r);
  r = await call("GET", `talent/${t2.id}/history/`);
  check("talent history", r.data.length >= 3, r.data && r.data.length);
  r = await call("GET", "audit/?page_size=50");
  check("audit log", r.data.count > 20, r.data && r.data.count);
  r = await call("POST", "auth/logout/");
  r = await call("GET", "auth/me/");
  check("logged out", r.status === 403, r);

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
