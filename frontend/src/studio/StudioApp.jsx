// CreativHeads studio UI: shell (sidebar, header, footer), sign-in and page routing.
import { useEffect, useState } from "react";
import { api, ensureCsrf, setUnauthorizedHandler } from "../lib/api";
import { CategoriesPage, HistoryPage, CampaignsPage, OverviewPage, ProjectsPage, ReviewsPage, SettingsPage, ShortlistsPage, TalentPage } from "./pages";
import { FormError, Studio, initials, useData, useStudio, useStudioState } from "./shared";
import "../studio.css";

const NAV = [
  ["overview", "◫", "Overview", OverviewPage],
  ["talent", "♙", "Talent directory", TalentPage],
  ["campaigns", "✧", "Campaigns", CampaignsPage],
  ["projects", "▣", "Projects", ProjectsPage],
  ["shortlists", "☷", "Shortlists", ShortlistsPage],
  ["history", "↺", "Casting history", HistoryPage],
  ["categories", "⌘", "Categories & tags", CategoriesPage],
  ["reviews", "◷", "Review reminders", ReviewsPage],
  ["settings", "⚙", "Settings", SettingsPage],
];

function Brand({ collapsed, onToggle }) {
  return (
    <div className="brand-header">
      <a className="brand" href="#talent" title="TakeBoard by CreativHeads">
        <img
          src={collapsed ? "/Takeboard Favicon.png" : "/Takeboard White_Logo.png"}
          alt="TakeBoard"
          className={collapsed ? "brand-logo-icon" : "brand-logo"}
        />
      </a>
      <button
        type="button"
        className="sidebar-toggle-btn"
        onClick={onToggle}
        title={collapsed ? "Expand sidebar" : "Collapse to icons only"}
        aria-label="Toggle sidebar"
      >
        {collapsed ? "»" : "«"}
      </button>
    </div>
  );
}

function Shell() {
  const s = useStudio();
  const { data: talentCount } = useData(() => api.get("talent/", { page_size: 1 }));
  const { data: campaigns } = useData(() => api.get("campaigns", { scope: "active" }));
  const current = NAV.find((n) => n[0] === s.page) || NAV[1];
  const Page = current[3];
  const studioName = s.settings?.studio_name || "TakeBoard Studio";
  return (
    <>
      <aside>
        <Brand
          collapsed={s.sidebarCollapsed}
          onToggle={() => s.setSidebarCollapsed(!s.sidebarCollapsed)}
        />
        <div className="workspace">
          {studioName[0]} <span>{studioName}<small>Internal workspace</small></span><b>⌄</b>
        </div>
        <div className="navlabel">WORKSPACE</div>
        <nav id="nav">
          {NAV.map(([id, icon, name]) => (
            <button key={id} className={current[0] === id ? "active" : ""} onClick={() => s.go(id)} title={name}>
              <span className="ico">{icon}</span>
              <span className="nav-text">{name}</span>
              {id === "talent" && talentCount && talentCount.count > 0 && <em>{talentCount.count}</em>}
              {id === "campaigns" && campaigns && campaigns.length > 0 && <em>{campaigns.length}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebottom">
          <div className="note"><span className="dot" /> Your next great cast<br /><b>is already in your network.</b></div>
          <button onClick={() => s.go("settings")} className="account">
            <span className="avatar">{initials(s.user.name)}</span>
            <span>{s.user.name}<small>{studioName.split(" ")[0]} · {(s.settings?.studio_location || "Kottakkal").split(",")[0]}</small></span>
            <b>⌄</b>
          </button>
        </div>
      </aside>
      <div className="shell">
        <header>
          <button className="mobile" aria-label="Open menu" onClick={() => s.setMenu(!s.menu)}>☰</button>
          <span>Workspace <i>/</i> <b id="crumb">{current[2]}</b></span>
          <div className="header-right">
            <span className="demo">STUDIO WORKSPACE</span>
            <button title="Review reminders" onClick={() => s.go("reviews")}>♧</button>
            <span className="avatar">{initials(s.user.name)}</span>
          </div>
        </header>
        <main id="main">
          <Page key={current[0]} />
        </main>
        <footer>
          <span>TAKEBOARD BY CREATIVHEADS</span>
          <span>Good stories begin with the right people.</span>
          <span>Signed in as {s.user.username}</span>
        </footer>
      </div>
      <div className="menu-backdrop" onClick={() => s.setMenu(false)} />
      <div id="overlay" hidden={!s.drawer} onClick={(e) => e.target.id === "overlay" && s.closeDrawer()}>
        {s.drawer && <section className="drawer" role="dialog" aria-modal="true">{s.drawer}</section>}
      </div>
      <div id="toast" role="status" style={{ display: s.toastMsg ? "block" : "none" }}>{s.toastMsg}</div>
    </>
  );
}

function Login({ onLogin }) {
  const [error, setError] = useState(null);
  const [mode, setMode] = useState("signin");
  const [sent, setSent] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    setBusy(true);
    setError(null);
    try {
      await ensureCsrf();
      if (mode === "signin") onLogin(await api.post("auth/login/", { username: f.username, password: f.password }));
      else setSent((await api.post("auth/password/reset/", { username: f.username })).detail);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login">
      <div className="loginbox">
        <Brand />
        <div className="eyebrow">TAKEBOARD BY CREATIVHEADS</div>
        <h1>{mode === "signin" ? "Welcome back to the studio." : "Reset your password."}</h1>
        <p>{mode === "signin" ? "Your people. Your projects. One place." : "We'll email a reset link to the address on your account."}</p>
        <form onSubmit={submit}>
          <div className="formgrid">
            <label className="field full">Work email or username<input name="username" required autoComplete="username" placeholder="you@creativheads.com" /></label>
            {mode === "signin" && <label className="field full">Password<input name="password" type="password" required autoComplete="current-password" placeholder="Enter your password" /></label>}
          </div>
          <FormError error={error} />
          {sent && <p style={{ marginTop: 14 }}>{sent}</p>}
          <button className="primary" disabled={busy}>{busy ? "One moment…" : mode === "signin" ? "Sign in" : "Send reset link"}</button>
        </form>
        <button className="linkbtn" onClick={() => { setMode(mode === "signin" ? "reset" : "signin"); setError(null); setSent(""); }}>
          {mode === "signin" ? "Forgot your password?" : "Back to sign in"}
        </button>
        <p style={{ fontSize: 11, marginTop: 20 }}>Internal staff access only. Accounts are created by your administrator.</p>
      </div>
    </div>
  );
}

function ResetPassword() {
  const q = new URLSearchParams(window.location.search);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    try {
      await ensureCsrf();
      const r = await api.post("auth/password/reset/confirm/", { uid: q.get("uid"), token: q.get("token"), new_password: new FormData(e.target).get("password") });
      setMsg(r.detail);
    } catch (err) {
      setError(err);
    }
  }
  return (
    <div className="login">
      <div className="loginbox">
        <Brand />
        <div className="eyebrow">TAKEBOARD BY CREATIVHEADS</div>
        <h1>Choose a new password.</h1>
        {msg ? (
          <>
            <p>{msg}</p>
            <button className="primary" onClick={() => (window.location.href = "/")}>Go to sign in</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <div className="formgrid"><label className="field full">New password (10+ characters)<input name="password" type="password" required minLength={10} /></label></div>
            <FormError error={error} />
            <button className="primary">Save password</button>
          </form>
        )}
      </div>
    </div>
  );
}

function Signed({ user, setUser }) {
  const value = useStudioState(user, setUser);
  return (
    <Studio.Provider value={value}>
      <Shell />
    </Studio.Provider>
  );
}

export default function StudioApp() {
  const [user, setUser] = useState(undefined);
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    ensureCsrf().then(() => api.get("auth/me/").then(setUser).catch(() => setUser(null)));
  }, []);
  if (window.location.pathname === "/reset-password") return <ResetPassword />;
  if (user === undefined) return <div className="boot">OPENING WORKSPACE…</div>;
  if (!user) return <Login onLogin={setUser} />;
  return <Signed user={user} setUser={setUser} />;
}
