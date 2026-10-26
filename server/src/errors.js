// Every API error leaves as {"detail": "<sentence for a person>", "errors": {field: [msgs]}, "code": "..."}.

class HttpError extends Error {
  constructor(status, detail, code = "error", extra = {}) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.code = code;
    this.extra = extra;
  }
}

class ValidationError extends HttpError {
  // errors: {field: [msg]} or {field: msg}
  constructor(errors) {
    const flat = {};
    for (const [k, v] of Object.entries(errors)) flat[k] = Array.isArray(v) ? v : [v];
    const first = Object.values(flat)[0];
    super(400, first ? `Please check the highlighted fields: ${first[0]}` : "Please check the form.", "invalid", { errors: flat });
  }
}

class Conflict extends HttpError {
  constructor(detail = "This change conflicts with existing data.", code = "conflict", extra = {}) {
    super(409, detail, code, extra);
  }
}

const notFound = () => new HttpError(404, "We couldn't find that record. It may have been deleted or archived.", "not_found");
const forbidden = (detail = "You do not have permission to perform this action.") => new HttpError(403, detail, "permission_denied");

// Express 4 doesn't catch rejected promises; wrap every async handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ detail: err.detail, code: err.code, ...err.extra });
  }
  if (err && (err.code === "LIMIT_FILE_SIZE" || err.type === "entity.too.large")) {
    return res.status(413).json({ detail: "That file is too large to upload.", code: "too_large" });
  }
  if (err && (err.code === "ER_DUP_ENTRY" || /UNIQUE constraint failed/.test(err.message || ""))) {
    return res.status(409).json({ detail: "This would create a duplicate or conflicting record. Please check and try again.", code: "integrity" });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ detail: "The request body isn't valid JSON.", code: "parse_error" });
  }
  console.error("Unhandled API error", err);
  return res.status(500).json({ detail: "Something went wrong on our side. Your data was not changed. Please try again.", code: "server_error" });
}

module.exports = { HttpError, ValidationError, Conflict, notFound, forbidden, wrap, errorHandler };
