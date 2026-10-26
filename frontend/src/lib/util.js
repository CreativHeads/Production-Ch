export const cx = (...a) => a.filter(Boolean).join(" ");

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function money(v, currency = "INR") {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return currency === "INR" ? `₹${inr.format(n)}` : `${currency} ${inr.format(n)}`;
}

export function feeLabel(t, meta) {
  if (t.fee_unknown) return "Fee unknown";
  if (t.expected_fee == null) return "";
  const range = t.expected_fee_max ? `${money(t.expected_fee, t.currency)}–${money(t.expected_fee_max, t.currency).replace("₹", "")}` : money(t.expected_fee, t.currency);
  const type = labelOf(meta?.fee_type, t.fee_type);
  return type ? `${range} ${type.toLowerCase()}` : range;
}

export function labelOf(list, value) {
  if (!list || !value) return "";
  const f = list.find((x) => x.value === value);
  return f ? f.label : value;
}

export function date(d, opts) {
  if (!d) return "";
  const dt = new Date(d.length === 10 ? d + "T00:00:00" : d);
  return dt.toLocaleDateString("en-IN", opts || { day: "numeric", month: "short", year: "numeric" });
}

export function dateTime(d) {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function relative(d) {
  if (!d) return "never";
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} d ago`;
  return date(d);
}

export function ageRange(t) {
  if (t.playing_age_min && t.playing_age_max) return t.playing_age_min === t.playing_age_max ? `${t.playing_age_min}` : `${t.playing_age_min}–${t.playing_age_max}`;
  return t.playing_age_min || t.playing_age_max || "";
}

export function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v) {
  return v ? new Date(v).toISOString() : null;
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function whatsappLink(digits, text) {
  if (!digits) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function fillTemplate(tpl, vars) {
  return (tpl || "").replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}

export const ACTION_LABELS = {
  "talent.created": "added talent",
  "talent.updated": "updated profile",
  "talent.archived": "archived",
  "talent.unarchived": "restored from archive",
  "talent.deleted": "moved to trash",
  "talent.restored": "restored from trash",
  "talent.note_added": "logged contact",
  "talent.photo_added": "added photos",
  "shortlist.added": "shortlisted",
  "shortlist.status": "changed shortlist status",
  "booking.created": "created booking",
  "booking.updated": "updated booking",
  "booking.cancelled": "cancelled booking",
  "booking.conflict_override": "overrode a booking conflict",
  "project.created": "created project",
  "project.updated": "updated project",
  "project.role_added": "added a role",
  "project.shortlist_added": "shortlisted for",
  "project.booking_created": "booked for",
};

export function actionLabel(a) {
  return ACTION_LABELS[a] || a.replace(/[._]/g, " ");
}
