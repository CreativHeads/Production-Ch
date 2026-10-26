import { useState } from "react";
import BookingForm from "../components/BookingForm";
import { PageHead } from "../components/Layout";
import { Empty, ErrorBox, Pagination, Select, Spinner, Tabs } from "../components/ui";
import { api, qs } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { Link, useLocation, useNavigate, useQuery } from "../lib/router";
import { cx } from "../lib/util";
import { BookingTable } from "./ProjectDetail";

function monthBounds(ym) {
  const [y, m] = ym.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start, end, startStr: iso(start), endStr: iso(new Date(y, m, 0)) };
}

export default function Bookings() {
  const { meta } = useApp();
  const query = useQuery();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const now = new Date();
  const view = query.view || (query.upcoming ? "upcoming" : "upcoming");
  const month = query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const set = (p) => navigate(pathname + qs({ ...query, ...p }), { replace: true });
  const [open, setOpen] = useState(null);

  const params =
    view === "calendar"
      ? { start: monthBounds(month).startStr, end: monthBounds(month).endStr, page_size: 200 }
      : view === "upcoming"
        ? { upcoming: 1, status: query.status || "", page: query.page || 1 }
        : { status: query.status || "", page: query.page || 1 };
  const { data, error, loading, reload } = useLoad(() => api.get("bookings/", params), [JSON.stringify(params)]);

  return (
    <div>
      <PageHead title="Bookings" subtitle="Confirmed shoots and tentative holds across every project." />
      <div className="dir-toolbar">
        <Tabs
          value={view}
          onChange={(v) => set({ view: v, page: "", upcoming: "" })}
          tabs={[
            { value: "upcoming", label: "Upcoming" },
            { value: "calendar", label: "Calendar" },
            { value: "all", label: "All" },
          ]}
        />
        {view !== "calendar" && meta && <Select label={null} aria-label="Status" value={query.status || ""} onChange={(v) => set({ status: v, page: "" })} options={meta.booking_status} placeholder="Any status" />}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data && <Spinner />}
      {data && view === "calendar" && <MonthGrid month={month} bookings={data.results} onMonth={(m) => set({ month: m })} />}
      {data && view !== "calendar" && data.results.length === 0 && (
        <Empty title={view === "upcoming" ? "No upcoming shoots" : "No bookings yet"}>Bookings are made from a shortlisted candidate inside a project.</Empty>
      )}
      {data && view !== "calendar" && data.results.length > 0 && (
        <>
          <BookingTable bookings={data.results} showProject onOpen={(b) => setOpen(b)} />
          <Pagination page={data.page} pages={data.pages} count={data.count} onPage={(p) => set({ page: p })} />
        </>
      )}
      {open && <BookingForm booking={open} onClose={() => setOpen(null)} onSaved={() => (setOpen(null), reload())} />}
    </div>
  );
}

function MonthGrid({ month, bookings, onMonth }) {
  const { start } = monthBounds(month);
  const y = start.getFullYear();
  const m = start.getMonth();
  const first = (start.getDay() + 6) % 7; // Monday first
  const days = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(d);
  const shift = (n) => {
    const d = new Date(y, m + n, 1);
    onMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const on = (d) =>
    bookings.filter((b) => {
      const s = new Date(b.shoot_start);
      const e = new Date(b.shoot_end);
      const dayStart = new Date(y, m, d);
      const dayEnd = new Date(y, m, d + 1);
      return s < dayEnd && e > dayStart && b.status !== "cancelled";
    });
  const today = new Date();
  return (
    <div className="calendar">
      <div className="cal-head">
        <button className="btn btn-ghost btn-sm" onClick={() => shift(-1)}>Previous</button>
        <h2>{start.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => shift(1)}>Next</button>
      </div>
      <div className="cal-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="cal-dow">{d}</div>
        ))}
        {cells.map((d, i) => (
          <div key={i} className={cx("cal-cell", !d && "is-blank", d && today.getFullYear() === y && today.getMonth() === m && today.getDate() === d && "is-today")}>
            {d && <span className="cal-num">{d}</span>}
            {d &&
              on(d).map((b) => (
                <Link key={b.id} to={`/projects/${b.project}`} className={`cal-ev cal-ev-${b.status}`} title={`${b.talent_name} as ${b.role_name}, ${b.project_title}`}>
                  {b.talent_name.split(" ")[0]}, {b.role_name}
                </Link>
              ))}
          </div>
        ))}
      </div>
      <p className="muted small">Solid entries are confirmed; outlined entries are tentative holds.</p>
    </div>
  );
}
