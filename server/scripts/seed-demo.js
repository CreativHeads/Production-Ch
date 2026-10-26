// Fill a LOCAL database with the sample studio data (8 talent, 3 projects),
// so the UI can be checked against the design. Never run against production.
//   BASE=http://localhost:3456 ADMIN_USERNAME=admin ADMIN_PASSWORD=... node scripts/seed-demo.js
const sharp = require("sharp");

const BASE = process.env.BASE || "http://localhost:3456";
if (!/localhost|127\.0\.0\.1/.test(BASE)) {
  console.error("seed-demo only runs against a local server.");
  process.exit(1);
}
const cookies = {};
async function call(method, path, body, form) {
  const headers = { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") };
  if (method !== "GET") headers["X-CSRFToken"] = cookies.csrftoken || "";
  let payload = form;
  if (!form && body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}/api/${path}`, { method, headers, body: payload });
  for (const c of res.headers.getSetCookie()) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    cookies[kv.slice(0, i)] = kv.slice(i + 1);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return data;
}

// A soft studio-portrait placeholder (no downloads needed).
async function portrait(name, hue) {
  const ini = name.split(" ").map((s) => s[0]).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="875">
    <defs><radialGradient id="g" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="hsl(${hue},18%,42%)"/><stop offset="1" stop-color="hsl(${hue},20%,10%)"/></radialGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="350" cy="330" r="120" fill="hsl(${hue},12%,70%)" opacity=".55"/>
    <ellipse cx="350" cy="760" rx="250" ry="230" fill="hsl(${hue},12%,70%)" opacity=".45"/>
    <text x="350" y="350" font-family="Arial" font-size="90" font-weight="700" text-anchor="middle" fill="#fff" opacity=".8">${ini}</text></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

const TALENT = [
  ["Arjun Menon", 28, "Kozhikode", "Actor", 6500, "Available", ["Malayalam", "Commercial"], "male"],
  ["Meera Nair", 24, "Kochi", "Actor", 8000, "Available", ["Malayalam", "Lifestyle"], "female"],
  ["Rahul Krishnan", 31, "Thrissur", "Model", 7000, "Booked", ["Fashion", "Commercial"], "male"],
  ["Ananya Das", 23, "Kochi", "Model", 5500, "Available", ["Fashion", "Lifestyle"], "female"],
  ["Diya Varghese", 26, "Kottakkal", "Presenter", 6000, "On hold", ["English", "Malayalam"], "female"],
  ["Adith Nair", 29, "Kozhikode", "Actor", 7500, "Available", ["Malayalam", "Film"], "male"],
  ["Nandana Ravi", 25, "Kannur", "Voice Artist", 4000, "Available", ["Malayalam", "Voice-over"], "female"],
  ["Vishnu Raj", 34, "Kottakkal", "Actor", 5000, "Booked", ["Comedy", "Commercial"], "male"],
];

(async () => {
  await call("GET", "auth/csrf/");
  await call("POST", "auth/login/", { username: process.env.ADMIN_USERNAME || "admin", password: process.env.ADMIN_PASSWORD });
  const terms = await call("GET", "terms/");
  const termId = async (kind, name) => {
    let t = terms.find((x) => x.kind === kind && x.name.toLowerCase() === name.toLowerCase());
    if (!t) {
      t = await call("POST", "terms/", { kind, name });
      terms.push(t);
    }
    return t.id;
  };
  const ids = [];
  for (const [i, [name, age, city, cat, fee, status, tags, gender]] of TALENT.entries()) {
    const fd = new FormData();
    fd.append("full_name", name);
    fd.append("phone", `98470${String(30000 + i * 1111).padStart(5, "0")}`);
    fd.append("city", city);
    fd.append("gender", gender);
    fd.append("approx_age", String(age));
    fd.append("categories", JSON.stringify([await termId("category", cat)]));
    fd.append("photo", new Blob([await portrait(name, 20 + i * 40)], { type: "image/jpeg" }), "p.jpg");
    fd.append("acknowledge_duplicates", JSON.stringify([]));
    let t;
    try {
      t = await call("POST", "talent/quick-add/", null, fd);
    } catch (e) {
      console.log("skip", name, e.message.slice(0, 80));
      continue;
    }
    const tagIds = [];
    for (const tg of tags) tagIds.push(await termId("tag", tg));
    t = await call("PATCH", `talent/${t.id}/`, { version: t.version, expected_fee: fee, fee_type: "per_day", tags: tagIds });
    if ([1, 3, 5].includes(i)) await call("POST", `talent/${t.id}/favorite/`);
    if (status === "On hold") {
      await call("POST", "availability/", { talent: t.id, start: new Date().toISOString(), end: new Date(Date.now() + 20 * 864e5).toISOString(), kind: "tentative_hold", source: "call" });
    }
    ids.push({ id: t.id, status, fee });
  }
  const projects = [
    ["The smile he held back", "Elite Dental Studio", "2026-11-04", "casting", [["Arnav", "Male · 25–30 · Malayalam · Natural screen presence", 8000, [0, 2]], ["Ishan", "Male · 25–30 · Malayalam · Friendly, expressive", 6500, [5]], ["Shreya", "Female · 22–27 · Malayalam", 7500, [1, 3]]]],
    ["Everyday confidence", "Haircom", "2026-11-09", "ready", [["Lead performer", "25–35 · Malayalam · Relatable everyday look", 7000, [0, 5, 2]]]],
    ["A little more care", "Union Finserv", "2026-11-12", "draft", [["Mother", "Female · 30–45 · Malayalam", 8000, []], ["Father", "Male · 30–45 · Malayalam", 5000, [7]]]],
  ];
  for (const [title, client, date, status, roles] of projects) {
    const p = await call("POST", "projects/", { title, client_name: client, shoot_start: date, status, production_type: "ad_film" });
    for (const [name, brief, budget, picks] of roles) {
      const r = await call("POST", "roles/", { project: p.id, name, description: brief, budget });
      const tids = picks.map((k) => ids[k] && ids[k].id).filter(Boolean);
      if (tids.length) await call("POST", "shortlist/add/", { role: r.id, talent_ids: tids });
      // Booked talent get a confirmed booking on their role.
      for (const k of picks) {
        if (ids[k] && ids[k].status === "Booked" && !ids[k].done) {
          await call("POST", "bookings/", { role: r.id, talent: ids[k].id, status: "confirmed", agreed_fee: ids[k].fee, proposed_fee: ids[k].fee, shoot_start: `${date}T09:00`, shoot_end: `${date}T18:00`, acknowledge_warnings: true });
          ids[k].done = true;
        }
      }
    }
  }
  console.log(`Seeded ${ids.length} talent and ${projects.length} projects.`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
