// Small History-API router (no dependency). Supports :params and query strings.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const RouterCtx = createContext(null);
const ParamsCtx = createContext({});

function current() {
  return { pathname: window.location.pathname, search: window.location.search };
}

export function Router({ children }) {
  const [loc, setLoc] = useState(current);
  useEffect(() => {
    const on = () => setLoc(current());
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  const navigate = useCallback((to, { replace = false } = {}) => {
    if (typeof to === "number") return window.history.go(to);
    if (to === window.location.pathname + window.location.search) return;
    window.history[replace ? "replaceState" : "pushState"]({}, "", to);
    setLoc(current());
    if (!replace) window.scrollTo(0, 0);
  }, []);
  const value = useMemo(() => ({ ...loc, navigate }), [loc, navigate]);
  return <RouterCtx.Provider value={value}>{children}</RouterCtx.Provider>;
}

export const useLocation = () => useContext(RouterCtx);
export const useNavigate = () => useContext(RouterCtx).navigate;
export const useParams = () => useContext(ParamsCtx);

export function useQuery() {
  const { search } = useLocation();
  return useMemo(() => Object.fromEntries(new URLSearchParams(search)), [search]);
}

export function match(pattern, path) {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

export function Routes({ routes, fallback }) {
  const { pathname } = useLocation();
  for (const [pattern, Comp] of routes) {
    const params = match(pattern, pathname);
    if (params) {
      return (
        <ParamsCtx.Provider value={params}>
          <Comp key={pattern + JSON.stringify(params)} />
        </ParamsCtx.Provider>
      );
    }
  }
  return fallback || null;
}

export function Link({ to, children, onClick, replace, ...rest }) {
  const navigate = useNavigate();
  return (
    <a
      href={to}
      onClick={(e) => {
        onClick && onClick(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || rest.target) return;
        e.preventDefault();
        navigate(to, { replace });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
