import { useEffect, useState } from "react";
import { PageHead } from "../components/Layout";
import { Alert, Button, Check, ErrorBox, Spinner, TextArea, TextInput } from "../components/ui";
import { api } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { dateTime, relative } from "../lib/util";

export default function Settings() {
  const { user, toast } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.get("settings/"), []);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  useEffect(() => {
    if (data) setF(data);
  }, [data]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!f) return null;
  const upd = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const { completeness_options, updated_at, ...body } = f; // eslint-disable-line no-unused-vars
      await api.patch("settings/", body);
      toast("Settings saved");
      reload();
    } catch (e) {
      setErrors(Object.fromEntries(Object.entries(e.errors || {}).map(([k, v]) => [k, v.join(" ")])));
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const toggleField = (key, on) => upd("completeness_fields")(on ? [...f.completeness_fields, key] : f.completeness_fields.filter((k) => k !== key));

  return (
    <div className="narrow">
      <PageHead title="Settings" subtitle={`Last changed ${relative(data.updated_at)}. Changes apply to all staff.`} />
      <section className="panel">
        <h2>Sessions & exports</h2>
        <div className="grid-2">
          <TextInput label="Sign out after inactivity (hours)" type="number" step="0.25" min="0.25" max="72" value={f.session_idle_hours} onChange={upd("session_idle_hours")} error={errors.session_idle_hours} />
          <TextInput label="Export links expire after (hours)" type="number" min="1" value={f.export_expiry_hours} onChange={upd("export_expiry_hours")} />
        </div>
      </section>
      <section className="panel">
        <h2>Review reminders</h2>
        <div className="grid-2">
          <TextInput label="Review rates every (days)" type="number" min="1" value={f.review_interval_days} onChange={upd("review_interval_days")} />
          <TextInput label="Re-verify contact details every (days)" type="number" min="1" value={f.contact_review_interval_days} onChange={upd("contact_review_interval_days")} />
        </div>
      </section>
      <section className="panel">
        <h2>Profile completeness checklist</h2>
        <p className="muted small">A profile counts as complete when it has everything ticked here. Saving recalculates every profile.</p>
        {errors.completeness_fields && <Alert kind="error">{errors.completeness_fields}</Alert>}
        <div className="check-grid">
          {f.completeness_options.map((o) => (
            <Check key={o.key} label={o.label} checked={f.completeness_fields.includes(o.key)} onChange={(v) => toggleField(o.key, v)} />
          ))}
        </div>
        <Check label="Require recorded consent for every adult" hint="Child artists always need guardian consent." checked={f.require_consent_for_all} onChange={upd("require_consent_for_all")} />
      </section>
      <section className="panel">
        <h2>Contact defaults</h2>
        <div className="grid-2">
          <TextInput label="Default country code" value={f.default_country_code} onChange={upd("default_country_code")} hint="Used to normalise phone numbers for duplicates and WhatsApp" />
          <TextInput label="Default currency" value={f.default_currency} onChange={upd("default_currency")} />
        </div>
        <TextArea label="WhatsApp casting message" value={f.whatsapp_template} onChange={upd("whatsapp_template")} rows={3} hint="Opens pre-filled in WhatsApp; staff still press send. Use {first_name} and {staff_name}." />
      </section>
      <div className="form-actions">
        <Button variant="primary" busy={busy} onClick={save}>Save settings</Button>
      </div>
      {user.can_manage_backups && <BackupStatus />}
    </div>
  );
}

function BackupStatus() {
  const { data, error, loading } = useLoad(() => api.get("backups/status/"), []);
  return (
    <section className="panel mt">
      <h2>Backups</h2>
      {loading && <Spinner />}
      {error && <Alert kind="error">{error.message}</Alert>}
      {data && !data.configured && <Alert kind="warn">No backup has reported in yet. Check that the backup service is running on the server.</Alert>}
      {data && data.configured && (
        <>
          <Alert kind={data.healthy ? "info" : "error"} icon={data.healthy ? "check" : "alert"}>
            {data.healthy ? "Backups are healthy." : "The last backup failed or is more than a day old."}
          </Alert>
          <dl className="defs">
            <div className="def"><dt>Last success</dt><dd>{data.last_success_at ? dateTime(data.last_success_at) : "Never"}</dd></div>
            <div className="def"><dt>Last attempt</dt><dd>{dateTime(data.last_run_at)}: {data.last_result}</dd></div>
            {data.last_error && <div className="def"><dt>Last error</dt><dd>{data.last_error}</dd></div>}
            <div className="def"><dt>Database dump</dt><dd>{data.last_db_file} {data.last_db_size && `(${data.last_db_size})`}</dd></div>
            <div className="def"><dt>Off-site copy</dt><dd>{data.offsite || "not configured"}</dd></div>
            <div className="def"><dt>Retention</dt><dd>{data.retention_days} days</dd></div>
            <div className="def"><dt>Last restore test</dt><dd>{data.last_restore_test_at ? `${dateTime(data.last_restore_test_at)}: ${data.last_restore_test_result}` : "Never"}</dd></div>
          </dl>
        </>
      )}
    </section>
  );
}
