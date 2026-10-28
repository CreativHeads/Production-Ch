import { useState } from "react";
import { Alert, Button, TextInput } from "../components/ui";
import { api, ensureCsrf } from "../lib/api";
import { useNavigate, useQuery } from "../lib/router";

function AuthFrame({ children }) {
  return (
    <div className="auth">
      <div className="auth-art" aria-hidden="true">
        <div className="slate-wall">
          {Array.from({ length: 36 }).map((_, i) => (
            <span key={i} className="slate-tile" style={{ animationDelay: `${(i % 12) * 50}ms` }}>
              CH-CAST-{String(1000 + i * 37).padStart(6, "0")}
            </span>
          ))}
        </div>
        <p className="auth-line">
          Your next great cast
          <br />
          <strong>is already in your network.</strong>
        </p>
        <p className="auth-tag">Good stories begin with the right people.</p>
      </div>
      <div className="auth-panel">
        <div className="brand brand-lg" style={{ justifyContent: "center", marginBottom: 20 }}>
          <img src="/Takeboard White_Logo.png" alt="TakeBoard by CreativHeads" className="brand-logo" />
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Login({ onLogin }) {
  const navigate = useNavigate();
  const { next } = useQuery();
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await ensureCsrf();
      if (mode === "login") {
        const u = await api.post("auth/login/", { username, password });
        await ensureCsrf(); // session rotated the CSRF token
        onLogin(u);
        navigate(next && next.startsWith("/") ? next : "/", { replace: true });
      } else {
        const r = await api.post("auth/password/reset/", { username });
        setInfo(r.detail);
        setMode("login");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <form className="auth-form" onSubmit={submit}>
        <h1>{mode === "login" ? "Staff sign in" : "Reset your password"}</h1>
        {info && <Alert kind="info" icon="check">{info}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        <TextInput label={mode === "login" ? "Username" : "Username or email"} value={username} onChange={setUsername} autoComplete="username" autoFocus required />
        {mode === "login" && <TextInput label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />}
        <Button type="submit" variant="primary" busy={busy} className="btn-block">
          {mode === "login" ? "Sign in" : "Send reset link"}
        </Button>
        <button type="button" className="link-btn" onClick={() => (setMode(mode === "login" ? "reset" : "login"), setError(""))}>
          {mode === "login" ? "Forgot your password?" : "Back to sign in"}
        </button>
        <p className="auth-note">Accounts are created by your administrator. There is no public sign-up.</p>
      </form>
    </AuthFrame>
  );
}

export function ResetPassword() {
  const { uid, token } = useQuery();
  const navigate = useNavigate();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (pw !== pw2) return setError("The two passwords don't match.");
    setBusy(true);
    setError("");
    try {
      await ensureCsrf();
      await api.post("auth/password/reset/confirm/", { uid, token, new_password: pw });
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthFrame>
      <form className="auth-form" onSubmit={submit}>
        <h1>Choose a new password</h1>
        {done ? (
          <>
            <Alert kind="info" icon="check">Password updated. You can sign in now.</Alert>
            <Button variant="primary" onClick={() => navigate("/login", { replace: true })}>Go to sign in</Button>
          </>
        ) : (
          <>
            {error && <Alert kind="error">{error}</Alert>}
            <TextInput label="New password" type="password" value={pw} onChange={setPw} autoComplete="new-password" hint="At least 10 characters, not all numbers." required />
            <TextInput label="Repeat new password" type="password" value={pw2} onChange={setPw2} autoComplete="new-password" required />
            <Button type="submit" variant="primary" busy={busy} className="btn-block">Save password</Button>
          </>
        )}
      </form>
    </AuthFrame>
  );
}
