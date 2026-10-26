import TalentCard from "../components/TalentCard";
import { Empty, ErrorBox, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { Link } from "../lib/router";
import { actionLabel, date, relative } from "../lib/util";

const METRICS = [
  ["active_talent", "Active talent"],
  ["needs_completion", "Profiles needing completion"],
  ["upcoming_bookings", "Upcoming bookings"],
  ["open_projects", "Open casting projects"],
  ["recently_added", "Added in the last 30 days"],
  ["favorites", "My favourites"],
  ["requiring_review", "Profiles requiring review"],
];

function activityLink(e) {
  if (e.entity_type === "talent") return `/talent/${e.entity_id}`;
  if (e.entity_type === "project") return `/projects/${e.entity_id}`;
  return null;
}

export default function Dashboard() {
  const { user } = useApp();
  const { data, error, loading, reload, setData } = useLoad(() => api.get("dashboard/"), []);
  const first = user.first_name || user.name;

  const setFav = (key) => (id, v) =>
    setData((d) => ({ ...d, [key]: d[key].map((t) => (t.id === id ? { ...t, is_favorite: v } : t)) }));

  return (
    <div className="dashboard">
      <section className="hero">
        <p className="eyebrow">CreativHeads Studio</p>
        <h1 className="hero-line">Good stories start with good people.</h1>
        <p className="page-sub">Good to see you, {first}. Your casting workspace, at a glance.</p>
      </section>
      {loading && !data && <Spinner />}
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <>
          <section className="metrics" aria-label="Workspace summary">
            {METRICS.map(([key, label]) => (
              <Link key={key} to={data.metrics[key].link} className="metric">
                <span className="metric-num">{data.metrics[key].count.toLocaleString("en-IN")}</span>
                <span className="metric-label">{label}</span>
              </Link>
            ))}
            <Link to={data.metrics.staging.link} className={data.metrics.staging.count ? "metric metric-warn" : "metric"}>
              <span className="metric-num">{data.metrics.staging.count}</span>
              <span className="metric-label">Imported, waiting for a photo</span>
            </Link>
          </section>

          <div className="dash-grid">
            <section className="panel">
              <header className="panel-head">
                <h2>Upcoming bookings</h2>
                <Link to="/bookings?upcoming=1" className="link">All bookings</Link>
              </header>
              {data.upcoming_bookings.length === 0 ? (
                <p className="muted">No shoots scheduled. Bookings appear here once a role is filled.</p>
              ) : (
                <ul className="timeline">
                  {data.upcoming_bookings.map((b) => (
                    <li key={b.id}>
                      <span className="tl-date">{date(b.shoot_start, { day: "numeric", month: "short" })}</span>
                      <span>
                        <Link to={`/talent/${b.talent_id}`}>{b.talent}</Link> as {b.role}
                        <small>
                          <Link to={`/projects/${b.project_id}`}>{b.project}</Link>
                          {b.status === "tentative" && " (on hold)"}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <header className="panel-head">
                <h2>Needs a look</h2>
                <Link to="/reminders" className="link">Review queue</Link>
              </header>
              <ul className="reminder-list">
                {data.reminders.map((r) => (
                  <li key={r.key}>
                    <Link to={r.key === "follow_up_due" ? "/reminders" : `/talent?review=${r.key}`} className={r.count ? "" : "muted"}>
                      <span>{r.label}</span>
                      <strong>{r.count}</strong>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel panel-activity">
              <header className="panel-head">
                <h2>Recent casting activity</h2>
                <Link to="/audit" className="link">Full log</Link>
              </header>
              {data.activity.length === 0 ? (
                <p className="muted">Nothing yet. Shortlists, bookings and contact notes will show up here.</p>
              ) : (
                <ul className="activity">
                  {data.activity.map((e) => {
                    const href = activityLink(e);
                    return (
                      <li key={e.id}>
                        <span className="act-who">{e.actor}</span> {actionLabel(e.action)}{" "}
                        {href ? <Link to={href}>{e.label}</Link> : e.label}
                        {e.message && <span className="act-msg"> — {e.message}</span>}
                        <time>{relative(e.at)}</time>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          <section className="strip">
            <header className="panel-head">
              <h2>Recently added</h2>
              <Link to="/talent?sort=newest" className="link">See all</Link>
            </header>
            {data.recent_talent.length ? (
              <div className="card-row">
                {data.recent_talent.map((t) => (
                  <TalentCard key={t.id} t={t} onFavorite={setFav("recent_talent")} />
                ))}
              </div>
            ) : (
              <Empty title="No talent yet" action={<Link className="btn btn-primary" to="/talent/new">Add the first profile</Link>}>
                Add someone with Quick Add, or bring in a spreadsheet from Import & export.
              </Empty>
            )}
          </section>

          {data.favorites.length > 0 && (
            <section className="strip">
              <header className="panel-head">
                <h2>My favourites</h2>
                <Link to="/talent?favorite=1" className="link">See all</Link>
              </header>
              <div className="card-row">
                {data.favorites.map((t) => (
                  <TalentCard key={t.id} t={t} onFavorite={setFav("favorites")} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
