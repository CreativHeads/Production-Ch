import { useEffect, useState } from "react";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import { api, ensureCsrf, setUnauthorizedHandler } from "./lib/api";
import { AppProvider } from "./lib/app";
import { Router, Routes, useLocation, useNavigate } from "./lib/router";
import Account from "./pages/Account";
import Audit from "./pages/Audit";
import Bookings from "./pages/Bookings";
import Dashboard from "./pages/Dashboard";
import Directory from "./pages/Directory";
import ImportExport from "./pages/ImportExport";
import Login, { ResetPassword } from "./pages/Login";
import ProjectDetail from "./pages/ProjectDetail";
import Projects from "./pages/Projects";
import QuickAdd from "./pages/QuickAdd";
import Reminders from "./pages/Reminders";
import Settings from "./pages/Settings";
import Staff from "./pages/Staff";
import TalentEdit from "./pages/TalentEdit";
import TalentProfile from "./pages/TalentProfile";
import Taxonomy from "./pages/Taxonomy";
import Trash from "./pages/Trash";

const ROUTES = [
  ["/", Dashboard],
  ["/talent", Directory],
  ["/talent/new", QuickAdd],
  ["/talent/:id/edit", TalentEdit],
  ["/talent/:id", TalentProfile],
  ["/projects", Projects],
  ["/projects/:id", ProjectDetail],
  ["/bookings", Bookings],
  ["/reminders", Reminders],
  ["/import-export", ImportExport],
  ["/taxonomy", Taxonomy],
  ["/trash", Trash],
  ["/audit", Audit],
  ["/settings", Settings],
  ["/account", Account],
  ["/staff", Staff],
];

function NotFound() {
  return (
    <div className="empty">
      <h3>This page doesn't exist</h3>
      <p>Check the address, or go back to the dashboard.</p>
      <a className="btn btn-primary" href="/">Go to dashboard</a>
    </div>
  );
}

function Gate() {
  const [user, setUser] = useState(undefined);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    ensureCsrf().then(() =>
      api
        .get("auth/me/")
        .then(setUser)
        .catch(() => setUser(null))
    );
  }, []);

  useEffect(() => {
    if (user === null && pathname !== "/login" && pathname !== "/reset-password") {
      const next = pathname + window.location.search;
      navigate(`/login${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`, { replace: true });
    }
  }, [user, pathname, navigate]);

  if (pathname === "/reset-password") return <ResetPassword />;
  if (user === undefined) return <div className="boot"><Spinner label="Opening workspace" /></div>;
  if (!user) return <Login onLogin={setUser} />;
  return (
    <AppProvider user={user} setUser={setUser}>
      <Layout>
        <Routes routes={ROUTES} fallback={<NotFound />} />
      </Layout>
    </AppProvider>
  );
}

export default function App() {
  return (
    <Router>
      <Gate />
    </Router>
  );
}
