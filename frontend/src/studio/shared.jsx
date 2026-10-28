import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";

export const Studio = createContext(null);
export const useStudio = () => useContext(Studio);

export const money = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");
export const pad2 = (n) => String(n ?? 0).padStart(2, "0");
export const initials = (name) =>
  (name || "?").split(/\s+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
export const shortDate = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "");

// Load data for a page; reloads whenever the studio data version changes.
export function useData(fn, deps = []) {
  const { version } = useStudio();
  const [state, setState] = useState({ data: null, error: null });
  useEffect(() => {
    let alive = true;
    fn()
      .then((data) => alive && setState({ data, error: null }))
      .catch((error) => alive && setState({ data: null, error }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return state;
}

export function useStudioState(user, setUser) {
  const initial = (window.location.hash || "").replace("#", "") || "talent";
  const [page, setPage] = useState(initial);
  const [drawer, setDrawer] = useState(null);
  const [toastMsg, setToast] = useState("");
  const [version, setVersion] = useState(0);
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(null);
  const [projectId, setProjectId] = useState(null);
  const [talentQuery, setTalentQuery] = useState("");

  const go = useCallback((p) => {
    setPage(p);
    setMenu(false);
    window.location.hash = p;
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    const onHash = () => setPage((window.location.hash || "").replace("#", "") || "talent");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    document.body.classList.toggle("menu", menu);
  }, [menu]);
  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    const onKey = (e) => e.key === "Escape" && setDrawer(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawer]);
  useEffect(() => {
    if (!toastMsg) return undefined;
    const t = setTimeout(() => setToast(""), 3200);
    return () => clearTimeout(t);
  }, [toastMsg]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("sidebar-collapsed", sidebarCollapsed);
  }, [sidebarCollapsed]);

  return {
    user, setUser, page, go, drawer, version, menu, setMenu, settings, projectId, setProjectId, talentQuery, setTalentQuery,
    sidebarCollapsed, setSidebarCollapsed,
    openDrawer: (node) => setDrawer(node),
    closeDrawer: () => setDrawer(null),
    toast: (m) => setToast(m),
    toastMsg,
    refresh: () => setVersion((v) => v + 1),
  };
}

// ---------------------------------------------------------------- small pieces
export function Heading({ eye, title, sub, children }) {
  return (
    <>
      <div className="eyebrow">{eye}</div>
      <div className="titlebar">
        <div>
          <h1>{title}</h1>
          <p>{sub}</p>
        </div>
        <div className="actions">{children}</div>
      </div>
    </>
  );
}

export function Status({ s }) {
  return <span className={"status" + (s === "Confirmed" ? " confirmed" : "")}>{s}</span>;
}

export function ModalHead({ title }) {
  const { closeDrawer } = useStudio();
  return (
    <div className="modalhead">
      <h2>{title}</h2>
      <button aria-label="Close dialog" onClick={closeDrawer}>×</button>
    </div>
  );
}

export function Photo({ src, name, className = "mini" }) {
  if (src) return <img className={className} src={src} alt={name} loading="lazy" />;
  return <span className={className + " noimg"} aria-hidden="true">{initials(name)}</span>;
}

export function Field({ label, name, value, type = "text", full, ...rest }) {
  return (
    <label className={"field" + (full ? " full" : "")}>
      {label}
      <input name={name} type={type} defaultValue={value ?? ""} {...rest} />
    </label>
  );
}

// Turn an ApiError into readable lines for a form.
export function errorText(e) {
  if (!e) return "";
  const lines = Object.entries(e.errors || {}).map(([k, v]) => `${k.replace(/_/g, " ")}: ${[].concat(v).join(" ")}`);
  return lines.length ? `${e.message}\n${lines.join("\n")}` : e.message;
}

export function FormError({ error }) {
  if (!error) return <div className="formerror" />;
  return <div className="formerror" style={{ whiteSpace: "pre-line" }}>{typeof error === "string" ? error : errorText(error)}</div>;
}

export function MultiSelectDropdown({
  label = "Select options",
  options = [],
  value = [],
  onChange,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef(null);

  const normalizedOptions = useMemo(() => {
    return (options || []).map((opt) => {
      if (typeof opt === "object" && opt !== null) {
        const val = String(opt.id !== undefined ? opt.id : (opt.value !== undefined ? opt.value : ""));
        const lbl = String(opt.name || opt.label || opt.value || val);
        return { value: val, label: lbl };
      }
      return { value: String(opt), label: String(opt) };
    });
  }, [options]);

  const selectedStrings = useMemo(() => (value || []).map(String), [value]);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return normalizedOptions;
    const s = search.toLowerCase();
    return normalizedOptions.filter((opt) => opt.label.toLowerCase().includes(s));
  }, [normalizedOptions, search]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const toggleOption = (val) => {
    const strVal = String(val);
    if (selectedStrings.includes(strVal)) {
      onChange(value.filter((v) => String(v) !== strVal));
    } else {
      onChange([...value, val]);
    }
  };

  const getDisplayText = () => {
    if (!value || value.length === 0) return label;
    if (value.length === 1) {
      const match = normalizedOptions.find((o) => o.value === selectedStrings[0]);
      return match ? match.label : selectedStrings[0];
    }
    const cleanLabel = label.replace(/^All\s+/i, "");
    return `${cleanLabel} (${value.length})`;
  };

  return (
    <div className="multiselect-wrapper" ref={dropdownRef}>
      <button
        type="button"
        className={`multiselect-btn ${value && value.length > 0 ? "has-selection" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-label={ariaLabel || label}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="multiselect-label" title={getDisplayText()}>
          {getDisplayText()}
        </span>
        <span className="multiselect-controls">
          {value && value.length > 0 && (
            <span
              role="button"
              tabIndex={0}
              className="multiselect-clear-btn"
              title="Clear selection"
              onClick={(e) => {
                e.stopPropagation();
                onChange([]);
              }}
            >
              ✕
            </span>
          )}
          <span className={`multiselect-arrow ${open ? "up" : ""}`}>▾</span>
        </span>
      </button>

      {open && (
        <div className="multiselect-dropdown">
          {normalizedOptions.length > 5 && (
            <div className="multiselect-search">
              <input
                type="text"
                placeholder={`Search ${label.replace(/^All\s+/i, "").toLowerCase()}…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          )}
          <div className="multiselect-header">
            <span>{value?.length || 0} selected</span>
            <div className="multiselect-actions">
              {filteredOptions.length > 0 && (value?.length || 0) < filteredOptions.length && (
                <button
                  type="button"
                  className="multiselect-link-btn"
                  onClick={() => {
                    const combined = Array.from(new Set([...selectedStrings, ...filteredOptions.map((o) => o.value)]));
                    onChange(combined);
                  }}
                >
                  Select all
                </button>
              )}
              {value && value.length > 0 && (
                <button
                  type="button"
                  className="multiselect-link-btn"
                  onClick={() => onChange([])}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className="multiselect-list" role="listbox">
            {filteredOptions.map((opt) => {
              const checked = selectedStrings.includes(opt.value);
              return (
                <label
                  key={opt.value}
                  className={`multiselect-item ${checked ? "selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleOption(opt.value)}
                  />
                  <span className="multiselect-item-name" title={opt.label}>
                    {opt.label}
                  </span>
                </label>
              );
            })}
            {filteredOptions.length === 0 && (
              <div className="multiselect-empty">No options found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
