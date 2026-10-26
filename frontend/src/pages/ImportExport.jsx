import { useState } from "react";
import ExportDialog from "../components/ExportDialog";
import { PageHead } from "../components/Layout";
import { Alert, Button, Check, Empty, ErrorBox, Spinner, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { Link } from "../lib/router";
import { dateTime } from "../lib/util";

export default function ImportExport() {
  const [tab, setTab] = useState("import");
  return (
    <div>
      <PageHead title="Import & export" />
      <Tabs tabs={[{ value: "import", label: "Import" }, { value: "export", label: "Export" }]} value={tab} onChange={setTab} />
      <div className="tab-panel">{tab === "import" ? <Importer /> : <Exporter />}</div>
    </div>
  );
}

function Importer() {
  const { toast } = useApp();
  const [batch, setBatch] = useState(null);
  const [file, setFile] = useState(null);
  const [zip, setZip] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rowFilter, setRowFilter] = useState("all");
  const history = useLoad(() => api.get("imports/"), [batch?.status]);

  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      const b = await fn();
      setBatch(b);
      return b;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const upload = () => {
    const fd = new FormData();
    fd.append("file", file);
    if (zip) fd.append("photos_zip", zip);
    run(() => api.post("imports/", fd));
  };
  const validate = () => run(() => api.post(`imports/${batch.id}/validate/`, { mapping: batch.mapping }));
  const confirm = () => run(() => api.post(`imports/${batch.id}/confirm/`)).then((b) => b && toast(`Import finished: ${b.summary.created} created, ${b.summary.staged} in staging`));
  const setRow = async (row, patch) => {
    try {
      const r = await api.patch(`imports/${batch.id}/rows/${row.id}/`, patch);
      setBatch((b) => ({ ...b, rows: b.rows.map((x) => (x.id === row.id ? { ...x, ...r } : x)) }));
    } catch (e) {
      toast(e.message, "error");
    }
  };

  if (!batch)
    return (
      <div className="stack-lg">
        <section className="panel">
          <h2>Bring in a spreadsheet</h2>
          <p className="prose">
            Upload a CSV or Excel file with one person per row. You'll map the columns, see every problem and possible duplicate before anything is saved,
            and choose what happens to each row. Rows without a photo go to <Link to="/talent?status=staging">import staging</Link> instead of the directory.
          </p>
          <p>
            <a href="/api/imports/template/" className="link">Download a template CSV</a>
          </p>
          {error && <Alert kind="error">{error}</Alert>}
          <div className="grid-2">
            <div className="field">
              <label className="field-label" htmlFor="imp-file">Spreadsheet (.csv or .xlsx)<span className="req"> *</span></label>
              <input id="imp-file" type="file" accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onChange={(e) => setFile(e.target.files[0] || null)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="imp-zip">Photos (.zip, optional)</label>
              <input id="imp-zip" type="file" accept=".zip,application/zip" onChange={(e) => setZip(e.target.files[0] || null)} />
              <div className="field-hint">File names must match the "Photo filename" column.</div>
            </div>
          </div>
          <Button variant="primary" icon="upload" busy={busy} disabled={!file} onClick={upload}>Upload and map columns</Button>
        </section>
        <section>
          <h3>Recent imports</h3>
          {history.loading && <Spinner />}
          {history.data && history.data.length === 0 && <p className="muted">None yet.</p>}
          {history.data && history.data.length > 0 && (
            <ul className="plain">
              {history.data.map((b) => (
                <li key={b.id}>
                  <button className="link-btn" onClick={() => run(() => api.get(`imports/${b.id}/`))}>{b.original_name}</button>{" "}
                  <span className="muted small">
                    {dateTime(b.created_at)}, {b.total_rows} rows, {b.status}
                    {b.summary?.created != null && `: ${b.summary.created} created, ${b.summary.staged} staged, ${b.summary.skipped} skipped, ${b.summary.failed} failed`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );

  const mapped = Object.values(batch.mapping || {});
  const rows = (batch.rows || []).filter((r) =>
    rowFilter === "errors" ? r.errors.length : rowFilter === "duplicates" ? r.duplicates.length : rowFilter === "staging" ? r.action === "staging" : true
  );

  return (
    <div className="stack-lg">
      <div className="section-head">
        <h2>{batch.original_name}</h2>
        <Button onClick={() => (setBatch(null), setFile(null), setZip(null))}>Start over</Button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      {batch.status === "uploaded" || batch.status === "mapped" ? (
        <section className="panel">
          <h3>1. Match your columns</h3>
          <p className="muted small">Name, phone, location and category are required. Unmatched columns are ignored.</p>
          <div className="map-grid">
            {batch.headers.map((h) => (
              <label key={h} className="map-row">
                <span className="map-col">{h}</span>
                <select
                  className="input"
                  value={batch.mapping[h] || ""}
                  onChange={(e) => setBatch((b) => ({ ...b, mapping: { ...b.mapping, [h]: e.target.value } }))}
                >
                  <option value="">Ignore this column</option>
                  {batch.fields.map((f) => (
                    <option key={f.key} value={f.key} disabled={mapped.includes(f.key) && batch.mapping[h] !== f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <Button variant="primary" busy={busy} onClick={validate}>{batch.status === "mapped" ? "Validate again" : "Validate rows"}</Button>
        </section>
      ) : null}

      {batch.status === "mapped" && batch.rows && (
        <section className="panel">
          <h3>2. Review rows</h3>
          <div className="import-summary">
            <span><strong>{batch.summary.ok}</strong> ready</span>
            <span><strong>{batch.summary.staging}</strong> without photo (staging)</span>
            <span><strong>{batch.summary.duplicates}</strong> possible duplicates</span>
            <span><strong>{batch.summary.errors}</strong> with errors</span>
          </div>
          <Tabs
            value={rowFilter}
            onChange={setRowFilter}
            tabs={[
              { value: "all", label: "All rows" },
              { value: "errors", label: "Errors", count: batch.summary.errors },
              { value: "duplicates", label: "Duplicates", count: batch.summary.duplicates },
              { value: "staging", label: "No photo", count: batch.summary.staging },
            ]}
          />
          {rows.length === 0 ? (
            <p className="muted">Nothing in this view.</p>
          ) : (
            <div className="table-wrap">
              <table className="table import-table">
                <thead>
                  <tr><th>Row</th><th>Name</th><th>Phone</th><th>Location</th><th>Problems</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.errors.length ? "row-error" : r.duplicates.length ? "row-warn" : ""}>
                      <td>{r.row_number}</td>
                      <td>{r.data.full_name || <span className="muted">missing</span>}</td>
                      <td>{r.data.phone}</td>
                      <td>{r.data.city}</td>
                      <td className="small">
                        {r.errors.map((e) => <div key={e} className="text-error">{e}</div>)}
                        {r.warnings.map((e) => <div key={e} className="muted">{e}</div>)}
                        {r.duplicates.map((d) => (
                          <div key={d.id}>
                            <span className="pill pill-warn">{d.strength}</span> <Link to={`/talent/${d.id}`} target="_blank">{d.full_name} ({d.cast_id})</Link>: {d.reasons.join(", ")}
                          </div>
                        ))}
                        {r.duplicates.length > 0 && (
                          <Check label="Different person, import anyway" checked={r.duplicate_acknowledged} onChange={(v) => setRow(r, { duplicate_acknowledged: v, ...(v && r.action === "skip" && !r.errors.length ? { action: r.data.photo_filename ? "create" : "staging" } : {}) })} />
                        )}
                      </td>
                      <td>
                        <select className="input input-sm" value={r.action} disabled={r.errors.length > 0} onChange={(e) => setRow(r, { action: e.target.value })} aria-label={`Action for row ${r.row_number}`}>
                          {r.data.photo_filename && <option value="create">Create profile</option>}
                          <option value="staging">Import staging</option>
                          <option value="skip">Skip</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h3>3. Import</h3>
          <p className="muted small">Only rows set to Create or Import staging are saved. Duplicates are skipped unless you tick "Different person".</p>
          <Button variant="primary" busy={busy} onClick={confirm}>Import {batch.rows.filter((r) => r.action !== "skip" && (!r.duplicates.length || r.duplicate_acknowledged)).length} rows</Button>
        </section>
      )}

      {batch.status === "completed" && (
        <section className="panel">
          <h3>Import finished</h3>
          <div className="import-summary">
            <span><strong>{batch.summary.created}</strong> created</span>
            <span><strong>{batch.summary.staged}</strong> in staging</span>
            <span><strong>{batch.summary.skipped}</strong> skipped</span>
            <span><strong>{batch.summary.failed}</strong> failed</span>
          </div>
          {batch.summary.new_terms?.length > 0 && <p className="small">New terms created: {batch.summary.new_terms.join(", ")}</p>}
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Row</th><th>Name</th><th>Result</th></tr></thead>
              <tbody>
                {batch.rows.map((r) => (
                  <tr key={r.id} className={r.result === "failed" ? "row-error" : ""}>
                    <td>{r.row_number}</td>
                    <td>{r.talent ? <Link to={`/talent/${r.talent}`}>{r.data.full_name}</Link> : r.data.full_name}</td>
                    <td className="small">{r.result}: {r.result_message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link to="/talent?status=staging" className="btn">Open import staging</Link>
        </section>
      )}
    </div>
  );
}

function Exporter() {
  const { user, toast } = useApp();
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [media, setMedia] = useState(true);
  const list = useLoad(() => api.get("exports/"), []);
  const backup = async () => {
    setBusy(true);
    try {
      await api.post("exports/", { format: "backup", include_media: media });
      toast("Full backup ready to download");
      list.reload();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack-lg">
      <section className="panel">
        <h2>Export talent</h2>
        <p className="prose">
          To export a filtered list, set the filters in the <Link to="/talent">directory</Link> and choose Export there, or tick profiles and use Export selected.
        </p>
        <Button variant="primary" icon="download" onClick={() => setDialog(true)}>Export all active talent</Button>
      </section>
      {user.can_manage_backups && (
        <section className="panel">
          <h2>Full structured backup</h2>
          <p className="prose">A ZIP with every record as JSON (no passwords) and, optionally, all photos and files. Automatic daily backups run separately on the server.</p>
          <Check label="Include photos, videos and consent files" checked={media} onChange={setMedia} />
          <Button icon="download" busy={busy} onClick={backup}>Create full backup</Button>
        </section>
      )}
      <section>
        <h3>Recent exports</h3>
        <ErrorBox error={list.error} onRetry={list.reload} />
        {list.data && list.data.length === 0 && <Empty title="No exports yet" />}
        {list.data && list.data.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>File</th><th>Rows</th><th>By</th><th>Created</th><th>Expires</th><th /></tr></thead>
              <tbody>
                {list.data.map((j) => (
                  <tr key={j.id} className={j.is_expired ? "is-archived" : ""}>
                    <td>{j.filename}<div className="row-sub">{j.params?.audience === "client" ? "Client-facing" : j.format === "backup" ? "Full backup" : "Internal"}</div></td>
                    <td>{j.row_count}</td>
                    <td>{j.created_by}</td>
                    <td>{dateTime(j.created_at)}</td>
                    <td>{j.is_expired ? "Expired" : dateTime(j.expires_at)}</td>
                    <td>{j.download_url && <a className="btn btn-sm" href={j.download_url}>Download</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {dialog && <ExportDialog filters={{}} onClose={() => (setDialog(false), list.reload())} />}
    </div>
  );
}
