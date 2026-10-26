// FR-001 staff authentication. No public sign-up endpoint exists.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const config = require("../config");
const { db, nowDb, iso, bool } = require("../db");
const audit = require("../audit");
const { getSettings } = require("../settings");
const { wrap, ValidationError, HttpError, forbidden, notFound } = require("../errors");

const COMMON = new Set([
  "password", "password1", "password123", "1234567890", "12345678910", "qwertyuiop", "iloveyou12", "welcome123", "letmein123",
  "admin12345", "abc1234567", "creativheads", "casting123", "qwerty1234", "1q2w3e4r5t", "passw0rd12", "sunshine12", "football12",
]);

function passwordErrors(pw, user = {}) {
  const errs = [];
  if (!pw || pw.length < 10) errs.push("This password is too short. It must contain at least 10 characters.");
  if (pw && /^\d+$/.test(pw)) errs.push("This password is entirely numeric.");
  if (pw && COMMON.has(pw.toLowerCase())) errs.push("This password is too common.");
  const low = (pw || "").toLowerCase();
  for (const attr of [user.username, user.first_name, user.last_name, (user.email || "").split("@")[0]]) {
    if (attr && attr.length >= 3 && low.includes(String(attr).toLowerCase())) {
      errs.push("The password is too similar to your account details.");
      break;
    }
  }
  return errs;
}
function checkPassword(pw, user, field) {
  const errs = passwordErrors(pw, user);
  if (errs.length) throw new HttpError(400, errs.join(" "), "invalid", { errors: { [field]: errs } });
}

const hash = (pw) => bcrypt.hashSync(pw, 12);
const fullName = (u) => `${u.first_name || ""} ${u.last_name || ""}`.trim();
const displayName = (u) => fullName(u) || u.username;

function userPayload(u) {
  return {
    id: u.id,
    username: u.username,
    name: displayName(u),
    first_name: u.first_name || "",
    email: u.email || "",
    is_superuser: bool(u.is_superuser),
    can_manage_backups: bool(u.is_superuser) || bool(u.can_manage_backups),
    last_login: iso(u.last_login),
  };
}

function staffPayload(u) {
  return {
    id: u.id,
    username: u.username,
    first_name: u.first_name || "",
    last_name: u.last_name || "",
    email: u.email || "",
    is_active: bool(u.is_active),
    is_superuser: bool(u.is_superuser),
    last_login: iso(u.last_login),
    date_joined: iso(u.date_joined),
    name: displayName(u),
  };
}

// Brute-force protection (single app process, so memory is enough).
const failures = new Map();
const lockKey = (username, ip) => `${(username || "").toLowerCase()}:${ip}`;
function failCount(key) {
  const f = failures.get(key);
  if (!f || f.until < Date.now()) return 0;
  return f.n;
}

// Password reset tokens: single use (bound to the current hash), valid 1 hour.
function resetToken(user, ts = Math.floor(Date.now() / 1000)) {
  const mac = crypto.createHmac("sha256", config.SECRET_KEY).update(`${user.id}|${user.password_hash}|${user.last_login || ""}|${ts}`).digest("hex").slice(0, 32);
  return `${ts.toString(36)}-${mac}`;
}
function checkResetToken(user, token) {
  const [ts36] = String(token || "").split("-");
  const ts = parseInt(ts36, 36);
  if (!ts || Date.now() / 1000 - ts > 3600) return false;
  const expected = resetToken(user, ts);
  return expected.length === token.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

let mailer = null;
function sendMail(to, subject, text) {
  if (!config.EMAIL.host) {
    console.log(`[email to ${to}] ${subject}\n${text}`);
    return Promise.resolve();
  }
  mailer = mailer || nodemailer.createTransport({
    host: config.EMAIL.host, port: config.EMAIL.port, secure: config.EMAIL.secure,
    auth: config.EMAIL.user ? { user: config.EMAIL.user, pass: config.EMAIL.password } : undefined,
  });
  return mailer.sendMail({ from: config.EMAIL.from, to, subject, text });
}

const regenerate = (req) => new Promise((ok, fail) => req.session.regenerate((e) => (e ? fail(e) : ok())));
const save = (req) => new Promise((ok, fail) => req.session.save((e) => (e ? fail(e) : ok())));

const requireSuperuser = (req) => {
  if (!bool(req.user.is_superuser)) throw forbidden("Only administrators can manage staff accounts.");
};

module.exports = function (r) {
  r.get("/auth/csrf", (req, res) => res.json({ ok: true }));

  r.post("/auth/login", wrap(async (req, res) => {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const ip = audit.clientIp(req) || "?";
    const key = lockKey(username, ip);
    if (failCount(key) >= config.LOGIN_MAX_ATTEMPTS) {
      throw new HttpError(429, `Too many failed attempts. Please wait ${config.LOGIN_LOCKOUT_MINUTES} minutes and try again.`, "locked");
    }
    if (!username || !password) throw new HttpError(400, "Enter your username and password.", "invalid");
    // Staff can sign in with their username or work email.
    const low = username.toLowerCase();
    const user =
      (await db("users").whereRaw("LOWER(username) = ?", [low]).first()) ||
      (low.includes("@") ? await db("users").whereRaw("LOWER(email) = ?", [low]).first() : null);
    const ok = user && bool(user.is_active) && bcrypt.compareSync(password, user.password_hash);
    if (!ok) {
      failures.set(key, { n: failCount(key) + 1, until: Date.now() + config.LOGIN_LOCKOUT_MINUTES * 60e3 });
      await audit.log(null, "auth.login_failed", { entityType: "user", label: username.slice(0, 150), message: `IP ${ip}` });
      throw new HttpError(400, "That username and password don't match an active staff account.", "invalid");
    }
    failures.delete(key);
    await regenerate(req);
    req.session.userId = user.id;
    const hours = Number((await getSettings()).session_idle_hours) || 8;
    req.session.cookie.maxAge = Math.round(hours * 3600e3);
    await save(req);
    await db("users").where({ id: user.id }).update({ last_login: nowDb() });
    req.user = user;
    await audit.log(req, "auth.login", { entityType: "user", entityId: user.id, label: user.username });
    res.json(userPayload({ ...user, last_login: nowDb() }));
  }));

  r.post("/auth/logout", wrap(async (req, res) => {
    await audit.log(req, "auth.logout", { entityType: "user", entityId: req.user.id, label: req.user.username });
    await new Promise((ok) => req.session.destroy(() => ok()));
    res.clearCookie("sessionid");
    res.json({ ok: true });
  }));

  r.get("/auth/me", (req, res) => res.json(userPayload(req.user)));

  r.patch("/auth/me", wrap(async (req, res) => {
    const u = req.user;
    const fields = ["first_name", "last_name", "email"];
    const before = audit.snapshot(u, fields);
    const upd = {};
    for (const f of fields) if (f in req.body) upd[f] = String(req.body[f] || "").trim();
    if (Object.keys(upd).length) await db("users").where({ id: u.id }).update(upd);
    const after = { ...u, ...upd };
    const changes = audit.diff(before, audit.snapshot(after, fields));
    if (Object.keys(changes).length) await audit.log(req, "user.profile_changed", { entityType: "user", entityId: u.id, label: u.username, changes });
    res.json(userPayload(after));
  }));

  r.post("/auth/password/change", wrap(async (req, res) => {
    const u = req.user;
    if (!bcrypt.compareSync(String(req.body.current_password || ""), u.password_hash)) {
      throw new HttpError(400, "Your current password is incorrect.", "invalid", { errors: { current_password: ["Incorrect password."] } });
    }
    const pw = String(req.body.new_password || "");
    checkPassword(pw, u, "new_password");
    await db("users").where({ id: u.id }).update({ password_hash: hash(pw) });
    // Sign out every other session of this account.
    await db("sessions").where({ user_id: u.id }).whereNot({ sid: req.sessionID }).del();
    await audit.log(req, "auth.password_changed", { entityType: "user", entityId: u.id, label: u.username });
    res.json({ ok: true });
  }));

  // Verified recovery: the response never reveals whether the account exists.
  const resetHits = new Map();
  r.post("/auth/password/reset", wrap(async (req, res) => {
    const ident = String(req.body.username || req.body.email || "").trim();
    const generic = { detail: "If that account exists and has a registered email, a reset link has been sent. Otherwise ask an administrator to reset your password." };
    if (!ident) return res.json(generic);
    const ip = audit.clientIp(req) || "?";
    const hit = resetHits.get(ip) || { n: 0, until: Date.now() + 3600e3 };
    if (hit.until < Date.now()) Object.assign(hit, { n: 0, until: Date.now() + 3600e3 });
    if (hit.n >= 5) return res.json(generic);
    hit.n += 1;
    resetHits.set(ip, hit);
    const low = ident.toLowerCase();
    const user =
      (await db("users").where({ is_active: true }).whereRaw("LOWER(username) = ?", [low]).first()) ||
      (await db("users").where({ is_active: true }).whereRaw("LOWER(email) = ?", [low]).first());
    if (user && user.email) {
      const uid = Buffer.from(String(user.id)).toString("base64url");
      const link = `${config.APP_BASE_URL}/reset-password?uid=${uid}&token=${resetToken(user)}`;
      sendMail(
        user.email,
        "Reset your CreativHeads Casting Manager password",
        `Hi ${displayName(user)},\n\nUse this link within one hour to set a new password:\n${link}\n\nIf you didn't ask for this, ignore this email and tell your administrator.`,
      ).catch((e) => console.error("Reset email failed", e.message));
      await audit.log(null, "auth.password_reset_requested", { entityType: "user", entityId: user.id, label: user.username, message: `IP ${ip}` });
    }
    res.json(generic);
  }));

  r.post("/auth/password/reset/confirm", wrap(async (req, res) => {
    let user = null;
    try {
      const id = Number(Buffer.from(String(req.body.uid || ""), "base64url").toString());
      if (id) user = await db("users").where({ id, is_active: true }).first();
    } catch {
      user = null;
    }
    if (!user || !checkResetToken(user, String(req.body.token || ""))) {
      throw new HttpError(400, "This reset link is invalid or has expired. Please request a new one.", "invalid");
    }
    const pw = String(req.body.new_password || "");
    checkPassword(pw, user, "new_password");
    await db("users").where({ id: user.id }).update({ password_hash: hash(pw) });
    await db("sessions").where({ user_id: user.id }).del();
    await audit.log(null, "auth.password_reset_completed", { entityType: "user", entityId: user.id, label: user.username });
    res.json({ ok: true, detail: "Password updated. You can sign in now." });
  }));

  // ------------------------------------------------ staff administration
  r.get("/auth/staff", wrap(async (req, res) => {
    requireSuperuser(req);
    res.json((await db("users").orderBy("username")).map(staffPayload));
  }));

  r.post("/auth/staff", wrap(async (req, res) => {
    requireSuperuser(req);
    const b = req.body;
    const username = String(b.username || "").trim();
    const errors = {};
    if (!username) errors.username = ["This field is required."];
    else if (!/^[\w.@+-]{1,150}$/.test(username)) errors.username = ["Use letters, numbers and @/./+/-/_ only."];
    else if (await db("users").whereRaw("LOWER(username) = ?", [username.toLowerCase()]).first()) errors.username = ["A user with that username already exists."];
    if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) errors.email = ["Enter a valid email address."];
    if (Object.keys(errors).length) throw new ValidationError(errors);
    const row = {
      username,
      first_name: String(b.first_name || "").trim(),
      last_name: String(b.last_name || "").trim(),
      email: String(b.email || "").trim(),
      is_active: b.is_active === undefined ? true : bool(b.is_active),
      is_superuser: false,
      can_manage_backups: false,
      date_joined: nowDb(),
    };
    checkPassword(String(b.password || ""), row, "password");
    row.password_hash = hash(String(b.password));
    const [id] = await db("users").insert(row);
    const user = await db("users").where({ id: Number(id) || (await db("users").where({ username }).first()).id }).first();
    await audit.log(req, "user.created", { entityType: "user", entityId: user.id, label: user.username });
    res.status(201).json(staffPayload(user));
  }));

  r.patch("/auth/staff/:id", wrap(async (req, res) => {
    requireSuperuser(req);
    const user = await db("users").where({ id: req.params.id }).first();
    if (!user) throw notFound();
    const b = req.body;
    if (user.id === req.user.id && b.is_active === false) throw new HttpError(400, "You can't deactivate your own account.", "invalid");
    if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) throw new ValidationError({ email: "Enter a valid email address." });
    const fields = ["first_name", "last_name", "email", "is_active"];
    const before = audit.snapshot({ ...user, is_active: bool(user.is_active) }, fields);
    const upd = {};
    for (const f of ["first_name", "last_name", "email"]) if (f in b) upd[f] = String(b[f] || "").trim();
    if ("is_active" in b) upd.is_active = bool(b.is_active);
    if (b.password) {
      checkPassword(String(b.password), { ...user, ...upd }, "password");
      upd.password_hash = hash(String(b.password));
    }
    if (Object.keys(upd).length) await db("users").where({ id: user.id }).update(upd);
    const after = await db("users").where({ id: user.id }).first();
    const label = after.username;
    if (b.password) await audit.log(req, "user.password_reset_by_admin", { entityType: "user", entityId: user.id, label });
    const changes = audit.diff(before, audit.snapshot({ ...after, is_active: bool(after.is_active) }, fields));
    if ("is_active" in changes) {
      await audit.log(req, bool(after.is_active) ? "user.reactivated" : "user.deactivated", { entityType: "user", entityId: user.id, label });
      if (!bool(after.is_active)) await db("sessions").where({ user_id: user.id }).del();
    }
    if (Object.keys(changes).length) await audit.log(req, "user.updated", { entityType: "user", entityId: user.id, label, changes });
    res.json(staffPayload(after));
  }));
};

module.exports.displayName = displayName;
module.exports.hash = hash;
module.exports.passwordErrors = passwordErrors;
