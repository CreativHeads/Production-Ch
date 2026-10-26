import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ user, setUser, children }) {
  const [meta, setMeta] = useState(null);
  const [terms, setTerms] = useState({ category: [], tag: [], skill: [], language: [] });
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const loadTerms = useCallback(async () => {
    const all = await api.get("terms/");
    const g = { category: [], tag: [], skill: [], language: [] };
    all.forEach((t) => g[t.kind] && g[t.kind].push(t));
    setTerms(g);
    return g;
  }, []);

  useEffect(() => {
    api.get("meta/").then(setMeta).catch(() => {});
    loadTerms().catch(() => {});
  }, [loadTerms]);

  const toast = useCallback((message, kind = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);

  const value = { user, setUser, meta, terms, loadTerms, toast };
  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

// Load-on-mount helper with error + reload
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => run(), [run]);
  return { ...state, reload: run, setData: (d) => setState((s) => ({ ...s, data: typeof d === "function" ? d(s.data) : d })) };
}
