import { useState } from "react";
import { PageHead } from "../components/Layout";
import { AvailabilitySection, CastingSection, ConsentSection, HistorySection, NotesSection, PhotosSection, VideosSection } from "../components/ProfileSections";
import ShortlistDialog from "../components/ShortlistDialog";
import { FavoriteButton, Portrait } from "../components/TalentCard";
import { Alert, Button, Confirm, ErrorBox, Icon, Meter, Spinner, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { Link, useNavigate, useParams, useQuery } from "../lib/router";
import { ageRange, copy, date, feeLabel, fillTemplate, labelOf, relative } from "../lib/util";

export default function TalentProfile() {
  const { id } = useParams();
  const { from, tab: tabQ } = useQuery();
  const { meta, toast, user } = useApp();
  const navigate = useNavigate();
  const { data: t, error, loading, reload, setData } = useLoad(() => api.get(`talent/${id}/`), [id]);
  const [tab, setTab] = useState(tabQ || "overview");
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  if (loading && !t) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!t) return null;

  const back = from && from.startsWith("/talent") ? { to: from, label: "Back to results" } : { to: "/talent", label: "Directory" };
  const primary = t.photos.find((p) => p.is_primary);
  const wa = t.whatsapp;
  const message = fillTemplate(meta?.whatsapp_template, { first_name: t.full_name.split(" ")[0], name: t.full_name, staff_name: user.first_name || user.name });

  const act = async (fn, msg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r && r.cast_id) setData(r);
      else reload();
      msg && toast(msg);
      setDialog(null);
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const contactText = [t.full_name, t.cast_id, t.phone, t.alt_phone && `Alt: ${t.alt_phone}`, t.email, t.instagram_url, [t.city, t.district].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join("\n");

  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "photos", label: "Photos", count: t.photos.length },
    { value: "videos", label: "Videos", count: t.featured_videos.length },
    { value: "availability", label: "Availability" },
    { value: "notes", label: "Notes & contacts" },
    { value: "casting", label: "Projects & bookings" },
    { value: "consent", label: t.is_child ? "Consent & guardian" : "Consent" },
    { value: "history", label: "History" },
  ];

  return (
    <div className="profile">
      <PageHead title="" back={back} />
      <header className="profile-head">
        <div className="profile-photo">
          <button className="photo-btn" onClick={() => setTab("photos")} aria-label="See all photos">
            {primary ? <img src={primary.profile_url} alt={primary.label || t.full_name} /> : <Portrait name={t.full_name} />}
          </button>
          <span className="slate slate-lg">{t.cast_id}</span>
        </div>
        <div className="profile-id">
          <div className="profile-title">
            <h1>{t.full_name}</h1>
            <FavoriteButton talent={t} onChange={(v) => setData({ ...t, is_favorite: v })} />
          </div>
          {t.screen_name && <p className="muted">Screen name: {t.screen_name}</p>}
          <p className="profile-line">
            {[labelOf(meta?.gender, t.gender), t.age != null && `${t.age} yrs`, ageRange(t) && `plays ${ageRange(t)}`, t.height_cm && `${t.height_cm} cm`, [t.city, t.district].filter(Boolean).join(", ")]
              .filter(Boolean)
              .join(", ")}
          </p>
          <div className="chip-set">
            {t.categories.map((c) => (
              <Link key={c.id} to={`/talent?category=${c.id}`} className="chip chip-solid">{c.name}</Link>
            ))}
            {t.tags.map((c) => (
              <Link key={c.id} to={`/talent?tag=${c.id}`} className="chip">{c.name}</Link>
            ))}
          </div>
          <div className="profile-status">
            <Meter value={t.completeness} />
            <span>{t.completeness}% complete</span>
            {t.is_archived && <span className="pill pill-archived">Archived {date(t.archived_at)}</span>}
            {t.status === "staging" && <span className="pill pill-warn">Import staging</span>}
            {t.consent_hold && <span className="pill pill-danger">Consent withdrawn</span>}
            <span className="muted small">Updated {relative(t.updated_at)}{t.updated_by_name ? ` by ${t.updated_by_name}` : ""}</span>
          </div>
          <div className="profile-actions">
            <Link to={`/talent/${t.id}/edit`} className="btn btn-primary">
              <Icon name="edit" size={16} />
              <span>Edit</span>
            </Link>
            <div className="menu-wrap">
              <Button icon="phone" onClick={() => setContactOpen((o) => !o)} aria-expanded={contactOpen}>Contact</Button>
              {contactOpen && (
                <div className="menu" onMouseLeave={() => setContactOpen(false)}>
                  <a href={`tel:${t.phone}`}><Icon name="phone" size={16} /> Call {t.phone}</a>
                  {t.alt_phone && <a href={`tel:${t.alt_phone}`}><Icon name="phone" size={16} /> Call alternate {t.alt_phone}</a>}
                  {wa && <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer"><Icon name="chat" size={16} /> Open WhatsApp chat</a>}
                  {wa && <a href={`https://wa.me/${wa}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><Icon name="chat" size={16} /> WhatsApp with casting message</a>}
                  {t.instagram_url && <a href={t.instagram_url} target="_blank" rel="noreferrer"><Icon name="insta" size={16} /> Open Instagram</a>}
                  <button onClick={async () => (await copy(t.phone)) && toast("Phone number copied")}><Icon name="copy" size={16} /> Copy phone number</button>
                  <button onClick={async () => (await copy(contactText)) && toast("Contact details copied")}><Icon name="copy" size={16} /> Copy contact details</button>
                  <button onClick={() => (setTab("notes"), setContactOpen(false), setDialog("log"))}><Icon name="edit" size={16} /> Log a call or message</button>
                </div>
              )}
            </div>
            <Button icon="film" onClick={() => setDialog("shortlist")} disabled={t.consent_hold || t.is_archived}>Add to shortlist</Button>
            {t.is_archived ? (
              <Button icon="archive" busy={busy} onClick={() => act(() => api.post(`talent/${t.id}/unarchive/`), "Restored from archive")}>Restore</Button>
            ) : (
              <Button icon="archive" onClick={() => setDialog("archive")}>Archive</Button>
            )}
            <Button icon="history" variant="ghost" onClick={() => setTab("history")}>History</Button>
          </div>
        </div>
      </header>

      {t.status === "staging" && (
        <Alert kind="warn">
          This profile came from an import without a photo, so it's hidden from the directory. Add a primary photo, then{" "}
          <button className="link-btn" onClick={() => act(() => api.post(`talent/${t.id}/publish/`), "Published to the directory")}>publish it</button>.
        </Alert>
      )}
      {t.booking_blockers.length > 0 && (
        <Alert kind={t.consent_hold ? "error" : "warn"} icon="shield">
          <strong>Can't be booked yet.</strong>
          <ul className="tight">{t.booking_blockers.map((b) => <li key={b}>{b}</li>)}</ul>
        </Alert>
      )}
      {t.missing.length > 0 && (
        <div className="missing">
          <span>Missing for a complete profile:</span> {t.missing.join(", ")}
        </div>
      )}
      {t.reminders.filter((r) => r.key !== "incomplete").length > 0 && (
        <div className="review-strip">
          {t.reminders
            .filter((r) => r.key !== "incomplete")
            .map((r) => (
              <span key={r.key} className="pill pill-warn">{r.label}</span>
            ))}
          {t.reminders.some((r) => r.key === "rates_stale") && (
            <button className="link-btn" onClick={() => act(() => api.post(`talent/${t.id}/mark-reviewed/`, { what: "rates" }), "Rates marked as reviewed")}>Rates are still correct</button>
          )}
          {t.reminders.some((r) => r.key === "contact_stale") && (
            <button className="link-btn" onClick={() => act(() => api.post(`talent/${t.id}/mark-reviewed/`, { what: "contact" }), "Contact details marked as verified")}>Contact details verified</button>
          )}
        </div>
      )}

      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="tab-panel">
        {tab === "overview" && <Overview t={t} meta={meta} />}
        {tab === "photos" && <PhotosSection t={t} onChange={reload} />}
        {tab === "videos" && <VideosSection t={t} onChange={reload} />}
        {tab === "availability" && <AvailabilitySection t={t} />}
        {tab === "notes" && <NotesSection t={t} openNew={dialog === "log"} onOpened={() => setDialog(null)} />}
        {tab === "casting" && <CastingSection t={t} />}
        {tab === "consent" && <ConsentSection t={t} onChange={reload} />}
        {tab === "history" && <HistorySection t={t} />}
      </div>

      {dialog === "shortlist" && <ShortlistDialog talentIds={[t.id]} onClose={() => setDialog(null)} onDone={() => setDialog(null)} />}
      {dialog === "archive" && (
        <Confirm
          title={`Archive ${t.full_name}?`}
          confirmLabel="Archive"
          busy={busy}
          needsReason
          reasonLabel="Why are you archiving this profile?"
          onClose={() => setDialog(null)}
          onConfirm={(reason) => act(() => api.post(`talent/${t.id}/archive/`, { reason }), "Archived")}
        >
          Archived profiles are hidden from the directory, dashboards and searches, but nothing is deleted. You can restore them any time.
        </Confirm>
      )}
      <div className="danger-zone">
        <button className="link-btn danger" onClick={() => setDialog("delete")}>Move to trash</button>
      </div>
      {dialog === "delete" && (
        <Confirm
          title="Move this profile to trash?"
          danger
          confirmLabel="Move to trash"
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            act(async () => {
              await api.del(`talent/${t.id}/`);
              navigate("/talent", { replace: true });
            }, "Moved to trash")
          }
        >
          It disappears from the app but can be recovered from Trash. Use Archive instead if they're simply inactive.
        </Confirm>
      )}
    </div>
  );
}

function Def({ label, children }) {
  if (children === undefined || children === null || children === "" || (Array.isArray(children) && !children.length)) return null;
  return (
    <div className="def">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Overview({ t, meta }) {
  const m = t.measurements || {};
  const yesNo = (v) => (v === true ? "Yes" : v === false ? "No" : null);
  return (
    <div className="overview">
      <section className="panel">
        <h2>Personal & appearance</h2>
        <dl className="defs">
          <Def label="Date of birth">{t.date_of_birth && `${date(t.date_of_birth)}${t.age_verified ? " (verified)" : ""}`}</Def>
          <Def label="Age">{t.age != null ? `${t.age}` : null}</Def>
          <Def label="Playing age">{ageRange(t)}</Def>
          <Def label="Gender">{labelOf(meta?.gender, t.gender)}</Def>
          <Def label="Height">{t.height_cm && `${t.height_cm} cm`}</Def>
          <Def label="Weight">{t.weight_kg && `${t.weight_kg} kg`}</Def>
          <Def label="Complexion">{t.complexion}</Def>
          <Def label="Hair">{t.hair}</Def>
          <Def label="Eyes">{t.eye_color}</Def>
          <Def label="Measurements">{Object.entries(m).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ")}</Def>
          <Def label="Appearance notes">{t.appearance_notes}</Def>
        </dl>
      </section>
      <section className="panel">
        <h2>Contact</h2>
        <dl className="defs">
          <Def label="Phone"><a href={`tel:${t.phone}`}>{t.phone}</a></Def>
          <Def label="Alternate">{t.alt_phone && <a href={`tel:${t.alt_phone}`}>{t.alt_phone}</a>}</Def>
          <Def label="WhatsApp">{t.whatsapp_phone}</Def>
          <Def label="Email">{t.email && <a href={`mailto:${t.email}`}>{t.email}</a>}</Def>
          <Def label="Instagram">{t.instagram_url && <a href={t.instagram_url} target="_blank" rel="noreferrer">{t.instagram}</a>}</Def>
          <Def label="Address">{t.address}</Def>
          <Def label="Location">{[t.city, t.district, t.state, t.country].filter(Boolean).join(", ")}</Def>
          <Def label="Contact verified">{t.contact_verified_at ? relative(t.contact_verified_at) : "Not yet"}</Def>
        </dl>
        {t.is_child && t.guardians.length > 0 && (
          <>
            <h3>Guardian</h3>
            {t.guardians.map((g) => (
              <p key={g.id}>
                {g.name} ({g.relationship}) <a href={`tel:${g.phone}`}>{g.phone}</a>
              </p>
            ))}
          </>
        )}
      </section>
      <section className="panel">
        <h2>Skills & languages</h2>
        <dl className="defs">
          <Def label="Languages">
            {t.languages.length > 0 && (
              <ul className="plain">
                {t.languages.map((l) => (
                  <li key={l.id}>
                    <strong>{l.name}</strong>
                    {l.fluency && `, ${labelOf(meta?.fluency, l.fluency).toLowerCase()}`}
                    {l.accents && ` (${l.accents})`}
                    {l.can_dub && ", can dub"}
                  </li>
                ))}
              </ul>
            )}
          </Def>
          <Def label="Skills">{t.skills.map((s) => s.name).join(", ")}</Def>
          <Def label="Experience">{labelOf(meta?.experience, t.experience_level)}</Def>
          <Def label="Credits">{t.experience_summary && <p className="pre">{t.experience_summary}</p>}</Def>
        </dl>
      </section>
      <section className="panel">
        <h2>Rates & travel</h2>
        <dl className="defs">
          <Def label="Expected fee">{feeLabel(t, meta) || "Not recorded"}</Def>
          <Def label="Negotiable">{yesNo(t.fee_negotiable)}</Def>
          <Def label="Fee notes">{t.fee_notes}</Def>
          <Def label="Rates reviewed">{t.rates_reviewed_at ? relative(t.rates_reviewed_at) : "Never"}</Def>
          <Def label="Travel">{labelOf(meta?.travel, t.travel_willingness)}</Def>
          <Def label="Passport">{yesNo(t.has_passport)}</Def>
          <Def label="Travel notes">{t.travel_notes}</Def>
        </dl>
      </section>
      {t.internal_notes && (
        <section className="panel panel-internal">
          <h2>Internal performance notes</h2>
          <p className="pre">{t.internal_notes}</p>
          <p className="muted small">Staff only. Never included in client exports.</p>
        </section>
      )}
    </div>
  );
}
