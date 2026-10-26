import { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { Alert, Button, Check, Modal, Select } from "./ui";

export default function ExportDialog({ filters, ids, onClose }) {
  const { toast } = useApp();
  const [format, setFormat] = useState("xlsx");
  const [audience, setAudience] = useState("internal");
  const [inc, setInc] = useState({ contact: true, fees: true, internal: false });
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const f = { ...(filters || {}) };
      delete f.page;
      const body = { format, audience, filters: f, ids: ids || [] };
      Object.entries(inc).forEach(([k, v]) => (body[`include_${k}`] = audience === "client" && k === "internal" ? false : v));
      const j = await api.post("exports/", body);
      setJob(j);
      toast(`Export ready: ${j.row_count} profiles`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={ids ? `Export ${ids.length} selected` : "Export these results"}
      onClose={onClose}
      footer={
        job ? (
          <>
            <Button onClick={onClose}>Close</Button>
            <a className="btn btn-primary" href={job.download_url}>Download {job.filename}</a>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" busy={busy} onClick={submit}>Create export</Button>
          </>
        )
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      {job ? (
        <p className="prose">
          The file is private to signed-in staff and the link expires on {new Date(job.expires_at).toLocaleString("en-IN")}. Downloads are recorded in the audit log.
        </p>
      ) : (
        <div className="stack">
          <Select label="Format" value={format} onChange={setFormat} placeholder={null} options={[{ value: "xlsx", label: "Excel (.xlsx)" }, { value: "csv", label: "CSV" }]} />
          <Select
            label="Who is this for?"
            value={audience}
            onChange={(v) => {
              setAudience(v);
              setInc(v === "client" ? { contact: false, fees: false, internal: false } : { contact: true, fees: true, internal: false });
            }}
            placeholder={null}
            options={[
              { value: "internal", label: "Internal use (staff only)" },
              { value: "client", label: "Sharing with a client" },
            ]}
            hint={audience === "client" ? "Client exports never include internal notes, and leave out anyone whose consent is withdrawn." : undefined}
          />
          <Check label="Include contact details" checked={inc.contact} onChange={(v) => setInc((s) => ({ ...s, contact: v }))} />
          <Check label="Include fees" checked={inc.fees} onChange={(v) => setInc((s) => ({ ...s, fees: v }))} />
          {audience === "internal" && (
            <Check label="Include internal notes" hint="Performance notes and the latest contact note." checked={inc.internal} onChange={(v) => setInc((s) => ({ ...s, internal: v }))} />
          )}
        </div>
      )}
    </Modal>
  );
}
