import { PageHead } from "../components/Layout";
import { Button, Empty, ErrorBox, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { dateTime } from "../lib/util";

export default function Trash() {
  const { toast } = useApp();
  const talent = useLoad(() => api.get("talent/trash/", { page_size: 100 }), []);
  const projects = useLoad(() => api.get("projects/trash/"), []);
  const restore = async (path, msg, reload) => {
    try {
      await api.post(path);
      toast(msg);
      reload();
    } catch (e) {
      toast(e.message, "error");
    }
  };
  return (
    <div className="narrow">
      <PageHead title="Trash" subtitle="Deleted records stay here so they can be recovered." />
      <section>
        <h2>Talent</h2>
        <ErrorBox error={talent.error} onRetry={talent.reload} />
        {talent.loading && <Spinner />}
        {talent.data && talent.data.results.length === 0 && <Empty title="No deleted talent" />}
        {talent.data && talent.data.results.length > 0 && (
          <ul className="trash-list">
            {talent.data.results.map((t) => (
              <li key={t.id}>
                <span>
                  <strong>{t.full_name}</strong> <span className="muted small">{t.cast_id}, {t.city}</span>
                  <small>Deleted {dateTime(t.deleted_at)}{t.deleted_by ? ` by ${t.deleted_by}` : ""}</small>
                </span>
                <Button size="sm" onClick={() => restore(`talent/trash/${t.id}/restore/`, `${t.full_name} restored`, talent.reload)}>Restore</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mt">
        <h2>Projects</h2>
        {projects.data && projects.data.length === 0 && <Empty title="No deleted projects" />}
        {projects.data && projects.data.length > 0 && (
          <ul className="trash-list">
            {projects.data.map((p) => (
              <li key={p.id}>
                <span>
                  <strong>{p.title}</strong> <span className="muted small">{p.code}</span>
                  <small>Deleted {dateTime(p.deleted_at)}</small>
                </span>
                <Button size="sm" onClick={() => restore(`projects/trash/${p.id}/restore/`, `${p.title} restored`, projects.reload)}>Restore</Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
