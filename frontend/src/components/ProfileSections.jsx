import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { Link } from "../lib/router";
import { actionLabel, date, dateTime, fromLocalInput, labelOf, money, relative, toLocalInput } from "../lib/util";
import PhotoCropper, { PhotoPicker } from "./PhotoCropper";
import { Alert, Button, Check, Confirm, Empty, ErrorBox, Icon, IconButton, Modal, Select, Spinner, TextArea, TextInput } from "./ui";

const useAct = () => {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async (fn, msg) => {
    setBusy(true);
    try {
      const r = await fn();
      msg && toast(msg);
      return r ?? true;
    } catch (e) {
      toast(e.message, "error");
      return null;
    } finally {
      setBusy(false);
    }
  };
  return [busy, run];
};

// ---------------------------------------------------------------- Photos
export function PhotosSection({ t, onChange }) {
  const [busy, run] = useAct();
  const [upload, setUpload] = useState(null); // {files, crop}
  const [edit, setEdit] = useState(null);
  const [view, setView] = useState(null);

  const send = async () => {
    const fd = new FormData();
    upload.files.forEach((f) => fd.append("photo", f));
    if (upload.files.length === 1 && upload.crop) {
      fd.append("crop", JSON.stringify(upload.crop.crop));
      fd.append("rotate", String(upload.crop.rotate));
    }
    if (upload.primary) fd.append("make_primary", "1");
    const ok = await run(() => api.post(`talent/${t.id}/photos/`, fd), upload.files.length > 1 ? `${upload.files.length} photos added` : "Photo added");
    if (ok) {
      setUpload(null);
      onChange();
    }
  };

  return (
    <div>
      <div className="section-head">
        <p className="muted">The primary photo appears on cards and exports. Flag photos that no longer look like them.</p>
        <PhotoPicker multiple label="Add photos" onFile={(files) => setUpload({ files, crop: null, primary: false })} />
      </div>
      {t.photos.length === 0 && <Empty title="No photos yet">A primary photo is required before this profile can be published.</Empty>}
      <div className="gallery">
        {t.photos.map((p) => (
          <figure key={p.id} className={p.is_outdated ? "is-outdated" : ""}>
            <button className="gallery-img" onClick={() => setView(p)} aria-label={`View ${p.label || "photo"}`}>
              <img src={p.card_url} alt={p.label || t.full_name} loading="lazy" />
            </button>
            <figcaption>
              {p.is_primary && <span className="pill pill-ok">Primary</span>}
              {p.is_outdated && <span className="pill pill-warn">Outdated</span>}
              <span className="small">{p.label}</span>
              <span className="gallery-tools">
                {!p.is_primary && <IconButton icon="star" label="Make primary" onClick={async () => (await run(() => api.patch(`photos/${p.id}/`, { is_primary: true }), "Primary photo changed")) && onChange()} />}
                <IconButton icon="edit" label="Edit label" onClick={() => setEdit(p)} />
                {!p.is_primary && <IconButton icon="trash" label="Delete photo" onClick={() => setEdit({ ...p, _delete: true })} />}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>

      {upload && (
        <Modal
          title={upload.files.length > 1 ? `Add ${upload.files.length} photos` : "Add photo"}
          onClose={() => setUpload(null)}
          footer={
            <>
              <Button onClick={() => setUpload(null)}>Cancel</Button>
              <Button variant="primary" busy={busy} onClick={send}>Upload</Button>
            </>
          }
        >
          {upload.files.length === 1 ? (
            <PhotoCropper file={upload.files[0]} onChange={(c) => setUpload((u) => ({ ...u, crop: c }))} />
          ) : (
            <p className="prose">Photos are uploaded as they are; location and camera data is stripped automatically.</p>
          )}
          {upload.files.length === 1 && <Check label="Make this the primary photo" checked={upload.primary} onChange={(v) => setUpload((u) => ({ ...u, primary: v }))} />}
        </Modal>
      )}
      {edit && !edit._delete && <PhotoEdit photo={edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), onChange())} />}
      {edit && edit._delete && (
        <Confirm title="Delete this photo?" danger confirmLabel="Delete" busy={busy} onClose={() => setEdit(null)} onConfirm={async () => (await run(() => api.del(`photos/${edit.id}/`), "Photo deleted")) && (setEdit(null), onChange())}>
          The photo and its variants are removed permanently.
        </Confirm>
      )}
      {view && (
        <Modal title={view.label || t.full_name} onClose={() => setView(null)} wide>
          <img src={view.profile_url} alt={view.label || t.full_name} className="lightbox-img" />
          {view.has_master && <p className="muted small">An original master file is kept privately for this photo.</p>}
        </Modal>
      )}
    </div>
  );
}

function PhotoEdit({ photo, onClose, onSaved }) {
  const [busy, run] = useAct();
  const [label, setLabel] = useState(photo.label || "");
  const [outdated, setOutdated] = useState(photo.is_outdated);
  const [taken, setTaken] = useState(photo.taken_on || "");
  return (
    <Modal
      title="Photo details"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={async () => (await run(() => api.patch(`photos/${photo.id}/`, { label, is_outdated: outdated, taken_on: taken || null }), "Photo updated")) && onSaved()}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextInput label="Label / description" value={label} onChange={setLabel} hint="Used as alt text, e.g. 'Headshot, traditional saree'" />
        <TextInput label="Taken on" type="date" value={taken} onChange={setTaken} />
        <Check label="Flag as outdated" hint="Shows up in the review queue so someone asks for new photos." checked={outdated} onChange={setOutdated} />
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Videos
export function VideosSection({ t, onChange }) {
  const [busy, run] = useAct();
  const [edit, setEdit] = useState(null);
  const [linkEdit, setLinkEdit] = useState(null);
  const bySlot = { 1: null, 2: null, 3: null };
  t.featured_videos.forEach((v) => (bySlot[v.position] = v));
  const filled = t.featured_videos.slice().sort((a, b) => a.position - b.position);

  const move = async (v, dir) => {
    const order = filled.map((x) => x.id);
    const i = order.indexOf(v.id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    (await run(() => api.post(`talent/${t.id}/videos/reorder/`, { order }), "Order updated")) && onChange();
  };

  return (
    <div>
      <p className="muted">Three featured slots. Extra links go under Other portfolio links and never push these out.</p>
      <div className="video-slots">
        {[1, 2, 3].map((pos) => {
          const v = bySlot[pos];
          return (
            <div key={pos} className={v ? "vslot" : "vslot vslot-empty"}>
              <span className="vslot-num">Slot {pos}</span>
              {v ? (
                <>
                  <a className="vthumb" href={v.url || v.file_url} target="_blank" rel="noreferrer" aria-label={`Play ${v.title}`}>
                    {v.thumbnail_url ? <img src={v.thumbnail_url} alt="" /> : <span className="vthumb-ph" />}
                    <span className="vplay"><Icon name="play" fill /></span>
                  </a>
                  <strong>{v.title}</strong>
                  <span className="small muted">{v.platform.replace("_", " ")}</span>
                  {v.description && <p className="small">{v.description}</p>}
                  <div className="vslot-tools">
                    <IconButton icon="up" label="Move earlier" disabled={filled[0]?.id === v.id} onClick={() => move(v, -1)} />
                    <IconButton icon="down" label="Move later" disabled={filled[filled.length - 1]?.id === v.id} onClick={() => move(v, 1)} />
                    <IconButton icon="edit" label="Edit" onClick={() => setEdit(v)} />
                    <IconButton icon="trash" label="Remove" onClick={async () => (await run(() => api.del(`videos/${v.id}/`), "Video removed")) && onChange()} />
                  </div>
                </>
              ) : (
                <button className="vslot-add" onClick={() => setEdit({ position: pos, talent: t.id, title: "", url: "", description: "", platform: "" })}>
                  <Icon name="plus" /> Add video
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="section-head">
        <h3>Other portfolio links</h3>
        <Button size="sm" icon="plus" onClick={() => setLinkEdit({ talent: t.id, title: "", url: "", kind: "" })}>Add link</Button>
      </div>
      {t.portfolio_links.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <ul className="link-list">
          {t.portfolio_links.map((l) => (
            <li key={l.id}>
              <Icon name="link" size={16} />
              <a href={l.url} target="_blank" rel="noreferrer">{l.title}</a>
              {l.kind && <span className="muted small">{l.kind}</span>}
              <IconButton icon="trash" label="Remove link" onClick={async () => (await run(() => api.del(`portfolio-links/${l.id}/`), "Link removed")) && onChange()} />
            </li>
          ))}
        </ul>
      )}
      {edit && <VideoForm v={edit} onClose={() => setEdit(null)} onSaved={() => (setEdit(null), onChange())} />}
      {linkEdit && (
        <SimpleForm
          title="Add portfolio link"
          initial={linkEdit}
          fields={[["title", "Title"], ["url", "Link", "url"], ["kind", "Type (e.g. Showreel, IMDb)"]]}
          onClose={() => setLinkEdit(null)}
          onSave={(d) => api.post("portfolio-links/", d)}
          onSaved={() => (setLinkEdit(null), onChange())}
        />
      )}
    </div>
  );
}

function VideoForm({ v, onClose, onSaved }) {
  const { meta } = useApp();
  const [busy, run] = useAct();
  const [f, setF] = useState(v);
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const save = async () => {
    setErrors({});
    let body = { ...f };
    if (file) {
      body = new FormData();
      Object.entries(f).forEach(([k, val]) => val != null && k !== "file_url" && k !== "id" && body.append(k, val));
      body.append("file", file);
    }
    try {
      const r = v.id ? await api.patch(`videos/${v.id}/`, body) : await api.post("videos/", body);
      onSaved(r);
    } catch (e) {
      setErrors(Object.fromEntries(Object.entries(e.errors || {}).map(([k, x]) => [k, x.join(" ")])));
      if (!Object.keys(e.errors || {}).length) await run(() => Promise.reject(e));
    }
  };
  const upd = (k) => (val) => setF((s) => ({ ...s, [k]: val }));
  return (
    <Modal
      title={`${v.id ? "Edit" : "Add"} video, slot ${v.position}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={save}>Save video</Button>
        </>
      }
    >
      <div className="stack">
        <TextInput label="Title" required value={f.title} onChange={upd("title")} error={errors.title} placeholder="e.g. Kalyan Jewellers TVC 2025" />
        <TextInput label="Video link" type="url" value={f.url} onChange={upd("url")} error={errors.url} placeholder="YouTube, Instagram, Vimeo or Drive link" />
        <div className="field">
          <span className="field-label">Or upload a file</span>
          <input type="file" accept="video/*" onChange={(e) => setFile(e.target.files[0] || null)} />
        </div>
        {meta && <Select label="Platform" value={f.platform} onChange={upd("platform")} options={meta.video_platform} placeholder="Detect from link" />}
        <TextArea label="Description" value={f.description} onChange={upd("description")} rows={2} />
        {errors.position && <Alert kind="error">{errors.position}</Alert>}
      </div>
    </Modal>
  );
}

function SimpleForm({ title, initial, fields, onClose, onSave, onSaved }) {
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      onSaved(await onSave(f));
    } catch (e) {
      setErrors(Object.fromEntries(Object.entries(e.errors || {}).map(([k, x]) => [k, x.join(" ")])));
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="stack">
        {fields.map(([k, label, type]) => (
          <TextInput key={k} label={label} type={type || "text"} value={f[k]} onChange={(v) => setF((s) => ({ ...s, [k]: v }))} error={errors[k]} />
        ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Availability
export function AvailabilitySection({ t }) {
  const { meta } = useApp();
  const [busy, run] = useAct();
  const list = useLoad(() => api.get("availability/", { talent: t.id }), [t.id]);
  const [form, setForm] = useState(null);
  const [overlaps, setOverlaps] = useState(null);
  const now = Date.now();
  const save = async () => {
    const body = { ...form, talent: t.id, start: fromLocalInput(form.start), end: fromLocalInput(form.end), confirmed_at: form.source ? new Date().toISOString() : null };
    const r = await run(() => (form.id ? api.patch(`availability/${form.id}/`, body) : api.post("availability/", body)), "Availability saved");
    if (r) {
      setForm(null);
      setOverlaps(r.overlaps && r.overlaps.length ? r.overlaps : null);
      list.reload();
    }
  };
  const day = (d) => {
    const x = new Date();
    x.setDate(x.getDate() + d);
    x.setHours(d === 0 ? 9 : 21, 0, 0, 0);
    return toLocalInput(x.toISOString());
  };
  return (
    <div>
      <div className="section-head">
        <p className="muted">Availability is tracked separately from shortlists. Bookings add entries here automatically.</p>
        <Button icon="plus" onClick={() => setForm({ kind: "available", start: day(0), end: day(0), source: "call", notes: "" })}>Add availability</Button>
      </div>
      {overlaps && (
        <Alert kind="warn">
          This overlaps with {overlaps.length} other entr{overlaps.length === 1 ? "y" : "ies"}: {overlaps.map((o) => `${o.label} (${date(o.start)})`).join(", ")}.
        </Alert>
      )}
      {list.loading && <Spinner />}
      <ErrorBox error={list.error} onRetry={list.reload} />
      {list.data && list.data.length === 0 && <p className="muted">Nothing recorded.</p>}
      {list.data && list.data.length > 0 && (
        <ul className="avail-list">
          {list.data.map((a) => (
            <li key={a.id} className={`avail avail-${a.kind} ${new Date(a.end).getTime() < now ? "is-past" : ""}`}>
              <span className="avail-kind">{a.kind_label}</span>
              <span>
                {dateTime(a.start)} – {dateTime(a.end)}
                {a.notes && <small>{a.notes}</small>}
                {a.confirmed_at && <small>Confirmed {relative(a.confirmed_at)}{a.source ? ` by ${labelOf(meta?.availability_source, a.source).toLowerCase()}` : ""}</small>}
              </span>
              {!a.is_booking && (
                <span>
                  <IconButton icon="edit" label="Edit" onClick={() => setForm({ ...a, start: toLocalInput(a.start), end: toLocalInput(a.end) })} />
                  <IconButton icon="trash" label="Remove" onClick={async () => (await run(() => api.del(`availability/${a.id}/`), "Removed")) && list.reload()} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {form && meta && (
        <Modal title={form.id ? "Edit availability" : "Add availability"} onClose={() => setForm(null)} footer={<><Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
          <div className="stack">
            <Select label="Type" value={form.kind} onChange={(v) => setForm((s) => ({ ...s, kind: v }))} options={meta.availability_type.filter((o) => o.value !== "confirmed_booking")} placeholder={null} />
            <div className="pair">
              <TextInput label="From" type="datetime-local" value={form.start} onChange={(v) => setForm((s) => ({ ...s, start: v }))} />
              <TextInput label="To" type="datetime-local" value={form.end} onChange={(v) => setForm((s) => ({ ...s, end: v }))} />
            </div>
            <Select label="Confirmed by" value={form.source} onChange={(v) => setForm((s) => ({ ...s, source: v }))} options={meta.availability_source.filter((o) => o.value !== "system")} placeholder="Not confirmed yet" />
            <TextArea label="Notes" value={form.notes} onChange={(v) => setForm((s) => ({ ...s, notes: v }))} rows={2} />
            <p className="muted small">Confirmed bookings are created from a project role so the fee and schedule are recorded.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Notes
export function NotesSection({ t, openNew, onOpened }) {
  const { meta } = useApp();
  const [busy, run] = useAct();
  const notes = useLoad(() => api.get("notes/", { talent: t.id, page_size: 100 }), [t.id]);
  const projects = useLoad(() => api.get("projects/", { status: "open", page_size: 100 }), []);
  const blank = { kind: "call", result: "", content: "", interaction_at: toLocalInput(new Date().toISOString()), project: "", follow_up_on: "" };
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (openNew) {
      setForm(blank);
      onOpened && onOpened();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openNew]);
  const save = async () => {
    const body = { ...form, talent: t.id, interaction_at: fromLocalInput(form.interaction_at), project: form.project || null, follow_up_on: form.follow_up_on || null, result: form.kind === "note" ? "" : form.result };
    const r = await run(() => (form.id ? api.patch(`notes/${form.id}/`, body) : api.post("notes/", body)), "Saved");
    if (r) {
      setForm(null);
      notes.reload();
    }
  };
  const upd = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));
  return (
    <div>
      <div className="section-head">
        <p className="muted">Internal only. Log calls and messages here after they happen; tapping Call or WhatsApp doesn't record anything.</p>
        <Button icon="plus" variant="primary" onClick={() => setForm(blank)}>Log contact or note</Button>
      </div>
      {notes.loading && <Spinner />}
      <ErrorBox error={notes.error} onRetry={notes.reload} />
      {notes.data && notes.data.results.length === 0 && <p className="muted">No notes yet.</p>}
      {notes.data && (
        <ol className="notes">
          {notes.data.results.map((n) => (
            <li key={n.id} className={`note note-${n.kind}`}>
              <div className="note-head">
                <strong>{labelOf(meta?.note_kind, n.kind)}</strong>
                {n.result && <span className="pill">{labelOf(meta?.note_result, n.result)}</span>}
                <span className="muted small">{dateTime(n.interaction_at)}, {n.staff_name}</span>
                {n.project_title && <Link to={`/projects/${n.project}`} className="small">{n.project_title}</Link>}
                <span className="note-tools">
                  <IconButton icon="edit" label="Edit" onClick={() => setForm({ ...n, interaction_at: toLocalInput(n.interaction_at), project: n.project || "", follow_up_on: n.follow_up_on || "" })} />
                </span>
              </div>
              <p className="pre">{n.content}</p>
              {n.follow_up_on && (
                <div className={`follow ${n.follow_up_done ? "is-done" : ""}`}>
                  Follow up {date(n.follow_up_on)}
                  {!n.follow_up_done && (
                    <button className="link-btn" onClick={async () => (await run(() => api.patch(`notes/${n.id}/`, { follow_up_done: true }), "Follow-up done")) && notes.reload()}>Mark done</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {form && meta && (
        <Modal title={form.id ? "Edit entry" : "Log contact or note"} onClose={() => setForm(null)} footer={<><Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" busy={busy} disabled={!form.content.trim()} onClick={save}>Save</Button></>}>
          <div className="stack">
            <div className="pair">
              <Select label="Type" value={form.kind} onChange={upd("kind")} options={meta.note_kind} placeholder={null} />
              {form.kind !== "note" && <Select label="Result" value={form.result} onChange={upd("result")} options={meta.note_result} />}
            </div>
            <TextArea label="What happened" value={form.content} onChange={upd("content")} rows={4} required />
            <div className="pair">
              <TextInput label="When" type="datetime-local" value={form.interaction_at} onChange={upd("interaction_at")} />
              <TextInput label="Follow up on" type="date" value={form.follow_up_on} onChange={upd("follow_up_on")} />
            </div>
            <Select label="Related project" value={form.project} onChange={upd("project")} options={(projects.data?.results || []).map((p) => ({ value: p.id, label: p.title }))} placeholder="None" />
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Casting
export function CastingSection({ t }) {
  const { meta } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.get(`talent/${t.id}/casting/`), [t.id]);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="stack-lg">
      <section>
        <h3>Bookings</h3>
        {data.bookings.length === 0 ? (
          <p className="muted">Not booked through CreativHeads yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Role</th>
                  <th>Shoot</th>
                  <th>Status</th>
                  <th className="num">Proposed</th>
                  <th className="num">Agreed</th>
                  <th className="num">Travel / stay</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {data.bookings.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link to={`/projects/${b.project_id}`}>{b.project}</Link>
                      <div className="row-sub">{b.client}</div>
                    </td>
                    <td>{b.role}</td>
                    <td>{date(b.shoot_start)}{b.completed_on && <div className="row-sub">Completed {date(b.completed_on)}</div>}</td>
                    <td><span className={`pill pill-${b.status}`}>{b.status_label}</span></td>
                    <td className="num">{money(b.proposed_fee, b.currency)}</td>
                    <td className="num"><strong>{money(b.agreed_fee, b.currency)}</strong> <span className="row-sub">{labelOf(meta?.fee_basis, b.fee_basis)}</span></td>
                    <td className="num">{[money(b.travel_charges, b.currency), money(b.accommodation_charges, b.currency)].filter(Boolean).join(" / ")}</td>
                    <td>
                      {b.outcome}
                      {b.deliverable_url && <div><a href={b.deliverable_url} target="_blank" rel="noreferrer">Watch</a></div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">Agreed fees are stored with each booking and don't change when the profile's expected fee is updated.</p>
      </section>
      <section>
        <h3>Shortlists</h3>
        {data.shortlists.length === 0 ? (
          <p className="muted">Not on any shortlist.</p>
        ) : (
          <ul className="plain">
            {data.shortlists.map((s) => (
              <li key={s.id} className={s.is_removed ? "muted" : ""}>
                <Link to={`/projects/${s.project_id}`}>{s.project}</Link>, {s.role}: <span className={`pill pill-${s.status}`}>{s.status_label}</span>
                {s.is_removed && " (removed)"} <span className="small muted">{date(s.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- Consent & guardian
export function ConsentSection({ t, onChange }) {
  const { meta } = useApp();
  const [busy, run] = useAct();
  const [form, setForm] = useState(null);
  const [gForm, setGForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [file, setFile] = useState(null);

  const saveConsent = async () => {
    setErrors({});
    const fd = new FormData();
    Object.entries({ ...form, talent: t.id }).forEach(([k, v]) => v !== null && v !== undefined && !["evidence_url", "type_label", "status_label", "is_effective", "created_at", "updated_at", "id"].includes(k) && fd.append(k, v));
    if (file) fd.append("evidence", file);
    try {
      form.id ? await api.patch(`consents/${form.id}/`, fd) : await api.post("consents/", fd);
      setForm(null);
      setFile(null);
      onChange();
    } catch (e) {
      setErrors(Object.fromEntries(Object.entries(e.errors || {}).map(([k, x]) => [k, x.join(" ")])));
      if (!Object.keys(e.errors || {}).length) run(() => Promise.reject(e));
    }
  };
  const saveGuardian = async () => {
    const body = { ...gForm, talent: t.id };
    const r = await run(() => (gForm.id ? api.patch(`guardians/${gForm.id}/`, body) : api.post("guardians/", body)), "Guardian saved");
    if (r) {
      setGForm(null);
      onChange();
    }
  };
  const today = new Date().toISOString().slice(0, 10);
  const blankConsent = { consent_type: t.is_child ? "guardian" : "data_storage", status: "granted", obtained_on: today, method: "", scope: "", given_by: "", expires_on: "", withdrawn_on: "", notes: "" };
  const upd = (k) => (v) => setForm((s) => ({ ...s, [k]: v }));

  return (
    <div className="stack-lg">
      {t.is_child && (
        <section className="panel">
          <div className="section-head">
            <h3>Parent / guardian</h3>
            <Button size="sm" icon="plus" onClick={() => setGForm({ name: "", relationship: "Mother", phone: "", email: "", address: "", id_verified: false, notes: "" })}>Add guardian</Button>
          </div>
          {t.guardians.length === 0 ? (
            <Alert kind="warn">A child artist needs parent or guardian details before they can be booked.</Alert>
          ) : (
            <ul className="plain">
              {t.guardians.map((g) => (
                <li key={g.id}>
                  <strong>{g.name}</strong> ({g.relationship}), <a href={`tel:${g.phone}`}>{g.phone}</a> {g.email}
                  {g.id_verified ? <span className="pill pill-ok">ID verified</span> : <span className="pill pill-warn">ID not verified</span>}
                  <IconButton icon="edit" label="Edit guardian" onClick={() => setGForm(g)} />
                </li>
              ))}
            </ul>
          )}
          <p className="small">
            Child-safety & production compliance: {t.child_safety_verified ? <strong>verified</strong> : <strong>not verified</strong>}. Change it in Edit profile.
          </p>
        </section>
      )}

      <section>
        <div className="section-head">
          <h3>Consent records</h3>
          <Button size="sm" icon="plus" onClick={() => setForm(blankConsent)}>Record consent</Button>
        </div>
        {t.consents.length === 0 ? (
          <Alert kind="warn">No consent recorded. Record permission to store their details and use their portfolio.</Alert>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Type</th><th>Status</th><th>Obtained</th><th>How</th><th>Scope</th><th>Evidence</th><th /></tr>
              </thead>
              <tbody>
                {t.consents.map((c) => (
                  <tr key={c.id}>
                    <td>{c.type_label}</td>
                    <td>
                      <span className={`pill pill-${c.is_effective ? "ok" : c.status === "withdrawn" ? "danger" : "warn"}`}>{c.status_label}</span>
                      {c.withdrawn_on && <div className="row-sub">Withdrawn {date(c.withdrawn_on)}</div>}
                      {c.expires_on && <div className="row-sub">Expires {date(c.expires_on)}</div>}
                    </td>
                    <td>{date(c.obtained_on)}{c.given_by && <div className="row-sub">by {c.given_by}</div>}</td>
                    <td>{labelOf(meta?.consent_method, c.method)}</td>
                    <td className="small">{c.scope}</td>
                    <td>{c.evidence_url ? <a href={c.evidence_url} target="_blank" rel="noreferrer">View file</a> : "—"}</td>
                    <td><IconButton icon="edit" label="Update" onClick={() => setForm({ ...c, expires_on: c.expires_on || "", withdrawn_on: c.withdrawn_on || "", obtained_on: c.obtained_on || "" })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">Consent records can't be deleted. Mark them withdrawn instead; that blocks shortlisting, booking and client exports and opens a retention review.</p>
      </section>

      {form && meta && (
        <Modal title={form.id ? "Update consent" : "Record consent"} onClose={() => setForm(null)} footer={<><Button onClick={() => setForm(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={saveConsent}>Save</Button></>}>
          <div className="stack">
            <Select label="Consent for" value={form.consent_type} onChange={upd("consent_type")} options={meta.consent_type} placeholder={null} disabled={!!form.id} />
            <Select label="Status" value={form.status} onChange={upd("status")} options={meta.consent_status} placeholder={null} error={errors.status} />
            {form.status === "withdrawn" && <Alert kind="warn">Withdrawing stops further use of this profile and opens a review of what data to keep or delete.</Alert>}
            <div className="pair">
              <TextInput label="Date obtained" type="date" value={form.obtained_on} onChange={upd("obtained_on")} error={errors.obtained_on} />
              <Select label="How it was obtained" value={form.method} onChange={upd("method")} options={meta.consent_method} error={errors.method} />
            </div>
            <TextInput label="Given by" value={form.given_by} onChange={upd("given_by")} hint={t.is_child ? "Parent or guardian's name" : "Usually the talent themselves"} />
            <TextArea label="Scope of allowed use" value={form.scope} onChange={upd("scope")} rows={2} placeholder="e.g. Share photos and videos with ad clients for casting only" />
            <div className="pair">
              <TextInput label="Expires on" type="date" value={form.expires_on} onChange={upd("expires_on")} />
              {form.status === "withdrawn" && <TextInput label="Withdrawn on" type="date" value={form.withdrawn_on} onChange={upd("withdrawn_on")} />}
            </div>
            <div className="field">
              <span className="field-label">Evidence file (signed form, screenshot)</span>
              <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} />
            </div>
            <TextArea label="Notes" value={form.notes} onChange={upd("notes")} rows={2} />
          </div>
        </Modal>
      )}
      {gForm && (
        <Modal title={gForm.id ? "Edit guardian" : "Add guardian"} onClose={() => setGForm(null)} footer={<><Button onClick={() => setGForm(null)}>Cancel</Button><Button variant="primary" busy={busy} disabled={!gForm.name || !gForm.phone} onClick={saveGuardian}>Save</Button></>}>
          <div className="stack">
            <TextInput label="Name" required value={gForm.name} onChange={(v) => setGForm((s) => ({ ...s, name: v }))} />
            <TextInput label="Relationship" required value={gForm.relationship} onChange={(v) => setGForm((s) => ({ ...s, relationship: v }))} />
            <TextInput label="Phone" required type="tel" value={gForm.phone} onChange={(v) => setGForm((s) => ({ ...s, phone: v }))} />
            <TextInput label="Email" type="email" value={gForm.email} onChange={(v) => setGForm((s) => ({ ...s, email: v }))} />
            <TextArea label="Address" value={gForm.address} onChange={(v) => setGForm((s) => ({ ...s, address: v }))} rows={2} />
            <Check label="ID document checked" checked={gForm.id_verified} onChange={(v) => setGForm((s) => ({ ...s, id_verified: v }))} />
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- History
export function HistorySection({ t }) {
  const { data, error, loading, reload } = useLoad(() => api.get(`talent/${t.id}/history/`), [t.id]);
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data.length) return <p className="muted">No changes recorded yet.</p>;
  const fmt = (v) => (Array.isArray(v) ? v.join(", ") : v === null || v === "" ? "empty" : String(v));
  return (
    <ol className="history">
      {data.map((e) => (
        <li key={e.id}>
          <div className="history-head">
            <strong>{e.actor}</strong> {actionLabel(e.action)}
            <time className="muted small">{dateTime(e.at)}</time>
          </div>
          {e.message && <p className="small">{e.message}</p>}
          {e.changes && Object.keys(e.changes).length > 0 && (
            <ul className="changes">
              {Object.entries(e.changes).map(([k, v]) => (
                <li key={k}>
                  <span className="muted">{k.replace(/_/g, " ")}:</span>{" "}
                  {Array.isArray(v) && v.length === 2 ? (
                    <>
                      <del>{fmt(v[0])}</del> <Icon name="chevron" size={12} /> <ins>{fmt(v[1])}</ins>
                    </>
                  ) : (
                    fmt(v)
                  )}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
