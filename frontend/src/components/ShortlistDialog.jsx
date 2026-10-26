import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { Link } from "../lib/router";
import { Alert, Button, Modal, Select, Spinner, TextArea } from "./ui";

export default function ShortlistDialog({ talentIds, roleId, onClose, onDone }) {
  const { toast } = useApp();
  const projects = useLoad(() => api.get("projects/", { status: "open", page_size: 100 }), []);
  const [projectId, setProjectId] = useState("");
  const [role, setRole] = useState(roleId ? String(roleId) : "");
  const [roles, setRoles] = useState([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (roleId) api.get(`roles/${roleId}/`).then((r) => setProjectId(String(r.project))).catch(() => {});
  }, [roleId]);
  useEffect(() => {
    if (!projectId) return setRoles([]);
    api.get("roles/", { project: projectId }).then(setRoles).catch(() => setRoles([]));
  }, [projectId]);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post("shortlist/add/", { role: Number(role), talent_ids: talentIds, notes });
      setResult(r);
      if (r.added.length) toast(`Shortlisted ${r.added.length} ${r.added.length === 1 ? "person" : "people"}`);
      if (!r.errors.length) onDone && onDone(r);
    } catch (e) {
      setResult({ added: [], errors: e.body?.errors?.length ? e.body.errors : [{ detail: e.message }] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Add ${talentIds.length} to a shortlist`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" busy={busy} disabled={!role} onClick={submit}>Add to shortlist</Button>
        </>
      }
    >
      {projects.loading && <Spinner />}
      {projects.data && projects.data.results.length === 0 && (
        <Alert kind="info">
          There are no open projects. <Link to="/projects?new=1">Create a project</Link> first.
        </Alert>
      )}
      {projects.data && projects.data.results.length > 0 && (
        <div className="stack">
          <Select
            label="Project"
            value={projectId}
            onChange={(v) => (setProjectId(v), setRole(""))}
            options={projects.data.results.map((p) => ({ value: String(p.id), label: `${p.title}${p.client_name ? ` — ${p.client_name}` : ""}` }))}
            placeholder="Choose a project"
          />
          <Select
            label="Role"
            value={role}
            onChange={setRole}
            options={roles.map((r) => ({ value: String(r.id), label: r.name }))}
            placeholder={projectId ? (roles.length ? "Choose a role" : "This project has no roles yet") : "Choose a project first"}
            disabled={!projectId}
          />
          <TextArea label="Note (optional)" value={notes} onChange={setNotes} rows={2} />
        </div>
      )}
      {result && result.errors.length > 0 && (
        <Alert kind="error">
          {result.errors.map((e, i) => (
            <div key={i}>
              {e.name ? <strong>{e.name}: </strong> : null}
              {e.detail}
            </div>
          ))}
        </Alert>
      )}
    </Modal>
  );
}
