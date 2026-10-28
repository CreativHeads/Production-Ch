// Creates every table on first boot (idempotent), then seeds default
// taxonomy, settings and an optional bootstrap administrator.
const bcrypt = require("bcryptjs");
const config = require("./config");
const { db, isMysql, nowDb, slugify, toJson } = require("./db");
const { DEFAULT_COMPLETENESS_FIELDS } = require("./choices");

const DT = 26; // "YYYY-MM-DD HH:MM:SS.mmm"

function stamps(t) {
  t.string("created_at", DT);
  t.string("updated_at", DT);
  t.integer("created_by").unsigned().nullable();
  t.integer("updated_by").unsigned().nullable();
}

const TABLES = {
  users(t) {
    t.increments("id");
    t.string("username", 150).notNullable().unique();
    t.string("password_hash", 128).notNullable();
    t.string("first_name", 150).defaultTo("");
    t.string("last_name", 150).defaultTo("");
    t.string("email", 254).defaultTo("");
    t.boolean("is_active").defaultTo(true);
    t.boolean("is_superuser").defaultTo(false);
    t.boolean("can_manage_backups").defaultTo(false);
    t.string("last_login", DT).nullable();
    t.string("date_joined", DT);
  },
  sessions(t) {
    t.string("sid", 128).primary();
    t.text("sess", "mediumtext").notNullable();
    t.bigInteger("expires").notNullable().index();
    t.integer("user_id").unsigned().nullable().index();
  },
  system_settings(t) {
    t.integer("id").primary();
    t.decimal("session_idle_hours", 5, 2).defaultTo(8);
    t.integer("review_interval_days").defaultTo(180);
    t.integer("contact_review_interval_days").defaultTo(180);
    t.integer("export_expiry_hours").defaultTo(24);
    t.text("completeness_fields");
    t.boolean("require_consent_for_all").defaultTo(true);
    t.string("default_currency", 3).defaultTo("INR");
    t.string("default_country_code", 4).defaultTo("91");
    t.text("whatsapp_template");
    t.string("studio_name", 120).defaultTo("TakeBoard Studio");
    t.string("studio_location", 120).defaultTo("Kottakkal, Kerala");
    t.string("updated_at", DT);
  },
  sequences(t) {
    t.string("name", 32).primary();
    t.bigInteger("value").defaultTo(0);
  },
  audit_log(t) {
    t.increments("id");
    t.string("created_at", DT).index();
    t.integer("actor_id").unsigned().nullable();
    t.string("actor_name", 150).defaultTo("");
    t.string("action", 64).index();
    t.string("entity_type", 64).defaultTo("");
    t.string("entity_id", 64).defaultTo("");
    t.string("entity_label", 255).defaultTo("");
    t.text("changes", "mediumtext");
    t.text("message");
    t.string("ip_address", 64).nullable();
    t.string("user_agent", 255).defaultTo("");
    t.index(["entity_type", "entity_id"]);
  },
  terms(t) {
    t.increments("id");
    t.string("kind", 16).index();
    t.string("name", 80);
    t.string("slug", 90);
    t.string("description", 255).defaultTo("");
    t.string("color", 16).defaultTo("");
    t.integer("sort_order").defaultTo(0);
    t.boolean("is_archived").defaultTo(false);
    t.integer("merged_into_id").unsigned().nullable();
    t.string("system_key", 32).defaultTo("");
    stamps(t);
    t.unique(["kind", "slug"]);
  },
  talent(t) {
    t.increments("id");
    t.string("cast_id", 20).unique();
    t.string("talent_type", 20).defaultTo("cast").index();
    t.string("social_reach", 80).defaultTo("");
    t.string("influencer_niche", 120).defaultTo("");
    t.string("primary_platform", 40).defaultTo("Instagram");
    t.integer("version").defaultTo(1);
    t.string("status", 16).defaultTo("needs_details").index();
    t.boolean("is_archived").defaultTo(false).index();
    t.string("archived_at", DT).nullable();
    t.string("archive_reason", 255).defaultTo("");
    t.string("full_name", 150);
    t.string("name_normalized", 150).index();
    t.string("screen_name", 150).defaultTo("");
    t.string("gender", 16).defaultTo("");
    t.string("date_of_birth", 10).nullable();
    t.boolean("age_verified").defaultTo(false);
    t.integer("approx_age").nullable();
    t.integer("playing_age_min").nullable();
    t.integer("playing_age_max").nullable();
    t.integer("height_cm").nullable();
    t.integer("weight_kg").nullable();
    t.text("measurements");
    t.string("complexion", 40).defaultTo("");
    t.string("hair", 60).defaultTo("");
    t.string("eye_color", 30).defaultTo("");
    t.text("appearance_notes");
    t.string("phone", 32);
    t.string("phone_normalized", 20).index();
    t.string("alt_phone", 32).defaultTo("");
    t.string("alt_phone_normalized", 20).defaultTo("").index();
    t.string("whatsapp_phone", 32).defaultTo("");
    t.string("email", 254).defaultTo("");
    t.string("instagram", 200).defaultTo("");
    t.string("instagram_normalized", 60).defaultTo("").index();
    t.text("address");
    t.string("city", 80).index();
    t.string("district", 80).defaultTo("");
    t.string("state", 80).defaultTo("Kerala");
    t.string("country", 60).defaultTo("India");
    t.string("contact_verified_at", DT).nullable();
    t.string("experience_level", 16).defaultTo("");
    t.text("experience_summary");
    t.decimal("expected_fee", 12, 2).nullable();
    t.decimal("expected_fee_max", 12, 2).nullable();
    t.boolean("fee_unknown").defaultTo(false);
    t.string("fee_type", 16).defaultTo("");
    t.string("currency", 3).defaultTo("INR");
    t.boolean("fee_negotiable").nullable();
    t.string("fee_notes", 255).defaultTo("");
    t.string("rates_reviewed_at", DT).nullable();
    t.string("travel_willingness", 16).defaultTo("");
    t.boolean("has_passport").nullable();
    t.text("travel_notes");
    t.text("internal_notes");
    t.boolean("child_safety_verified").defaultTo(false);
    t.string("child_safety_verified_at", DT).nullable();
    t.text("child_safety_notes");
    t.boolean("consent_hold").defaultTo(false);
    t.integer("completeness").defaultTo(0).index();
    t.text("missing_fields");
    t.string("deleted_at", DT).nullable().index();
    t.integer("deleted_by").unsigned().nullable();
    stamps(t);
  },
  talent_categories: (t) => link(t, "talent_id", "term_id"),
  talent_tags: (t) => link(t, "talent_id", "term_id"),
  talent_skills: (t) => link(t, "talent_id", "term_id"),
  talent_languages(t) {
    t.increments("id");
    t.integer("talent_id").unsigned().index();
    t.integer("language_id").unsigned().index();
    t.string("fluency", 16).defaultTo("");
    t.string("accents", 200).defaultTo("");
    t.boolean("can_dub").defaultTo(false);
    t.unique(["talent_id", "language_id"]);
  },
  talent_photos(t) {
    t.increments("id");
    t.integer("talent_id").unsigned().index();
    t.string("master", 255).defaultTo("");
    t.string("profile", 255);
    t.string("card", 255);
    t.string("thumb", 255);
    t.integer("width").defaultTo(0);
    t.integer("height").defaultTo(0);
    t.string("label", 120).defaultTo("");
    t.boolean("is_primary").defaultTo(false);
    t.boolean("is_outdated").defaultTo(false);
    t.string("taken_on", 10).nullable();
    t.integer("sort_order").defaultTo(0);
    stamps(t);
  },
  featured_videos(t) {
    t.increments("id");
    t.integer("talent_id").unsigned().index();
    t.integer("position");
    t.string("title", 150);
    t.string("platform", 16).defaultTo("youtube");
    t.string("url", 500).defaultTo("");
    t.string("file", 255).defaultTo("");
    t.text("description");
    t.string("thumbnail_url", 500).defaultTo("");
    stamps(t);
    t.unique(["talent_id", "position"]);
  },
  portfolio_links(t) {
    t.increments("id");
    t.integer("talent_id").unsigned().index();
    t.string("title", 150);
    t.string("url", 500);
    t.string("kind", 30).defaultTo("");
    stamps(t);
  },
  favorites(t) {
    t.increments("id");
    t.integer("user_id").unsigned();
    t.integer("talent_id").unsigned().index();
    t.string("created_at", DT);
    t.unique(["user_id", "talent_id"]);
  },
  contact_notes(t) {
    t.increments("id");
    t.integer("talent_id").unsigned().index();
    t.string("kind", 16).defaultTo("note");
    t.string("result", 16).defaultTo("");
    t.text("content");
    t.integer("staff_id").unsigned().nullable();
    t.string("interaction_at", DT).index();
    t.integer("project_id").unsigned().nullable();
    t.string("follow_up_on", 10).nullable().index();
    t.boolean("follow_up_done").defaultTo(false);
    stamps(t);
  },
  guardians(t) {
    t.increments("id");
    t.integer("talent_id").unsigned().index();
    t.string("name", 150);
    t.string("relationship", 40);
    t.string("phone", 32);
    t.string("alt_phone", 32).defaultTo("");
    t.string("email", 254).defaultTo("");
    t.text("address");
    t.boolean("id_verified").defaultTo(false);
    t.boolean("is_primary").defaultTo(true);
    t.text("notes");
    stamps(t);
  },
  consents(t) {
    t.increments("id");
    t.integer("talent_id").unsigned().index();
    t.string("consent_type", 20);
    t.string("status", 12).defaultTo("pending");
    t.string("obtained_on", 10).nullable();
    t.string("method", 16).defaultTo("");
    t.string("evidence", 255).defaultTo("");
    t.text("scope");
    t.string("given_by", 150).defaultTo("");
    t.string("expires_on", 10).nullable();
    t.string("withdrawn_on", 10).nullable();
    t.text("notes");
    stamps(t);
  },
  retention_reviews(t) {
    t.increments("id");
    t.integer("talent_id").unsigned().index();
    t.integer("consent_id").unsigned().nullable();
    t.string("reason", 255);
    t.string("status", 12).defaultTo("open");
    t.string("due_on", 10);
    t.text("resolution_notes");
    t.string("resolved_at", DT).nullable();
    t.integer("resolved_by").unsigned().nullable();
    stamps(t);
  },
  projects(t) {
    t.increments("id");
    t.string("title", 200);
    t.string("client_name", 200).defaultTo("");
    t.string("code", 30).unique();
    t.text("description");
    t.string("production_type", 20).defaultTo("ad_film");
    t.string("shoot_start", 10).nullable();
    t.string("shoot_end", 10).nullable();
    t.string("location", 200).defaultTo("");
    t.decimal("budget", 14, 2).nullable();
    t.string("currency", 3).defaultTo("INR");
    t.string("status", 16).defaultTo("draft").index();
    t.text("notes");
    t.string("deleted_at", DT).nullable().index();
    t.integer("deleted_by").unsigned().nullable();
    stamps(t);
  },
  roles(t) {
    t.increments("id");
    t.integer("project_id").unsigned().index();
    t.string("name", 150);
    t.text("description");
    t.integer("positions_needed").defaultTo(1);
    t.string("gender_preference", 12).defaultTo("any");
    t.integer("age_min").nullable();
    t.integer("age_max").nullable();
    t.string("accent_requirements", 200).defaultTo("");
    t.string("location", 150).defaultTo("");
    t.string("travel_requirement", 16).defaultTo("");
    t.string("travel_notes", 255).defaultTo("");
    t.decimal("budget", 12, 2).nullable();
    t.string("fee_basis", 16).defaultTo("");
    t.string("shoot_start", 10).nullable();
    t.string("shoot_end", 10).nullable();
    t.text("notes");
    t.integer("sort_order").defaultTo(0);
    stamps(t);
  },
  role_languages: (t) => link(t, "role_id", "term_id"),
  role_categories: (t) => link(t, "role_id", "term_id"),
  role_tags: (t) => link(t, "role_id", "term_id"),
  role_skills: (t) => link(t, "role_id", "term_id"),
  shortlist_entries(t) {
    t.increments("id");
    t.integer("role_id").unsigned().index();
    t.integer("talent_id").unsigned().index();
    t.integer("priority").defaultTo(0);
    t.string("status", 12).defaultTo("shortlisted");
    t.text("notes");
    t.decimal("proposed_fee", 12, 2).nullable();
    t.string("fee_basis", 16).defaultTo("");
    t.boolean("availability_confirmed").defaultTo(false);
    t.string("availability_confirmed_at", DT).nullable();
    t.string("availability_notes", 255).defaultTo("");
    t.boolean("is_removed").defaultTo(false);
    t.string("removed_at", DT).nullable();
    t.string("removed_reason", 255).defaultTo("");
    stamps(t);
    t.unique(["role_id", "talent_id"]);
  },
  shortlist_events(t) {
    t.increments("id");
    t.integer("entry_id").unsigned().index();
    t.string("action", 24);
    t.string("from_value", 120).defaultTo("");
    t.string("to_value", 120).defaultTo("");
    t.text("note");
    t.integer("actor_id").unsigned().nullable();
    t.string("created_at", DT);
  },
  availability(t) {
    t.increments("id");
    t.integer("talent_id").unsigned().index();
    t.string("start", DT).index();
    t.string("end", DT).index();
    t.string("kind", 20);
    t.string("confirmed_at", DT).nullable();
    t.string("source", 12).defaultTo("");
    t.text("notes");
    t.integer("booking_id").unsigned().nullable().unique();
    t.integer("project_id").unsigned().nullable();
    stamps(t);
  },
  bookings(t) {
    t.increments("id");
    t.integer("project_id").unsigned().index();
    t.integer("role_id").unsigned().index();
    t.integer("talent_id").unsigned().index();
    t.integer("shortlist_entry_id").unsigned().nullable();
    t.string("shoot_start", DT);
    t.string("shoot_end", DT);
    t.text("schedule_notes");
    t.string("status", 12).defaultTo("tentative").index();
    t.decimal("proposed_fee", 12, 2).nullable();
    t.decimal("agreed_fee", 12, 2).nullable();
    t.string("fee_basis", 16).defaultTo("");
    t.string("currency", 3).defaultTo("INR");
    t.decimal("travel_charges", 12, 2).nullable();
    t.decimal("accommodation_charges", 12, 2).nullable();
    t.string("other_charges_notes", 255).defaultTo("");
    t.string("confirmed_at", DT).nullable();
    t.string("confirmation_source", 12).defaultTo("");
    t.text("confirmation_notes");
    t.string("outcome", 20).defaultTo("pending");
    t.string("completed_on", 10).nullable();
    t.string("deliverable_url", 500).defaultTo("");
    t.boolean("conflict_override").defaultTo(false);
    t.text("override_reason");
    t.integer("override_by").unsigned().nullable();
    t.string("override_at", DT).nullable();
    stamps(t);
  },
  import_batches(t) {
    t.increments("id");
    t.string("created_at", DT);
    t.integer("created_by").unsigned().nullable();
    t.string("original_name", 255);
    t.string("file", 255);
    t.string("photos_zip", 255).defaultTo("");
    t.text("headers", "mediumtext");
    t.text("mapping");
    t.string("status", 12).defaultTo("uploaded");
    t.integer("total_rows").defaultTo(0);
    t.text("summary");
    t.text("error");
    t.string("completed_at", DT).nullable();
  },
  import_rows(t) {
    t.increments("id");
    t.integer("batch_id").unsigned().index();
    t.integer("row_number");
    t.text("raw", "mediumtext");
    t.text("data", "mediumtext");
    t.text("errors");
    t.text("warnings");
    t.text("duplicates");
    t.string("action", 10).defaultTo("create");
    t.boolean("duplicate_acknowledged").defaultTo(false);
    t.string("result", 20).defaultTo("");
    t.string("result_message", 255).defaultTo("");
    t.integer("talent_id").unsigned().nullable();
  },
  export_jobs(t) {
    t.increments("id");
    t.string("created_at", DT);
    t.integer("created_by").unsigned().nullable();
    t.string("format", 8);
    t.text("params");
    t.boolean("include_internal").defaultTo(false);
    t.string("file", 255).defaultTo("");
    t.string("filename", 200).defaultTo("");
    t.integer("row_count").defaultTo(0);
    t.string("expires_at", DT);
    t.integer("download_count").defaultTo(0);
    t.string("last_downloaded_at", DT).nullable();
    t.boolean("purged").defaultTo(false);
  },
};

function link(t, a, b) {
  t.integer(a).unsigned().notNullable();
  t.integer(b).unsigned().notNullable().index();
  t.primary([a, b]);
}

// ---------------------------------------------------------------- seed data
const CATEGORIES = [
  ["Actor", ""], ["Model", ""], ["Influencer", "influencer"], ["Content Creator", "creator"], ["Child Artist", "child"], ["Senior Artist", ""], ["Supporting Artist", ""],
  ["Extra", ""], ["Voice Artist", ""], ["Presenter", ""], ["Dancer", ""], ["Anchor", ""],
];
const TAGS = [
  "Father Role", "Mother Role", "Corporate Look", "Comedy", "Emotional Acting", "Strong Dialogue Delivery",
  "Natural Malayalam Accent", "Experienced in Advertisements", "Village Look", "Urban Look", "Doctor Look", "Police Look",
  "Student Look", "Grandparent Role", "Fitness Look",
];
const SKILLS = [
  "Dialogue delivery", "Improvisation", "Classical dance", "Contemporary dance", "Singing", "Dubbing", "Swimming", "Driving (car)",
  "Riding (two-wheeler)", "Martial arts", "Horse riding", "Musical instrument", "Mimicry", "Anchoring", "Ramp walk",
];
const LANGUAGES = ["Malayalam", "English", "Tamil", "Hindi", "Kannada", "Telugu", "Arabic", "Urdu", "Tulu", "Konkani"];

async function seedDefaults() {
  const now = nowDb();
  const ensure = async (kind, name, i, systemKey = "") => {
    const slug = slugify(name);
    const row = await db("terms").where({ kind, slug }).first();
    if (!row) {
      await db("terms").insert({ kind, name, slug, sort_order: i, system_key: systemKey, created_at: now, updated_at: now, description: "", color: "" });
    } else if (systemKey && row.system_key !== systemKey) {
      await db("terms").where({ id: row.id }).update({ system_key: systemKey });
    }
  };
  for (const [i, [name, key]] of CATEGORIES.entries()) await ensure("category", name, i, key);
  for (const [kind, names] of [["tag", TAGS], ["skill", SKILLS], ["language", LANGUAGES]]) {
    for (const [i, name] of names.entries()) await ensure(kind, name, i);
  }
  if (!(await db("system_settings").where({ id: 1 }).first())) {
    await db("system_settings").insert({
      id: 1,
      completeness_fields: toJson(DEFAULT_COMPLETENESS_FIELDS),
      whatsapp_template: "Hi {first_name}, this is {staff_name} from TakeBoard by CreativHeads. We have a casting opportunity you may be interested in.",
      updated_at: now,
    });
  }
  const admin = config.BOOTSTRAP_ADMIN;
  const users = await db("users").count({ n: "*" }).first();
  if (Number(users.n) === 0 && admin.username && admin.password) {
    const [first, ...rest] = (admin.name || "").split(" ");
    await db("users").insert({
      username: admin.username,
      password_hash: bcrypt.hashSync(admin.password, 12),
      first_name: first || "",
      last_name: rest.join(" "),
      email: admin.email || "",
      is_active: true,
      is_superuser: true,
      can_manage_backups: true,
      date_joined: now,
    });
    console.log(`Created administrator account "${admin.username}".`);
  }
}

// Columns added after the first release; created on existing databases.
const ADDED_COLUMNS = [
  ["system_settings", "studio_name", (t) => t.string("studio_name", 120).defaultTo("TakeBoard Studio")],
  ["system_settings", "studio_location", (t) => t.string("studio_location", 120).defaultTo("Kottakkal, Kerala")],
  ["talent", "talent_type", (t) => t.string("talent_type", 20).defaultTo("cast").index()],
  ["talent", "social_reach", (t) => t.string("social_reach", 80).defaultTo("")],
  ["talent", "influencer_niche", (t) => t.string("influencer_niche", 120).defaultTo("")],
  ["talent", "primary_platform", (t) => t.string("primary_platform", 40).defaultTo("Instagram")],
];

async function ensureSchema() {
  for (const [name, build] of Object.entries(TABLES)) {
    if (!(await db.schema.hasTable(name))) {
      await db.schema.createTable(name, (t) => {
        build(t);
        if (isMysql) t.charset("utf8mb4");
      });
    }
  }
  for (const [table, column, build] of ADDED_COLUMNS) {
    if (!(await db.schema.hasColumn(table, column))) await db.schema.alterTable(table, build);
  }
  await seedDefaults();
}

module.exports = { ensureSchema };
