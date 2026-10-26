// Every choice list the API validates against and /api/meta/ hands to the frontend.

const DEFAULT_COMPLETENESS_FIELDS = [
  "primary_photo", "name", "phone", "location", "category", "age", "fee", "languages", "featured_video", "consent",
];

const COMPLETENESS_LABELS = {
  primary_photo: "Primary photo",
  name: "Name",
  phone: "Phone",
  location: "Location",
  category: "Category",
  age: "Age information",
  fee: "Expected fee (or marked Unknown)",
  languages: "Languages",
  featured_video: "At least one featured video",
  consent: "Consent verification",
  gender: "Gender",
  height: "Height",
  skills: "Skills",
  instagram: "Instagram",
  experience: "Experience level",
};

const C = {
  term_kind: [["category", "Category"], ["tag", "Tag"], ["skill", "Skill"], ["language", "Language"]],
  talent_status: [["active", "Active"], ["needs_details", "Needs Details"], ["staging", "Import staging"]],
  gender: [["female", "Female"], ["male", "Male"], ["non_binary", "Non-binary"], ["other", "Other"], ["unspecified", "Prefer not to say"]],
  experience: [["fresher", "Fresher"], ["beginner", "Beginner"], ["intermediate", "Intermediate"], ["experienced", "Experienced"], ["professional", "Professional"]],
  fee_type: [["per_day", "Per day"], ["per_shoot", "Per shoot"], ["per_project", "Per project"], ["per_hour", "Per hour"]],
  travel: [["local", "Local only"], ["district", "Within district"], ["state", "Within state"], ["national", "Anywhere in India"], ["international", "International"]],
  fluency: [["native", "Native"], ["fluent", "Fluent"], ["conversational", "Conversational"], ["basic", "Basic"]],
  video_platform: [["youtube", "YouTube"], ["instagram", "Instagram"], ["vimeo", "Vimeo"], ["google_drive", "Google Drive"], ["facebook", "Facebook"], ["upload", "Uploaded file"], ["other", "Other"]],
  note_kind: [["note", "Note"], ["call", "Call"], ["whatsapp", "WhatsApp"], ["email", "Email"], ["in_person", "In Person"], ["audition", "Audition"], ["other", "Other"]],
  note_result: [["connected", "Connected"], ["no_answer", "No Answer"], ["interested", "Interested"], ["follow_up", "Follow Up"], ["declined", "Declined"], ["unavailable", "Unavailable"], ["other", "Other"]],
  consent_type: [
    ["data_storage", "Store personal details"],
    ["portfolio_use", "Use photos/videos for casting submissions"],
    ["client_sharing", "Share profile with clients"],
    ["marketing", "Use in CreativHeads marketing"],
    ["guardian", "Parent/guardian consent (minor)"],
  ],
  consent_status: [["pending", "Pending"], ["granted", "Granted"], ["refused", "Refused"], ["withdrawn", "Withdrawn"], ["expired", "Expired"]],
  consent_method: [["signed_form", "Signed form"], ["digital_form", "Digital form"], ["email", "Email"], ["whatsapp", "WhatsApp message"], ["verbal", "Verbal (recorded by staff)"], ["other", "Other"]],
  retention_status: [["open", "Open"], ["retained", "Retained (lawful basis recorded)"], ["anonymised", "Anonymised"], ["deleted", "Deleted"]],
  project_status: [["draft", "Draft"], ["casting", "Casting"], ["ready", "Ready"], ["in_production", "In Production"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["archived", "Archived"]],
  production_type: [
    ["ad_film", "Ad film / TVC"], ["feature_film", "Feature film"], ["short_film", "Short film"], ["web_series", "Web series"], ["tv", "Television"],
    ["music_video", "Music video"], ["corporate", "Corporate video"], ["photo_shoot", "Photo shoot"], ["social", "Social / influencer content"], ["event", "Event"], ["other", "Other"],
  ],
  role_gender: [["any", "Any"], ["female", "Female"], ["male", "Male"], ["non_binary", "Non-binary"], ["other", "Other"]],
  shortlist_status: [["shortlisted", "Shortlisted"], ["contacted", "Contacted"], ["interested", "Interested"], ["unavailable", "Unavailable"], ["selected", "Selected"], ["rejected", "Rejected"], ["withdrawn", "Withdrawn"]],
  availability_type: [["available", "Available"], ["unavailable", "Unavailable"], ["tentative_hold", "Tentative Hold"], ["confirmed_booking", "Confirmed Booking"]],
  availability_source: [["call", "Phone call"], ["whatsapp", "WhatsApp"], ["email", "Email"], ["in_person", "In person"], ["agent", "Agent / manager"], ["system", "Booking (system)"], ["other", "Other"]],
  booking_status: [["tentative", "Tentative hold"], ["confirmed", "Confirmed"], ["completed", "Completed"], ["cancelled", "Cancelled"]],
  booking_outcome: [
    ["pending", "Pending"], ["completed", "Shoot completed"], ["partially_completed", "Partially completed"], ["no_show", "No-show"],
    ["cancelled_client", "Cancelled by client"], ["cancelled_talent", "Cancelled by talent"], ["replaced", "Replaced"],
  ],
  fee_basis: [["per_day", "Per day"], ["per_shoot", "Per shoot"], ["per_project", "Per project"], ["per_hour", "Per hour"]],
  reminders: [
    ["incomplete", "Incomplete profiles"],
    ["rates_stale", "Rates not reviewed recently"],
    ["contact_stale", "Contact details not re-verified recently"],
    ["photo_outdated", "Photos flagged as outdated"],
    ["consent_missing", "Missing guardian / consent details"],
    ["follow_up_due", "Follow-ups due"],
    ["consent_withdrawn", "Consent withdrawn — retention review"],
  ],
  export_format: [["csv", "CSV"], ["xlsx", "Excel (XLSX)"], ["backup", "Full structured backup (ZIP)"]],
  import_action: [["create", "Create active profile"], ["staging", "Create in import staging (no photo)"], ["skip", "Skip"]],
};

const OPEN_PROJECT_STATUSES = ["draft", "casting", "ready", "in_production"];

const label = (list, value) => {
  const hit = C[list].find(([v]) => v === value);
  return hit ? hit[1] : value || "";
};
const has = (list, value) => C[list].some(([v]) => v === value);
const asOptions = (list) => C[list].map(([value, l]) => ({ value, label: l }));

module.exports = { C, DEFAULT_COMPLETENESS_FIELDS, COMPLETENESS_LABELS, OPEN_PROJECT_STATUSES, label, has, asOptions };
