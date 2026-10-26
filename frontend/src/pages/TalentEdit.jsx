import { useEffect, useMemo, useState } from "react";
import DuplicateDialog from "../components/DuplicateDialog";
import { PageHead } from "../components/Layout";
import { Alert, Button, Check, ErrorBox, Icon, IconButton, Select, Spinner, TermPicker, TextArea, TextInput, TriState } from "../components/ui";
import { api } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { useNavigate, useParams } from "../lib/router";

const NUMBER = ["approx_age", "playing_age_min", "playing_age_max", "height_cm", "weight_kg", "expected_fee", "expected_fee_max"];
const DATES = ["date_of_birth"];
const SCALARS = [
  "full_name", "screen_name", "gender", "date_of_birth", "age_verified", "approx_age", "playing_age_min", "playing_age_max", "height_cm", "weight_kg",
  "complexion", "hair", "eye_color", "appearance_notes", "phone", "alt_phone", "whatsapp_phone", "email", "instagram", "address", "city", "district",
  "state", "country", "experience_level", "experience_summary", "expected_fee", "expected_fee_max", "fee_unknown", "fee_type", "currency",
  "fee_negotiable", "fee_notes", "travel_willingness", "has_passport", "travel_notes", "internal_notes", "child_safety_verified", "child_safety_notes",
];
const MEASURES = [
  ["chest", "Chest / bust"],
  ["waist", "Waist"],
  ["hips", "Hips"],
  ["shoulder", "Shoulder"],
  ["inseam", "Inseam"],
  ["shirt", "Shirt size"],
  ["trouser", "Trouser size"],
  ["dress", "Dress size"],
  ["shoe", "Shoe size (UK)"],
  ["head", "Head"],
];

function toForm(t) {
  const f = {};
  SCALARS.forEach((k) => (f[k] = t[k] ?? (typeof t[k] === "boolean" ? false : "")));
  ["age_verified", "fee_unknown", "child_safety_verified"].forEach((k) => (f[k] = !!t[k]));
  f.fee_negotiable = t.fee_negotiable;
  f.has_passport = t.has_passport;
  f.categories = t.categories.map((c) => c.id);
  f.tags = t.tags.map((c) => c.id);
  f.skills = t.skills.map((c) => c.id);
  f.languages = t.languages.map((l) => ({ language: l.language, fluency: l.fluency, accents: l.accents, can_dub: l.can_dub }));
  f.measurements = { ...(t.measurements || {}) };
  return f;
}

function normalize(k, v) {
  if (NUMBER.includes(k) || DATES.includes(k)) return v === "" || v === undefined ? null : v;
  return v;
}

export default function TalentEdit() {
  const { id } = useParams();
  const { meta, terms, toast, loadTerms } = useApp();
  const navigate = useNavigate();
  const { data: t, error, loading, reload } = useLoad(() => api.get(`talent/${id}/`), [id]);
  const original = useMemo(() => (t ? toForm(t) : null), [t]);
  const [f, setF] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [dups, setDups] = useState(null);

  useEffect(() => {
    if (original) setF(original);
  }, [original]);
  const dirty = useMemo(() => {
    if (!f || !original) return {};
    const d = {};
    Object.keys(f).forEach((k) => {
      if (JSON.stringify(f[k]) !== JSON.stringify(original[k])) d[k] = normalize(k, f[k]);
    });
    return d;
  }, [f, original]);
  const dirtyCount = Object.keys(dirty).length;

  useEffect(() => {
    const warn = (e) => {
      if (dirtyCount) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  if (loading && !t) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!f) return null;

  const upd = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const err = (k) => errors[k];

  const save = async (ack = []) => {
    if (!dirtyCount) return navigate(`/talent/${t.id}`);
    setBusy(true);
    setMsg("");
    setErrors({});
    try {
      const body = { ...dirty, version: t.version };
      if (dirty.languages) body.languages = f.languages.filter((l) => l.language);
      if (ack.length) body.acknowledge_duplicates = ack;
      await api.patch(`talent/${t.id}/`, body);
      toast("Profile saved");
      setF(null);
      navigate(`/talent/${t.id}`);
    } catch (e) {
      if (e.code === "duplicate") setDups(e.body.duplicates);
      else {
        setErrors(Object.fromEntries(Object.entries(e.errors || {}).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") : String(v)])));
        setMsg(e.message);
        window.scrollTo(0, 0);
      }
    } finally {
      setBusy(false);
    }
  };

  const createTerm = (kind) => async (name) => {
    try {
      const term = await api.post("terms/", { kind, name });
      await loadTerms();
      return term;
    } catch (e) {
      toast(e.message, "error");
      return null;
    }
  };

  const isChild = t.is_child || f.categories.some((cid) => terms.category.find((c) => c.id === cid)?.system_key === "child");
  const opts = (k) => (meta ? meta[k] : []);

  return (
    <div className="edit-page">
      <PageHead title={`Edit ${t.full_name}`} subtitle={t.cast_id} back={{ to: `/talent/${t.id}`, label: "Profile" }} />
      {msg && <Alert kind="error">{msg}</Alert>}
      <form
        className="edit-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <nav className="edit-nav" aria-label="Sections">
          {["Personal", "Appearance", "Contact", "Categories & skills", "Languages", "Rates & travel", "Internal", ...(isChild ? ["Child safety"] : [])].map((s) => (
            <a key={s} href={`#sec-${s.replace(/\W+/g, "-")}`}>{s}</a>
          ))}
        </nav>
        <div className="edit-sections">
          <fieldset id="sec-Personal" className="panel">
            <legend>Personal</legend>
            <div className="grid-2">
              <TextInput label="Full name" required value={f.full_name} onChange={upd("full_name")} error={err("full_name")} />
              <TextInput label="Screen / stage name" value={f.screen_name} onChange={upd("screen_name")} />
              <Select label="Gender" value={f.gender} onChange={upd("gender")} options={opts("gender")} error={err("gender")} />
              <TextInput label="Date of birth" type="date" value={f.date_of_birth} onChange={upd("date_of_birth")} error={err("date_of_birth")} />
              <TextInput label="Approximate age" type="number" min="0" max="120" value={f.approx_age} onChange={upd("approx_age")} hint="If date of birth isn't known" />
              <div className="pair">
                <TextInput label="Playing age from" type="number" min="0" max="120" value={f.playing_age_min} onChange={upd("playing_age_min")} error={err("playing_age_min")} />
                <TextInput label="to" type="number" min="0" max="120" value={f.playing_age_max} onChange={upd("playing_age_max")} error={err("playing_age_max")} />
              </div>
            </div>
            <Check label="Age verified from a document" checked={f.age_verified} onChange={upd("age_verified")} />
          </fieldset>

          <fieldset id="sec-Appearance" className="panel">
            <legend>Appearance</legend>
            <div className="grid-3">
              <TextInput label="Height (cm)" type="number" min="30" max="260" value={f.height_cm} onChange={upd("height_cm")} error={err("height_cm")} />
              <TextInput label="Weight (kg)" type="number" value={f.weight_kg} onChange={upd("weight_kg")} />
              <TextInput label="Complexion" value={f.complexion} onChange={upd("complexion")} />
              <TextInput label="Hair" value={f.hair} onChange={upd("hair")} placeholder="e.g. Long, curly, black" />
              <TextInput label="Eyes" value={f.eye_color} onChange={upd("eye_color")} />
            </div>
            <TextArea label="Appearance notes" value={f.appearance_notes} onChange={upd("appearance_notes")} placeholder="Beard, tattoos, distinctive features, looks they can carry" />
            <details className="measures" open={Object.values(f.measurements).some(Boolean)}>
              <summary>Costume measurements (optional)</summary>
              <div className="grid-3">
                {MEASURES.map(([k, label]) => (
                  <TextInput key={k} label={label} value={f.measurements[k] || ""} onChange={(v) => setF((s) => ({ ...s, measurements: { ...s.measurements, [k]: v } }))} />
                ))}
              </div>
            </details>
          </fieldset>

          <fieldset id="sec-Contact" className="panel">
            <legend>Contact</legend>
            <div className="grid-2">
              <TextInput label="Primary phone" required type="tel" value={f.phone} onChange={upd("phone")} error={err("phone")} />
              <TextInput label="Alternate phone" type="tel" value={f.alt_phone} onChange={upd("alt_phone")} />
              <TextInput label="WhatsApp number" type="tel" value={f.whatsapp_phone} onChange={upd("whatsapp_phone")} hint="Only if different from the primary phone" />
              <TextInput label="Email" type="email" value={f.email} onChange={upd("email")} error={err("email")} />
              <TextInput label="Instagram" value={f.instagram} onChange={upd("instagram")} placeholder="@handle or profile link" />
            </div>
            <TextArea label="Address" value={f.address} onChange={upd("address")} rows={2} />
            <div className="grid-4">
              <TextInput label="City / current location" required value={f.city} onChange={upd("city")} error={err("city")} />
              <TextInput label="District" value={f.district} onChange={upd("district")} />
              <TextInput label="State" value={f.state} onChange={upd("state")} />
              <TextInput label="Country" value={f.country} onChange={upd("country")} />
            </div>
          </fieldset>

          <fieldset id="sec-Categories-skills" className="panel">
            <legend>Categories & skills</legend>
            <TermPicker label="Categories" required terms={terms.category} value={f.categories} onChange={upd("categories")} error={err("categories")} onCreate={createTerm("category")} />
            <TermPicker label="Tags" terms={terms.tag} value={f.tags} onChange={upd("tags")} onCreate={createTerm("tag")} />
            <TermPicker label="Skills" terms={terms.skill} value={f.skills} onChange={upd("skills")} onCreate={createTerm("skill")} />
            <Select label="Experience level" value={f.experience_level} onChange={upd("experience_level")} options={opts("experience")} />
            <TextArea label="Acting experience & credits" value={f.experience_summary} onChange={upd("experience_summary")} rows={4} />
          </fieldset>

          <fieldset id="sec-Languages" className="panel">
            <legend>Languages & accents</legend>
            {err("languages") && <Alert kind="error">{err("languages")}</Alert>}
            {f.languages.map((l, i) => (
              <div className="lang-row" key={i}>
                <Select label="Language" value={l.language} onChange={(v) => setF((s) => ({ ...s, languages: s.languages.map((x, j) => (j === i ? { ...x, language: Number(v) || "" } : x)) }))} options={terms.language.map((x) => ({ value: x.id, label: x.name }))} />
                <Select label="Fluency" value={l.fluency} onChange={(v) => setF((s) => ({ ...s, languages: s.languages.map((x, j) => (j === i ? { ...x, fluency: v } : x)) }))} options={opts("fluency")} />
                <TextInput label="Accents / dialects" value={l.accents} onChange={(v) => setF((s) => ({ ...s, languages: s.languages.map((x, j) => (j === i ? { ...x, accents: v } : x)) }))} placeholder="Malabar, Thrissur, Kottayam" />
                <Check label="Can dub" checked={l.can_dub} onChange={(v) => setF((s) => ({ ...s, languages: s.languages.map((x, j) => (j === i ? { ...x, can_dub: v } : x)) }))} />
                <IconButton icon="x" label="Remove language" onClick={() => setF((s) => ({ ...s, languages: s.languages.filter((_, j) => j !== i) }))} />
              </div>
            ))}
            <Button size="sm" icon="plus" onClick={() => setF((s) => ({ ...s, languages: [...s.languages, { language: "", fluency: "", accents: "", can_dub: false }] }))}>Add language</Button>
          </fieldset>

          <fieldset id="sec-Rates-travel" className="panel">
            <legend>Rates & travel</legend>
            <div className="grid-3">
              <TextInput label="Expected fee (₹)" type="number" min="0" value={f.expected_fee} onChange={upd("expected_fee")} disabled={f.fee_unknown} error={err("expected_fee")} />
              <TextInput label="Up to (₹, optional)" type="number" min="0" value={f.expected_fee_max} onChange={upd("expected_fee_max")} disabled={f.fee_unknown} error={err("expected_fee_max")} />
              <Select label="Fee type" value={f.fee_type} onChange={upd("fee_type")} options={opts("fee_type")} />
              <TriState label="Negotiable" value={f.fee_negotiable} onChange={upd("fee_negotiable")} />
            </div>
            <Check label="Fee is unknown" hint="Counts as answered for profile completeness." checked={f.fee_unknown} onChange={upd("fee_unknown")} />
            <TextInput label="Fee notes" value={f.fee_notes} onChange={upd("fee_notes")} placeholder="e.g. Higher rate for overnight shoots" />
            <p className="muted small">
              <Icon name="alert" size={14} /> Changing the expected fee never changes fees already agreed on bookings.
            </p>
            <div className="grid-2">
              <Select label="Willing to travel" value={f.travel_willingness} onChange={upd("travel_willingness")} options={opts("travel")} />
              <TriState label="Has a passport" value={f.has_passport} onChange={upd("has_passport")} />
            </div>
            <TextArea label="Travel preferences" value={f.travel_notes} onChange={upd("travel_notes")} rows={2} placeholder="Needs accommodation, travels with a companion, available weekends only…" />
          </fieldset>

          <fieldset id="sec-Internal" className="panel panel-internal">
            <legend>Internal performance notes</legend>
            <TextArea label="Notes for the casting team" value={f.internal_notes} onChange={upd("internal_notes")} rows={4} hint="Staff only; never included in client exports." />
          </fieldset>

          {isChild && (
            <fieldset id="sec-Child-safety" className="panel">
              <legend>Child safety</legend>
              <Check label="Child-safety restrictions and production compliance verified" checked={f.child_safety_verified} onChange={upd("child_safety_verified")} />
              <TextArea label="Child-safety notes" value={f.child_safety_notes} onChange={upd("child_safety_notes")} rows={3} placeholder="Working-hour limits, chaperone, permits checked…" />
              <p className="muted small">Guardian details and guardian consent are recorded on the profile's Consent tab.</p>
            </fieldset>
          )}
        </div>
        <div className="sticky-save">
          <span className="muted">{dirtyCount ? `${dirtyCount} unsaved change${dirtyCount === 1 ? "" : "s"}` : "No changes yet"}</span>
          <Button onClick={() => navigate(`/talent/${t.id}`)}>Cancel</Button>
          <Button type="submit" variant="primary" busy={busy} disabled={!dirtyCount}>Save changes</Button>
        </div>
      </form>
      {dups && <DuplicateDialog duplicates={dups} busy={busy} onCancel={() => setDups(null)} onContinue={(ids) => (setDups(null), save(ids))} />}
    </div>
  );
}
