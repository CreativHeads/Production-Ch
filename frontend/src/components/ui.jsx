import { forwardRef, useEffect, useId, useMemo, useRef, useState } from "react";
import { cx } from "../lib/util";

// ---- Icons (inline, stroke-based) -----------------------------------------
const P = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  users: "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 10.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5M20 19v-1.5a3.5 3.5 0 0 0-2.5-3.35M15 4.15a3.25 3.25 0 0 1 0 6.2",
  film: "M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  tag: "M3 12V4h8l9 9-8 8zM7.5 8.5h.01",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M21 21l-5-5",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6 6 18",
  star: "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z",
  phone: "M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1",
  chat: "M4 20l1.3-3.9A8 8 0 1 1 8 19z",
  insta: "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17.5 6.5h.01",
  copy: "M9 9h11v11H9zM5 15H4V4h11v1",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  archive: "M3 5h18v4H3zM5 9v10h14V9M10 13h4",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  history: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  filter: "M3 5h18l-7 8v6l-4 2v-8z",
  play: "M7 4v16l13-8z",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  rotate: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  check: "M5 12l5 5L20 7",
  alert: "M12 3l10 18H2zM12 10v5M12 18h.01",
  menu: "M4 6h16M4 12h16M4 18h16",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  download: "M12 4v12M7 11l5 5 5-5M4 20h16",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0",
  up: "M12 19V5M5 12l7-7 7 7",
  down: "M12 5v14M5 12l7 7 7-7",
  chevron: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
};

export function Icon({ name, size = 18, fill = false, className, title }) {
  return (
    <svg
      className={cx("icon", className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : "true"}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      <path d={P[name] || ""} />
    </svg>
  );
}

// ---- Buttons ---------------------------------------------------------------
export function Button({ variant = "secondary", size, icon, children, busy, className, type = "button", ...rest }) {
  return (
    <button type={type} className={cx("btn", `btn-${variant}`, size && `btn-${size}`, className)} disabled={busy || rest.disabled} {...rest}>
      {busy ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={16} /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ icon, label, className, active, ...rest }) {
  return (
    <button type="button" className={cx("icon-btn", active && "is-active", className)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} fill={icon === "star" && active} />
    </button>
  );
}

// ---- Form fields -----------------------------------------------------------
export function Field({ label, error, hint, required, children, className }) {
  const id = useId();
  const child = typeof children === "function" ? children(id) : children;
  return (
    <div className={cx("field", error && "has-error", className)}>
      {label && (
        <label htmlFor={id} className="field-label">
          {label}
          {required && <span className="req" aria-label="required"> *</span>}
        </label>
      )}
      {child}
      {hint && !error && <div className="field-hint">{hint}</div>}
      {error && <div className="field-error">{Array.isArray(error) ? error.join(" ") : error}</div>}
    </div>
  );
}

export const TextInput = forwardRef(function TextInput({ label, error, hint, required, value, onChange, className, ...rest }, ref) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id) => <input id={id} ref={ref} className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} {...rest} />}
    </Field>
  );
});

export function TextArea({ label, error, hint, value, onChange, rows = 3, className, ...rest }) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(id) => <textarea id={id} className="input" rows={rows} value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...rest} />}
    </Field>
  );
}

export function Select({ label, error, hint, value, onChange, options, placeholder = "—", required, className, ...rest }) {
  return (
    <Field label={label} error={error} hint={hint} required={required} className={className}>
      {(id) => (
        <select id={id} className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...rest}>
          {placeholder !== null && <option value="">{placeholder}</option>}
          {(options || []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Check({ label, checked, onChange, hint }) {
  return (
    <label className="check">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function TriState({ label, value, onChange }) {
  const opts = [
    { value: "", label: "Not recorded" },
    { value: "true", label: "Yes" },
    { value: "false", label: "No" },
  ];
  return <Select label={label} value={value === null || value === undefined ? "" : String(value)} onChange={(v) => onChange(v === "" ? null : v === "true")} options={opts.slice(1)} placeholder="Not recorded" />;
}

// Searchable multi-select of terms (categories, tags, skills, languages)
export function TermPicker({ label, terms, value = [], onChange, error, required, placeholder = "Type to search", onCreate, single }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = useMemo(() => value.map((id) => terms.find((t) => t.id === Number(id))).filter(Boolean), [value, terms]);
  const options = terms.filter((t) => !value.map(Number).includes(t.id) && t.name.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const add = (id) => {
    onChange(single ? [id] : [...value.map(Number), id]);
    setQ("");
    if (single) setOpen(false);
  };
  const exact = terms.some((t) => t.name.toLowerCase() === q.trim().toLowerCase());
  return (
    <Field label={label} error={error} required={required}>
      {(id) => (
        <div className="picker" ref={ref}>
          <div className="picker-box" onClick={() => setOpen(true)}>
            {selected.map((t) => (
              <span className="chip chip-solid" key={t.id}>
                {t.name}
                <button type="button" aria-label={`Remove ${t.name}`} onClick={(e) => (e.stopPropagation(), onChange(value.filter((v) => Number(v) !== t.id)))}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
            <input
              id={id}
              className="picker-input"
              value={q}
              placeholder={selected.length ? "" : placeholder}
              onFocus={() => setOpen(true)}
              onChange={(e) => (setQ(e.target.value), setOpen(true))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (options[0]) add(options[0].id);
                  else if (onCreate && q.trim() && !exact) onCreate(q.trim()).then((t) => t && add(t.id));
                }
                if (e.key === "Backspace" && !q && value.length) onChange(value.slice(0, -1));
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
          {open && (options.length > 0 || (onCreate && q.trim() && !exact)) && (
            <ul className="picker-menu" role="listbox">
              {options.map((t) => (
                <li key={t.id} role="option" aria-selected="false" onMouseDown={(e) => (e.preventDefault(), add(t.id))}>
                  {t.name}
                </li>
              ))}
              {onCreate && q.trim() && !exact && (
                <li className="picker-create" onMouseDown={(e) => (e.preventDefault(), onCreate(q.trim()).then((t) => t && add(t.id)))}>
                  Create “{q.trim()}”
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
}

// ---- Feedback --------------------------------------------------------------
export function Spinner({ label = "Loading" }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <Icon name="alert" />
      <div>
        <strong>{error.message || String(error)}</strong>
        {onRetry && (
          <div>
            <button className="link-btn" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function Alert({ kind = "info", children, icon = "alert" }) {
  return (
    <div className={`alert alert-${kind}`}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide, labelledBy }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const focusable = el && el.querySelector("input, select, textarea, button:not(.modal-close)");
    focusable && focusable.focus();
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("no-scroll");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("no-scroll");
      prev && prev.focus && prev.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx("modal", wide && "modal-wide")} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn modal-close" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Confirm({ title, children, confirmLabel = "Confirm", danger, onConfirm, onClose, busy, needsReason, reasonLabel = "Reason" }) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} busy={busy} disabled={needsReason && !reason.trim()} onClick={() => onConfirm(reason)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="prose">{children}</div>
      {needsReason && <TextArea label={reasonLabel} value={reason} onChange={setReason} rows={2} />}
    </Modal>
  );
}

export function Pagination({ page, pages, count, onPage }) {
  if (!pages || pages <= 1) return count != null ? <div className="pager-count">{count} result{count === 1 ? "" : "s"}</div> : null;
  const nums = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) nums.push(i);
  return (
    <nav className="pager" aria-label="Pagination">
      <span className="pager-count">{count} results</span>
      <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      {nums[0] > 1 && (
        <>
          <button className="pager-num" onClick={() => onPage(1)}>1</button>
          {nums[0] > 2 && <span className="pager-gap">…</span>}
        </>
      )}
      {nums.map((n) => (
        <button key={n} className={cx("pager-num", n === page && "is-current")} aria-current={n === page ? "page" : undefined} onClick={() => onPage(n)}>
          {n}
        </button>
      ))}
      {nums[nums.length - 1] < pages && (
        <>
          {nums[nums.length - 1] < pages - 1 && <span className="pager-gap">…</span>}
          <button className="pager-num" onClick={() => onPage(pages)}>{pages}</button>
        </>
      )}
      <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </nav>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={cx("tab", value === t.value && "is-active")} onClick={() => onChange(t.value)}>
          {t.label}
          {t.count != null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function StatusPill({ value, label, tone }) {
  return <span className={cx("pill", `pill-${tone || value}`)}>{label || value}</span>;
}

export function Meter({ value }) {
  const tone = value >= 100 ? "full" : value >= 60 ? "mid" : "low";
  return (
    <span className={cx("meter", `meter-${tone}`)} title={`Profile ${value}% complete`}>
      <span style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  );
}

// Apply API field errors to a form and return a top-level message
export function formErrors(err) {
  return (err && err.errors) || {};
}
