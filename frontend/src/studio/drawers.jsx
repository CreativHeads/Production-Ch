// Drawers (side panels) of the studio UI, wired to the casting API.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Field, FormError, ModalHead, Photo, Status, money, shortDate, useData, useStudio } from "./shared";

const GENDERS = [["", "Not specified"], ["male", "Male"], ["female", "Female"]];
const genderLabel = (g) => (GENDERS.find(([v]) => v === g) || [null, "Not specified"])[1];
const today = () => new Date().toLocaleDateString("en-CA");

async function tagIds(names, terms) {
  const ids = [];
  for (const name of names) {
    let t = terms.find((x) => x.kind === "tag" && x.name.toLowerCase() === name.toLowerCase());
    if (!t) t = await api.post("terms/", { kind: "tag", name });
    ids.push(t.id);
  }
  return ids;
}

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
  const consent = (t.consents || []).filter((c) => c.consent_type === "data_storage").pop();
  const guardian = (t.guardians || [])[0];
  const video = (i) => (t.featured_videos || []).find((v) => v.position === i + 1);

  async function submit(e, acknowledge = []) {
    e && e.preventDefault();
    const form = document.getElementById("talentForm");
    const f = new FormData(form);
    const age = Number(f.get("age"));
    if (age < 18 && (!String(f.get("guardian")).trim() || !String(f.get("guardianPhone")).trim())) {
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
        full_name: String(f.get("name")).trim(), approx_age: age, gender: f.get("gender"), city: String(f.get("location")).trim(),
        categories: [Number(f.get("category"))], phone: String(f.get("phone")).trim(),
      };
      if (!id) {
        const fd = new FormData();
        Object.entries(core).forEach(([k, v]) => fd.append(k, k === "categories" ? JSON.stringify(v) : v));
        fd.append("photo", file);
        if (acknowledge.length) fd.append("acknowledge_duplicates", JSON.stringify(acknowledge));
        talent = await api.post("talent/quick-add/", fd);
      }
      const tags = String(f.get("tags")).split(",").map((s) => s.trim()).filter(Boolean);
      talent = await api.patch(`talent/${talent.id}/`, {
        ...(id ? core : {}), version: talent.version, email: String(f.get("email")).trim(), expected_fee: f.get("fee"), fee_type: "per_day",
        tags: await tagIds(tags, terms), ...(acknowledge.length ? { acknowledge_duplicates: acknowledge } : {}),
      });
      if (id && file && file.size) {
        const fd = new FormData();
        fd.append("photo", file);
        fd.append("make_primary", "1");
        await api.post(`talent/${talent.id}/photos/`, fd);
      }
      // Consent (data storage)
      const wanted = f.get("consent");
      const status = wanted === "Recorded" ? "granted" : wanted === "Withdrawn" ? "withdrawn" : "pending";
      const current = (talent.consents || []).filter((c) => c.consent_type === "data_storage").pop();
      if (current && current.status !== status && !(status === "pending" && current.status === "pending")) {
        await api.patch(`consents/${current.id}/`, status === "granted" ? { status, obtained_on: current.obtained_on || today(), method: current.method || "other" } : { status });
      } else if (!current && status !== "pending") {
        const fd = new FormData();
        Object.entries({ talent: talent.id, consent_type: "data_storage", status, obtained_on: today(), method: "other", given_by: talent.full_name }).forEach(([k, v]) => fd.append(k, v));
        await api.post("consents/", fd);
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
      // Availability: manual hold for the next 30 days, or clear current holds.
      const avail = f.get("status");
      if (avail && avail !== talent.availability) {
        const holds = await api.get("availability/", { talent: talent.id, start: today() });
        if (avail === "On hold") {
          const end = new Date(Date.now() + 30 * 864e5);
          await api.post("availability/", { talent: talent.id, start: new Date().toISOString(), end: end.toISOString(), kind: "tentative_hold", source: "other", notes: "On hold (set from profile)" });
        } else if (avail === "Available") {
          for (const h of holds.filter((x) => !x.is_booking && ["tentative_hold", "unavailable"].includes(x.kind))) await api.del(`availability/${h.id}/`);
        }
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
          <Field label="Full name *" name="name" value={t.full_name} required />
          <Field label="Age *" name="age" type="number" value={t.age ?? t.approx_age} required min="1" max="100" />
          <label className="field">
            Gender
            <select name="gender" defaultValue={t.gender === "male" || t.gender === "female" ? t.gender : ""}>
              {GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <Field label="Location *" name="location" value={t.city} required />
          <label className="field">
            Category
            <select name="category" defaultValue={t.categories?.[0]?.id} required>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <Field label="Day rate (₹) *" name="fee" type="number" value={t.expected_fee ? Number(t.expected_fee) : ""} required min="0" />
          <Field label="Phone *" name="phone" type="tel" value={t.phone} required />
          <Field label="Email" name="email" type="email" value={t.email} />
          <label className="field">
            Availability
            <select name="status" defaultValue={t.availability || "Available"}>
              <option>Available</option>
              <option>On hold</option>
              {t.availability === "Booked" && <option disabled>Booked</option>}
            </select>
          </label>
          <label className="field full">
            Profile photo {id ? "" : "*"}
            <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" required={!id} />
            <small>JPG, PNG or WebP. Photos are cropped and resized on the server.</small>
          </label>
          <Field label="Tags (comma separated)" name="tags" value={(t.tags || []).map((x) => x.name).join(", ")} />
          <label className="field">
            Consent
            <select name="consent" defaultValue={consent ? (consent.status === "granted" ? "Recorded" : consent.status === "withdrawn" ? "Withdrawn" : "Pending") : "Pending"}>
              <option>Pending</option>
              <option>Recorded</option>
              <option>Withdrawn</option>
            </select>
          </label>
          <Field label="Guardian name (required under 18)" name="guardian" value={guardian?.name} />
          <Field label="Guardian contact (required under 18)" name="guardianPhone" value={guardian?.phone} />
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

// ---------------------------------------------------------------- profile
export function Profile({ id }) {
  const { openDrawer, refresh, toast } = useStudio();
  const [n, setN] = useState(0);
  const { data: t } = useData(() => api.get(`talent/${id}/`), [id, n]);
  const { data: casting } = useData(() => api.get(`talent/${id}/casting/`), [id, n]);
  const { data: notes } = useData(() => api.get("notes/", { talent: id, page_size: 100 }), [id, n]);
  if (!t) return <><ModalHead title="Talent profile" /><div className="loading">Loading profile…</div></>;
  const consent = t.consent_state;
  const guardian = t.guardians[0];
  const photo = t.photos.find((p) => p.is_primary);

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
      <ModalHead title="Talent profile" />
      <div className="profilehero">
        {photo ? <img src={photo.profile_url} alt={t.full_name} /> : <span className="noimg">{t.full_name[0]}</span>}
        <div>
          <div className="eyebrow">{t.categories.map((c) => c.name).join(" · ")}</div>
          <h1>{t.full_name}</h1>
          <p>{t.city} · {t.age ?? "—"} years · {genderLabel(t.gender)}</p>
          <br />
          <Status s={t.availability} />
        </div>
      </div>
      <div className="actions" style={{ marginBottom: 25 }}>
        <button className="primary" onClick={() => openDrawer(<ShortlistTalent id={id} />)}>＋ Add to shortlist</button>
        <button onClick={() => openDrawer(<TalentForm id={id} />)}>Edit profile</button>
        <button onClick={() => (t.phone ? openDrawer(<Contact t={t} />) : toast("Add a phone number in Edit profile to enable contact shortcuts"))}>↗ Contact</button>
      </div>
      {t.booking_blockers.length > 0 && <div className="completed-notice" style={{ marginTop: 0, marginBottom: 20 }}>{t.booking_blockers.join(" ")}</div>}
      <div className="panel">
        <div className="detailgrid">
          <div><small>Day rate</small>{t.expected_fee ? money(t.expected_fee) : "Not added"}</div>
          <div><small>Consent</small>{consent}</div>
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

export function ProjectDetail({ id }) {
  const { openDrawer, refresh, toast } = useStudio();
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
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState(false);
  const p = data?.projects.find((x) => x.id === projectId);
  const r = p?.roles.find((x) => x.id === roleId);
  if (!p || !r || !all) return <><ModalHead title="Confirm cast" /><div className="loading">Loading…</div></>;
  if (p.is_closed) return <><ModalHead title="Confirm cast" /><p>Reopen this project before changing casting.</p></>;
  const ids = new Set(r.shortlist.map((s) => s.talent_id));
  const ordered = [...all.results].sort((a, b) => Number(ids.has(b.id)) - Number(ids.has(a.id)));
  const chosen = talentId || r.confirmed?.talent_id || r.shortlist[0]?.talent_id || ordered[0]?.id;
  const feeFor = (tid) => (r.confirmed && r.confirmed.talent_id === tid ? Number(r.confirmed.agreed_fee) : Number(ordered.find((t) => t.id === tid)?.expected_fee || 0));

  async function submit(e, override = false) {
    e && e.preventDefault();
    const f = new FormData(document.getElementById("castForm"));
    const tid = Number(f.get("talent"));
    const agreed = f.get("fee");
    const note = String(f.get("reason") || "").trim();
    if (override && !note) {
      setError("Add a change note explaining why this booking overrides the clash.");
      return;
    }
    setBusy(true);
    setError(null);
    const flags = { acknowledge_warnings: true, ...(override ? { override: true, override_reason: note } : {}) };
    try {
      if (r.confirmed && r.confirmed.talent_id === tid) {
        await api.patch(`bookings/${r.confirmed.booking_id}/`, { agreed_fee: agreed, confirmation_notes: note, ...flags });
      } else {
        const add = await api.post("shortlist/add/", { role: r.id, talent_ids: [tid] }).catch((x) => x.body);
        if (add && add.errors && add.errors.length && !ids.has(tid)) throw new Error(add.errors[0].detail);
        const start = p.shoot_start || new Date().toLocaleDateString("en-CA");
        const end = p.shoot_end || start;
        const body = {
          role: r.id, talent: tid, status: "confirmed", agreed_fee: agreed, proposed_fee: agreed, confirmation_notes: note,
          shoot_start: `${start}T09:00`, shoot_end: `${end}T18:00`, ...flags,
        };
        // Book the new cast first, so a failed booking never leaves the role empty.
        await api.post("bookings/", body);
        if (r.confirmed) await api.del(`bookings/${r.confirmed.booking_id}/`, { outcome: "replaced", reason: note });
      }
      refresh();
      toast("Confirmed cast saved");
      openDrawer(<ProjectDetail id={projectId} />);
    } catch (err) {
      if (err.code === "booking_conflict") setConflict(err.body);
      else setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ModalHead title={r.confirmed ? "Edit confirmed cast" : "Confirm cast"} />
      <p style={{ marginBottom: 20 }}>{p.title} · {r.name}</p>
      <form id="castForm" onSubmit={(e) => submit(e)}>
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
        {conflict && (
          <div className="dupe">
            <b>{conflict.detail}</b>
            {(conflict.conflicts || []).map((c) => <div className="row" key={c.id}><div>{c.label}<small>{shortDate(c.start)} – {shortDate(c.end)}</small></div></div>)}
            <div className="actions" style={{ marginTop: 10 }}>
              <button type="button" onClick={() => setConflict(null)}>Choose someone else</button>
              <button type="button" className="primary" onClick={() => submit(null, true)}>Override and confirm</button>
            </div>
          </div>
        )}
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
