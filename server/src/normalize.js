// Normalisation used for duplicate detection (FR-021) and search.

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "master", "baby", "kumari", "shri", "smt", "sri"]);

// Return E.164-like digits ("919876543210") or "" if unusable.
function normalizePhone(raw, cc = "91") {
  if (!raw) return "";
  const s = String(raw).trim();
  let hasPlus = s.startsWith("+");
  let digits = s.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
    hasPlus = true;
  }
  if (hasPlus) return digits;
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) return cc + digits;
  return digits;
}

function normalizeInstagram(raw) {
  if (!raw) return "";
  let s = String(raw).trim();
  if (s.startsWith("@")) return s.slice(1).toLowerCase().replace(/^\/+|\/+$/g, "");
  if (s.includes("instagram.com") || s.includes("instagr.am")) {
    if (!s.startsWith("http")) s = "https://" + s;
    try {
      const path = new URL(s).pathname.replace(/^\/+|\/+$/g, "");
      return (path ? path.split("/")[0] : "").toLowerCase();
    } catch {
      return "";
    }
  }
  return s.toLowerCase();
}

const instagramUrl = (v) => {
  const h = normalizeInstagram(v);
  return h ? `https://www.instagram.com/${h}/` : "";
};

function normalizeName(raw) {
  if (!raw) return "";
  const s = String(raw)
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-zA-Z\s]/g, " ")
    .toLowerCase();
  return s
    .split(/\s+/)
    .filter((t) => t && !HONORIFICS.has(t))
    .join(" ");
}

// Ratcliff/Obershelp similarity, same as Python's difflib.SequenceMatcher.ratio().
function similarity(a, b) {
  if (!a.length && !b.length) return 1;
  const matches = (s1, s2) => {
    if (!s1.length || !s2.length) return 0;
    let best = 0, i1 = 0, i2 = 0;
    const prev = new Array(s2.length + 1).fill(0);
    for (let i = 1; i <= s1.length; i++) {
      let diag = 0;
      for (let j = 1; j <= s2.length; j++) {
        const tmp = prev[j];
        prev[j] = s1[i - 1] === s2[j - 1] ? diag + 1 : 0;
        if (prev[j] > best) {
          best = prev[j];
          i1 = i - best;
          i2 = j - best;
        }
        diag = tmp;
      }
    }
    if (!best) return 0;
    return best + matches(s1.slice(0, i1), s2.slice(0, i2)) + matches(s1.slice(i1 + best), s2.slice(i2 + best));
  };
  return (2 * matches(a, b)) / (a.length + b.length);
}

module.exports = { normalizePhone, normalizeInstagram, instagramUrl, normalizeName, similarity };
