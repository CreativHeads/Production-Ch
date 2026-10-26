import { useEffect, useMemo, useState } from "react";
import { PageHead } from "../components/Layout";
import TalentCard, { TalentRow } from "../components/TalentCard";
import ExportDialog from "../components/ExportDialog";
import ShortlistDialog from "../components/ShortlistDialog";
import { Button, Empty, ErrorBox, Icon, IconButton, Pagination, Select, Spinner, TermPicker, TextInput } from "../components/ui";
import { api, qs } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { Link, useLocation, useNavigate, useQuery } from "../lib/router";
import { cx, labelOf } from "../lib/util";

const SORTS = [
  { value: "name", label: "Name A–Z" },
  { value: "-name", label: "Name Z–A" },
  { value: "newest", label: "Newest first" },
  { value: "updated", label: "Recently updated" },
  { value: "age", label: "Playing age (youngest)" },
  { value: "-age", label: "Playing age (oldest)" },
  { value: "fee", label: "Fee (low to high)" },
  { value: "-fee", label: "Fee (high to low)" },
  { value: "last_contact", label: "Last contacted" },
];

const FILTER_KEYS = [
  "q", "category", "tag", "skill", "language", "accent", "gender", "age_min", "age_max", "city", "district", "location", "experience",
  "fee_min", "fee_max", "fee_type", "fee_unknown", "travel", "travel_min", "favorite", "completeness", "available_on", "available_strict",
  "booking_status", "last_contact_before", "last_contact_after", "never_contacted", "review", "status", "archived", "added_after",
];

const ids = (v) => (v ? String(v).split(",").filter(Boolean).map(Number) : []);
const VIEW_KEY = "ch.directory.view";

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) || "cards";
  } catch {
    return "cards";
  }
}

export default function Directory() {
  const { meta, terms } = useApp();
  const query = useQuery();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [view, setView] = useState(readView);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [dialog, setDialog] = useState(null);
  const [draftQ, setDraftQ] = useState(query.q || "");
  const page = Number(query.page || 1);
  const roleId = query.role;

  useEffect(() => setDraftQ(query.q || ""), [query.q]);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* private mode */
    }
  }, [view]);

  const params = useMemo(() => {
    const p = {};
    FILTER_KEYS.forEach((k) => query[k] && (p[k] = query[k]));
    p.sort = query.sort || "name";
    p.page = page;
    return p;
  }, [query, page]);

  const { data, error, loading, reload, setData } = useLoad(() => api.get("talent/", params), [JSON.stringify(params)]);
  const role = useLoad(() => (roleId ? api.get(`roles/${roleId}/`) : Promise.resolve(null)), [roleId]);
  const places = useLoad(() => api.get("talent/cities/"), []);

  const set = (patch) => {
    const next = { ...query, ...patch };
    if (!("page" in patch)) delete next.page;
    Object.keys(next).forEach((k) => (next[k] === "" || next[k] == null || (Array.isArray(next[k]) && !next[k].length)) && delete next[k]);
    Object.keys(next).forEach((k) => Array.isArray(next[k]) && (next[k] = next[k].join(",")));
    navigate(pathname + qs(next), { replace: true });
  };
  const reset = () => navigate(pathname + (roleId ? qs({ role: roleId }) : ""), { replace: true });
  const active = FILTER_KEYS.filter((k) => query[k] && k !== "q");

  const toggleSel = (id, on) =>
    setSelected((s) => {
      const n = new Set(s);
      on ? n.add(id) : n.delete(id);
      return n;
    });
  const setFav = (id, v) => setData((d) => ({ ...d, results: d.results.map((t) => (t.id === id ? { ...t, is_favorite: v } : t)) }));
  const from = pathname + search;

  const chip = (k) => {
    const v = query[k];
    const termName = (kind) => ids(v).map((i) => terms[kind].find((t) => t.id === i)?.name || i).join(" or ");
    const map = {
      category: () => termName("category"),
      tag: () => termName("tag"),
      skill: () => termName("skill"),
      language: () => termName("language"),
      gender: () => v.split(",").map((g) => labelOf(meta?.gender, g)).join(" or "),
      age_min: () => `Plays ${v}+`,
      age_max: () => `Plays up to ${v}`,
      fee_min: () => `Fee from ₹${v}`,
      fee_max: () => `Fee up to ₹${v}`,
      favorite: () => "My favourites",
      completeness: () => (v === "complete" ? "Complete profiles" : "Incomplete profiles"),
      available_on: () => `Free on ${v}`,
      review: () => labelOf(meta?.reminders, v),
      archived: () => (v === "only" ? "Archived only" : "Including archived"),
      status: () => (v === "staging" ? "Import staging" : labelOf([{ value: "needs_details", label: "Needs details" }, { value: "active", label: "Complete" }], v)),
      booking_status: () => v.replace(/_/g, " "),
      travel_min: () => `Travels: ${labelOf(meta?.travel, v)}+`,
      added_after: () => `Added since ${v}`,
    };
    return (map[k] ? map[k]() : `${k.replace(/_/g, " ")}: ${v}`) || v;
  };

  return (
    <div className="directory">
      <PageHead
        title={query.status === "staging" ? "Import staging" : "Talent directory"}
        subtitle={data ? `${data.count.toLocaleString("en-IN")} ${query.archived === "only" ? "archived" : ""} profiles` : " "}
        actions={
          <>
            <Button icon="download" onClick={() => setDialog("export")}>Export</Button>
            <Link to="/talent/new" className="btn btn-primary">
              <Icon name="plus" size={16} />
              <span>Add talent</span>
            </Link>
          </>
        }
      />

      {roleId && role.data && (
        <div className="role-banner">
          <div>
            Finding talent for <strong>{role.data.name}</strong> in <Link to={`/projects/${role.data.project}`}>{role.data.project_title}</Link>. Filters are pre-filled from
            the role requirements.
          </div>
          <Button size="sm" variant="primary" disabled={!selected.size} onClick={() => setDialog("shortlist")}>
            Shortlist {selected.size || ""} selected
          </Button>
        </div>
      )}

      <div className="dir-toolbar">
        <form className="dir-search" onSubmit={(e) => (e.preventDefault(), set({ q: draftQ }))}>
          <Icon name="search" />
          <input value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder="Name, cast ID, place, skill, language, tag" aria-label="Search the directory" />
          {draftQ && (
            <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => (setDraftQ(""), set({ q: "" }))}>
              <Icon name="x" size={14} />
            </button>
          )}
        </form>
        <Button icon="filter" className={cx(active.length && "has-badge")} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          Filters{active.length ? ` (${active.length})` : ""}
        </Button>
        <Select className="sort-select" label={null} value={params.sort} onChange={(v) => set({ sort: v })} options={SORTS} placeholder={null} aria-label="Sort by" />
        <div className="view-toggle" role="group" aria-label="Layout">
          <IconButton icon="grid" label="Photo cards" active={view === "cards"} onClick={() => setView("cards")} />
          <IconButton icon="list" label="Compact list" active={view === "list"} onClick={() => setView("list")} />
        </div>
      </div>

      {active.length > 0 && (
        <div className="active-filters">
          {active.map((k) => (
            <button key={k} className="chip" onClick={() => set({ [k]: "" })} aria-label={`Remove filter ${chip(k)}`}>
              {chip(k)} <Icon name="x" size={12} />
            </button>
          ))}
          <button className="link-btn" onClick={reset}>Reset filters</button>
        </div>
      )}

      {showFilters && (
        <FilterPanel query={query} set={set} meta={meta} terms={terms} places={places.data} onClose={() => setShowFilters(false)} onReset={reset} />
      )}

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span>{selected.size} selected</span>
          <Button size="sm" onClick={() => setDialog("shortlist")}>Add to shortlist</Button>
          <Button size="sm" onClick={() => setDialog("export-selected")}>Export selected</Button>
          <button className="link-btn" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && data.results.length === 0 && (
        <Empty
          title={active.length || query.q ? "No one matches these filters" : "The directory is empty"}
          action={active.length || query.q ? <Button onClick={reset}>Reset filters</Button> : <Link className="btn btn-primary" to="/talent/new">Add talent</Link>}
        >
          {active.length || query.q ? "Loosen a filter or try a different spelling. Archived profiles are hidden unless you include them." : "Start with Quick Add, or import a spreadsheet."}
        </Empty>
      )}
      {data && data.results.length > 0 && (
        <div className={cx(loading && "is-refreshing")}>
          {view === "cards" ? (
            <div className="card-grid">
              {data.results.map((t) => (
                <TalentCard key={t.id} t={t} from={from} onFavorite={setFav} selectable selected={selected.has(t.id)} onSelect={toggleSel} />
              ))}
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-check">
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        checked={data.results.every((t) => selected.has(t.id))}
                        onChange={(e) => data.results.forEach((t) => toggleSel(t.id, e.target.checked))}
                      />
                    </th>
                    <th />
                    <th>Name</th>
                    <th>Categories</th>
                    <th>Plays</th>
                    <th>Location</th>
                    <th>Languages</th>
                    <th className="num">Fee</th>
                    <th>Profile</th>
                    <th>Last contact</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((t) => (
                    <TalentRow key={t.id} t={t} from={from} onFavorite={setFav} selectable selected={selected.has(t.id)} onSelect={toggleSel} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={data.page} pages={data.pages} count={data.count} onPage={(p) => (set({ page: p }), window.scrollTo(0, 0))} />
        </div>
      )}

      {dialog === "export" && <ExportDialog filters={params} onClose={() => setDialog(null)} />}
      {dialog === "export-selected" && <ExportDialog ids={[...selected]} onClose={() => setDialog(null)} />}
      {dialog === "shortlist" && (
        <ShortlistDialog
          talentIds={[...selected]}
          roleId={roleId}
          onClose={() => setDialog(null)}
          onDone={() => {
            setSelected(new Set());
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function FilterPanel({ query, set, meta, terms, places, onClose, onReset }) {
  const [d, setD] = useState({ ...query });
  const upd = (k) => (v) => setD((s) => ({ ...s, [k]: Array.isArray(v) ? v.join(",") : v }));
  const multi = (k, list) => (
    <fieldset className="chips-field">
      <legend>{k.label}</legend>
      <div className="chip-set">
        {list.map((o) => {
          const vals = (d[k.key] || "").split(",").filter(Boolean);
          const on = vals.includes(o.value);
          return (
            <button
              type="button"
              key={o.value}
              className={cx("chip", on && "chip-on")}
              aria-pressed={on}
              onClick={() => upd(k.key)(on ? vals.filter((v) => v !== o.value) : [...vals, o.value])}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
  const apply = (e) => {
    e && e.preventDefault();
    const patch = {};
    FILTER_KEYS.forEach((k) => (patch[k] = d[k] || ""));
    set(patch);
    onClose();
  };
  return (
    <form className="filter-panel" onSubmit={apply} aria-label="Filters">
      <div className="filter-grid">
        <TermPicker label="Category" terms={terms.category} value={ids(d.category)} onChange={upd("category")} placeholder="Any category" />
        <TermPicker label="Tags" terms={terms.tag} value={ids(d.tag)} onChange={upd("tag")} placeholder="Any tag" />
        <TermPicker label="Skills" terms={terms.skill} value={ids(d.skill)} onChange={upd("skill")} placeholder="Any skill" />
        <TermPicker label="Languages" terms={terms.language} value={ids(d.language)} onChange={upd("language")} placeholder="Any language" />
        <TextInput label="Accent / dialect" value={d.accent} onChange={upd("accent")} placeholder="e.g. Malabar, Thrissur" />
        {meta && multi({ key: "gender", label: "Gender" }, meta.gender)}
        <div className="pair">
          <TextInput label="Playing age from" type="number" min="0" value={d.age_min} onChange={upd("age_min")} />
          <TextInput label="to" type="number" min="0" value={d.age_max} onChange={upd("age_max")} />
        </div>
        <Select label="City" value={d.city} onChange={upd("city")} options={(places?.cities || []).map((c) => ({ value: c, label: c }))} placeholder="Any city" />
        <Select label="District" value={d.district} onChange={upd("district")} options={(places?.districts || []).map((c) => ({ value: c, label: c }))} placeholder="Any district" />
        {meta && multi({ key: "experience", label: "Experience" }, meta.experience)}
        <div className="pair">
          <TextInput label="Fee from (₹)" type="number" min="0" value={d.fee_min} onChange={upd("fee_min")} />
          <TextInput label="Fee up to (₹)" type="number" min="0" value={d.fee_max} onChange={upd("fee_max")} />
        </div>
        {meta && multi({ key: "fee_type", label: "Fee type" }, meta.fee_type)}
        {meta && <Select label="Willing to travel at least" value={d.travel_min} onChange={upd("travel_min")} options={meta.travel} placeholder="Any" />}
        <TextInput label="Available on" type="date" value={d.available_on} onChange={upd("available_on")} hint="Hides anyone marked unavailable or booked that day." />
        <Select
          label="Booking status"
          value={d.booking_status}
          onChange={upd("booking_status")}
          placeholder="Any"
          options={[
            { value: "booked_upcoming", label: "Has an upcoming confirmed booking" },
            { value: "on_hold", label: "On tentative hold" },
            { value: "previously_booked", label: "Booked with us before" },
            { value: "never_booked", label: "Never booked" },
          ]}
        />
        <div className="pair">
          <TextInput label="Last contacted after" type="date" value={d.last_contact_after} onChange={upd("last_contact_after")} />
          <TextInput label="Not contacted since" type="date" value={d.last_contact_before} onChange={upd("last_contact_before")} />
        </div>
        <Select
          label="Profile completeness"
          value={d.completeness}
          onChange={upd("completeness")}
          placeholder="Any"
          options={[
            { value: "complete", label: "Complete" },
            { value: "incomplete", label: "Needs details" },
          ]}
        />
        {meta && <Select label="Needs review" value={d.review} onChange={upd("review")} options={meta.reminders} placeholder="Any" />}
        <Select
          label="Show"
          value={d.favorite === "1" ? "fav" : d.archived || ""}
          onChange={(v) => setD((s) => ({ ...s, favorite: v === "fav" ? "1" : "", archived: v === "fav" ? "" : v }))}
          placeholder="Active talent"
          options={[
            { value: "fav", label: "My favourites" },
            { value: "include", label: "Active and archived" },
            { value: "only", label: "Archived only" },
          ]}
        />
      </div>
      <div className="filter-foot">
        <button type="button" className="link-btn" onClick={() => (onReset(), onClose())}>Reset all</button>
        <Button onClick={onClose}>Close</Button>
        <Button type="submit" variant="primary">Show results</Button>
      </div>
    </form>
  );
}
