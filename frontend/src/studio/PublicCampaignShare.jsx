import React, { useEffect, useState } from "react";
import "../studio.css";

function getDayOfWeek(dateStr) {
  if (!dateStr) return "";
  const match = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [, y, m, d] = match;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (!isNaN(date.getTime())) {
      return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
    }
  }
  return "";
}

function formatRate(v) {
  if (v === null || v === undefined || v === "") return "0";
  const num = Number(v);
  if (isNaN(num)) return String(v);
  return num.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function getProfileLink(raw, platform) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  const handle = s.replace(/^@/, "");
  return `https://www.instagram.com/${handle}/`;
}

function getStatusBadge(st) {
  const norm = (st || "not_contacted").toLowerCase();
  switch (norm) {
    case "finalised":
    case "finalized":
    case "confirmed":
      return { label: "✓ Finalized", bg: "#0d2614", color: "#4ade80", border: "#1f6b34" };
    case "completed":
      return { label: "✓ Completed", bg: "#0a2622", color: "#2dd4bf", border: "#166155" };
    case "shortlisted":
      return { label: "★ Shortlisted", bg: "#231433", color: "#c084fc", border: "#55267f" };
    case "contacted":
    case "pitched":
      return { label: "Contacted", bg: "#0f2338", color: "#60a5fa", border: "#1e4d7a" };
    case "no_response":
      return { label: "No Respond", bg: "#1f1f1f", color: "#a3a3a3", border: "#3d3d3d" };
    case "rejected":
    case "declined":
      return { label: "Rejected", bg: "#2c1214", color: "#f87171", border: "#6e2327" };
    default:
      return { label: "Not Contacted", bg: "#2b210c", color: "#fbbf24", border: "#694d13" };
  }
}

export default function PublicCampaignShare({ campaignId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all"); // all | finalised | shortlisted
  const [viewMode, setViewMode] = useState("cards"); // cards | table
  const [lightboxImg, setLightboxImg] = useState(null);

  useEffect(() => {
    let unmounted = false;
    async function load() {
      try {
        setLoading(true);
        const res = await fetch(`/api/public/campaigns/${encodeURIComponent(campaignId)}/`);
        if (!res.ok) {
          throw new Error(`Campaign not found or link expired (HTTP ${res.status})`);
        }
        const json = await res.json();
        if (!unmounted) setData(json);
      } catch (err) {
        if (!unmounted) setError(err.message);
      } finally {
        if (!unmounted) setLoading(false);
      }
    }
    load();
    return () => {
      unmounted = true;
    };
  }, [campaignId]);

  if (loading) {
    return (
      <div className="client-share-shell">
        <div className="client-share-boot">
          <img src="/Takeboard White_Logo.png" alt="TakeBoard" style={{ width: 150, marginBottom: 20 }} />
          <div className="client-share-spinner" />
          <p style={{ color: "#aaa", fontSize: 14, marginTop: 16 }}>Loading campaign showcase for client…</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="client-share-shell">
        <div className="client-share-boot" style={{ maxWidth: 440 }}>
          <img src="/Takeboard White_Logo.png" alt="TakeBoard" style={{ width: 140, marginBottom: 20 }} />
          <h2 style={{ color: "#ff7373", fontSize: 20, margin: "0 0 10px" }}>Campaign Unavailable</h2>
          <p style={{ color: "#888", fontSize: 13, lineHeight: 1.5 }}>
            {error || "The requested campaign could not be loaded. Please request a new link from CreativHeads."}
          </p>
        </div>
      </div>
    );
  }

  const roster = data.roster || [];
  const finalisedList = roster.filter((i) => i.status === "finalised" || i.status === "confirmed");
  const shortlistedList = roster.filter((i) => i.status === "shortlisted");

  let filtered = roster;
  if (tab === "finalised") filtered = finalisedList;
  else if (tab === "shortlisted") filtered = shortlistedList;

  if (search.trim()) {
    const q = search.trim().toLowerCase();
    filtered = filtered.filter(
      (i) =>
        (i.name && i.name.toLowerCase().includes(q)) ||
        (i.deliverables && i.deliverables.toLowerCase().includes(q)) ||
        (i.remark && i.remark.toLowerCase().includes(q)) ||
        (i.profile_url && i.profile_url.toLowerCase().includes(q))
    );
  }

  return (
    <div className="client-share-shell">
      {/* Client Brand Header */}
      <header className="client-share-header">
        <div className="client-share-header-inner">
          <div className="client-share-brand-row">
            <img src="/Takeboard White_Logo.png" alt="TakeBoard" className="client-share-logo" />
            <span className="client-share-badge">CLIENT ROSTER SHOWCASE</span>
          </div>

          <div className="client-share-title-row">
            <div>
              {data.client_name && (
                <small className="client-share-sub">CLIENT: {data.client_name.toUpperCase()}</small>
              )}
              <h1 className="client-share-title">{data.title}</h1>
            </div>

            <div className="client-share-kpis">
              <div className="client-kpi-pill">
                <span>TOTAL FACES</span>
                <strong>{data.influencers_count}</strong>
              </div>
              <div className="client-kpi-pill highlighted">
                <span>FINALISED</span>
                <strong>{data.finalised_count}</strong>
              </div>
              <div className="client-kpi-pill">
                <span>TOTAL BUDGET</span>
                <strong>₹{formatRate(data.total_rate)}</strong>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="client-share-body">
        {/* Controls: Search, Tabs, View Toggle */}
        <div className="client-share-controls">
          <div className="client-share-tabs">
            <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>
              All ({roster.length})
            </button>
            <button
              className={tab === "finalised" ? "active" : ""}
              onClick={() => setTab("finalised")}
              style={tab !== "finalised" ? { color: "#4ade80" } : {}}
            >
              ✓ Finalized ({finalisedList.length})
            </button>
            <button
              className={tab === "shortlisted" ? "active" : ""}
              onClick={() => setTab("shortlisted")}
              style={tab !== "shortlisted" ? { color: "#c084fc" } : {}}
            >
              Shortlisted ({shortlistedList.length})
            </button>
          </div>

          <div className="client-share-tools">
            <div className="client-search-wrap">
              <span className="client-search-ico">🔍</span>
              <input
                type="text"
                className="client-search-input"
                placeholder="Search faces, deliverables…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button className="client-search-clear" onClick={() => setSearch("")}>
                  ✕
                </button>
              )}
            </div>

            {/* Desktop View Mode Toggle */}
            <div className="client-view-toggle">
              <button className={viewMode === "cards" ? "active" : ""} onClick={() => setViewMode("cards")} title="Card View">
                🂡 Cards
              </button>
              <button className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")} title="Spreadsheet View">
                📊 Table
              </button>
            </div>
          </div>
        </div>

        {/* Empty Search Result */}
        {filtered.length === 0 && (
          <div className="client-empty-state">
            <span style={{ fontSize: 32 }}>🔍</span>
            <h3>No faces match your filter</h3>
            <p>Try clearing your search query or selecting a different tab.</p>
            {search && (
              <button className="btn btn-secondary" onClick={() => setSearch("")} style={{ marginTop: 10 }}>
                Clear Search
              </button>
            )}
          </div>
        )}

        {/* Cards View (Mobile-First Default & Desktop Grid) */}
        {viewMode === "cards" && filtered.length > 0 && (
          <div className="client-cards-grid">
            {filtered.map((inf, idx) => {
              const badge = getStatusBadge(inf.status);
              const day = getDayOfWeek(inf.date_available);
              const link = getProfileLink(inf.profile_url, inf.platform);
              return (
                <div key={inf.id} className="client-face-card">
                  {/* Photo & Profile Link Header */}
                  <div className="client-face-top">
                    <div
                      className="client-face-avatar"
                      onClick={() => inf.photo_url && setLightboxImg(inf.photo_url)}
                      title={inf.photo_url ? "Click to view photo" : ""}
                    >
                      {inf.photo_url ? (
                        <img src={inf.photo_url} alt={inf.name} loading="lazy" />
                      ) : (
                        <span>{inf.name ? inf.name[0] : "✦"}</span>
                      )}
                    </div>

                    <div className="client-face-meta">
                      <div className="client-face-num">#{idx + 1}</div>
                      <h3 className="client-face-name">{inf.name}</h3>

                      <div className="client-face-actions-row">
                        {link && (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="client-profile-link-btn"
                            title="Open profile in Instagram"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                            </svg>
                            <span>Profile Link ↗</span>
                          </a>
                        )}

                        <span
                          className="client-status-pill"
                          style={{
                            background: badge.bg,
                            color: badge.color,
                            borderColor: badge.border,
                          }}
                        >
                          {badge.label}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Deliverables Section */}
                  {inf.deliverables ? (
                    <div className="client-face-deliverables">
                      <div className="client-chip-label">DELIVERABLES</div>
                      <p>{inf.deliverables}</p>
                    </div>
                  ) : null}

                  {/* Remarks Section */}
                  {inf.remark ? (
                    <div className="client-face-remark">
                      <div className="client-chip-label">REMARKS</div>
                      <p>“{inf.remark}”</p>
                    </div>
                  ) : null}

                  {/* Bottom Stats: Rate & Date */}
                  <div className="client-face-footer">
                    <div className="client-face-rate">
                      <span className="client-chip-label">RATE FIXED</span>
                      <strong>₹{formatRate(inf.rate_fixed)}</strong>
                    </div>

                    <div className="client-face-date">
                      <span className="client-chip-label">DATE FIXED</span>
                      {inf.date_available ? (
                        <div className="client-date-val">
                          {day && <span className="client-day-tag">{day}</span>}
                          <span>{inf.date_available}</span>
                        </div>
                      ) : (
                        <span className="client-date-tbd">Dates TBD</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Table View (Clean Spreadsheet for Laptop / Desktop) */}
        {viewMode === "table" && filtered.length > 0 && (
          <div className="client-table-container">
            <table className="client-share-table">
              <thead>
                <tr>
                  <th style={{ width: 44, textAlign: "center" }}>#</th>
                  <th style={{ width: 60, textAlign: "center" }}>Photo</th>
                  <th style={{ minWidth: 170 }}>Influencer Name</th>
                  <th style={{ minWidth: 160 }}>Profile Link</th>
                  <th style={{ minWidth: 220 }}>Deliverables</th>
                  <th style={{ minWidth: 120 }}>Rate (₹)</th>
                  <th style={{ minWidth: 240 }}>Remarks</th>
                  <th style={{ minWidth: 160 }}>Date Fixed</th>
                  <th style={{ minWidth: 130 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((inf, idx) => {
                  const badge = getStatusBadge(inf.status);
                  const day = getDayOfWeek(inf.date_available);
                  const link = getProfileLink(inf.profile_url, inf.platform);
                  return (
                    <tr key={inf.id}>
                      <td style={{ textAlign: "center", color: "#666", fontSize: 12 }}>{idx + 1}</td>
                      <td style={{ textAlign: "center", padding: "6px 4px" }}>
                        <div
                          className="client-table-avatar"
                          onClick={() => inf.photo_url && setLightboxImg(inf.photo_url)}
                          title="Click to view photo"
                        >
                          {inf.photo_url ? (
                            <img src={inf.photo_url} alt={inf.name} />
                          ) : (
                            <span>{inf.name ? inf.name[0] : "✦"}</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <strong style={{ color: "#fff", fontSize: 13 }}>{inf.name}</strong>
                      </td>
                      <td>
                        {link ? (
                          <a
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="client-table-link-btn"
                          >
                            <span>Open Profile ↗</span>
                          </a>
                        ) : (
                          <span style={{ color: "#555" }}>—</span>
                        )}
                      </td>
                      <td>
                        <div className="client-table-text">{inf.deliverables || "—"}</div>
                      </td>
                      <td>
                        <strong style={{ color: "#ffffff", fontSize: 13 }}>₹{formatRate(inf.rate_fixed)}</strong>
                      </td>
                      <td>
                        <div className="client-table-text" style={{ fontStyle: inf.remark ? "italic" : "normal" }}>
                          {inf.remark ? `“${inf.remark}”` : "—"}
                        </div>
                      </td>
                      <td>
                        {inf.date_available ? (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                            {day && <span className="client-day-tag">{day}</span>}
                            <span>{inf.date_available}</span>
                          </div>
                        ) : (
                          <span style={{ color: "#666" }}>TBD</span>
                        )}
                      </td>
                      <td>
                        <span
                          className="client-status-pill"
                          style={{
                            background: badge.bg,
                            color: badge.color,
                            borderColor: badge.border,
                          }}
                        >
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Lightbox Photo Preview Modal */}
      {lightboxImg && (
        <div className="client-lightbox-backdrop" onClick={() => setLightboxImg(null)}>
          <div className="client-lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button className="client-lightbox-close" onClick={() => setLightboxImg(null)}>
              ✕
            </button>
            <img src={lightboxImg} alt="Preview" />
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="client-share-footer">
        <div className="client-share-footer-inner">
          <span>TAKEBOARD BY CREATIVHEADS · CLIENT ROSTER PORTAL</span>
          <span style={{ color: "#666" }}>Curated with precision for brand campaigns.</span>
        </div>
      </footer>
    </div>
  );
}
