import { useState } from "react";
import { PageHead } from "../components/Layout";
import { Button, ErrorBox, Modal, Select, Spinner, TextArea } from "../components/ui";
import { api } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { Link } from "../lib/router";
import { date } from "../lib/util";

export default function Reminders() {
  const { toast } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.get("reminders/"), []);
  const [review, setReview] = useState(null);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const done = async (n) => {
    try {
      await api.patch(`notes/${n.id}/`, { follow_up_done: true });
      toast("Follow-up done");
      reload();
    } catch (e) {
      toast(e.message, "error");
    }
  };

  return (
    <div>
      <PageHead title="Review queue" subtitle={`Rates and contact details are due for review every ${data.intervals.rates_days} and ${data.intervals.contact_days} days. Change this in Settings.`} />
      <div className="review-grid">
        {data.counts.map((c) =>
          c.key === "follow_up_due" ? (
            <a key={c.key} href="#follow-ups" className={`review-tile ${c.count ? "" : "is-zero"}`}>
              <strong>{c.count}</strong>
              <span>{c.label}</span>
            </a>
          ) : (
            <Link key={c.key} to={`/talent?review=${c.key}`} className={`review-tile ${c.count ? "" : "is-zero"}`}>
              <strong>{c.count}</strong>
              <span>{c.label}</span>
            </Link>
          )
        )}
      </div>

      <section className="panel" id="follow-ups">
        <h2>Follow-ups due</h2>
        {data.follow_ups.length === 0 ? (
          <p className="muted">Nothing due. Set a follow-up date when you log a call or message.</p>
        ) : (
          <ul className="followups">
            {data.follow_ups.map((n) => (
              <li key={n.id}>
                <span className="tl-date">{date(n.follow_up_on, { day: "numeric", month: "short" })}</span>
                <span>
                  <Link to={`/talent/${n.talent}?tab=notes`}>{n.talent_name}</Link> <span className="muted small">{n.talent_cast_id}</span>
                  <small>{n.content.slice(0, 140)}</small>
                </span>
                <Button size="sm" onClick={() => done(n)}>Mark done</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.retention_reviews.length > 0 && (
        <section className="panel">
          <h2>Consent withdrawn: retention reviews</h2>
          <p className="muted">Decide what can lawfully be kept, then anonymise or delete the rest.</p>
          <ul className="followups">
            {data.retention_reviews.map((r) => (
              <li key={r.id}>
                <span className="tl-date">Due {date(r.due_on, { day: "numeric", month: "short" })}</span>
                <span>
                  <Link to={`/talent/${r.talent}?tab=consent`}>{r.talent_name}</Link>
                  <small>{r.reason}</small>
                </span>
                <Button size="sm" onClick={() => setReview(r)}>Resolve</Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {review && <ResolveReview review={review} onClose={() => setReview(null)} onDone={() => (setReview(null), reload())} />}
    </div>
  );
}

function ResolveReview({ review, onClose, onDone }) {
  const { toast } = useApp();
  const [status, setStatus] = useState("retained");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(`retention-reviews/${review.id}/`, { status, resolution_notes: notes });
      toast("Review resolved");
      onDone();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Retention review: ${review.talent_name}`} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!notes.trim()} onClick={save}>Save decision</Button></>}>
      <div className="stack">
        <Select
          label="Decision"
          value={status}
          onChange={setStatus}
          placeholder={null}
          options={[
            { value: "retained", label: "Keep the record (lawful basis recorded below)" },
            { value: "anonymised", label: "Personal details anonymised" },
            { value: "deleted", label: "Record deleted" },
          ]}
        />
        <TextArea label="What was decided and why" value={notes} onChange={setNotes} rows={3} />
        <p className="muted small">Recording a decision doesn't change the profile by itself. Edit or move it to trash as decided.</p>
      </div>
    </Modal>
  );
}
