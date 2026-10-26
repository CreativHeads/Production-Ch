import { useState } from "react";
import { PageHead } from "../components/Layout";
import { Alert, Button, Empty, ErrorBox, Modal, Pagination, Select, Spinner, TextArea, TextInput } from "../components/ui";
import { api, qs } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { Link, useLocation, useNavigate, useQuery } from "../lib/router";
import { date, money } from "../lib/util";

export default function Projects() {
  const { meta } = useApp();
  const query = useQuery();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(query.new === "1");
  const [q, setQ] = useState(query.q || "");
  const params = { status: query.status || "", q: query.q || "", page: query.page || 1, sort: query.sort || "-created_at" };
  const { data, error, loading, reload } = useLoad(() => api.get("projects/", params), [JSON.stringify(params)]);
  const set = (p) => navigate(pathname + qs({ ...query, ...p, ...(p.page ? {} : { page: "" }), new: "" }), { replace: true });

  return (
    <div>
      <PageHead title="Casting projects" actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>New project</Button>} />
      <div className="dir-toolbar">
        <form className="dir-search" onSubmit={(e) => (e.preventDefault(), set({ q }))}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, client, code, location" aria-label="Search projects" />
        </form>
        <Select
          label={null}
          aria-label="Status"
          value={params.status}
          onChange={(v) => set({ status: v })}
          placeholder="All except archived"
          options={[{ value: "open", label: "Open (draft to in production)" }, ...(meta?.project_status || [])]}
        />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && data.results.length === 0 && (
        <Empty title="No projects here" action={<Button variant="primary" onClick={() => setCreating(true)}>Create a project</Button>}>
          A project holds the roles you're casting for, their shortlists and the final bookings.
        </Empty>
      )}
      {data && data.results.length > 0 && (
        <>
          <div className="project-list">
            {data.results.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="project-row">
                <span className={`pill pill-${p.status}`}>{p.status_label}</span>
                <span className="project-main">
                  <strong>{p.title}</strong>
                  <small>{[p.client_name, p.production_type_label, p.location].filter(Boolean).join(", ")}</small>
                </span>
                <span className="project-code">{p.code}</span>
                <span className="small">{p.shoot_start ? `${date(p.shoot_start)}${p.shoot_end && p.shoot_end !== p.shoot_start ? ` – ${date(p.shoot_end)}` : ""}` : "Dates not set"}</span>
                <span className="small">{p.role_count} role{p.role_count === 1 ? "" : "s"}{p.positions_needed ? `, ${p.positions_needed} to cast` : ""}</span>
                <span className="small num">{money(p.budget, p.currency)}</span>
              </Link>
            ))}
          </div>
          <Pagination page={data.page} pages={data.pages} count={data.count} onPage={(pg) => set({ page: pg })} />
        </>
      )}
      {creating && <ProjectForm onClose={() => setCreating(false)} onSaved={(p) => navigate(`/projects/${p.id}`)} />}
    </div>
  );
}

export function ProjectForm({ project, onClose, onSaved }) {
  const { meta } = useApp();
  const [f, setF] = useState(
    project || { title: "", client_name: "", code: "", description: "", production_type: "ad_film", shoot_start: "", shoot_end: "", location: "", budget: "", status: "casting", notes: "" }
  );
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const upd = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      const body = { ...f, shoot_start: f.shoot_start || null, shoot_end: f.shoot_end || null, budget: f.budget === "" ? null : f.budget };
      const p = project ? await api.patch(`projects/${project.id}/`, body) : await api.post("projects/", body);
      onSaved(p);
    } catch (e) {
      setErrors(Object.fromEntries(Object.entries(e.errors || {}).map(([k, v]) => [k, v.join(" ")])));
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={project ? "Edit project" : "New casting project"} onClose={onClose} wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!f.title.trim()} onClick={save}>{project ? "Save project" : "Create project"}</Button></>}>
      {msg && <Alert kind="error">{msg}</Alert>}
      <div className="grid-2">
        <TextInput label="Project title" required value={f.title} onChange={upd("title")} error={errors.title} />
        <TextInput label="Client" value={f.client_name} onChange={upd("client_name")} />
        <TextInput label="Project code" value={f.code} onChange={upd("code")} error={errors.code} hint={project ? undefined : "Leave blank to generate one, e.g. CH-PRJ-2026-0012"} />
        {meta && <Select label="Production type" value={f.production_type} onChange={upd("production_type")} options={meta.production_type} placeholder={null} />}
        <TextInput label="Shoot starts" type="date" value={f.shoot_start || ""} onChange={upd("shoot_start")} />
        <TextInput label="Shoot ends" type="date" value={f.shoot_end || ""} onChange={upd("shoot_end")} error={errors.shoot_end} />
        <TextInput label="Location" value={f.location} onChange={upd("location")} />
        <TextInput label="Budget (₹, optional)" type="number" min="0" value={f.budget ?? ""} onChange={upd("budget")} />
        {meta && <Select label="Status" value={f.status} onChange={upd("status")} options={meta.project_status} placeholder={null} />}
      </div>
      <TextArea label="Description / brief" value={f.description} onChange={upd("description")} rows={3} />
      <TextArea label="Internal notes" value={f.notes} onChange={upd("notes")} rows={2} />
    </Modal>
  );
}
