import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { CampaignDetail, CampaignForm, CastForm, InfluencerForm, Profile, ProjectDetail, ProjectForm, ShortlistTalent, TalentForm, deleteProject } from "./drawers";
import { Field, FormError, Heading, MultiSelectDropdown, Photo, Status, initials, money, pad2, shortDate, useData, useStudio } from "./shared";

async function exportTalent(format, filters, toast) {
  try {
    const job = await api.post("exports/", { format, audience: "internal", filters });
    window.location.href = job.download_url;
    toast("Export downloaded");
  } catch (e) {
    toast(e.message);
  }
}

function Stats() {
  const { data: s } = useData(() => api.get("studio/summary/"));
  const items = [
    ["Total talent", s?.total, "Your growing network", "♙"],
    ["Confirmed casts", s?.confirmed_casts, "Faces locked for active shoots", "✓"],
    ["Active projects", s?.active_projects, "Stories in the making", "▣"],
    ["Your favorites", s?.favorites, "The people you come back to", "♡"],
  ];
  return (
    <div className="stats">
      {items.map(([a, b, c, icon], i) => (
        <div className="stat" key={a}>
          <label>{a}<span>{icon}</span></label>
          <strong>{s ? pad2(b) : "··"}</strong>
          <small className={i === 1 ? "green" : ""}>{c}</small>
        </div>
      ))}
    </div>
  );
}

export function Card({ t, onFav }) {
  const { openDrawer, toast, refresh } = useStudio();
  const fav = async (e) => {
    e.stopPropagation();
    try {
      if (t.is_favorite) await api.del(`talent/${t.id}/favorite/`);
      else await api.post(`talent/${t.id}/favorite/`);
      onFav && onFav(t.id, !t.is_favorite);
      refresh();
    } catch (err) {
      toast(err.message);
    }
  };
  const isInf = t.talent_type === "influencer";
  const tags = isInf
    ? [t.influencer_niche, t.primary_platform, ...t.languages].filter(Boolean).slice(0, 3)
    : [...t.tags.map((x) => x.name), ...t.languages].slice(0, 3);
  const open = () => openDrawer(<Profile id={t.id} />);
  const label = isInf ? "✦ INFLUENCER" : (t.categories[0]?.name || "").toUpperCase();
  return (
    <article className="talent">
      <div className={"portrait" + (t.photo ? "" : " noimg")} onClick={open}>
        {t.photo ? <img src={t.photo.card} alt={t.full_name} loading="lazy" /> : initials(t.full_name)}
        <button className={"heart" + (t.is_favorite ? " saved" : "")} aria-label={`Favorite ${t.full_name}`} onClick={fav}>{t.is_favorite ? "♥" : "♡"}</button>
        {label && <span className={"image-label" + (isInf ? " is-influencer" : "")}>{label}</span>}
      </div>
      <div className="talentinfo">
        <div className="talentname" onClick={open}>
          <div>
            <h3>{t.full_name}</h3>
            {t.instagram && <small style={{ color: "#aaa", fontSize: 11, display: "block", marginTop: 2 }}>@{t.instagram.replace(/^@/, "")}</small>}
          </div>
          {isInf ? <span className="influencer-pill">✦ Influencer</span> : <span>↗</span>}
        </div>
        <div className="meta">⌖ {t.city} &nbsp;·&nbsp; {isInf && t.social_reach ? t.social_reach : `${t.age ?? "—"} years`}</div>
        <div className="tags">{tags.map((x) => <span className="tag" key={x}>{x}</span>)}</div>
        <div className="cardfoot">
          <span>{t.expected_fee ? money(t.expected_fee) : "Fee TBC"} <small>{isInf ? "/ post" : "/ day"}</small></span>
          <button onClick={() => openDrawer(<ShortlistTalent id={t.id} />)}>＋ Shortlist</button>
        </div>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------- talent directory (casts + influencers)
export function TalentPage() {
  const { openDrawer, toast, talentQuery, setTalentQuery, version } = useStudio();
  const [tab, setTab] = useState("cast");
  const [query, setQuery] = useState(talentQuery || "");
  const [debounced, setDebounced] = useState(query);
  const [cats, setCats] = useState([]);
  const [genders, setGenders] = useState([]);
  const [locs, setLocs] = useState([]);
  const [sort, setSort] = useState("recent");
  const [filters, setFilters] = useState(false);
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [maxFee, setMaxFee] = useState("");
  const [rows, setRows] = useState(null);
  const [counts, setCounts] = useState({ all: 0, cast: 0, inf: 0, fav: 0 });
  const { data: terms } = useData(() => api.get("terms/", { kind: "category" }));
  const { data: places } = useData(() => api.get("talent/cities/"));

  useEffect(() => {
    if (talentQuery) setTalentQuery("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const typeParam = tab === "cast" ? "cast" : tab === "influencers" ? "influencer" : "";
  const params = {
    ...(typeParam ? { type: typeParam } : {}),
    q: debounced,
    category: cats.join(","),
    gender: genders.join(","),
    city: locs.join(","),
    actual_age_min: minAge,
    actual_age_max: maxAge,
    fee_max: maxFee,
    favorite: tab === "fav" ? "1" : "",
    sort: tab === "recent" || sort === "recent" ? "newest" : sort === "fee" ? "fee" : "name",
    page_size: tab === "recent" ? 4 : 200,
  };

  useEffect(() => {
    let alive = true;
    api.get("talent/", params).then((d) => alive && setRows(d)).catch((e) => toast(e.message));
    Promise.all([
      api.get("talent/", { page_size: 1 }),
      api.get("talent/", { type: "cast", page_size: 1 }),
      api.get("talent/", { type: "influencer", page_size: 1 }),
      api.get("talent/", { favorite: "1", page_size: 1 }),
    ])
      .then(([a, c, inf, f]) => alive && setCounts({ all: a.count, cast: c.count, inf: inf.count, fav: f.count }))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(params), version]);

  const reset = () => {
    setMinAge(""); setMaxAge(""); setMaxFee(""); setQuery(""); setCats([]); setLocs([]); setGenders([]);
  };
  const exportFilters = { ...params, page_size: undefined };
  const shown = rows ? rows.results : [];

  return (
    <>
      <Heading eye="THE RIGHT PEOPLE. THE RIGHT STORY." title="Talent directory" sub="Actors, casts, models, and digital influencers in one unified network.">
        <button onClick={() => exportTalent("xlsx", exportFilters, toast)}>↥ &nbsp; Export</button>
        <button className="primary" onClick={() => openDrawer(<TalentForm />)}>＋ &nbsp; Add talent</button>
      </Heading>
      <Stats />
      <div className="tabs">
        <button className={tab === "cast" ? "on" : ""} onClick={() => setTab("cast")}>Actors & Cast <span>{counts.cast}</span></button>
        <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>All talent <span>{counts.all}</span></button>
        <button className={tab === "influencers" ? "on" : ""} onClick={() => setTab("influencers")}>✦ Influencers <span>{counts.inf}</span></button>
        <button className={tab === "fav" ? "on" : ""} onClick={() => setTab("fav")}>Favorites <span>{counts.fav}</span></button>
        <button className={tab === "recent" ? "on" : ""} onClick={() => setTab("recent")}>Recently added</button>
      </div>
      <div className="toolbar">
        <div className="search">
          <input aria-label="Search talent" placeholder="Search names, social handles, skills, or tags…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <MultiSelectDropdown
          label="All categories"
          options={terms || []}
          value={cats}
          onChange={setCats}
          ariaLabel="Category filter"
        />
        <MultiSelectDropdown
          label="All genders"
          options={[
            { value: "male", label: "Male" },
            { value: "female", label: "Female" },
            { value: "unspecified", label: "Not specified" },
          ]}
          value={genders}
          onChange={setGenders}
          ariaLabel="Gender filter"
        />
        <MultiSelectDropdown
          label="All locations"
          options={places?.cities || []}
          value={locs}
          onChange={setLocs}
          ariaLabel="Location filter"
        />
        <button onClick={() => setFilters(!filters)}>☷ &nbsp; Filters {filters ? "−" : "+"}</button>
      </div>
      {filters && (
        <div className="filterpanel">
          <label>Min age<input type="number" min="0" value={minAge} onChange={(e) => setMinAge(e.target.value)} /></label>
          <label>Max age<input type="number" value={maxAge} onChange={(e) => setMaxAge(e.target.value)} /></label>
          <label>Max fee ₹<input type="number" value={maxFee} onChange={(e) => setMaxFee(e.target.value)} /></label>
          <button onClick={reset}>Reset filters</button>
        </div>
      )}
      <div className="results">
        <span>Showing <b>{rows ? rows.count : 0} talent</b> in your directory</span>
        <span>
          Sort by{" "}
          <select aria-label="Sort talent" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="recent">Recently added</option>
            <option value="name">Name A–Z</option>
            <option value="fee">Lowest fee</option>
          </select>
        </span>
      </div>
      <div className="grid">
        {rows && shown.map((t) => <Card key={t.id} t={t} />)}
        {rows && shown.length === 0 && <div className="empty">No talent matches these filters. Try a broader search.</div>}
        {!rows && <div className="empty">Loading your directory…</div>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- campaigns page
export function CampaignsPage() {
  const { openDrawer, setSidebarCollapsed } = useStudio();
  const [selectedId, setSelectedId] = useState(null);
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const { data: allCampaigns } = useData(() => api.get("campaigns/", { scope: "all", q: query, location }), [query, location]);

  const openCampaign = (id) => {
    setSelectedId(id);
    setSidebarCollapsed(true);
  };

  const closeCampaign = () => {
    setSelectedId(null);
    setSidebarCollapsed(false);
  };

  if (selectedId) {
    return <CampaignDetail id={selectedId} onBack={closeCampaign} isPage />;
  }

  const list = allCampaigns || [];
  const planningList = list.filter((c) => c.status === "draft" || c.status === "planning");
  const inProgressList = list.filter((c) => c.status === "active");
  const completedList = list.filter((c) => c.status === "completed" || c.status === "cancelled");
  const activeAndPlanningList = list.filter((c) => c.status !== "completed" && c.status !== "cancelled");

  const shown = tab === "planning"
    ? planningList
    : tab === "in_progress"
    ? inProgressList
    : tab === "completed"
    ? completedList
    : activeAndPlanningList;

  return (
    <>
      <Heading eye="INFLUENCER CAMPAIGNS & CLIENT ROSTERS." title="Campaigns" sub="Brand activations, locked influencer rates, and finalized client deliveries.">
        <button className="primary" onClick={() => openDrawer(<CampaignForm />)}>＋ &nbsp; New campaign</button>
      </Heading>

      <div className="tabs">
        <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
          All active & planning <span>{activeAndPlanningList.length}</span>
        </button>
        <button className={tab === "planning" ? "on" : ""} onClick={() => setTab("planning")}>
          Planning & Draft <span>{planningList.length}</span>
        </button>
        <button className={tab === "in_progress" ? "on" : ""} onClick={() => setTab("in_progress")}>
          In Progress <span>{inProgressList.length}</span>
        </button>
        <button className={tab === "completed" ? "on" : ""} onClick={() => setTab("completed")}>
          Completed <span>{completedList.length}</span>
        </button>
      </div>

      <div className="toolbar">
        <div className="search">
          <input
            placeholder="Search campaigns by title, client, or city (e.g. Coimbatore)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <input
          placeholder="Filter city (e.g. Coimbatore)…"
          value={location}
          style={{ maxWidth: 220 }}
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>

      <div className="projectgrid">
        {shown.map((c) => (
          <article className="project campaign-card" key={c.id}>
            <div
              className="project-open"
              role="button"
              tabIndex={0}
              onClick={() => openCampaign(c.id)}
              onKeyDown={(e) => e.key === "Enter" && openCampaign(c.id)}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                <div className="projecticon" style={{ marginBottom: 0, background: "#1c2419", color: "#b9ff66" }}>✧</div>
                <span
                  className="status"
                  style={{
                    background: (c.status === "draft" || c.status === "planning") ? "#29210c" : c.status === "active" ? "#1b2e1be8" : "#222",
                    color: (c.status === "draft" || c.status === "planning") ? "#ffd276" : c.status === "active" ? "#95f589" : "#aaa",
                    border: (c.status === "draft" || c.status === "planning") ? "1px solid #544114" : "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  {(c.status === "draft" || c.status === "planning") ? "PLANNING / DRAFT" : c.status.toUpperCase()}
                </span>
              </div>

              <small style={{ letterSpacing: 1.2, fontWeight: 600 }}>{c.client_name ? c.client_name.toUpperCase() : "CLIENT"}</small>
              <h2 style={{ margin: "8px 0 10px", fontSize: 18 }}>{c.title}</h2>
              <p style={{ margin: "0 0 16px", color: "#aaa", fontSize: 12 }}>
                📍 {c.location || "Coimbatore"} &nbsp;·&nbsp; {c.start_date ? `${c.start_date} to ${c.end_date || "TBD"}` : "Dates TBD"}
              </p>

              {/* Roster & Budget summary */}
              <div className="campaign-card-kpis">
                <div>
                  <small style={{ margin: 0 }}>INFLUENCERS</small>
                  <strong style={{ fontSize: 16 }}>{c.influencers_count}</strong>
                </div>
                <div>
                  <small style={{ margin: 0 }}>FINALISED</small>
                  <strong style={{ fontSize: 16, color: "var(--accent)" }}>{c.finalised_count}</strong>
                </div>
                <div>
                  <small style={{ margin: 0 }}>AGREED RATE</small>
                  <strong style={{ fontSize: 16, color: "#6ef0a3" }}>₹{c.total_fixed_rate.toLocaleString("en-IN")}</strong>
                </div>
              </div>

              {/* Avatars preview */}
              {c.preview_photos && c.preview_photos.length > 0 && (
                <div className="campaign-avatars-preview">
                  {c.preview_photos.map((src, i) => (
                    <img key={i} src={src} alt="Influencer" className="mini" style={{ width: 28, height: 28, marginLeft: i > 0 ? -8 : 0, border: "2px solid #111" }} />
                  ))}
                  <span style={{ fontSize: 11, color: "#888", marginLeft: 8 }}>{c.influencers_count} attached</span>
                </div>
              )}
            </div>

            <div className="actions" style={{ marginTop: 18 }}>
              <button onClick={() => openCampaign(c.id)}>Open roster →</button>
              <button onClick={() => openDrawer(<CampaignForm campaign={c} />)}>Edit</button>
            </div>
          </article>
        ))}

        {allCampaigns && shown.length === 0 && (
          <div className="empty">
            {tab === "planning"
              ? "No planning / draft campaigns."
              : tab === "in_progress"
              ? "No campaigns in progress."
              : tab === "completed"
              ? "No completed campaigns."
              : "No campaigns found. Create one to begin."}
            <br />
            <button className="primary" style={{ marginTop: 14 }} onClick={() => openDrawer(<CampaignForm />)}>
              ＋ Create campaign
            </button>
          </div>
        )}
        {!allCampaigns && <div className="empty">Loading campaigns…</div>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- overview
export function OverviewPage() {
  const { openDrawer, go } = useStudio();
  const { data: projects } = useData(() => api.get("studio/projects/", { scope: "active" }));
  const { data: favs } = useData(() => api.get("talent/", { favorite: "1", page_size: 4, sort: "name" }));
  return (
    <>
      <Heading eye="TAKEBOARD BY CREATIVHEADS" title="Good stories start with good people." sub="Your casting workspace, at a glance.">
        <button className="primary" onClick={() => openDrawer(<TalentForm />)}>＋ Quick Add talent</button>
      </Heading>
      <Stats />
      <div className="cols">
        <div className="panel">
          <h2>In production <small>Your active projects</small></h2>
          {projects && projects.projects.length === 0 && <p>No active projects yet.</p>}
          {projects && projects.projects.map((p) => (
            <div className="row" key={p.id} onClick={() => openDrawer(<ProjectDetail id={p.id} />)} style={{ cursor: "pointer" }}>
              <div>{p.title}<small>{p.client_name} · {p.roles.length} roles</small></div>
              <Status s={p.studio_status} />
            </div>
          ))}
          <button style={{ marginTop: 20 }} onClick={() => go("projects")}>All projects →</button>
        </div>
        <div className="panel">
          <h2>A little attention goes a long way.</h2>
          <p>Keep profiles current so your next casting is easier.</p>
          <button style={{ marginTop: 25 }} onClick={() => go("reviews")}>Review profiles →</button>
        </div>
      </div>
      <h2 style={{ marginTop: 28 }}>Faces to remember <small>A few of your favorites</small></h2>
      <div className="grid">
        {favs && favs.results.map((t) => <Card key={t.id} t={t} />)}
        {favs && favs.results.length === 0 && <div className="empty">Tap ♡ on a talent card to keep them here.</div>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- projects
export function ProjectsPage() {
  const studio = useStudio();
  const { openDrawer } = studio;
  const [tab, setTab] = useState("active");
  const { data } = useData(() => api.get("studio/projects/", { scope: "all" }));
  const list = data ? data.projects.filter((p) => p.is_closed === (tab === "completed")) : [];
  const activeCount = data ? data.projects.filter((p) => !p.is_closed).length : 0;
  return (
    <>
      <Heading eye="FROM BRIEF TO BRILLIANT." title="Projects" sub="Every role, every confirmed face, every story.">
        <button className="primary" onClick={() => openDrawer(<ProjectForm />)}>＋ New project</button>
      </Heading>
      <div className="tabs">
        <button className={tab === "active" ? "on" : ""} onClick={() => setTab("active")}>Active projects <span>{activeCount}</span></button>
        <button className={tab === "completed" ? "on" : ""} onClick={() => setTab("completed")}>Completed <span>{data ? data.projects.length - activeCount : 0}</span></button>
      </div>
      <div className="projectgrid">
        {list.map((p) => {
          const confirmed = p.roles.filter((r) => r.confirmed);
          return (
            <article className={"project" + (p.studio_status === "Confirmed" ? " is-confirmed" : "")} key={p.id}>
              <div className="project-open" role="button" tabIndex={0} onClick={() => openDrawer(<ProjectDetail id={p.id} />)} onKeyDown={(e) => e.key === "Enter" && openDrawer(<ProjectDetail id={p.id} />)}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div className="projecticon">▣</div>
                  <Status s={p.studio_status} />
                </div>
                <small>{p.client_name.toUpperCase()}</small>
                <h2 style={{ margin: "10px 0" }}>{p.title}</h2>
                <p>{p.production_type.replace(/_/g, " ")} · Shoot {p.shoot_start || "TBC"}</p>
                <div className="bar"><i style={{ width: `${p.roles.length ? (100 * confirmed.length) / p.roles.length : 0}%` }} /></div>
                <div className="row"><small>{confirmed.length} / {p.roles.length} roles confirmed</small><span>↗</span></div>
                {confirmed.map((r) => <div className="confirmed-summary" key={r.id}>✓ {r.name} <b>{data.talent[r.confirmed.talent_id]?.full_name || "Talent"}</b></div>)}
              </div>
              <div className="actions" style={{ marginTop: 18 }}>
                <button onClick={() => openDrawer(<ProjectDetail id={p.id} />)}>View roles</button>
                <button onClick={() => openDrawer(<ProjectForm project={p} />)}>Edit project</button>
                <button onClick={() => deleteProject(p, studio)}>Delete</button>
              </div>
            </article>
          );
        })}
        {data && list.length === 0 && <div className="empty">{tab === "completed" ? "Completed shoots will appear here." : "No active projects. Create a project to start casting."}</div>}
        {!data && <div className="empty">Loading projects…</div>}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- shortlists
export function ShortlistsPage() {
  const { openDrawer, go, projectId, setProjectId, toast, refresh } = useStudio();
  const { data } = useData(() => api.get("studio/projects/", { scope: "active" }));
  const active = data ? data.projects : [];
  const p = active.find((x) => x.id === Number(projectId)) || active[0];
  async function remove(r, s) {
    if (r.confirmed && r.confirmed.talent_id === s.talent_id) {
      toast("Cancel or replace the confirmed cast in the project first");
      return;
    }
    await api.post(`shortlist/${s.entry_id}/remove/`, { reason: "Removed from shortlist" });
    refresh();
  }
  return (
    <>
      <Heading eye="THE POSSIBILITIES, TOGETHER." title="Role shortlists" sub="Only active projects. Completed shoots stay in project history.">
        {active.length > 0 && (
          <select aria-label="Select project" value={p?.id} onChange={(e) => setProjectId(Number(e.target.value))}>
            {active.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
        )}
      </Heading>
      {!data && <div className="empty">Loading shortlists…</div>}
      {data && !p && <div className="empty">No active projects to shortlist.<br />Completed projects are available in Projects → Completed.</div>}
      {p && p.roles.length === 0 && (
        <div className="empty">This project has no roles yet.<br /><button style={{ marginTop: 15 }} onClick={() => openDrawer(<ProjectDetail id={p.id} />)}>Add role requirements</button></div>
      )}
      {p && p.roles.map((r) => (
        <div className="panel" key={r.id}>
          <div className="titlebar">
            <div>
              <h2>{r.name}<small>{r.description}</small></h2>
              <p>Budget {money(r.budget)} / day · {r.shortlist.length} candidates</p>
            </div>
            <button onClick={() => go("talent")}>＋ Find talent</button>
          </div>
          {r.shortlist.length === 0 && <div className="empty">No candidates yet. Find talent to build this shortlist.</div>}
          {r.shortlist.map((s) => {
            const t = data.talent[s.talent_id];
            if (!t) return null;
            const isCast = r.confirmed && r.confirmed.talent_id === s.talent_id;
            return (
              <div className={"row" + (isCast ? " confirmed-row" : "")} key={s.entry_id}>
                <div className="rowperson" onClick={() => openDrawer(<Profile id={t.id} />)} style={{ cursor: "pointer" }}>
                  <Photo src={t.thumb} name={t.full_name} />
                  <div>{t.full_name}<small>{isCast ? "✓ CONFIRMED CAST · " : ""}{t.city} · {money(isCast ? r.confirmed.agreed_fee : t.expected_fee)}</small></div>
                </div>
                <div className="actions">
                  <button onClick={() => openDrawer(<CastForm projectId={p.id} roleId={r.id} talentId={t.id} />)}>{isCast ? "Edit cast" : "Confirm cast"}</button>
                  <button aria-label="Remove from shortlist" onClick={() => remove(r, s)}>×</button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- history
export function HistoryPage() {
  const { openDrawer, toast } = useStudio();
  const { data } = useData(() => api.get("studio/projects/", { scope: "all" }));
  return (
    <>
      <Heading eye="EVERY COLLABORATION COUNTS." title="Casting history" sub="Confirmed casts, agreed fees, and the changes along the way.">
        <button onClick={() => exportTalent("xlsx", {}, toast)}>↥ Export data</button>
      </Heading>
      {!data && <div className="empty">Loading history…</div>}
      {data && data.projects.length === 0 && <div className="empty">Your casting history starts with your first project.</div>}
      {data && data.projects.map((p) => (
        <div className="panel" key={p.id}>
          <div className="row">
            <h2>{p.title}<small>{p.shoot_start || "No shoot date"} · {p.client_name}</small></h2>
            <Status s={p.studio_status} />
          </div>
          {p.roles.map((r) => (
            <div key={r.id}>
              <div className="row">
                <div>{r.name}<small>{r.confirmed ? "Confirmed: " + (data.talent[r.confirmed.talent_id]?.full_name || "Talent") : "No confirmed cast"}</small></div>
                <span>{r.confirmed ? money(r.confirmed.agreed_fee) : "—"}</span>
              </div>
              {r.log.map((l, i) => <p key={i} style={{ fontSize: 11, padding: "8px 0", color: "#aaa" }}>{l.text} · {shortDate(l.date)}</p>)}
            </div>
          ))}
          <button style={{ marginTop: 15 }} onClick={() => openDrawer(<ProjectDetail id={p.id} />)}>View project →</button>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- categories & tags
function CategoryRow({ c }) {
  const { toast, refresh } = useStudio();
  const [editing, setEditing] = useState(false);
  async function rename(e) {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    try {
      await api.patch(`terms/${c.id}/`, { name });
      setEditing(false);
      refresh();
      toast("Category renamed");
    } catch (err) {
      toast(err.errors?.name ? "That category already exists" : err.message);
    }
  }
  async function remove() {
    if (!window.confirm(`Delete the category "${c.name}"?${c.usage ? ` ${c.usage} talent use it; their profiles are kept.` : ""}`)) return;
    try {
      await api.del(`terms/${c.id}/`);
      refresh();
      toast("Category deleted");
    } catch (err) {
      toast(err.message);
    }
  }
  if (editing) {
    return (
      <form className="row" onSubmit={rename}>
        <input name="name" defaultValue={c.name} required autoFocus style={{ flex: 1 }} />
        <div className="actions">
          <button type="button" onClick={() => setEditing(false)}>Cancel</button>
          <button className="primary">Save</button>
        </div>
      </form>
    );
  }
  return (
    <div className="row">
      <div>{c.name}<small>{c.usage} talent</small></div>
      <div className="actions">
        <button onClick={() => setEditing(true)}>Edit</button>
        <button onClick={remove}>Delete</button>
      </div>
    </div>
  );
}

export function CategoriesPage() {
  const { toast, refresh, go, setTalentQuery } = useStudio();
  const { data } = useData(() => api.get("terms/", { usage: "1" }));
  const cats = data ? data.filter((t) => t.kind === "category") : [];
  const tags = data ? data.filter((t) => t.kind === "tag" && t.usage > 0) : [];
  async function add(e) {
    e.preventDefault();
    const name = e.target.category.value.trim();
    if (!name) return;
    try {
      await api.post("terms/", { kind: "category", name });
      e.target.reset();
      refresh();
      toast("Category added");
    } catch (err) {
      toast(err.errors?.name ? "That category already exists" : err.message);
    }
  }
  return (
    <>
      <Heading eye="A PLACE FOR EVERY TALENT." title="Categories & tags" sub="Organize your network in a way that works for your team." />
      <div className="cols">
        <div className="panel">
          <h2>Talent categories</h2>
          {cats.map((c) => <CategoryRow key={c.id} c={c} />)}
          <form onSubmit={add} style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <input name="category" placeholder="New category" required style={{ flex: 1 }} />
            <button className="primary">＋ Add</button>
          </form>
        </div>
        <div className="panel">
          <h2>Tags in your workspace</h2>
          <p style={{ marginBottom: 20 }}>Skills, languages, and styles. Add tags when editing any talent profile.</p>
          <div className="tags">
            {tags.map((t) => <button className="tag" key={t.id} onClick={() => { setTalentQuery(t.name); go("talent"); }}>{t.name} ↗</button>)}
            {data && tags.length === 0 && <p>No tags in use yet.</p>}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- reviews
export function ReviewsPage() {
  const { openDrawer, toast, refresh } = useStudio();
  const { data } = useData(() => api.get("talent/", { page_size: 200, sort: "completeness" }));
  async function reviewed(t) {
    await api.post(`talent/${t.id}/mark-reviewed/`, { what: "all" });
    refresh();
    toast("Review recorded");
  }
  return (
    <>
      <Heading eye="KEEP YOUR NETWORK IN FOCUS." title="Profile reviews" sub="A simple way to keep talent details current." />
      <div className="panel">
        <h2>Needs a second look</h2>
        {!data && <p>Loading…</p>}
        {data && data.results.length === 0 && <p>Nothing to review yet.</p>}
        {data && data.results.map((t) => {
          const notes = [
            t.video_count < 3 ? "Featured videos missing" : "",
            t.rates_reviewed_at ? "Reviewed " + new Date(t.rates_reviewed_at).toLocaleDateString("en-IN") : "",
          ].filter(Boolean);
          return (
            <div className="row" key={t.id}>
              <div className="rowperson">
                <Photo src={t.photo?.thumb} name={t.full_name} />
                <div>{t.full_name}<small>{notes.join(" · ")}</small></div>
              </div>
              <div style={{ width: 120 }}>
                <small>{t.completeness}% complete</small>
                <div className="bar"><i style={{ width: `${t.completeness}%` }} /></div>
              </div>
              <div className="actions">
                <button onClick={() => openDrawer(<TalentForm id={t.id} />)}>Update</button>
                <button onClick={() => reviewed(t)}>Mark reviewed</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- settings
const PREFS = ["Profile review reminders", "Duplicate detection alerts"];
function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem("ch-prefs") || "{}");
  } catch {
    return {};
  }
}

export function SettingsPage() {
  const { user, setUser, settings, toast, refresh } = useStudio();
  const [tab, setTab] = useState("Workspace");
  const [prefs, setPrefs] = useState(readPrefs);
  const [error, setError] = useState(null);
  const staff = useData(() => (user.is_superuser ? api.get("auth/staff/") : Promise.resolve([])), [user.id]);

  async function saveWorkspace(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    await api.patch("settings/", { studio_name: f.name, studio_location: f.location });
    refresh();
    toast("Workspace details saved");
  }
  async function addStaff(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const [first, ...rest] = f.name.trim().split(" ");
    try {
      await api.post("auth/staff/", { username: f.username, first_name: first || "", last_name: rest.join(" "), email: f.email, password: f.password });
      e.target.reset();
      setError(null);
      refresh();
      toast("Staff account created");
    } catch (err) {
      setError(err);
    }
  }
  async function toggleStaff(s) {
    try {
      await api.patch(`auth/staff/${s.id}/`, { is_active: !s.is_active });
      refresh();
      toast(s.is_active ? "Account deactivated" : "Account reactivated");
    } catch (err) {
      toast(err.message);
    }
  }
  async function changePassword(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await api.post("auth/password/change/", f);
      e.target.reset();
      setError(null);
      toast("Password changed");
    } catch (err) {
      setError(err);
    }
  }
  async function signOut() {
    await api.post("auth/logout/").catch(() => {});
    setUser(null);
  }
  async function backup() {
    try {
      const job = await api.post("exports/", { format: "backup", include_media: true });
      window.location.href = job.download_url;
      toast("Backup downloaded");
    } catch (err) {
      toast(err.message);
    }
  }
  const togglePref = (i) => {
    const next = { ...prefs, [i]: prefs[i] === false };
    setPrefs(next);
    try {
      localStorage.setItem("ch-prefs", JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <>
      <Heading eye="MAKE YOURSELF AT HOME." title="Workspace settings" sub="The details that keep your studio running smoothly." />
      <div className="settingsnav">
        {["Workspace", "Staff & security", "Data & backups", "Preferences"].map((s) => (
          <button key={s} className={tab === s ? "on" : ""} onClick={() => { setTab(s); setError(null); }}>{s}</button>
        ))}
      </div>
      {tab === "Workspace" && (
        <div className="panel">
          <h2>Studio details</h2>
          <form onSubmit={saveWorkspace} key={settings?.updated_at}>
            <div className="formgrid">
              <Field label="Workspace name" name="name" value={settings?.studio_name || "TakeBoard Studio"} />
              <Field label="Location" name="location" value={settings?.studio_location || "Kottakkal, Kerala"} />
              <Field label="Default currency" name="currency" value="INR — Indian Rupee" readOnly />
              <Field label="Timezone" name="timezone" value="Asia/Kolkata" readOnly />
            </div>
            <div className="formactions"><button className="primary">Save changes</button></div>
          </form>
        </div>
      )}
      {tab === "Staff & security" && (
        <>
          <div className="panel">
            <h2>Staff access</h2>
            {(user.is_superuser ? staff.data || [] : [{ id: user.id, name: user.name, username: user.username, is_superuser: false, is_active: true }]).map((s) => (
              <div className="row" key={s.id}>
                <div className="rowperson">
                  <span className="avatar">{initials(s.name)}</span>
                  <div>{s.name}<small>{s.username}{s.email ? " · " + s.email : ""}{s.last_login ? " · Last sign-in " + shortDate(s.last_login) : ""}</small></div>
                </div>
                <div className="actions">
                  <span className="tag">{s.is_superuser ? "Owner" : s.is_active ? "Staff" : "Deactivated"}</span>
                  {user.is_superuser && s.id !== user.id && <button onClick={() => toggleStaff(s)}>{s.is_active ? "Deactivate" : "Reactivate"}</button>}
                </div>
              </div>
            ))}
            {user.is_superuser && (
              <form onSubmit={addStaff} style={{ marginTop: 20 }}>
                <h3 style={{ marginBottom: 15 }}>Add a staff member</h3>
                <div className="formgrid">
                  <Field label="Full name *" name="name" required />
                  <Field label="Username *" name="username" required />
                  <Field label="Work email" name="email" type="email" />
                  <Field label="Temporary password * (10+ characters)" name="password" type="password" required minLength={10} />
                </div>
                <div className="formactions"><button className="primary">Create account</button></div>
              </form>
            )}
          </div>
          <div className="panel">
            <h2>Your password</h2>
            <form onSubmit={changePassword}>
              <div className="formgrid">
                <Field label="Current password" name="current_password" type="password" required />
                <Field label="New password (10+ characters)" name="new_password" type="password" required minLength={10} />
              </div>
              <FormError error={error} />
              <div className="formactions">
                <button type="button" onClick={signOut}>Sign out</button>
                <button className="primary">Change password</button>
              </div>
            </form>
          </div>
        </>
      )}
      {tab === "Data & backups" && (
        <div className="panel">
          <h2>Your casting data</h2>
          <p>Download your talent directory for spreadsheets, or a full backup of everything.</p>
          <div className="row"><div>Export talent (Excel)<small>Profiles with contact details and fees. The link expires after a day.</small></div><button onClick={() => exportTalent("xlsx", {}, toast)}>Download XLSX ↓</button></div>
          <div className="row"><div>Export talent (CSV)<small>Opens in Excel, Google Sheets and Numbers.</small></div><button onClick={() => exportTalent("csv", {}, toast)}>Download CSV ↓</button></div>
          {user.can_manage_backups && (
            <div className="row"><div>Full backup<small>Every record and photo in one ZIP. Keep it somewhere safe.</small></div><button onClick={backup}>Download ZIP ↓</button></div>
          )}
          <div className="row"><div>Automatic backups<small>Hostinger takes daily backups of the database and photos.</small></div><span className="tag">Hostinger daily</span></div>
        </div>
      )}
      {tab === "Preferences" && (
        <div className="panel">
          <h2>Workspace preferences</h2>
          {PREFS.map((s, i) => (
            <div className="row" key={s}>
              <div>{s}<small>Saved on this device.</small></div>
              <button aria-label={`Toggle ${s}`} className={"switch" + (prefs[i] === false ? " off" : "")} onClick={() => togglePref(i)} />
            </div>
          ))}
          <div className="row"><div>Appearance<small>True black · #000000</small></div><span className="tag">Dark studio</span></div>
        </div>
      )}
    </>
  );
}
