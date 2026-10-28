import { useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { Link, useLocation, useNavigate } from "../lib/router";
import { cx } from "../lib/util";
import { Icon } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", icon: "home", exact: true },
  { to: "/talent", label: "Talent", icon: "users" },
  { to: "/projects", label: "Projects", icon: "film" },
  { to: "/bookings", label: "Bookings", icon: "calendar" },
  { to: "/reminders", label: "Reviews", icon: "bell" },
];
const MORE = [
  { to: "/import-export", label: "Import & export", icon: "upload" },
  { to: "/taxonomy", label: "Categories & tags", icon: "tag" },
  { to: "/trash", label: "Trash", icon: "trash" },
  { to: "/audit", label: "Audit log", icon: "history" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

export default function Layout({ children }) {
  const { user, setUser } = useApp();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const isActive = (n) => (n.exact ? pathname === n.to : pathname === n.to || pathname.startsWith(n.to + "/"));
  const current = [...NAV, ...MORE].find(isActive);
  const initials = (user?.name || "CH").split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  const logout = async () => {
    try {
      await api.post("auth/logout/");
    } finally {
      setUser(null);
      navigate("/login", { replace: true });
    }
  };

  const NavItem = (n) => (
    <Link key={n.to} to={n.to} className={cx("nav-item", isActive(n) && "is-active")} onClick={() => setOpen(false)} aria-current={isActive(n) ? "page" : undefined}>
      <Icon name={n.icon} />
      <span>{n.label}</span>
    </Link>
  );

  return (
    <div className={cx("shell", open && "nav-open")}>
      <aside className="sidebar" aria-label="Main navigation">
        <Link to="/" className="brand" onClick={() => setOpen(false)} title="TakeBoard by CreativHeads">
          <img src="/Takeboard White_Logo.png" alt="TakeBoard by CreativHeads" className="brand-logo" />
        </Link>
        <div className="workspace">
          <span className="ws-avatar">T</span>
          <span>
            <strong>TakeBoard Studio</strong>
            <small>Internal workspace</small>
          </span>
          <Icon name="chevron" size={14} />
        </div>
        <div className="nav-label">Workspace</div>
        <nav className="nav">{NAV.map(NavItem)}</nav>
        <div className="nav-sep" />
        <div className="nav-label">Manage</div>
        <nav className="nav nav-secondary">
          {MORE.map(NavItem)}
          {user?.is_superuser && NavItem({ to: "/staff", label: "Staff accounts", icon: "shield" })}
        </nav>
        <p className="sidebar-note">
          <span className="dot" />
          Your next great cast
          <br />
          <b>is already in your network.</b>
        </p>
        <div className="sidebar-foot">
          <Link to="/account" className="me" onClick={() => setOpen(false)}>
            <span className="avatar">{initials}</span>
            <span>
              {user?.name}
              <small>CreativHeads · Kottakkal</small>
            </span>
          </Link>
          <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out">
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Icon name="menu" />
          </button>
          <span className="crumb">
            Workspace <i>/</i> <b>{current?.label || "Talent"}</b>
          </span>
          <form
            className="global-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const v = q.trim();
              if (/^ch-cast-\d+$/i.test(v)) navigate(`/talent/${v.toUpperCase()}`);
              else navigate(`/talent?q=${encodeURIComponent(v)}`);
              setQ("");
            }}
          >
            <Icon name="search" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, cast ID, skill, language, place…" aria-label="Search talent" />
          </form>
          <Link to="/talent/new" className="btn btn-primary add-talent">
            <Icon name="plus" size={16} />
            <span>Add talent</span>
          </Link>
          <Link to="/account" className="avatar" aria-label="My account" title={user?.name}>
            {initials}
          </Link>
        </header>
        <main className="content" id="main">
          {children}
        </main>
        <footer className="app-footer">
          <span>TAKEBOARD BY CREATIVHEADS</span>
          <span>Good stories begin with the right people.</span>
          <span>Internal workspace</span>
        </footer>
      </div>
      <nav className="bottom-nav" aria-label="Quick navigation">
        {NAV.slice(0, 4).map((n) => (
          <Link key={n.to} to={n.to} className={cx(isActive(n) && "is-active")}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </Link>
        ))}
        <Link to="/talent/new" className="fab" aria-label="Add talent">
          <Icon name="plus" />
        </Link>
      </nav>
    </div>
  );
}

export function PageHead({ title, subtitle, actions, back }) {
  return (
    <div className="page-head">
      <div>
        {back && (
          <Link to={back.to} className="back-link">
            <Icon name="back" size={16} />
            {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
