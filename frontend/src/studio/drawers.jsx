// Drawers (side panels) of the studio UI, wired to the casting API.
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Field, FormError, ModalHead, Photo, money, shortDate, useData, useStudio } from "./shared";

// Ask before a delete; deleted records go to the trash.
const sure = (what) => window.confirm(`Delete ${what}? This removes it from the workspace.`);

const GENDERS = [["", "Not specified"], ["male", "Male"], ["female", "Female"]];
const genderLabel = (g) => (GENDERS.find(([v]) => v === g) || [null, "Not specified"])[1];

// ---------------------------------------------------------------- talent form
export function TalentForm({ id }) {
  const { closeDrawer, refresh, toast, openDrawer } = useStudio();
  const [t, setT] = useState(id ? null : {});
  const [terms, setTerms] = useState([]);
  const [error, setError] = useState(null);
  const [dupes, setDupes] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get("terms/").then(setTerms);
    if (id) api.get(`talent/${id}/`).then(setT);
  }, [id]);
  if (!t) return <><ModalHead title="Edit talent" /><div className="loading">Loading profile…</div></>;

  const cats = terms.filter((x) => x.kind === "category");
  const guardian = (t.guardians || [])[0];
  const video = (i) => (t.featured_videos || []).find((v) => v.position === i + 1);

  async function submit(e, acknowledge = []) {
    e && e.preventDefault();
    const form = document.getElementById("talentForm");
    const f = new FormData(form);
    const ageVal = f.get("age");
    const age = ageVal ? Number(ageVal) : null;
    const categories = f.getAll("category").map(Number);
    if (age && age < 18 && (!String(f.get("guardian")).trim() || !String(f.get("guardianPhone")).trim())) {
      setError("Please add guardian name and contact for talent under 18.");
      return;
    }
    const file = f.get("photo");
    if (file && file.size > 25e6) {
      setError("Please select a photo smaller than 25 MB.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let talent = t;
      const core = {
        full_name: String(f.get("name")).trim(), approx_age: age, gender: f.get("gender") || "", city: String(f.get("location") || "").trim(),
        categories, phone: String(f.get("phone")).trim(),
      };
      if (!id) {
        const fd = new FormData();
        Object.entries(core).forEach(([k, v]) => fd.append(k, k === "categories" ? JSON.stringify(v) : (v ?? "")));
        if (file && file.size) fd.append("photo", file);
        if (acknowledge.length) fd.append("acknowledge_duplicates", JSON.stringify(acknowledge));
        talent = await api.post("talent/quick-add/", fd);
      }
      talent = await api.patch(`talent/${talent.id}/`, {
        ...(id ? core : {}), version: talent.version, email: String(f.get("email")).trim(), expected_fee: f.get("fee") || null, fee_type: "per_day",
        ...(acknowledge.length ? { acknowledge_duplicates: acknowledge } : {}),
      });
      if (id && file && file.size) {
        const fd = new FormData();
        fd.append("photo", file);
        fd.append("make_primary", "1");
        await api.post(`talent/${talent.id}/photos/`, fd);
      }
      // Guardian
      const gName = String(f.get("guardian")).trim();
      const gPhone = String(f.get("guardianPhone")).trim();
      const g = (talent.guardians || [])[0];
      if (gName && gPhone) {
        if (g) await api.patch(`guardians/${g.id}/`, { name: gName, phone: gPhone });
        else await api.post("guardians/", { talent: talent.id, name: gName, phone: gPhone, relationship: "Parent / guardian" });
      }
      // Featured videos (positions 1–3)
      for (let i = 0; i < 3; i++) {
        const url = String(f.get("video" + i)).trim();
        const v = (talent.featured_videos || []).find((x) => x.position === i + 1);
        if (v && !url) await api.del(`videos/${v.id}/`);
        else if (v && url !== v.url) await api.patch(`videos/${v.id}/`, { url, platform: "" });
        else if (!v && url) await api.post("videos/", { talent: talent.id, position: i + 1, title: `Featured video ${i + 1}`, url });
      }
      refresh();
      toast("Talent profile saved");
      openDrawer(<Profile id={talent.id} />);
    } catch (err) {
      if (err.code === "duplicate") setDupes(err.body.duplicates || []);
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ModalHead title={id ? "Edit talent" : "Add a new face"} />
      <p style={{ marginBottom: 25 }}>Start with the essentials. Build the story as you go.</p>
      <form id="talentForm" onSubmit={(e) => submit(e)}>
        <div className="formgrid">
          <Field label="Full name" name="name" value={t.full_name} placeholder="e.g. Actor / Model name" />
          <Field label="Age" name="age" type="number" value={t.age ?? t.approx_age} min="1" max="100" />
          <label className="field">
            Gender
            <select name="gender" defaultValue={t.gender === "male" || t.gender === "female" ? t.gender : ""}>
              {GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <Field label="Location" name="location" value={t.city} placeholder="City / District" />
          <fieldset className="field full checks">
            <legend>Categories <small>Choose all that apply</small></legend>
            <div>
              {cats.map((c) => (
                <label key={c.id} className="check">
                  <input type="checkbox" name="category" value={c.id} defaultChecked={(t.categories || []).some((x) => x.id === c.id)} />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Day rate (₹)" name="fee" type="number" value={t.expected_fee ? Number(t.expected_fee) : ""} min="0" placeholder="0" />
          <Field label="Phone" name="phone" type="tel" value={t.phone && t.phone !== "0000000000" ? t.phone : ""} placeholder="e.g. +91 98765 43210" />
          <Field label="Email" name="email" type="email" value={t.email} placeholder="email@example.com" />
          <label className="field full">
            Profile photo
            <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
            <small>JPG, PNG or WebP. Photos are cropped and resized on the server.</small>
          </label>
          <Field label="Guardian name (if under 18)" name="guardian" value={guardian?.name} />
          <Field label="Guardian contact (if under 18)" name="guardianPhone" value={guardian?.phone} />
          <div className="field full">Featured videos (up to 3 links)</div>
          {[0, 1, 2].map((i) => <Field key={i} label={`Video ${i + 1}`} name={"video" + i} type="url" value={video(i)?.url} />)}
        </div>
        <FormError error={error} />
        {dupes && (
          <div className="dupe">
            <b>Possible duplicate:</b> this looks like someone already in your directory.
            {dupes.map((d) => (
              <div className="row" key={d.id}>
                <div className="rowperson">
                  <Photo src={d.photo} name={d.full_name} />
                  <div>{d.full_name}<small>{d.cast_id} · {d.city} · {d.reasons.join(", ")}</small></div>
                </div>
              </div>
            ))}
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="button" onClick={() => setDupes(null)}>Go back</button>
              <button type="button" className="primary" onClick={() => submit(null, dupes.map((d) => d.id))}>It's a different person, save</button>
            </div>
          </div>
        )}
        <div className="formactions">
          <button type="button" onClick={closeDrawer}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : id ? "Save changes" : "Add talent"}</button>
        </div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- influencer form
export function InfluencerForm({ id }) {
  const { closeDrawer, refresh, toast, openDrawer } = useStudio();
  const [t, setT] = useState(id ? null : {});
  const [terms, setTerms] = useState([]);
  const [error, setError] = useState(null);
  const [dupes, setDupes] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get("terms/").then(setTerms);
    if (id) api.get(`talent/${id}/`).then(setT);
  }, [id]);
  if (!t) return <><ModalHead title="Edit influencer" /><div className="loading">Loading profile…</div></>;

  const influencerTerm = terms.find((x) => x.kind === "category" && (x.slug === "influencer" || x.slug === "content-creator"));
  const categories = influencerTerm ? [influencerTerm.id] : [59];
  const video = (i) => (t.featured_videos || []).find((v) => v.position === i + 1);

  async function submit(e, acknowledge = []) {
    e && e.preventDefault();
    const form = document.getElementById("influencerForm");
    const f = new FormData(form);
    const age = Number(f.get("age")) || null;
    const file = f.get("photo");
    if (file && file.size > 25e6) {
      setError("Please select a photo smaller than 25 MB.");
      return;
    }
    let rawName = String(f.get("name") || "").trim();
    let rawHandle = String(f.get("instagram") || "").trim();

    // Auto-clean handle if full URL or leading @ was provided
    let cleanHandleStr = rawHandle.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").replace(/^@+/, "").trim();

    // Auto-clean name if a full URL was pasted into the Name field
    if (/^https?:\/\//i.test(rawName)) {
      const ext = rawName.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").replace(/^@+/, "").trim();
      if (ext) {
        rawName = ext.charAt(0).toUpperCase() + ext.slice(1);
        if (!cleanHandleStr) cleanHandleStr = ext;
      }
    }

    if (!rawName && cleanHandleStr) {
      rawName = cleanHandleStr.charAt(0).toUpperCase() + cleanHandleStr.slice(1);
    }
    if (!rawName) {
      rawName = cleanHandleStr ? `@${cleanHandleStr}` : "New Influencer";
    }

    setBusy(true);
    setError(null);
    try {
      let talent = t;
      const cleanPhone = String(f.get("phone") || "").trim();
      const phoneVal = cleanPhone === "0000000000" ? "" : cleanPhone;
      const core = {
        full_name: rawName,
        approx_age: age,
        gender: f.get("gender") || "",
        city: String(f.get("location") || "").trim(),
        categories,
        phone: phoneVal,
        instagram: cleanHandleStr,
        talent_type: "influencer",
        social_reach: String(f.get("reach") || "").trim(),
        influencer_niche: String(f.get("niche") || "").trim(),
        primary_platform: String(f.get("platform") || "").trim() || "Instagram",
      };
      if (!id) {
        const fd = new FormData();
        Object.entries(core).forEach(([k, v]) => fd.append(k, k === "categories" ? JSON.stringify(v) : (v ?? "")));
        if (file && file.size) fd.append("photo", file);
        if (acknowledge.length) fd.append("acknowledge_duplicates", JSON.stringify(acknowledge));
        talent = await api.post("talent/quick-add/", fd);
      }
      talent = await api.patch(`talent/${talent.id}/`, {
        ...(id ? core : {}),
        version: talent.version,
        email: String(f.get("email") || "").trim(),
        expected_fee: f.get("fee") || null,
        fee_type: "per_post",
        talent_type: "influencer",
        social_reach: String(f.get("reach") || "").trim(),
        influencer_niche: String(f.get("niche") || "").trim(),
        primary_platform: String(f.get("platform") || "").trim() || "Instagram",
        instagram: cleanHandleStr,
        ...(acknowledge.length ? { acknowledge_duplicates: acknowledge } : {}),
      });
      if (id && file && file.size) {
        const fd = new FormData();
        fd.append("photo", file);
        fd.append("make_primary", "1");
        await api.post(`talent/${talent.id}/photos/`, fd);
      }
      for (let i = 0; i < 3; i++) {
        const url = String(f.get("video" + i)).trim();
        const v = (talent.featured_videos || []).find((x) => x.position === i + 1);
        if (v && !url) await api.del(`videos/${v.id}/`);
        else if (v && url !== v.url) await api.patch(`videos/${v.id}/`, { url, platform: "" });
        else if (!v && url) await api.post("videos/", { talent: talent.id, position: i + 1, title: `Featured reel ${i + 1}`, url });
      }
      refresh();
      toast("Influencer profile saved ✓");
      openDrawer(<Profile id={talent.id} />);
    } catch (err) {
      if (err.code === "duplicate") setDupes(err.body.duplicates || []);
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ModalHead title={id ? "Edit influencer" : "Add an influencer / creator"} />
      <p style={{ marginBottom: 25 }}>Digital creators, influencers, and voices with social reach and collab rates.</p>
      <form id="influencerForm" onSubmit={(e) => submit(e)}>
        <div className="formgrid">
          <Field label="Creator / Full name" name="name" value={t.full_name && !t.full_name.startsWith("http") ? t.full_name : ""} placeholder="e.g. Subika Senthil" />
          <Field label="Social handle / Instagram" name="instagram" value={t.instagram ? (t.instagram.startsWith("http") ? t.instagram : `@${t.instagram.replace(/^@/, '')}`) : (t.full_name && t.full_name.startsWith("http") ? t.full_name : "")} placeholder="@username or instagram.com/..." />
          <label className="field">
            Primary platform
            <select name="platform" defaultValue={t.primary_platform || "Instagram"}>
              <option value="Instagram">Instagram</option>
              <option value="YouTube">YouTube</option>
              <option value="TikTok">TikTok</option>
              <option value="Facebook">Facebook</option>
              <option value="LinkedIn">LinkedIn</option>
              <option value="X">X (Twitter)</option>
            </select>
          </label>
          <Field label="Audience reach / Followers" name="reach" value={t.social_reach} placeholder="e.g. 310K followers, 1.2M subs" />
          <label className="field">
            Content niche
            <select name="niche" defaultValue={t.influencer_niche || "Lifestyle"}>
              <option value="Lifestyle">Lifestyle</option>
              <option value="Fashion">Fashion & Style</option>
              <option value="Beauty">Beauty & Makeup</option>
              <option value="Food">Food & Culinary</option>
              <option value="Travel">Travel & Vlogs</option>
              <option value="Tech">Tech & Gadgets</option>
              <option value="Fitness">Fitness & Wellness</option>
              <option value="Comedy">Comedy & Skits</option>
              <option value="Healthcare">Healthcare & Dental</option>
              <option value="Parenting">Parenting & Family</option>
              <option value="Entertainment">Entertainment</option>
              <option value="Finance">Finance & Business</option>
            </select>
          </label>
          <Field label="Location / City" name="location" value={t.city} placeholder="e.g. Coimbatore, Chennai, Bangalore" />
          <Field label="Approx age" name="age" type="number" value={t.age ?? t.approx_age} min="1" max="100" placeholder="Optional" />
          <label className="field">
            Gender
            <select name="gender" defaultValue={t.gender === "male" || t.gender === "female" ? t.gender : ""}>
              {GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <Field label="Collab fee / post (₹)" name="fee" type="number" value={t.expected_fee ? Number(t.expected_fee) : ""} min="0" placeholder="e.g. 25000" />
          <Field label="Phone / WhatsApp" name="phone" type="tel" value={t.phone && t.phone !== "0000000000" ? t.phone : ""} placeholder="e.g. +91 98765 43210" />
          <Field label="Email" name="email" type="email" value={t.email} placeholder="collab@creator.com" />
          <label className="field full">
            Profile photo
            <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
            <small>Clear portrait or creator avatar (JPG, PNG, or WebP).</small>
          </label>
          <div className="field full">Featured reels / sample content (up to 3 links)</div>
          {[0, 1, 2].map((i) => <Field key={i} label={`Sample link ${i + 1}`} name={"video" + i} type="url" value={video(i)?.url} placeholder="https://instagram.com/reel/..." />)}
        </div>
        <FormError error={error} />
        {dupes && (
          <div className="dupe">
            <strong>Similar profile found:</strong>
            {dupes.map((d) => (
              <div key={d.talent.id} className="row">
                <span>{d.talent.full_name} · {d.talent.phone}</span>
                <button type="button" onClick={() => submit(null, [d.talent.id])}>Save anyway</button>
              </div>
            ))}
          </div>
        )}
        <div className="formactions">
          <button type="button" onClick={closeDrawer}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : id ? "Save changes" : "Add influencer"}</button>
        </div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- profile
export function Profile({ id }) {
  const { openDrawer, closeDrawer, refresh, toast } = useStudio();
  const [n, setN] = useState(0);
  const { data: t } = useData(() => api.get(`talent/${id}/`), [id, n]);
  const { data: casting } = useData(() => api.get(`talent/${id}/casting/`), [id, n]);
  const { data: notes } = useData(() => api.get("notes/", { talent: id, page_size: 100 }), [id, n]);
  if (!t) return <><ModalHead title="Profile" /><div className="loading">Loading profile…</div></>;
  const guardian = t.guardians[0];
  const photo = t.photos.find((p) => p.is_primary);
  const isInf = t.talent_type === "influencer";

  async function remove() {
    if (!sure(t.full_name)) return;
    try {
      await api.del(`talent/${id}/`);
      closeDrawer();
      refresh();
      toast(isInf ? "Influencer deleted" : "Talent deleted");
    } catch (err) {
      toast(err.message);
    }
  }

  async function addNote(e) {
    e.preventDefault();
    const text = new FormData(e.target).get("note");
    await api.post("notes/", { talent: id, kind: "note", content: text });
    e.target.reset();
    setN((x) => x + 1);
    refresh();
    toast("Note added");
  }

  return (
    <>
      <ModalHead title={isInf ? "Influencer profile" : "Talent profile"} />
      <div className="profilehero">
        {photo ? <img src={photo.profile_url} alt={t.full_name} /> : <span className="noimg">{t.full_name[0]}</span>}
        <div>
          <div className="eyebrow">{isInf ? `✦ INFLUENCER · ${(t.influencer_niche || t.primary_platform || "DIGITAL CREATOR").toUpperCase()}` : t.categories.map((c) => c.name).join(" · ")}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            <h1 style={{ margin: 0 }}>
              {(() => {
                let s = t.full_name || "Creator";
                if (/^https?:\/\//i.test(s)) {
                  const ext = s.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").replace(/^@+/, "").trim();
                  if (ext) s = ext.charAt(0).toUpperCase() + ext.slice(1);
                }
                return s;
              })()}
            </h1>
            {(() => {
              const handle = (t.instagram || "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").replace(/^@+/, "").trim();
              if (!handle && !t.full_name.includes("instagram.com")) return null;
              const cleanH = handle || t.full_name.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").replace(/^@+/, "").trim();
              return (
                <a
                  href={`https://www.instagram.com/${cleanH}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="talent-insta-link-btn"
                  style={{ padding: "3px 8px", fontSize: 11 }}
                  title={`Open @${cleanH} on Instagram ↗`}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                  </svg>
                  <span>@{cleanH} ↗</span>
                </a>
              );
            })()}
          </div>
          <p>
            {t.city} {t.social_reach ? `· ✦ ${t.social_reach}` : ""} · {t.age ?? "—"} years · {genderLabel(t.gender)}
          </p>
        </div>
      </div>
      <div className="actions" style={{ marginBottom: 25 }}>
        <button className="primary" onClick={() => openDrawer(<ShortlistTalent id={id} />)}>＋ Add to shortlist</button>
        <button onClick={() => openDrawer(isInf ? <InfluencerForm id={id} /> : <TalentForm id={id} />)}>Edit profile</button>
        <button onClick={() => (t.phone ? openDrawer(<Contact t={t} />) : toast("Add a phone number in Edit profile to enable contact shortcuts"))}>↗ Contact</button>
        <button onClick={remove}>Delete</button>
      </div>
      {t.booking_blockers.length > 0 && <div className="completed-notice" style={{ marginTop: 0, marginBottom: 20 }}>{t.booking_blockers.join(" ")}</div>}
      <div className="panel">
        <div className="detailgrid">
          <div><small>{isInf ? "Collab rate / post" : "Day rate"}</small>{t.expected_fee ? money(t.expected_fee) : "Not added"}</div>
          {t.social_reach && <div><small>Audience reach</small>✦ {t.social_reach}</div>}
          {t.primary_platform && <div><small>Primary platform</small>{t.primary_platform}</div>}
          {t.influencer_niche && <div><small>Content niche</small>{t.influencer_niche}</div>}
          {t.instagram && (
            <div>
              <small>Social handle</small>
              <a href={t.instagram_url || `https://instagram.com/${t.instagram.replace(/^@/, "")}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "underline", color: "#fff" }}>
                @{t.instagram.replace(/^@/, "")} ↗
              </a>
            </div>
          )}
          <div><small>Phone</small>{t.phone || "Not added"}</div>
          <div><small>Email</small>{t.email || "Not added"}</div>
          <div><small>Cast ID</small>{t.cast_id}</div>
          <div><small>Profile</small>{t.completeness}% complete</div>
          {t.is_child && (
            <>
              <div><small>Guardian</small>{guardian?.name || "Not added"}</div>
              <div><small>Guardian contact</small>{guardian?.phone || "Not added"}</div>
            </>
          )}
        </div>
      </div>
      <h2>Featured videos <small>Three performances that tell their story</small></h2>
      {[0, 1, 2].map((i) => {
        const v = t.featured_videos.find((x) => x.position === i + 1);
        return (
          <div className="video" key={i}>
            <span>▷</span>
            {v ? <a target="_blank" rel="noopener noreferrer" href={v.url || v.file_url}>Watch featured video {i + 1} ↗</a> : `Video ${i + 1} · Add a video link in Edit profile`}
          </div>
        );
      })}
      <div style={{ marginTop: 28 }}>
        <h2>Internal notes & contact history</h2>
        {notes && notes.results.length === 0 && <p>No notes yet. Keep your team in the loop.</p>}
        {notes && notes.results.map((x) => (
          <div className="row" key={x.id}>
            <div>{x.content}<small>{shortDate(x.interaction_at)} · {x.staff_name}</small></div>
          </div>
        ))}
        <form onSubmit={addNote} style={{ marginTop: 15 }}>
          <textarea required name="note" placeholder="Add a note or log a conversation…" style={{ width: "100%" }} />
          <button style={{ marginTop: 10 }}>Add note</button>
        </form>
      </div>
      <h2 style={{ marginTop: 28 }}>Casting history</h2>
      {casting && casting.bookings.filter((b) => b.status !== "cancelled").length === 0 && <p>No bookings recorded yet.</p>}
      {casting && casting.bookings.filter((b) => b.status !== "cancelled").map((b) => (
        <div className="row" key={b.id}>
          <div>{b.project}<small>{(b.shoot_start || "").slice(0, 10)} · {b.role}</small></div>
          <span>{money(b.agreed_fee ?? b.proposed_fee)}</span>
        </div>
      ))}
    </>
  );
}

export function Contact({ t }) {
  const digits = t.whatsapp || t.phone.replace(/\D/g, "");
  return (
    <>
      <ModalHead title={`Contact ${t.full_name}`} />
      <div className="actions">
        <a className="primary" style={{ padding: 15, borderRadius: 6 }} href={`tel:${t.phone}`}>Call {t.phone}</a>
        <a style={{ padding: 15 }} target="_blank" rel="noopener noreferrer" href={`https://wa.me/${digits}`}>Open WhatsApp ↗</a>
      </div>
      <p style={{ marginTop: 25 }}>Log the conversation in this talent’s internal notes after contacting them.</p>
    </>
  );
}

// ---------------------------------------------------------------- shortlisting
export function ShortlistTalent({ id }) {
  const { toast, refresh } = useStudio();
  const [n, setN] = useState(0);
  const { data: t } = useData(() => api.get(`talent/${id}/`), [id]);
  const { data } = useData(() => api.get("studio/projects/", { scope: "active" }), [n]);
  async function add(role) {
    try {
      const r = await api.post("shortlist/add/", { role: role.id, talent_ids: [id] });
      if (r.errors.length) toast(r.errors[0].detail);
      else toast("Added to " + role.name);
    } catch (e) {
      toast(e.body?.errors?.[0]?.detail || e.message);
    }
    setN((x) => x + 1);
    refresh();
  }
  return (
    <>
      <ModalHead title="Add to a role shortlist" />
      <p style={{ marginBottom: 20 }}>Choose an active project for {t ? t.full_name : "this talent"}.</p>
      {!data && <div className="loading">Loading projects…</div>}
      {data && data.projects.length === 0 && <div className="empty">No active projects. Create or reopen a project to shortlist talent.</div>}
      {data && data.projects.map((p) => (
        <div className="panel" key={p.id}>
          <h2>{p.title}</h2>
          {p.roles.length === 0 && <p>Add role requirements to this project first.</p>}
          {p.roles.map((r) => {
            const added = r.shortlist.some((s) => s.talent_id === id);
            return (
              <div className="row" key={r.id}>
                <div>{r.name}<small>{r.description}</small></div>
                <button className={added ? "" : "primary"} onClick={() => !added && add(r)}>{added ? "Added ✓" : "＋ Add"}</button>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- projects
export const STUDIO_STATUSES = [["draft", "Planning"], ["casting", "Casting"], ["ready", "Shortlisting"], ["in_production", "Confirmed"], ["completed", "Completed"]];

export function ProjectForm({ project }) {
  const { closeDrawer, refresh, toast, openDrawer } = useStudio();
  const { data: meta } = useData(() => api.get("meta/"));
  const [error, setError] = useState(null);
  const p = project || {};
  async function submit(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = { title: f.name, client_name: f.client, production_type: f.type, shoot_start: f.date, status: f.status, description: f.description || "" };
    try {
      const saved = p.id ? await api.patch(`projects/${p.id}/`, body) : await api.post("projects/", body);
      refresh();
      toast(f.status === "completed" ? "Moved to Completed and removed from active shortlists" : p.id ? "Project saved" : "Project created");
      openDrawer(<ProjectDetail id={saved.id} />);
    } catch (err) {
      setError(err);
    }
  }
  return (
    <>
      <ModalHead title={p.id ? "Edit project" : "New casting project"} />
      <form onSubmit={submit}>
        <div className="formgrid">
          <Field label="Project name *" name="name" value={p.title} required />
          <Field label="Client *" name="client" value={p.client_name} required />
          <label className="field">
            Production type
            <select name="type" defaultValue={p.production_type || "ad_film"}>
              {(meta?.production_type || [{ value: "ad_film", label: "Ad film / TVC" }]).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <Field label="Shoot date *" name="date" type="date" value={p.shoot_start} required />
          <label className="field full">
            Status
            <select name="status" defaultValue={p.status || "draft"}>
              {STUDIO_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <small>Completed projects move to Completed and leave active shortlists.</small>
          </label>
        </div>
        <FormError error={error} />
        <div className="formactions">
          <button type="button" onClick={closeDrawer}>Cancel</button>
          <button className="primary">Save project</button>
        </div>
      </form>
    </>
  );
}

function useProject(id) {
  return useData(() => api.get("studio/projects/", { scope: "all" }), [id]);
}

export async function deleteProject(p, { closeDrawer, refresh, toast }) {
  if (!sure(`the project "${p.title}"`)) return;
  try {
    await api.del(`projects/${p.id}/`);
    closeDrawer();
    refresh();
    toast("Project deleted");
  } catch (err) {
    toast(err.message);
  }
}

export function ProjectDetail({ id }) {
  const studio = useStudio();
  const { openDrawer, refresh, toast } = studio;
  const { data } = useProject(id);
  const p = data?.projects.find((x) => x.id === id);
  if (!data) return <><ModalHead title="Project" /><div className="loading">Loading project…</div></>;
  if (!p) return <><ModalHead title="Project" /><div className="empty">This project was deleted.</div></>;
  async function setStatus(value) {
    await api.patch(`projects/${id}/`, { status: value });
    refresh();
    toast(value === "completed" ? "Moved to Completed and removed from active shortlists" : "Project status updated");
  }
  return (
    <>
      <ModalHead title={p.title} />
      <p>{p.client_name} · {p.production_type.replace(/_/g, " ")} · {p.shoot_start || "No shoot date"}</p>
      <div className="row">
        <button onClick={() => openDrawer(<ProjectForm project={p} />)}>Edit project</button>
        <button onClick={() => deleteProject(p, studio)}>Delete project</button>
        <select aria-label="Project status" value={STUDIO_STATUSES.some(([v]) => v === p.status) ? p.status : "completed"} onChange={(e) => setStatus(e.target.value)}>
          {STUDIO_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {p.is_closed && <div className="completed-notice">✓ Shoot completed · retained in project history. Reopen the project to change casting.</div>}
      <h2 style={{ marginTop: 25 }}>Role requirements</h2>
      {p.roles.length === 0 && <p>No roles yet. Add the first role below.</p>}
      {p.roles.map((r) => <RolePanel key={r.id} p={p} r={r} talent={data.talent} />)}
      <button style={{ marginTop: 20 }} onClick={() => openDrawer(<RoleForm project={p} />)}>＋ Add role</button>
    </>
  );
}

function RolePanel({ p, r, talent }) {
  const { openDrawer, closeDrawer, go, setProjectId } = useStudio();
  const t = r.confirmed ? talent[r.confirmed.talent_id] : null;
  return (
    <div className={"panel role-panel" + (t ? " has-confirmed" : "")}>
      <div className="row" style={{ paddingTop: 0 }}>
        <h3>{r.name}</h3>
        <button onClick={() => openDrawer(<RoleForm project={p} role={r} />)}>Edit role</button>
      </div>
      <p style={{ fontSize: 12, marginTop: 10 }}>{r.description}</p>
      <small>Budget {money(r.budget)} / day · {r.shortlist.length} shortlisted</small>
      {t ? (
        <div className="confirmed-cast">
          <div className="confirmed-label">✓ CONFIRMED CAST</div>
          <div className="rowperson">
            <Photo src={t.photo} name={t.full_name} />
            <div><b>{t.full_name}</b><small>Agreed fee {money(r.confirmed.agreed_fee)} / day</small></div>
          </div>
          {!p.is_closed && (
            <div className="actions" style={{ marginTop: 14 }}>
              <button onClick={() => openDrawer(<CastForm projectId={p.id} roleId={r.id} />)}>Edit / replace cast</button>
              <button onClick={() => openDrawer(<CancelCast project={p} role={r} name={t.full_name} />)}>Cancel cast</button>
            </div>
          )}
        </div>
      ) : (
        <div className="unconfirmed">
          No confirmed cast
          {!p.is_closed && <button className="primary" onClick={() => openDrawer(<CastForm projectId={p.id} roleId={r.id} />)}>Select cast</button>}
        </div>
      )}
      {r.log.length > 0 && (
        <details>
          <summary>Cast changes ({r.log.length})</summary>
          {r.log.map((l, i) => <div className="row" key={i}><div>{l.text}<small>{shortDate(l.date)}</small></div></div>)}
        </details>
      )}
      {!p.is_closed && (
        <button style={{ marginTop: 15 }} onClick={() => { closeDrawer(); setProjectId(p.id); go("shortlists"); }}>View shortlist →</button>
      )}
    </div>
  );
}

export function RoleForm({ project, role }) {
  const { openDrawer, refresh, toast } = useStudio();
  const [error, setError] = useState(null);
  const r = role || {};
  async function submit(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = { name: f.name, budget: f.budget, description: f.brief };
    try {
      if (r.id) await api.patch(`roles/${r.id}/`, body);
      else await api.post("roles/", { ...body, project: project.id });
      refresh();
      toast("Role saved");
      openDrawer(<ProjectDetail id={project.id} />);
    } catch (err) {
      setError(err);
    }
  }
  return (
    <>
      <ModalHead title={r.id ? "Edit role requirements" : "Add role"} />
      <form onSubmit={submit}>
        <div className="formgrid">
          <Field label="Role name *" name="name" value={r.name} required />
          <Field label="Budget per day ₹ *" name="budget" type="number" value={r.budget ? Number(r.budget) : ""} required min="0" />
          <label className="field full">
            Requirements
            <textarea required name="brief" defaultValue={r.description || ""} placeholder="Age range, language, skills, and character notes" />
          </label>
        </div>
        <FormError error={error} />
        <div className="formactions">
          <button type="button" onClick={() => openDrawer(<ProjectDetail id={project.id} />)}>Back</button>
          <button className="primary">Save role</button>
        </div>
      </form>
    </>
  );
}

// Confirming cast creates (or replaces) a confirmed booking for the role.
export function CastForm({ projectId, roleId, talentId }) {
  const { openDrawer, refresh, toast } = useStudio();
  const { data } = useProject(projectId);
  const { data: all } = useData(() => api.get("talent/", { page_size: 200, sort: "name" }));
  const [fee, setFee] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const p = data?.projects.find((x) => x.id === projectId);
  const r = p?.roles.find((x) => x.id === roleId);
  if (!p || !r || !all) return <><ModalHead title="Confirm cast" /><div className="loading">Loading…</div></>;
  if (p.is_closed) return <><ModalHead title="Confirm cast" /><p>Reopen this project before changing casting.</p></>;
  const ids = new Set(r.shortlist.map((s) => s.talent_id));
  const ordered = [...all.results].sort((a, b) => Number(ids.has(b.id)) - Number(ids.has(a.id)));
  const chosen = talentId || r.confirmed?.talent_id || r.shortlist[0]?.talent_id || ordered[0]?.id;
  const feeFor = (tid) => (r.confirmed && r.confirmed.talent_id === tid ? Number(r.confirmed.agreed_fee) : Number(ordered.find((t) => t.id === tid)?.expected_fee || 0));

  async function submit(e) {
    e.preventDefault();
    const f = new FormData(document.getElementById("castForm"));
    const tid = Number(f.get("talent"));
    const agreed = f.get("fee");
    const note = String(f.get("reason") || "").trim();
    setBusy(true);
    setError(null);
    try {
      if (r.confirmed && r.confirmed.talent_id === tid) {
        await api.patch(`bookings/${r.confirmed.booking_id}/`, { agreed_fee: agreed, confirmation_notes: note });
      } else {
        const add = await api.post("shortlist/add/", { role: r.id, talent_ids: [tid] }).catch((x) => x.body);
        if (add && add.errors && add.errors.length && !ids.has(tid)) throw new Error(add.errors[0].detail);
        const start = p.shoot_start || new Date().toLocaleDateString("en-CA");
        const end = p.shoot_end || start;
        const body = {
          role: r.id, talent: tid, status: "confirmed", agreed_fee: agreed, proposed_fee: agreed, confirmation_notes: note,
          shoot_start: `${start}T09:00`, shoot_end: `${end}T18:00`,
        };
        // Book the new cast first, so a failed booking never leaves the role empty.
        await api.post("bookings/", body);
        if (r.confirmed) await api.del(`bookings/${r.confirmed.booking_id}/`, { outcome: "replaced", reason: note });
      }
      refresh();
      toast("Confirmed cast saved");
      openDrawer(<ProjectDetail id={projectId} />);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ModalHead title={r.confirmed ? "Edit confirmed cast" : "Confirm cast"} />
      <p style={{ marginBottom: 20 }}>{p.title} · {r.name}</p>
      <form id="castForm" onSubmit={submit}>
        <div className="formgrid">
          <label className="field full">
            Talent
            <select required name="talent" defaultValue={chosen} onChange={(e) => setFee(feeFor(Number(e.target.value)))}>
              {ordered.map((t) => <option key={t.id} value={t.id}>{t.full_name}{ids.has(t.id) ? " · Shortlisted" : ""}</option>)}
            </select>
          </label>
          <label className="field">
            Agreed fee ₹ *
            <input name="fee" type="number" min="0" required value={fee ?? feeFor(chosen)} onChange={(e) => setFee(e.target.value)} />
          </label>
          <label className="field full">
            Change note
            <textarea name="reason" placeholder="For example: original cast cancelled; replacement confirmed" />
          </label>
        </div>
        <FormError error={error} />
        <div className="formactions">
          <button type="button" onClick={() => openDrawer(<ProjectDetail id={projectId} />)}>Back</button>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save confirmed cast"}</button>
        </div>
      </form>
    </>
  );
}

export function CancelCast({ project, role, name }) {
  const { openDrawer, refresh, toast } = useStudio();
  async function submit(e) {
    e.preventDefault();
    await api.del(`bookings/${role.confirmed.booking_id}/`, { outcome: "cancelled_client", reason: new FormData(e.target).get("reason") });
    refresh();
    toast("Cast cancelled. You can select a replacement.");
    openDrawer(<ProjectDetail id={project.id} />);
  }
  return (
    <>
      <ModalHead title="Cancel confirmed cast" />
      <p>{name} will be unconfirmed for {role.name}. The shortlist and change history will be kept.</p>
      <form onSubmit={submit}>
        <label className="field" style={{ marginTop: 20 }}>
          Cancellation reason *
          <textarea name="reason" required placeholder="Why did this casting change?" />
        </label>
        <div className="formactions">
          <button type="button" onClick={() => openDrawer(<ProjectDetail id={project.id} />)}>Keep cast</button>
          <button className="primary">Confirm cancellation</button>
        </div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- Campaign Form
export function CampaignForm({ campaign = null }) {
  const { closeDrawer, refresh, toast, openDrawer } = useStudio();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const f = new FormData(e.target);
    const rawTitle = String(f.get("title") || "").trim();
    const rawClient = String(f.get("client_name") || "").trim();
    const body = {
      title: rawTitle || "New Campaign",
      client_name: rawClient || "",
      location: f.get("location"),
      start_date: f.get("start_date") || null,
      end_date: f.get("end_date") || null,
      budget: f.get("budget") ? Number(f.get("budget")) : null,
      status: f.get("status") || "active",
      notes: f.get("notes") || "",
    };
    setBusy(true);
    setError(null);
    try {
      let res;
      if (campaign) {
        res = await api.patch(`campaigns/${campaign.id}/`, body);
        toast("Campaign updated");
      } else {
        res = await api.post("campaigns/", body);
        toast("Campaign created");
      }
      refresh();
      openDrawer(<CampaignDetail id={res.id} />);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ModalHead title={campaign ? "Edit campaign" : "New campaign"} />
      <p style={{ marginBottom: 20 }}>Plan brand activations, influencer rosters, and finalized client budgets.</p>
      <form onSubmit={submit}>
        <div className="formgrid">
          <Field label="Campaign Title" name="title" value={campaign?.title} placeholder="e.g. Summer Launch · Coimbatore" />
          <Field label="Client / Brand Name" name="client_name" value={campaign?.client_name} placeholder="e.g. Malabar Gold, Myntra, Trends" />
          <Field label="Target City / Location" name="location" value={campaign?.location || ""} placeholder="e.g. Coimbatore, Kochi, Bangalore" />
          <label className="field">
            Campaign Status
            <select name="status" defaultValue={campaign?.status || "active"}>
              <option value="active">Active / In Progress</option>
              <option value="draft">Planning / Draft</option>
              <option value="completed">Completed / Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
          <label className="field">
            Start Date
            <input type="date" name="start_date" defaultValue={campaign?.start_date || ""} />
          </label>
          <label className="field">
            End Date
            <input type="date" name="end_date" defaultValue={campaign?.end_date || ""} />
          </label>
          <Field label="Total Client Budget ₹" name="budget" type="number" value={campaign?.budget} placeholder="e.g. 500000" />
          <label className="field full">
            Campaign Brief & Remarks
            <textarea name="notes" defaultValue={campaign?.notes || ""} placeholder="Deliverables, reels count, brand guidelines, etc." />
          </label>
        </div>
        <FormError error={error} />
        <div className="formactions">
          <button type="button" onClick={closeDrawer}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : campaign ? "Save changes" : "Create campaign"}</button>
        </div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- Campaign Influencer Statuses & Color
export const INFLUENCER_STATUS_OPTIONS = [
  { value: "not_contacted", label: "Not Contacted" },
  { value: "no_response", label: "No Respond" },
  { value: "contacted", label: "Contacted" },
  { value: "shortlisted", label: "Shortlisted" },
  { value: "rejected", label: "Rejected" },
  { value: "finalised", label: "Finalized" },
  { value: "completed", label: "Completed" },
];

export function getInfluencerStatusColor(st) {
  switch (st) {
    case "finalised":
    case "confirmed":
      return "#95f589";
    case "completed":
      return "#5eead4";
    case "not_contacted":
      return "#e5b158";
    case "no_response":
      return "#8e9297";
    case "contacted":
    case "pitched":
      return "#4fc3f7";
    case "shortlisted":
      return "#c084fc";
    case "rejected":
    case "declined":
      return "#ff6b6b";
    default:
      return "#cccccc";
  }
}

// ---------------------------------------------------------------- Campaign Influencer Form
export function CampaignInfluencerForm({ campaignId, initialData = null }) {
  const { openDrawer, refresh, toast } = useStudio();
  const [name, setName] = useState(initialData?.name || "");
  const [talentId, setTalentId] = useState(initialData?.talent_id || null);
  const [phone, setPhone] = useState(initialData?.phone || "");
  const [profileUrl, setProfileUrl] = useState(initialData?.profile_url || "");
  const [platform, setPlatform] = useState(initialData?.platform || "Instagram");
  const [deliverables, setDeliverables] = useState(initialData?.deliverables || "");
  const [location, setLocation] = useState(initialData?.location || "");
  const [rateFixed, setRateFixed] = useState(initialData?.rate_fixed || "");
  const [dateAvailable, setDateAvailable] = useState(initialData?.date_available || "");
  const [status, setStatus] = useState(initialData?.status || "not_contacted");
  const [remark, setRemark] = useState(initialData?.remark || "");
  const [photoPreview, setPhotoPreview] = useState(initialData?.photo_url || "");
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Autocomplete fetch when user types name
  useEffect(() => {
    if (!name || talentId || initialData) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      api.get("talent/", { q: name.trim(), page_size: 5 })
        .then((res) => {
          if (res && res.results && res.results.length) {
            setSuggestions(res.results);
            setShowDropdown(true);
          } else {
            setSuggestions([]);
            setShowDropdown(false);
          }
        })
        .catch(() => setSuggestions([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [name, talentId, initialData]);

  function pickSuggestion(t) {
    setName(t.full_name);
    setTalentId(t.id);
    setShowDropdown(false);
    if (t.photo?.card || t.photo?.thumb) {
      setPhotoPreview(t.photo.card || t.photo.thumb);
    }
    if (t.phone || t.whatsapp_phone) {
      setPhone(t.phone || t.whatsapp_phone);
    }
    if (t.instagram) {
      setProfileUrl(t.instagram.startsWith("@") ? t.instagram : `@${t.instagram}`);
    }
    if (t.city) setLocation(t.city);
    if (t.expected_fee) setRateFixed(t.expected_fee);
    if (t.primary_platform) setPlatform(t.primary_platform);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = e.target;
      const fd = new FormData(form);

      let finalName = String(name || "").trim();
      let cleanProfile = String(profileUrl || "").trim();

      // If user pasted URL into name, clean it
      if (/^https?:\/\//i.test(finalName)) {
        const ext = finalName.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").replace(/^@+/, "").trim();
        if (ext) {
          if (!cleanProfile) cleanProfile = finalName;
          finalName = ext.charAt(0).toUpperCase() + ext.slice(1);
        }
      }

      // If name is blank but profile is given, derive name from profile handle
      if (!finalName && cleanProfile) {
        const ext = cleanProfile.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").replace(/^@+/, "").trim();
        finalName = ext ? (ext.charAt(0).toUpperCase() + ext.slice(1)) : "New Influencer";
      }
      if (!finalName) finalName = "New Influencer";

      if (talentId) fd.set("talent_id", talentId);
      fd.set("name", finalName);
      fd.set("phone", phone);
      fd.set("profile_url", cleanProfile);
      fd.set("platform", platform);
      fd.set("deliverables", deliverables);
      fd.set("location", location);
      fd.set("rate_fixed", rateFixed);
      fd.set("date_available", dateAvailable);
      fd.set("status", status);
      fd.set("remark", remark);

      if (initialData?.id) {
        await api.patch(`campaigns/${campaignId}/influencers/${initialData.id}/`, {
          name: finalName,
          phone,
          profile_url: cleanProfile,
          platform,
          deliverables,
          location,
          rate_fixed: rateFixed,
          date_available: dateAvailable,
          status,
          remark,
        });
        toast("Influencer details updated!");
      } else {
        await api.post(`campaigns/${campaignId}/influencers/`, fd);
        toast("Influencer added to campaign & saved to Talent directory!");
      }
      refresh();
      openDrawer(<CampaignDetail id={campaignId} />);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ModalHead title={initialData ? "Edit campaign influencer" : "Add influencer to campaign"} />
      <p style={{ marginBottom: 20 }}>
        {talentId
          ? "✓ Linked to talent profile in your directory."
          : "✦ Enter influencer details. New creators will automatically be saved into your Talent directory under the 'Influencer' tag."}
      </p>

      <form onSubmit={submit}>
        <div className="formgrid">
          {/* Name Field with Auto-Suggest */}
          <div className="field full" style={{ position: "relative" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
              Influencer Name
              <input
                value={name}
                autoComplete="off"
                placeholder="Type influencer name (auto-fetches existing talent)…"
                style={{ width: "100%" }}
                onChange={(e) => {
                  setName(e.target.value);
                  setTalentId(null);
                }}
              />
            </label>

            {showDropdown && suggestions.length > 0 && (
              <div className="talent-autocomplete">
                <div className="autocomplete-header">Found in Talent Directory — click to auto-fetch details:</div>
                {suggestions.map((s) => (
                  <div key={s.id} className="autocomplete-item" onClick={() => pickSuggestion(s)}>
                    <div className="autocomplete-avatar">
                      {s.photo ? <img src={s.photo.card} alt={s.full_name} /> : s.full_name[0]}
                    </div>
                    <div className="autocomplete-info">
                      <strong>{s.full_name}</strong>
                      <small>{s.instagram ? `@${s.instagram.replace(/^@/, '')}` : s.city || "Talent"} · {s.talent_type === "influencer" ? "✦ Influencer" : "Cast"}</small>
                    </div>
                    <span className="autocomplete-pick">Auto-fetch ↗</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Photo Preview & Upload */}
          <div className="field full">
            <label>Influencer Photo</label>
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 4 }}>
              {photoPreview ? (
                <img src={photoPreview} alt="Preview" style={{ width: 60, height: 75, objectFit: "cover", borderRadius: 6, border: "1px solid #444" }} />
              ) : (
                <div style={{ width: 60, height: 75, background: "#1a1a1a", borderRadius: 6, display: "grid", placeItems: "center", color: "#666", fontSize: 24 }}>✦</div>
              )}
              <div style={{ flex: 1 }}>
                <input
                  type="file"
                  name="photo"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files[0];
                    if (f) setPhotoPreview(URL.createObjectURL(f));
                  }}
                />
                <small style={{ color: "#888", marginTop: 4 }}>Select a photo (JPG, PNG, WebP up to 25 MB)</small>
              </div>
            </div>
          </div>

          {/* Phone Number */}
          <label className="field">
            Phone Number
            <input
              value={phone}
              placeholder="+91 98765 43210"
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>

          {/* Social Handle */}
          <label className="field">
            Profile / Handle
            <input
              value={profileUrl}
              placeholder="e.g. @anjalimenon or URL"
              onChange={(e) => setProfileUrl(e.target.value)}
            />
          </label>

          {/* Primary Platform */}
          <label className="field">
            Platform
            <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
              <option value="Instagram">Instagram</option>
              <option value="YouTube">YouTube</option>
              <option value="TikTok">TikTok</option>
              <option value="Facebook">Facebook</option>
              <option value="LinkedIn">LinkedIn</option>
            </select>
          </label>

          {/* Location */}
          <label className="field">
            Location / City
            <input
              value={location}
              placeholder="e.g. Coimbatore, Kochi"
              onChange={(e) => setLocation(e.target.value)}
            />
          </label>

          {/* Rate Fixed */}
          <label className="field">
            Rate Fixed (₹)
            <input
              type="number"
              min="0"
              value={rateFixed}
              placeholder="Agreed amount e.g. 25000"
              onChange={(e) => setRateFixed(e.target.value)}
            />
          </label>

          {/* Date Available / Time Fixed */}
          <label className="field">
            Date Available / Time Fixed
            <input
              value={dateAvailable}
              placeholder="e.g. 2026-11-05 or Available Nov 5-7"
              onChange={(e) => setDateAvailable(e.target.value)}
            />
          </label>

          {/* Status */}
          <label className="field">
            Status in Campaign
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {INFLUENCER_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          {/* Deliverables */}
          <label className="field full">
            Deliverables
            <textarea
              value={deliverables}
              placeholder="e.g. 1 Reel + 2 Stories"
              style={{ minHeight: 60 }}
              onChange={(e) => setDeliverables(e.target.value)}
            />
          </label>

          {/* Remarks */}
          <label className="field full">
            Remarks / Notes
            <textarea
              value={remark}
              placeholder="e.g. 310K Followers, Model, shoot at Coimbatore store on Nov 5th."
              style={{ minHeight: 60 }}
              onChange={(e) => setRemark(e.target.value)}
            />
          </label>
        </div>

        <FormError error={error} />

        <div className="formactions">
          <button type="button" onClick={() => openDrawer(<CampaignDetail id={campaignId} />)}>Back</button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : initialData ? "Save changes" : "Add to campaign & save talent"}
          </button>
        </div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- Campaign Helpers
function getDayOfWeek(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return "";
  const match = dateStr.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (match) {
    const [, y, m, d] = match;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (!isNaN(date.getTime())) {
      return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
    }
  }
  const match2 = dateStr.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (match2) {
    const [, d, m, y] = match2;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (!isNaN(date.getTime())) {
      return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
    }
  }
  return "";
}

function getProfileLink(url, platform = "Instagram") {
  if (!url) return null;
  const clean = String(url).trim();
  if (!clean) return null;
  if (/^https?:\/\//i.test(clean)) return clean;
  const handle = clean.replace(/^@/, "");
  if (platform && platform.toLowerCase() === "youtube") {
    return `https://youtube.com/@${handle}`;
  }
  return `https://instagram.com/${handle}`;
}

function cleanPhone(phone) {
  if (!phone) return "";
  const s = String(phone).trim();
  if (/^0+$/.test(s) || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return "";
  return s;
}

function formatRate(val) {
  if (val === null || val === undefined || val === "") return "";
  const n = Number(val);
  if (isNaN(n)) return String(val);
  return Number.isInteger(n) ? String(n) : String(n);
}

function ExcelPhotoCell({ photoUrl, name, onUpload }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = (file) => {
    if (!file) return;
    if (file.type && !file.type.startsWith("image/")) return;
    onUpload(file);
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          e.stopPropagation();
          handleFile(file);
          break;
        }
      }
    }
  };

  return (
    <label
      tabIndex={0}
      className={`excel-grid-photo-cell ${isDragOver ? "is-drag-over" : ""}`}
      title="Click to upload, drag & drop image, or paste (Ctrl+V)"
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
      }}
      onPaste={handlePaste}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fileInputRef.current?.click();
        }
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.[0]) handleFile(e.target.files[0]);
        }}
      />
      {photoUrl ? (
        <img src={photoUrl} alt={name || ""} />
      ) : (
        <span>{name ? name[0] : "✦"}</span>
      )}
    </label>
  );
}

// ---------------------------------------------------------------- Campaign Excel Spreadsheet Component
function CampaignExcelSpreadsheet({ campaign, shown, removeInfluencer, changeStatus, openDrawer, refresh, toast }) {
  const [rows, setRows] = useState(shown);
  const [saveStatus, setSaveStatus] = useState("idle"); // idle | saving | saved | error

  // New row bottom entry state
  const [newName, setNewName] = useState("");
  const [newTalentId, setNewTalentId] = useState(null);
  const [newPhone, setNewPhone] = useState("");
  const [newProfile, setNewProfile] = useState("");
  const [newDeliverables, setNewDeliverables] = useState("");
  const [newRemark, setNewRemark] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [newRate, setNewRate] = useState("");
  const [newDate, setNewDate] = useState("");
  const [newStatus, setNewStatus] = useState("not_contacted");
  const [newPhotoFile, setNewPhotoFile] = useState(null);
  const [newPhotoPreview, setNewPhotoPreview] = useState(null);
  const [addingNew, setAddingNew] = useState(false);

  // Suggestions for talent autocomplete
  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const nameInputRef = useRef(null);

  useEffect(() => {
    setRows(shown);
  }, [shown]);

  // Autocomplete debounce
  useEffect(() => {
    if (!newName || newName.length < 2 || newTalentId) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.get("talent/", { q: newName, page_size: 5 });
        if (res && res.results) {
          setSuggestions(res.results);
          setShowDropdown(res.results.length > 0);
        }
      } catch (e) {
        // ignore
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [newName, newTalentId]);

  function pickSuggestionNew(s) {
    setNewName(s.full_name);
    setNewTalentId(s.id);
    if (s.phone || s.whatsapp_phone) setNewPhone(s.phone || s.whatsapp_phone);
    if (s.instagram) setNewProfile(s.instagram.replace(/^@/, ""));
    if (s.city) setNewLocation(s.city);
    if (s.expected_fee) setNewRate(s.expected_fee);
    if (s.photo?.card) setNewPhotoPreview(s.photo.card);
    setShowDropdown(false);
  }

  function handleCellChange(id, field, value) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  async function handleAutoSave(id, field, value) {
    const original = shown.find((s) => s.id === id);
    if (original && String(original[field] ?? "") === String(value ?? "")) {
      return;
    }
    setSaveStatus("saving");
    try {
      await api.patch(`campaigns/${campaign.id}/influencers/${id}/`, { [field]: value });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
      refresh();
    } catch (err) {
      setSaveStatus("error");
      toast("Failed to auto-save: " + err.message);
    }
  }

  async function handlePhotoUpload(infId, file) {
    if (!file) return;
    setSaveStatus("saving");
    try {
      const fd = new FormData();
      fd.append("photo", file);
      await api.patch(`campaigns/${campaign.id}/influencers/${infId}/`, fd);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
      refresh();
      toast("Photo auto-saved!");
    } catch (err) {
      setSaveStatus("error");
      toast("Photo upload failed: " + err.message);
    }
  }

  async function submitNewRow() {
    if (!newName.trim()) return;
    setAddingNew(true);
    setSaveStatus("saving");
    try {
      const fd = new FormData();
      fd.append("name", newName.trim());
      if (newTalentId) fd.append("talent_id", newTalentId);
      if (newPhone.trim()) fd.append("phone", newPhone.trim());
      fd.append("profile_url", newProfile.trim());
      fd.append("platform", "Instagram");
      if (newDeliverables.trim()) fd.append("deliverables", newDeliverables.trim());
      fd.append("location", newLocation.trim());
      if (newRate !== "") fd.append("rate_fixed", newRate);
      if (newDate.trim()) fd.append("date_available", newDate.trim());
      fd.append("status", newStatus);
      if (newRemark.trim()) fd.append("remark", newRemark.trim());
      if (newPhotoFile) fd.append("photo", newPhotoFile);

      await api.post(`campaigns/${campaign.id}/influencers/`, fd);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2500);
      setNewName("");
      setNewTalentId(null);
      setNewPhone("");
      setNewProfile("");
      setNewDeliverables("");
      setNewRemark("");
      setNewLocation("");
      setNewRate("");
      setNewDate("");
      setNewStatus("not_contacted");
      setNewPhotoFile(null);
      setNewPhotoPreview(null);
      refresh();
    } catch (err) {
      setSaveStatus("error");
      toast(err.message);
    } finally {
      setAddingNew(false);
    }
  }

  const totalRate = rows.reduce((acc, i) => acc + (Number(i.rate_fixed) || 0), 0);
  const finalisedCount = rows.filter((i) => i.status === "finalised" || i.status === "confirmed").length;

  return (
    <div className="campaign-excel-card">
      {/* Excel Sheet Toolbar */}
      <div className="campaign-excel-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <strong style={{ color: "#fff", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            📊 Campaign Roster Grid
          </strong>
          <div className="excel-autosave-indicator">
            {saveStatus === "saving" && <span className="saving-pill">● Saving changes…</span>}
            {saveStatus === "saved" && <span className="saved-pill">✓ Auto-saved</span>}
            {saveStatus === "error" && <span className="saving-pill" style={{ color: "#ff8585" }}>⚠ Auto-save error</span>}
            {saveStatus === "idle" && <span className="idle-pill">● Auto-save enabled</span>}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            className="excel-add-row-bar-btn"
            onClick={() => {
              if (nameInputRef.current) nameInputRef.current.focus();
            }}
          >
            ＋ Add new row
          </button>
        </div>
      </div>

      <div className="campaign-excel-tablewrap">
        <table className="campaign-excel-table">
          <thead>
            <tr>
              <th style={{ width: 40, textAlign: "center" }}>#</th>
              <th style={{ width: 54, textAlign: "center" }}>Photo</th>
              <th style={{ minWidth: 140 }}>Influencer Name</th>
              <th style={{ minWidth: 115 }}>Phone</th>
              <th style={{ minWidth: 175 }}>Profile / Handle</th>
              <th style={{ minWidth: 115 }}>Deliverables</th>
              <th style={{ minWidth: 95 }}>Rate Fixed (₹)</th>
              <th style={{ minWidth: 120 }}>Remarks</th>
              <th style={{ minWidth: 95 }}>Location</th>
              <th style={{ minWidth: 100 }}>Date / Time Fixed</th>
              <th style={{ minWidth: 120 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {/* Existing Rows: Pure Excel Cells with Auto-save */}
            {rows.map((inf, idx) => {
              const isDone = inf.status === "finalised" || inf.status === "confirmed";
              const dayOfWeek = getDayOfWeek(inf.date_available);
              const profileLink = getProfileLink(inf.profile_url, inf.platform);
              return (
                <tr
                  key={inf.id}
                  className={isDone ? "is-finalised-row" : ""}
                  onPaste={(e) => {
                    const items = e.clipboardData?.items;
                    if (!items) return;
                    for (const item of items) {
                      if (item.type && item.type.startsWith("image/")) {
                        const file = item.getAsFile();
                        if (file) {
                          e.preventDefault();
                          handlePhotoUpload(inf.id, file);
                          toast("Photo pasted and uploaded ✓");
                          break;
                        }
                      }
                    }
                  }}
                >
                  <td style={{ textAlign: "center", color: "#666", fontSize: 11 }}>{idx + 1}</td>
                  <td style={{ textAlign: "center", padding: "3px" }}>
                    <ExcelPhotoCell
                      photoUrl={inf.photo_url}
                      name={inf.name}
                      onUpload={(f) => handlePhotoUpload(inf.id, f)}
                    />
                  </td>
                  <td>
                    <input
                      className="excel-grid-input"
                      value={inf.name || ""}
                      onChange={(e) => handleCellChange(inf.id, "name", e.target.value)}
                      onBlur={(e) => handleAutoSave(inf.id, "name", e.target.value)}
                    />
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", height: "100%", position: "relative" }}>
                      <input
                        className="excel-grid-input"
                        placeholder="Phone / WhatsApp"
                        style={{ paddingRight: cleanPhone(inf.phone) ? 28 : 8 }}
                        value={cleanPhone(inf.phone)}
                        onChange={(e) => handleCellChange(inf.id, "phone", e.target.value)}
                        onBlur={(e) => handleAutoSave(inf.id, "phone", cleanPhone(e.target.value))}
                      />
                      {cleanPhone(inf.phone) && (
                        <a
                          href={`https://wa.me/${cleanPhone(inf.phone).replace(/\D/g, "").length === 10 ? "91" + cleanPhone(inf.phone).replace(/\D/g, "") : cleanPhone(inf.phone).replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="excel-wa-btn"
                          title={`Chat on WhatsApp with ${inf.name} (${cleanPhone(inf.phone)})`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                          </svg>
                        </a>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", height: "100%", position: "relative" }}>
                      <textarea
                        className="excel-grid-input excel-grid-textarea"
                        placeholder="@handle or URL"
                        rows={3}
                        style={{ paddingRight: profileLink ? 26 : 10 }}
                        value={inf.profile_url || ""}
                        onChange={(e) => handleCellChange(inf.id, "profile_url", e.target.value)}
                        onBlur={(e) => handleAutoSave(inf.id, "profile_url", e.target.value)}
                      />
                      {profileLink && (
                        <a
                          href={profileLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="excel-open-link-btn"
                          title="Open profile in new tab ↗"
                          onClick={(e) => e.stopPropagation()}
                        >
                          ↗
                        </a>
                      )}
                    </div>
                  </td>
                  <td>
                    <textarea
                      className="excel-grid-input excel-grid-textarea"
                      placeholder="e.g. 1 Reel + 2 Stories"
                      rows={3}
                      value={inf.deliverables || ""}
                      onChange={(e) => handleCellChange(inf.id, "deliverables", e.target.value)}
                      onBlur={(e) => handleAutoSave(inf.id, "deliverables", e.target.value)}
                    />
                  </td>
                  <td>
                    <div className="excel-rate-cell">
                      <span className="excel-rate-currency">₹</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="excel-grid-input excel-grid-num"
                        placeholder="0"
                        value={formatRate(inf.rate_fixed)}
                        style={{ color: isDone ? "#7bf59e" : "#ddd" }}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^0-9.]/g, "");
                          handleCellChange(inf.id, "rate_fixed", v);
                        }}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          const num = v ? Number(v) : null;
                          handleAutoSave(inf.id, "rate_fixed", num);
                        }}
                      />
                    </div>
                  </td>
                  <td>
                    <textarea
                      className="excel-grid-input excel-grid-textarea"
                      placeholder="Notes / follower count"
                      rows={3}
                      value={inf.remark || ""}
                      onChange={(e) => handleCellChange(inf.id, "remark", e.target.value)}
                      onBlur={(e) => handleAutoSave(inf.id, "remark", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="excel-grid-input"
                      placeholder="Location"
                      value={inf.location || ""}
                      onChange={(e) => handleCellChange(inf.id, "location", e.target.value)}
                      onBlur={(e) => handleAutoSave(inf.id, "location", e.target.value)}
                    />
                  </td>
                  <td>
                    <div className="excel-grid-date-wrap">
                      {dayOfWeek && (
                        <span
                          className="excel-day-tag"
                          title={`Day: ${dayOfWeek}`}
                        >
                          {dayOfWeek}
                        </span>
                      )}
                      <input
                        type="date"
                        className="excel-grid-date-input"
                        value={inf.date_available ? inf.date_available.slice(0, 10) : ""}
                        onClick={(e) => {
                          try { e.currentTarget.showPicker(); } catch (_) { }
                        }}
                        onChange={(e) => {
                          const val = e.target.value;
                          handleCellChange(inf.id, "date_available", val);
                          handleAutoSave(inf.id, "date_available", val);
                        }}
                      />
                      {inf.date_available && (
                        <button
                          type="button"
                          className="excel-date-clear-btn"
                          title="Clear date"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCellChange(inf.id, "date_available", "");
                            handleAutoSave(inf.id, "date_available", "");
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, height: "100%" }}>
                      <select
                        className="excel-grid-select"
                        value={inf.status || "not_contacted"}
                        style={{
                          flex: 1,
                          color: getInfluencerStatusColor(inf.status || "not_contacted"),
                          fontWeight: (inf.status === "finalised" || inf.status === "completed") ? 600 : 400,
                        }}
                        onChange={(e) => {
                          handleCellChange(inf.id, "status", e.target.value);
                          handleAutoSave(inf.id, "status", e.target.value);
                        }}
                      >
                        {INFLUENCER_STATUS_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="excel-grid-del-btn"
                        onClick={() => removeInfluencer(inf)}
                        title="Delete row"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {/* Bottom New Row (Excel Blank Row for Direct Input) */}
            <tr style={{ background: "rgba(255,255,255,0.015)" }}>
              <td style={{ textAlign: "center", color: "var(--accent)", fontSize: 13, fontWeight: 700 }}>＋</td>
              <td style={{ textAlign: "center", padding: "3px" }}>
                <ExcelPhotoCell
                  photoUrl={newPhotoPreview}
                  name={newName}
                  onUpload={(f) => {
                    setNewPhotoFile(f);
                    setNewPhotoPreview(URL.createObjectURL(f));
                  }}
                />
              </td>
              <td style={{ position: "relative" }}>
                <input
                  ref={nameInputRef}
                  className="excel-grid-input"
                  placeholder="Type name to add new row…"
                  value={newName}
                  autoComplete="off"
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setNewTalentId(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && submitNewRow()}
                  onBlur={() => {
                    if (newName.trim() && !showDropdown) submitNewRow();
                  }}
                />
                {showDropdown && suggestions.length > 0 && (
                  <div className="talent-autocomplete" style={{ top: "100%", left: 0, minWidth: 280, zIndex: 20 }}>
                    <div className="autocomplete-header">Found in directory — click to autofill:</div>
                    {suggestions.map((s) => (
                      <div key={s.id} className="autocomplete-item" onClick={() => pickSuggestionNew(s)}>
                        <div className="autocomplete-avatar">
                          {s.photo ? <img src={s.photo.card} alt={s.full_name} /> : s.full_name[0]}
                        </div>
                        <div className="autocomplete-info">
                          <strong>{s.full_name}</strong>
                          <small>{cleanPhone(s.phone) ? `📞 ${cleanPhone(s.phone)} · ` : ""}{s.instagram ? `@${s.instagram.replace(/^@/, '')}` : s.city} · {s.expected_fee ? `₹${formatRate(s.expected_fee)}` : "Influencer"}</small>
                        </div>
                        <span className="autocomplete-pick">Autofill ↗</span>
                      </div>
                    ))}
                  </div>
                )}
              </td>
              <td>
                <div style={{ display: "flex", alignItems: "center", height: "100%", position: "relative" }}>
                  <input
                    className="excel-grid-input"
                    placeholder="Phone / WhatsApp"
                    style={{ paddingRight: cleanPhone(newPhone) ? 28 : 8 }}
                    value={cleanPhone(newPhone)}
                    onChange={(e) => setNewPhone(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submitNewRow()}
                  />
                  {cleanPhone(newPhone) && (
                    <a
                      href={`https://wa.me/${cleanPhone(newPhone).replace(/\D/g, "").length === 10 ? "91" + cleanPhone(newPhone).replace(/\D/g, "") : cleanPhone(newPhone).replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="excel-wa-btn"
                      title="Open WhatsApp chat 💬"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
                      </svg>
                    </a>
                  )}
                </div>
              </td>
              <td>
                <div style={{ display: "flex", alignItems: "center", height: "100%", position: "relative" }}>
                  <textarea
                    className="excel-grid-input excel-grid-textarea"
                    placeholder="@handle or URL"
                    rows={3}
                    style={{ paddingRight: getProfileLink(newProfile) ? 26 : 10 }}
                    value={newProfile}
                    onChange={(e) => setNewProfile(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submitNewRow())}
                  />
                  {getProfileLink(newProfile) && (
                    <a
                      href={getProfileLink(newProfile)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="excel-open-link-btn"
                      title="Open profile in new tab ↗"
                      onClick={(e) => e.stopPropagation()}
                    >
                      ↗
                    </a>
                  )}
                </div>
              </td>
              <td>
                <textarea
                  className="excel-grid-input excel-grid-textarea"
                  placeholder="e.g. 1 Reel + 2 Stories"
                  rows={3}
                  value={newDeliverables}
                  onChange={(e) => setNewDeliverables(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submitNewRow())}
                />
              </td>
              <td>
                <div className="excel-rate-cell">
                  <span className="excel-rate-currency">₹</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="excel-grid-input excel-grid-num"
                    placeholder="0"
                    value={formatRate(newRate)}
                    onChange={(e) => setNewRate(e.target.value.replace(/[^0-9.]/g, ""))}
                    onKeyDown={(e) => e.key === "Enter" && submitNewRow()}
                  />
                </div>
              </td>
              <td>
                <textarea
                  className="excel-grid-input excel-grid-textarea"
                  placeholder="Notes / follower count"
                  rows={3}
                  value={newRemark}
                  onChange={(e) => setNewRemark(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submitNewRow())}
                />
              </td>
              <td>
                <input
                  className="excel-grid-input"
                  placeholder="Location"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitNewRow()}
                />
              </td>
              <td>
                <div className="excel-grid-date-wrap">
                  {getDayOfWeek(newDate) && (
                    <span className="excel-day-tag">
                      {getDayOfWeek(newDate)}
                    </span>
                  )}
                  <input
                    type="date"
                    className="excel-grid-date-input"
                    value={newDate}
                    onClick={(e) => {
                      try { e.currentTarget.showPicker(); } catch (_) { }
                    }}
                    onChange={(e) => setNewDate(e.target.value)}
                  />
                  {newDate && (
                    <button
                      type="button"
                      className="excel-date-clear-btn"
                      title="Clear date"
                      onClick={(e) => {
                        e.stopPropagation();
                        setNewDate("");
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 4, height: "100%" }}>
                  <select
                    className="excel-grid-select"
                    value={newStatus}
                    style={{
                      flex: 1,
                      color: getInfluencerStatusColor(newStatus),
                      fontWeight: (newStatus === "finalised" || newStatus === "completed") ? 600 : 400,
                    }}
                    onChange={(e) => setNewStatus(e.target.value)}
                  >
                    {INFLUENCER_STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="excel-cell-save-icon"
                    onClick={submitNewRow}
                    title="Press Enter or click to save row"
                    disabled={addingNew}
                  >
                    {addingNew ? "…" : "↵"}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>

          {/* Excel Sticky Footer */}
          <tfoot>
            <tr className="excel-footer-row">
              <td colSpan={2} style={{ textAlign: "center" }}>TOTAL</td>
              <td>{rows.length} Influencer{rows.length === 1 ? "" : "s"}</td>
              <td colSpan={3}>{finalisedCount} Finalised for Client</td>
              <td style={{ color: "#7bf59e", fontSize: 14, fontWeight: 700 }}>₹{totalRate.toLocaleString("en-IN")}</td>
              <td colSpan={4} style={{ textAlign: "right", color: "#777", fontSize: 11 }}>
                💡 Click any cell to edit & auto-save directly
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Campaign Detail View
export function CampaignDetail({ id, onBack, isPage }) {
  const { openDrawer, closeDrawer, toast, refresh } = useStudio();
  const [tab, setTab] = useState("all");
  const [viewMode, setViewMode] = useState("excel");
  const { data: campaign, error } = useData(() => api.get(`campaigns/${id}/`), [id]);

  if (error) {
    return (
      <div className="campaign-detail-fullscreen">
        <p>Failed to load campaign: {error.message}</p>
      </div>
    );
  }
  if (!campaign) {
    return (
      <div className="campaign-detail-fullscreen">
        <div className="empty">Loading campaign roster…</div>
      </div>
    );
  }

  const influencers = campaign.influencers || [];
  const finalised = influencers.filter((i) => i.status === "finalised" || i.status === "confirmed");
  const shortlisted = influencers.filter((i) => i.status === "shortlisted" || i.status === "pitched");

  const shown = tab === "finalised" ? finalised : tab === "shortlisted" ? shortlisted : influencers;

  async function removeInfluencer(inf) {
    if (!confirm(`Remove ${inf.name} from this campaign? (Their profile will remain in the Talent directory)`)) return;
    try {
      await api.del(`campaigns/${campaign.id}/influencers/${inf.id}/`);
      toast(`Removed ${inf.name} from campaign.`);
      refresh();
    } catch (err) {
      toast(err.message);
    }
  }

  async function changeStatus(inf, newStatus) {
    try {
      await api.patch(`campaigns/${campaign.id}/influencers/${inf.id}/`, { status: newStatus });
      toast(`Status updated to ${newStatus}`);
      refresh();
    } catch (err) {
      toast(err.message);
    }
  }

  return (
    <div className="campaign-detail-fullscreen">
      {/* Campaign Hero Bar: Heading on Left, KPIs on Right */}
      <div className="campaign-hero-bar">
        <div className="campaign-hero-left">
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 30, margin: 0, letterSpacing: "-1px" }}>{campaign.title}</h1>
            <select
              className="campaign-status-switcher"
              value={campaign.status}
              aria-label="Change campaign status"
              onChange={async (e) => {
                const newSt = e.target.value;
                try {
                  await api.patch(`campaigns/${campaign.id}/`, { status: newSt });
                  toast(`Status changed to ${newSt.toUpperCase()}`);
                  refresh();
                } catch (err) {
                  toast(err.message);
                }
              }}
            >
              <option value="planning">• PLANNING / DRAFT</option>
              <option value="active">• ACTIVE CAMPAIGN</option>
              <option value="completed">• COMPLETED</option>
              <option value="cancelled">• CANCELLED</option>
            </select>
          </div>
        </div>

        {/* Right side KPI Stats */}
        <div className="campaign-kpi-compact">
          <div className="campaign-kpi-pill">
            <label>Total Influencers</label>
            <strong>{influencers.length}</strong>
          </div>
          <div className="campaign-kpi-pill">
            <label>Finalised Faces</label>
            <strong style={{ color: "var(--accent)" }}>{finalised.length}</strong>
          </div>
          <div className="campaign-kpi-pill">
            <label>Agreed Client Budget</label>
            <strong style={{ color: "#6ef0a3" }}>₹{campaign.total_fixed_rate.toLocaleString("en-IN")}</strong>
          </div>
        </div>
      </div>

      {/* Roster Header with View Toggle */}
      <div className="titlebar" style={{ marginTop: 24, marginBottom: 14 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Influencers & Finalised List</h2>
          <small>Direct Excel spreadsheet input with rates, dates fixed, and auto-fetch from Talent directory.</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div className="view-toggle-btns">
            <button className={viewMode === "excel" ? "active" : ""} onClick={() => setViewMode("excel")}>
              📊 Excel Sheet
            </button>
            <button className={viewMode === "cards" ? "active" : ""} onClick={() => setViewMode("cards")}>
              🂡 Cards
            </button>
          </div>
          <button
            type="button"
            className="campaign-share-client-btn"
            onClick={() => {
              const url = `${window.location.origin}/#/share/campaign/${campaign.id}`;
              navigator.clipboard?.writeText(url);
              toast("✓ Client public link copied to clipboard! (Share on WhatsApp or email)");
            }}
            title="Copy shareable client link for mobile & laptop"
          >
            🔗 Share Client Link
          </button>
          <a
            href={`/#/share/campaign/${campaign.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="campaign-preview-client-btn"
            title="Open client showcase in new tab"
          >
            👁 Preview Client View ↗
          </a>
          <a
            className="primary"
            href={`/api/campaigns/${campaign.id}/export`}
            download
            title="Download formatted client Excel sheet"
            style={{ padding: "8px 14px", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 6, fontWeight: 600 }}
          >
            ↥ Export client list (Excel)
          </a>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="tabs" style={{ marginBottom: 18 }}>
        <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
          All roster <span>{influencers.length}</span>
        </button>
        <button className={tab === "finalised" ? "on" : ""} onClick={() => setTab("finalised")}>
          Finalised for Client <span>{finalised.length}</span>
        </button>
        <button className={tab === "shortlisted" ? "on" : ""} onClick={() => setTab("shortlisted")}>
          Shortlisted / Pitched <span>{shortlisted.length}</span>
        </button>
      </div>

      {/* Excel Sheet Table View (Default) */}
      {viewMode === "excel" && (
        <CampaignExcelSpreadsheet
          campaign={campaign}
          influencers={influencers}
          shown={shown}
          removeInfluencer={removeInfluencer}
          changeStatus={changeStatus}
          openDrawer={openDrawer}
          refresh={refresh}
          toast={toast}
        />
      )}

      {/* Card View */}
      {viewMode === "cards" && (
        <div className="campaign-roster-list">
          {shown.map((inf) => {
            const isDone = inf.status === "finalised" || inf.status === "confirmed";
            return (
              <div key={inf.id} className={"campaign-roster-card" + (isDone ? " is-finalised" : "")}>
                <div className="roster-avatar">
                  {inf.photo_url ? (
                    <img src={inf.photo_url} alt={inf.name} />
                  ) : (
                    <div className="roster-avatar-fallback">{inf.name[0]}</div>
                  )}
                </div>

                <div className="roster-details">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <h3 style={{ margin: 0, fontSize: 16 }}>{inf.name}</h3>
                    <span className="roster-rate">₹{Number(inf.rate_fixed || 0).toLocaleString("en-IN")}</span>
                  </div>

                  <div className="roster-meta">
                    {inf.profile_url && (
                      <a
                        href={getProfileLink(inf.profile_url, inf.platform)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="roster-handle"
                        style={{ textDecoration: "none", color: "#ddd" }}
                        title="Open profile in new tab ↗"
                      >
                        {inf.platform}: <b style={{ textDecoration: "underline" }}>{inf.profile_url}</b> ↗
                      </a>
                    )}
                    {inf.phone && <span>📞 {inf.phone}</span>}
                    {inf.location && <span>📍 {inf.location}</span>}
                  </div>

                  {/* Structured Deliverables, Remarks & Date Section */}
                  <div className="roster-fields-grid">
                    <div className="roster-field-box">
                      <span className="roster-field-label">📦 DELIVERABLES</span>
                      <div className="roster-field-content">
                        {inf.deliverables ? (
                          <span className="roster-deliverables-text">{inf.deliverables}</span>
                        ) : (
                          <span className="roster-empty-text">—</span>
                        )}
                      </div>
                    </div>

                    <div className="roster-field-box">
                      <span className="roster-field-label">💬 REMARKS / NOTES</span>
                      <div className="roster-field-content">
                        {inf.remark ? (
                          <span className="roster-remark-text">“{inf.remark}”</span>
                        ) : (
                          <span className="roster-empty-text">—</span>
                        )}
                      </div>
                    </div>

                    <div className="roster-field-box">
                      <span className="roster-field-label">🗓 DATE / TIME FIXED</span>
                      <div className="roster-field-content">
                        {inf.date_available ? (
                          <span className="roster-date-text">
                            {getDayOfWeek(inf.date_available) ? <b>{getDayOfWeek(inf.date_available)}, </b> : ""}
                            {inf.date_available}
                          </span>
                        ) : (
                          <span className="roster-empty-text">Not fixed</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="roster-actions">
                    <select
                      className="roster-status-select"
                      value={inf.status || "not_contacted"}
                      style={{
                        color: getInfluencerStatusColor(inf.status || "not_contacted"),
                        borderColor: getInfluencerStatusColor(inf.status || "not_contacted") + "55",
                        background: getInfluencerStatusColor(inf.status || "not_contacted") + "15",
                        fontWeight: 600,
                      }}
                      onChange={(e) => changeStatus(inf, e.target.value)}
                    >
                      {INFLUENCER_STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => openDrawer(<CampaignInfluencerForm campaignId={campaign.id} initialData={inf} />)}
                    >
                      Edit details
                    </button>

                    {inf.talent_id && (
                      <button onClick={() => openDrawer(<Profile id={inf.talent_id} />)}>
                        View profile ↗
                      </button>
                    )}

                    <button className="roster-delete" onClick={() => removeInfluencer(inf)}>
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {shown.length === 0 && (
            <div className="empty" style={{ padding: "50px 20px" }}>
              No influencers in this list yet.
              <br />
              <button
                className="primary"
                style={{ marginTop: 14 }}
                onClick={() => openDrawer(<CampaignInfluencerForm campaignId={campaign.id} />)}
              >
                ＋ Add influencer to campaign
              </button>
            </div>
          )}
        </div>
      )}

      {!onBack && (
        <div style={{ marginTop: 30, display: "flex", justifyContent: "space-between" }}>
          <button onClick={closeDrawer}>Close</button>
          <button onClick={() => deleteCampaign(campaign, { toast, refresh, closeDrawer })}>Delete campaign</button>
        </div>
      )}
    </div>
  );
}

async function deleteCampaign(c, studio) {
  if (!confirm(`Delete campaign "${c.title}"?`)) return;
  try {
    await api.del(`campaigns/${c.id}/`);
    studio.refresh();
    studio.toast(`Campaign "${c.title}" deleted.`);
    studio.closeDrawer();
  } catch (err) {
    studio.toast(err.message);
  }
}
