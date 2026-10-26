// Provision a staff account (there is no public sign-up).
//   node scripts/create-staff.js anjali --email anjali@creativheads.com --name "Anjali Nair" --password "..."
//   node scripts/create-staff.js admin --admin --backup-operator --password "..."
const { db, nowDb } = require("../src/db");
const { ensureSchema } = require("../src/schema");
const { hash, passwordErrors } = require("../src/routes/auth");
const audit = require("../src/audit");

async function main() {
  const args = process.argv.slice(2);
  const username = args.find((a) => !a.startsWith("--"));
  const opt = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : "";
  };
  const flag = (name) => args.includes(`--${name}`);
  if (!username) throw new Error("Usage: create-staff <username> --password <pw> [--email e] [--name \"Full Name\"] [--admin] [--backup-operator]");
  await ensureSchema();
  if (await db("users").whereRaw("LOWER(username) = ?", [username.toLowerCase()]).first()) throw new Error("That username already exists.");
  const [first, ...rest] = (opt("name") || "").split(" ");
  const user = { username, email: opt("email"), first_name: first || "", last_name: rest.join(" ") };
  const password = opt("password");
  const errs = passwordErrors(password, user);
  if (errs.length) throw new Error(errs.join(" "));
  const admin = flag("admin");
  await db("users").insert({
    ...user, password_hash: hash(password), is_active: true, is_superuser: admin, can_manage_backups: admin || flag("backup-operator"), date_joined: nowDb(),
  });
  await audit.log(null, "user.created", { entityType: "user", label: username, message: "Provisioned from command line" });
  console.log(`Created ${username}`);
}

main()
  .then(() => db.destroy())
  .catch((e) => {
    console.error(e.message);
    db.destroy();
    process.exit(1);
  });
