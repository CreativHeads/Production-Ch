// Thin fetch wrapper: same-origin session cookie + CSRF header, friendly errors.

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.detail) || `Request failed (${status})`);
    this.status = status;
    this.body = body || {};
    this.errors = (body && body.errors) || {};
    this.code = body && body.code;
  }
}

function cookie(name) {
  const m = document.cookie.match(new RegExp("(^|;\\s*)" + name + "=([^;]*)"));
  return m ? decodeURIComponent(m[2]) : "";
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export async function request(method, path, data, { raw = false, signal } = {}) {
  const opts = { method, credentials: "same-origin", headers: {}, signal };
  if (method !== "GET" && method !== "HEAD") opts.headers["X-CSRFToken"] = cookie("csrftoken");
  if (data instanceof FormData) {
    opts.body = data;
  } else if (data !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(data);
  }
  let res;
  try {
    res = await fetch(path.startsWith("/") ? path : `/api/${path}`, opts);
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError(0, { detail: "Can't reach the server. Check your connection and try again." });
  }
  if (raw) return res;
  if (res.status === 204) return null;
  let body = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { detail: res.ok ? text : `The server returned an unexpected response (${res.status}).` };
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      if (body && /sign in|session/i.test(body.detail || "")) onUnauthorized();
    }
    throw new ApiError(res.status, body);
  }
  return body;
}

export const api = {
  get: (p, params, o) => request("GET", p + qs(params), undefined, o),
  post: (p, d, o) => request("POST", p, d, o),
  patch: (p, d, o) => request("PATCH", p, d, o),
  put: (p, d, o) => request("PUT", p, d, o),
  del: (p, d, o) => request("DELETE", p, d, o),
};

export function qs(params) {
  if (!params) return "";
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) return;
    u.set(k, Array.isArray(v) ? v.join(",") : String(v));
  });
  const s = u.toString();
  return s ? `?${s}` : "";
}

export function ensureCsrf() {
  return request("GET", "auth/csrf/").catch(() => null);
}
