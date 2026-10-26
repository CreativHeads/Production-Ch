import { useState } from "react";
import BookingForm from "../components/BookingForm";
import { PageHead } from "../components/Layout";
import { Alert, Button, Confirm, Empty, ErrorBox, IconButton, Modal, Select, Spinner, TermPicker, TextArea, TextInput } from "../components/ui";
import { api, qs } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { Link, useNavigate, useParams } from "../lib/router";
import { actionLabel, cx, date, dateTime, labelOf, money, relative } from "../lib/util";
import { ProjectForm } from "./Projects";

export default function ProjectDetail() {
  const { id } = useParams();
  const { meta, toast } = useApp();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api.get(`projects/${id}/board/`), [id]);
  const [editing, setEditing] = useState(false);
  const [roleForm, setRoleForm] = useState(null);
  const [booking, setBooking] = useState(null);
  const [history, setHistory] = useState(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { project: p, roles, shortlist, bookings } = data;

  const changeStatus = async (status) => {
    try {
      await api.patch(`projects/${p.id}/`, { status });
      toast(`Project marked ${labelOf(meta?.project_status, status)}`);
      reload();
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const findTalent = async (role) => {
    try {
      const r = await api.get(`roles/${role.id}/search-filters/`);
      navigate(`/talent${qs({ ...r.filters, role: role.id })}`);
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <div className="project">
      <PageHead
        title={p.title}
        subtitle={[p.code, p.client_name, p.production_type_label].filter(Boolean).join(", ")}
        back={{ to: "/projects", label: "Projects" }}
        actions={
          <>
            {meta && <Select label={null} aria-label="Project status" value={p.status} onChange={changeStatus} options={meta.project_status} placeholder={null} />}
            <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>
          </>
        }
      />
      <section className="project-facts">
        <div><span>Shoot</span>{p.shoot_start ? `${date(p.shoot_start)}${p.shoot_end ? ` – ${date(p.shoot_end)}` : ""}` : "Not set"}</div>
        <div><span>Location</span>{p.location || "Not set"}</div>
        <div><span>Budget</span>{money(p.budget, p.currency) || "Not set"}</div>
        <div><span>Booked</span>{bookings.filter((b) => b.status !== "cancelled").length} of {roles.reduce((n, r) => n + r.positions_needed, 0)} positions</div>
      </section>
      {p.description && <p className="pre project-desc">{p.description}</p>}
      {p.notes && <Alert kind="info">{p.notes}</Alert>}

      <div className="section-head">
        <h2>Roles</h2>
        <div className="row-gap">
          <label className="check small"><input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> Show removed candidates</label>
          <Button variant="primary" icon="plus" onClick={() => setRoleForm({ project: p.id })}>Add role</Button>
        </div>
      </div>
      {roles.length === 0 && <Empty title="No roles yet">Add each character or position you need to cast. Their requirements become search filters.</Empty>}
      {roles.map((r) => (
        <RoleCard
          key={r.id}
          role={r}
          project={p}
          entries={shortlist.filter((s) => s.role === r.id && (showRemoved || !s.is_removed))}
          bookings={bookings.filter((b) => b.role === r.id)}
          onEdit={() => setRoleForm(r)}
          onFind={() => findTalent(r)}
          onBook={(entry) => setBooking({ entry, role: r })}
          onHistory={(entry) => setHistory(entry)}
          onChange={reload}
        />
      ))}

      <h2 className="mt">Bookings</h2>
      {bookings.length === 0 ? (
        <p className="muted">No bookings yet. Book a shortlisted candidate from their role above.</p>
      ) : (
        <BookingTable bookings={bookings} onOpen={(b) => setBooking({ booking: b })} />
      )}

      <div className="danger-zone">
        <button className="link-btn danger" onClick={() => setConfirmDelete(true)}>Move project to trash</button>
      </div>

      {editing && <ProjectForm project={p} onClose={() => setEditing(false)} onSaved={() => (setEditing(false), reload(), toast("Project saved"))} />}
      {roleForm && <RoleForm role={roleForm} onClose={() => setRoleForm(null)} onSaved={() => (setRoleForm(null), reload())} />}
      {booking && (
        <BookingForm
          booking={booking.booking}
          entry={booking.entry}
          role={booking.role}
          project={p}
          onClose={() => setBooking(null)}
          onSaved={() => (setBooking(null), reload())}
        />
      )}
      {history && <ShortlistHistory entry={history} onClose={() => setHistory(null)} />}
      {confirmDelete && (
        <Confirm
          title="Move this project to trash?"
          danger
          confirmLabel="Move to trash"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              await api.del(`projects/${p.id}/`);
              toast("Project moved to trash");
              navigate("/projects");
            } catch (e) {
              toast(e.message, "error");
            }
          }}
        >
          Roles, shortlists and bookings are kept and come back if you restore it from Trash. To close a finished project, set its status to Completed or Archived instead.
        </Confirm>
      )}
    </div>
  );
}

export function BookingTable({ bookings, onOpen, showProject }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th />
            <th>Talent</th>
            {showProject && <th>Project</th>}
            <th>Role</th>
            <th>Shoot</th>
            <th>Status</th>
            <th className="num">Agreed fee</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id} className={b.status === "cancelled" ? "is-archived" : ""}>
              <td className="col-photo">{b.talent_photo ? <img className="portrait portrait-thumb" src={b.talent_photo} alt="" /> : null}</td>
              <td>
                <Link to={`/talent/${b.talent}`} className="row-name">{b.talent_name}</Link>
                <div className="row-sub">{b.talent_cast_id}</div>
              </td>
              {showProject && <td><Link to={`/projects/${b.project}`}>{b.project_title}</Link></td>}
              <td>{b.role_name}</td>
              <td>
                {dateTime(b.shoot_start)}
                <div className="row-sub">to {dateTime(b.shoot_end)}</div>
              </td>
              <td>
                <span className={`pill pill-${b.status}`}>{b.status_label}</span>
                {b.conflict_override && <div className="row-sub" title={b.override_reason}>Conflict overridden</div>}
              </td>
              <td className="num">{money(b.agreed_fee, b.currency) || <span className="muted">{money(b.proposed_fee, b.currency) ? `proposed ${money(b.proposed_fee, b.currency)}` : "—"}</span>}</td>
              <td>{onOpen && <Button size="sm" onClick={() => onOpen(b)}>Open</Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoleCard({ role: r, project, entries, bookings, onEdit, onFind, onBook, onHistory, onChange }) {
  const { meta, toast } = useApp();
  const [removing, setRemoving] = useState(null);
  const live = entries.filter((e) => !e.is_removed);
  const filled = bookings.filter((b) => b.status !== "cancelled").length;

  const patch = async (entry, body, msg) => {
    try {
      await api.patch(`shortlist/${entry.id}/`, body);
      msg && toast(msg);
      onChange();
    } catch (e) {
      toast(e.message, "error");
    }
  };
  const move = async (entry, dir) => {
    const order = live.map((e) => e.id);
    const i = order.indexOf(entry.id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    try {
      await api.post("shortlist/reorder/", { role: r.id, order });
      onChange();
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const req = [
    r.gender_preference !== "any" && labelOf(meta?.role_gender, r.gender_preference),
    (r.age_min || r.age_max) && `age ${r.age_min ?? "?"}–${r.age_max ?? "?"}`,
    r.category_names.length && r.category_names.join("/"),
    r.language_names.length && r.language_names.join(", "),
    r.accent_requirements,
    r.skill_names.length && r.skill_names.join(", "),
    r.location,
    r.budget && `budget ${money(r.budget)}${r.fee_basis ? " " + labelOf(meta?.fee_basis, r.fee_basis).toLowerCase() : ""}`,
    r.shoot_start && `shoot ${date(r.shoot_start)}${r.shoot_end && r.shoot_end !== r.shoot_start ? ` – ${date(r.shoot_end)}` : ""}`,
  ].filter(Boolean);

  return (
    <section className="role-card">
      <header className="role-head">
        <div>
          <h3>
            {r.name} <span className="muted small">{filled}/{r.positions_needed} booked</span>
          </h3>
          {req.length > 0 && <p className="small">{req.join(", ")}</p>}
          {r.description && <p className="small muted">{r.description}</p>}
        </div>
        <div className="row-gap">
          <Button size="sm" icon="search" variant="primary" onClick={onFind}>Find talent</Button>
          <IconButton icon="edit" label="Edit role" onClick={onEdit} />
        </div>
      </header>
      {entries.length === 0 ? (
        <p className="muted small">No candidates yet. Use Find talent to search with this role's requirements.</p>
      ) : (
        <div className="table-wrap">
          <table className="table shortlist">
            <thead>
              <tr>
                <th>#</th>
                <th />
                <th>Candidate</th>
                <th>Status</th>
                <th className="num">Proposed fee</th>
                <th>Availability</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.id} className={cx(e.is_removed && "is-archived")}>
                  <td className="col-order">
                    {!e.is_removed && (
                      <>
                        <IconButton icon="up" label="Move up" disabled={i === 0} onClick={() => move(e, -1)} />
                        <IconButton icon="down" label="Move down" disabled={i === live.length - 1} onClick={() => move(e, 1)} />
                      </>
                    )}
                  </td>
                  <td className="col-photo">{e.talent_detail.photo && <img className="portrait portrait-thumb" src={e.talent_detail.photo} alt="" />}</td>
                  <td>
                    <Link to={`/talent/${e.talent}`} className="row-name">{e.talent_detail.full_name}</Link>
                    <div className="row-sub">
                      {e.talent_detail.city}, <a href={`tel:${e.talent_detail.phone}`}>{e.talent_detail.phone}</a>
                    </div>
                    {e.talent_detail.consent_hold && <span className="pill pill-danger">Consent withdrawn</span>}
                  </td>
                  <td>
                    {meta && !e.is_removed ? (
                      <select className="input input-sm" value={e.status} onChange={(ev) => patch(e, { status: ev.target.value })} aria-label="Shortlist status">
                        {meta.shortlist_status.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <span className="pill">{e.status_label} (removed)</span>
                    )}
                  </td>
                  <td className="num">
                    <InlineMoney value={e.proposed_fee} disabled={e.is_removed} onSave={(v) => patch(e, { proposed_fee: v }, "Fee updated")} />
                  </td>
                  <td>
                    <label className="check small">
                      <input type="checkbox" checked={e.availability_confirmed} disabled={e.is_removed} onChange={(ev) => patch(e, { availability_confirmed: ev.target.checked })} />
                      {e.availability_confirmed ? `Confirmed ${relative(e.availability_confirmed_at)}` : "Not confirmed"}
                    </label>
                  </td>
                  <td className="small">
                    <InlineText value={e.notes} disabled={e.is_removed} onSave={(v) => patch(e, { notes: v })} />
                  </td>
                  <td className="col-actions">
                    {!e.is_removed && !e.has_booking && <Button size="sm" onClick={() => onBook(e)}>Book</Button>}
                    {e.has_booking && <span className="pill pill-confirmed">Booked</span>}
                    <IconButton icon="history" label="Shortlist history" onClick={() => onHistory(e)} />
                    {e.is_removed ? (
                      <button className="link-btn" onClick={async () => (await api.post(`shortlist/${e.id}/restore/`), onChange())}>Restore</button>
                    ) : (
                      <IconButton icon="x" label="Remove from shortlist" onClick={() => setRemoving(e)} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {removing && (
        <Confirm
          title={`Remove ${removing.talent_detail.full_name} from this shortlist?`}
          confirmLabel="Remove"
          needsReason={false}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await api.post(`shortlist/${removing.id}/remove/`, {});
              setRemoving(null);
              onChange();
            } catch (err) {
              toast(err.message, "error");
            }
          }}
        >
          Their profile isn't affected and the shortlist history is kept. You can restore them later.
        </Confirm>
      )}
    </section>
  );
}

function InlineMoney({ value, onSave, disabled }) {
  const [v, setV] = useState(value ?? "");
  const [editing, setEditing] = useState(false);
  if (!editing || disabled)
    return (
      <button className="inline-edit" disabled={disabled} onClick={() => setEditing(true)} title="Edit proposed fee">
        {money(value) || "Add"}
      </button>
    );
  return (
    <input
      className="input input-sm"
      type="number"
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => (setEditing(false), String(v) !== String(value ?? "") && onSave(v === "" ? null : v))}
      onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
      aria-label="Proposed fee"
    />
  );
}

function InlineText({ value, onSave, disabled }) {
  const [v, setV] = useState(value || "");
  const [editing, setEditing] = useState(false);
  if (!editing || disabled)
    return (
      <button className="inline-edit inline-text" disabled={disabled} onClick={() => setEditing(true)} title="Edit note">
        {value || <span className="muted">Add note</span>}
      </button>
    );
  return (
    <textarea
      className="input input-sm"
      rows={2}
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => (setEditing(false), v !== (value || "") && onSave(v))}
      aria-label="Shortlist note"
    />
  );
}

function ShortlistHistory({ entry, onClose }) {
  const { data, loading } = useLoad(() => api.get(`shortlist/${entry.id}/history/`), [entry.id]);
  return (
    <Modal title={`History: ${entry.talent_detail.full_name}, ${entry.role_name}`} onClose={onClose}>
      {loading && <Spinner />}
      {data && (
        <ol className="history">
          {data.map((e) => (
            <li key={e.id}>
              <div className="history-head">
                <strong>{e.actor_name}</strong> {e.action === "status" ? `changed status from ${e.from_value} to ${e.to_value}` : e.action === "fee" ? `changed proposed fee from ${e.from_value || "none"} to ${e.to_value || "none"}` : e.action === "priority" ? `moved from #${e.from_value} to #${e.to_value}` : actionLabel(e.action)}
                <time className="muted small">{dateTime(e.created_at)}</time>
              </div>
              {e.note && <p className="small">{e.note}</p>}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

function RoleForm({ role, onClose, onSaved }) {
  const { meta, terms, toast } = useApp();
  const [f, setF] = useState({
    name: "", description: "", positions_needed: 1, gender_preference: "any", age_min: "", age_max: "", languages: [], accent_requirements: "",
    categories: [], tags: [], skills: [], location: "", travel_requirement: "", travel_notes: "", budget: "", fee_basis: "", shoot_start: "", shoot_end: "", notes: "",
    ...role,
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const upd = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const nul = (v) => (v === "" || v === undefined ? null : v);
  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      const body = { ...f, age_min: nul(f.age_min), age_max: nul(f.age_max), budget: nul(f.budget), shoot_start: nul(f.shoot_start), shoot_end: nul(f.shoot_end) };
      role.id ? await api.patch(`roles/${role.id}/`, body) : await api.post("roles/", body);
      toast("Role saved");
      onSaved();
    } catch (e) {
      setErrors(Object.fromEntries(Object.entries(e.errors || {}).map(([k, v]) => [k, v.join(" ")])));
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    try {
      await api.del(`roles/${role.id}/`);
      toast("Role removed");
      onSaved();
    } catch (e) {
      setMsg(e.message);
    }
  };
  return (
    <Modal
      wide
      title={role.id ? `Edit role: ${role.name}` : "Add role"}
      onClose={onClose}
      footer={
        <>
          {role.id && <button className="link-btn danger" onClick={remove}>Delete role</button>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!f.name.trim()} onClick={save}>Save role</Button>
        </>
      }
    >
      {msg && <Alert kind="error">{msg}</Alert>}
      <div className="grid-2">
        <TextInput label="Character / role name" required value={f.name} onChange={upd("name")} error={errors.name} placeholder="e.g. Young mother, Shop owner" />
        <TextInput label="Number of people needed" type="number" min="1" value={f.positions_needed} onChange={upd("positions_needed")} />
        {meta && <Select label="Gender" value={f.gender_preference} onChange={upd("gender_preference")} options={meta.role_gender} placeholder={null} />}
        <div className="pair">
          <TextInput label="Playing age from" type="number" value={f.age_min ?? ""} onChange={upd("age_min")} />
          <TextInput label="to" type="number" value={f.age_max ?? ""} onChange={upd("age_max")} error={errors.age_max} />
        </div>
        <TermPicker label="Categories" terms={terms.category} value={f.categories} onChange={upd("categories")} />
        <TermPicker label="Look / tags" terms={terms.tag} value={f.tags} onChange={upd("tags")} />
        <TermPicker label="Languages" terms={terms.language} value={f.languages} onChange={upd("languages")} />
        <TextInput label="Accent requirements" value={f.accent_requirements} onChange={upd("accent_requirements")} placeholder="e.g. Malabar" />
        <TermPicker label="Skills" terms={terms.skill} value={f.skills} onChange={upd("skills")} />
        <TextInput label="Location" value={f.location} onChange={upd("location")} />
        {meta && <Select label="Must travel at least" value={f.travel_requirement} onChange={upd("travel_requirement")} options={meta.travel} placeholder="No requirement" />}
        <TextInput label="Travel notes" value={f.travel_notes} onChange={upd("travel_notes")} />
        <TextInput label="Role budget (₹)" type="number" min="0" value={f.budget ?? ""} onChange={upd("budget")} />
        {meta && <Select label="Fee basis" value={f.fee_basis} onChange={upd("fee_basis")} options={meta.fee_basis} />}
        <TextInput label="Shoot from" type="date" value={f.shoot_start || ""} onChange={upd("shoot_start")} />
        <TextInput label="Shoot to" type="date" value={f.shoot_end || ""} onChange={upd("shoot_end")} error={errors.shoot_end} />
      </div>
      <TextArea label="Description" value={f.description} onChange={upd("description")} rows={2} />
      <TextArea label="Role notes" value={f.notes} onChange={upd("notes")} rows={2} />
    </Modal>
  );
}
