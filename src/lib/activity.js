// Physical-activity string handling, shared by the state surfaces. The iPhone
// reports activity as free-ish, inconsistently-worded strings ("Stationary",
// "In a moving vehicle", …). Normalize them to a small set of canonical keys so
// the icons resolve and the same state groups together, and give the wordier
// ones a short display label.

const ALIASES = {
  stationary: 'stationary',
  still: 'stationary',
  idle: 'stationary',
  walking: 'walking',
  walk: 'walking',
  'on foot': 'walking',
  running: 'running',
  run: 'running',
  cycling: 'cycling',
  biking: 'cycling',
  bicycling: 'cycling',
  'on a bicycle': 'cycling',
  automotive: 'automotive',
  driving: 'automotive',
  'in a vehicle': 'automotive',
  'in vehicle': 'automotive',
  'in a moving vehicle': 'automotive',
};

/**
 * Map a raw activity string to a canonical key (stationary | walking | running
 * | cycling | automotive), or null for empty / "unknown". Falls back to loose
 * keyword matching for phrasings we didn't enumerate, then to the raw lowercased
 * string so an unrecognized-but-present activity still shows (generic icon).
 */
export function normalizeActivity(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s || s === 'unknown') return null;
  if (ALIASES[s]) return ALIASES[s];
  if (/vehicle|driving|automotive/.test(s)) return 'automotive';
  if (/cycl|bike|bicycl/.test(s)) return 'cycling';
  if (/runn/.test(s)) return 'running';
  if (/walk|on foot/.test(s)) return 'walking';
  if (/stationary|not moving|standing still|\bstill\b|idle/.test(s)) return 'stationary';
  return s;
}

const LABELS = {
  automotive: 'in vehicle',
};

/** Short display label for a canonical activity key (defaults to the key). */
export function activityLabel(key) {
  if (!key) return '';
  return LABELS[key] || key;
}
