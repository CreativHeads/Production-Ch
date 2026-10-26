import { useState } from "react";
import { PageHead } from "../components/Layout";
import { Alert, Button, TextInput } from "../components/ui";
import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { dateTime } from "../lib/util";

export default function Account() {
  const { user, setUser, toast } = useApp();
  const [p, setP] = useState({ first_name: user.first_name, email: user.email });
  const [pw, setPw] = useState({ current_password: "", new_password: "", repeat: "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState("");

  const saveProfile = async () => {
    setBusy("p");
    try {
      setUser(await api.patch("auth/me/", p));
      toast("Details saved");
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy("");
    }
  };
  const changePw = async () => {
    setErrors({});
    if (pw.new_password !== pw.repeat) return setErrors({ repeat: "The two new passwords don't match." });
    setBusy("pw");
    try {
      await api.post("auth/password/change/", pw);
      setPw({ current_password: "", new_password: "", repeat: "" });
      toast("Password changed");
    } catch (e) {
      setErrors(Object.fromEntries(Object.entries(e.errors || {}).map(([k, v]) => [k, v.join(" ")])));
      if (!e.errors) toast(e.message, "error");
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="narrow">
      <PageHead title="My account" subtitle={`Signed in as ${user.username}. Last sign-in ${dateTime(user.last_login)}.`} />
      <section className="panel">
        <h2>Your details</h2>
        <div className="grid-2">
          <TextInput label="First name" value={p.first_name} onChange={(v) => setP((s) => ({ ...s, first_name: v }))} hint="Used in WhatsApp messages you send" />
          <TextInput label="Email" type="email" value={p.email} onChange={(v) => setP((s) => ({ ...s, email: v }))} hint="Password reset links go here" />
        </div>
        <Button busy={busy === "p"} onClick={saveProfile}>Save details</Button>
      </section>
      <section className="panel">
        <h2>Change password</h2>
        {!user.email && <Alert kind="warn">Add an email above so you can reset your password if you forget it.</Alert>}
        <div className="stack">
          <TextInput label="Current password" type="password" autoComplete="current-password" value={pw.current_password} onChange={(v) => setPw((s) => ({ ...s, current_password: v }))} error={errors.current_password} />
          <TextInput label="New password" type="password" autoComplete="new-password" value={pw.new_password} onChange={(v) => setPw((s) => ({ ...s, new_password: v }))} error={errors.new_password} hint="At least 10 characters, not all numbers." />
          <TextInput label="Repeat new password" type="password" autoComplete="new-password" value={pw.repeat} onChange={(v) => setPw((s) => ({ ...s, repeat: v }))} error={errors.repeat} />
        </div>
        <Button variant="primary" busy={busy === "pw"} disabled={!pw.current_password || !pw.new_password} onClick={changePw}>Change password</Button>
      </section>
    </div>
  );
}
