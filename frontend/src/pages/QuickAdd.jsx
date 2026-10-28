import { useRef, useState } from "react";
import DuplicateDialog from "../components/DuplicateDialog";
import { PageHead } from "../components/Layout";
import PhotoCropper, { PhotoPicker } from "../components/PhotoCropper";
import { Alert, Button, Field, Select, TermPicker, TextInput } from "../components/ui";
import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { useNavigate } from "../lib/router";

const EMPTY = { full_name: "", phone: "", city: "", district: "", categories: [], gender: "", playing_age_min: "", playing_age_max: "", instagram: "" };

export default function QuickAdd() {
  const { meta, terms, toast } = useApp();
  const navigate = useNavigate();
  const [f, setF] = useState(EMPTY);
  const [photo, setPhoto] = useState(null);
  const [crop, setCrop] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null);
  const [dups, setDups] = useState(null);
  const [earlyDup, setEarlyDup] = useState(null);
  const pendingMode = useRef("view");
  const nameRef = useRef(null);
  const upd = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  const checkEarly = async () => {
    if (!f.phone.trim() && !f.instagram.trim()) return;
    try {
      const r = await api.post("talent/duplicate-check/", { full_name: f.full_name, phone: f.phone, instagram: f.instagram, city: f.city });
      setEarlyDup(r.duplicates.length ? r.duplicates : null);
    } catch {
      /* the save will re-check */
    }
  };

  const validate = () => {
    const e = {};
    if (!f.full_name.trim()) e.full_name = "Enter the full name.";
    if (!f.phone.trim()) e.phone = "Enter a phone number.";
    setErrors(e);
    return !Object.keys(e).length;
  };

  const save = async (mode, acknowledged = []) => {
    pendingMode.current = mode;
    if (!validate()) return;
    setBusy(mode);
    setError("");
    const fd = new FormData();
    Object.entries(f).forEach(([k, v]) => k !== "categories" && v !== "" && fd.append(k, v));
    if (f.categories && f.categories.length) fd.append("categories", JSON.stringify(f.categories));
    if (photo) fd.append("photo", photo);
    if (crop) {
      fd.append("crop", JSON.stringify(crop.crop));
      fd.append("rotate", String(crop.rotate));
    }
    if (acknowledged.length) fd.append("acknowledge_duplicates", JSON.stringify(acknowledged));
    try {
      const t = await api.post("talent/quick-add/", fd);
      setDups(null);
      toast(`${t.full_name} saved as ${t.cast_id}${t.status === "needs_details" ? " (needs details)" : ""}`);
      if (mode === "view") navigate(`/talent/${t.id}`);
      else {
        setF((s) => ({ ...EMPTY, city: s.city, district: s.district, categories: s.categories }));
        setPhoto(null);
        setCrop(null);
        setEarlyDup(null);
        window.scrollTo(0, 0);
        nameRef.current && nameRef.current.focus();
      }
    } catch (err) {
      if (err.code === "duplicate" || err.body?.duplicates) setDups(err.body.duplicates);
      else {
        setErrors(Object.fromEntries(Object.entries(err.errors || {}).map(([k, v]) => [k, v.join(" ")])));
        setError(err.message);
      }
    } finally {
      setBusy(null);
    }
  };

  const createCategory = async (name) => {
    try {
      const t = await api.post("terms/", { kind: "category", name });
      return t;
    } catch (e) {
      toast(e.message, "error");
      return null;
    }
  };

  return (
    <div className="narrow">
      <PageHead title="Quick add talent" subtitle="Five things to save a profile. Everything else can be added later." back={{ to: "/talent", label: "Directory" }} />
      {error && <Alert kind="error">{error}</Alert>}
      <form
        className="quick-form"
        onSubmit={(e) => {
          e.preventDefault();
          save("view");
        }}
      >
        <section className="qa-photo">
          <Field label="Primary photo" required error={errors.photo}>
            {() => (
              <>
                {photo ? <PhotoCropper file={photo} onChange={setCrop} /> : <div className="photo-drop">A clear, recent face photo. JPG, PNG or WebP.</div>}
                <PhotoPicker onFile={(file) => (setPhoto(file), setErrors((s) => ({ ...s, photo: undefined })))} label={photo ? "Choose a different photo" : "Choose photo"} />
              </>
            )}
          </Field>
        </section>
        <section className="qa-fields">
          <TextInput label="Full name" required value={f.full_name} onChange={upd("full_name")} error={errors.full_name} ref={nameRef} autoComplete="off" />
          <TextInput label="Primary phone" required type="tel" value={f.phone} onChange={upd("phone")} onBlur={checkEarly} error={errors.phone} placeholder="+91 98470 12345" autoComplete="off" />
          {earlyDup && (
            <Alert kind="warn">
              {earlyDup.some((d) => d.strength === "exact") ? "This number already belongs to " : "Possible match: "}
              {earlyDup.slice(0, 2).map((d, i) => (
                <span key={d.id}>
                  {i > 0 && ", "}
                  <a href={`/talent/${d.id}`} target="_blank" rel="noreferrer">
                    {d.full_name} ({d.cast_id})
                  </a>
                </span>
              ))}
              . Check before saving.
            </Alert>
          )}
          <div className="pair">
            <TextInput label="Current location" required value={f.city} onChange={upd("city")} error={errors.city} placeholder="City or town" />
            <TextInput label="District" value={f.district} onChange={upd("district")} />
          </div>
          <TermPicker label="Category" required terms={terms.category} value={f.categories} onChange={upd("categories")} error={errors.categories} onCreate={createCategory} />
          <details className="qa-more">
            <summary>A few more details (optional)</summary>
            <div className="stack">
              {meta && <Select label="Gender" value={f.gender} onChange={upd("gender")} options={meta.gender} />}
              <div className="pair">
                <TextInput label="Playing age from" type="number" min="0" max="120" value={f.playing_age_min} onChange={upd("playing_age_min")} />
                <TextInput label="to" type="number" min="0" max="120" value={f.playing_age_max} onChange={upd("playing_age_max")} />
              </div>
              <TextInput label="Instagram" value={f.instagram} onChange={upd("instagram")} onBlur={checkEarly} placeholder="@handle or profile link" />
            </div>
          </details>
          <p className="muted small">A cast ID is assigned automatically when you save.</p>
          <div className="form-actions">
            <Button onClick={() => navigate(-1)}>Cancel</Button>
            <Button busy={busy === "another"} onClick={() => save("another")}>Save & add another</Button>
            <Button type="submit" variant="primary" busy={busy === "view"}>Save & view</Button>
          </div>
        </section>
      </form>
      {dups && <DuplicateDialog duplicates={dups} busy={!!busy} onCancel={() => setDups(null)} onContinue={(ids) => save(pendingMode.current, ids)} />}
    </div>
  );
}
