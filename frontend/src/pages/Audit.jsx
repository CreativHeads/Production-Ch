import { useState } from "react";
import { PageHead } from "../components/Layout";
import { ErrorBox, Pagination, Select, Spinner } from "../components/ui";
import { api, qs } from "../lib/api";
import { useLoad } from "../lib/app";
import { Link, useLocation, useNavigate, useQuery } from "../lib/router";
import { actionLabel, dateTime } from "../lib/util";

const GROUPS = [
  { value: "auth.", label: "Sign-ins & passwords" },
  { value: "user.", label: "Staff accounts" },
  { value: "talent.", label: "Talent changes" },
  { value: "shortlist.", label: "Shortlists" },
  { value: "booking.", label: "Bookings" },
  { value: "project.", label: "Projects" },
  { value: "export.", label: "Exports & downloads" },
  { value: "import.", label: "Imports" },
  { value: "settings.", label: "Settings" },
  { value: "media.", label: "Sensitive file access" },
  { value: "backup.", label: "Backups" },
];

export default function Audit() {
  const query = useQuery();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState(query.q || "");
  const params = { action: query.action || "", q: query.q || "", page: query.page || 1, page_size: 50 };
  const { data, error, loading, reload } = useLoad(() => api.get("audit/", params), [JSON.stringify(params)]);
  const set = (p) => navigate(pathname + qs({ ...query, ...p }), { replace: true });
  const link = (e) => (e.entity_type === "talent" ? `/talent/${e.entity_id}` : e.entity_type === "project" ? `/projects/${e.entity_id}` : null);
  return (
    <div>
      <PageHead title="Audit log" subtitle="Every sign-in, important change, export and download." />
      <div className="dir-toolbar">
        <form className="dir-search" onSubmit={(e) => (e.preventDefault(), set({ q, page: "" }))}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names or messages" aria-label="Search the audit log" />
        </form>
        <Select label={null} aria-label="Type" value={params.action} onChange={(v) => set({ action: v, page: "" })} options={GROUPS} placeholder="Everything" />
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && (
        <>
          <div className="table-wrap">
            <table className="table audit">
              <thead><tr><th>When</th><th>Who</th><th>What</th><th>Record</th><th>Details</th></tr></thead>
              <tbody>
                {data.results.map((e) => (
                  <tr key={e.id}>
                    <td className="nowrap small">{dateTime(e.at)}</td>
                    <td>{e.actor}</td>
                    <td>{actionLabel(e.action)}</td>
                    <td>{link(e) ? <Link to={link(e)}>{e.label}</Link> : e.label}</td>
                    <td className="small">
                      {e.message}
                      {e.changes && Object.keys(e.changes).length > 0 && (
                        <details>
                          <summary>{Object.keys(e.changes).length} field{Object.keys(e.changes).length === 1 ? "" : "s"}</summary>
                          <pre>{JSON.stringify(e.changes, null, 1)}</pre>
                        </details>
                      )}
                      {e.ip && <div className="muted">IP {e.ip}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} pages={data.pages} count={data.count} onPage={(p) => set({ page: p })} />
        </>
      )}
    </div>
  );
}
