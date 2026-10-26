import { useState } from "react";
import { PageHead } from "../components/Layout";
import { Alert, Button, Check, ErrorBox, Modal, Spinner, TextInput } from "../components/ui";
import { api } from "../lib/api";
import { useApp, useLoad } from "../lib/app";
import { relative } from "../lib/util";

export default function Staff() {
  const { user, toast } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.get("auth/staff/"), []);
  const [form, setForm] = useState(null);
  if (!user.is_superuser) return <Alert kind="error">Only administrators can manage staff accounts.</Alert>;
  const toggle = async (s) => {
    try {
      await api.patch(`auth/staff/${s.id}/`, { is_active: !s.is_active });
      toast(s.is_active ? `${s.name} deactivated and signed out` : `${s.name} reactivated`);
      reload();
    } catch (e) {
      toast(e.message, "error");
    }
  };
  return (
    <div className="narrow">
      <PageHead title="Staff accounts" subtitle="All staff share the same permissions in this version. Deactivated accounts can't sign in." actions={<Button variant="primary" icon="plus" onClick={() => setForm({ username: "", first_name: "", last_name: "", email: "", password: "" })}>Add staff</Button>} />
      <ErrorBox error={error} onRetry={reload} />
      {loading && <Spinner />}
      {data && (
        <ul className="trash-list">
          {data.map((s) => (
            <li key={s.id} className={s.is_active ? "" : "is-archived"}>
              <span>
                <strong>{s.name}</strong> <span className="muted small">{s.username}{s.is_superuser ? ", administrator" : ""}</span>
                <small>{s.email || "No email"}; last sign-in {relative(s.last_login)}</small>
              </span>
              <span className="row-gap">
                <Button size="sm" onClick={() => setForm({ ...s, password: "" })}>Edit</Button>
                {s.id !== user.id && <Button size="sm" variant={s.is_active ? "ghost" : "secondary"} onClick={() => toggle(s)}>{s.is_active ? "Deactivate" : "Reactivate"}</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {form && <StaffForm s={form} onClose={() => setForm(null)} onSaved={() => (setForm(null), reload())} />}
    </div>
  );
}

function StaffForm({ s, onClose, onSaved }) {
  const { toast } = useApp();
  const [f, setF] = useState(s);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const upd = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const body = { username: f.username, first_name: f.first_name, last_name: f.last_name, email: f.email };
      if (f.password) body.password = f.password;
      s.id ? await api.patch(`auth/staff/${s.id}/`, body) : await api.post("auth/staff/", { ...body, is_active: true });
      toast(s.id ? "Account updated" : "Account created");
      onSaved();
    } catch (e) {
      setErrors(Object.fromEntries(Object.entries(e.errors || {}).map(([k, v]) => [k, v.join(" ")])));
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={s.id ? `Edit ${s.name}` : "Add staff account"} onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={save}>Save</Button></>}>
      <div className="stack">
        <TextInput label="Username" required value={f.username} onChange={upd("username")} error={errors.username} disabled={!!s.id} />
        <div className="pair">
          <TextInput label="First name" value={f.first_name} onChange={upd("first_name")} />
          <TextInput label="Last name" value={f.last_name} onChange={upd("last_name")} />
        </div>
        <TextInput label="Email" type="email" value={f.email} onChange={upd("email")} error={errors.email} hint="Needed for self-service password reset" />
        <TextInput label={s.id ? "Set a new password (optional)" : "Temporary password"} type="password" autoComplete="new-password" value={f.password} onChange={upd("password")} error={errors.password} hint="Share it privately; they can change it under My account." />
      </div>
    </Modal>
  );
}
