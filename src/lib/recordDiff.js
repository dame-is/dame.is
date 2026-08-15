// Dirty tracking for the record editor — "is there anything unsaved, and what
// exactly did I change?" — as three pure functions, so the answer is testable
// without mounting a form.
//
// This exists because the editor has never been able to answer that question.
// `RecordEditor` kept an `original` state that was written in three places and
// read in none, and the three writes stored three DIFFERENT shapes: the merged
// blank+preset draft, the RAW fetched value (live `BlobRef` instances, before
// `lex.migrate`), and the post-`derive` saved payload. Meanwhile `value` holds
// the migrated, `_url`-annotated form. Comparing those two directly would report
// every legacy-migrated record as permanently dirty, and every record with a
// cover image as dirty the moment its blob was annotated for display.
//
// So nothing is compared until both sides have been put through
// `normalizeForDiff`, which strips exactly the three differences that are ours
// rather than the record's:
//
//   1. `BlobRef` instances → their plain wire form,
//   2. our `_url` display annotations,
//   3. every `autoOnEdit` field, because the save path rewrites those to
//      `Date.now()` on every call and they would otherwise report as changed
//      from the moment the record loads.
//
// The module is deliberately free of React and of any import from the editor:
// vitest runs `environment: 'node'` (vitest.config.js), and this is the half of
// the feature worth pinning with tests.

/**
 * Deep value equality, key-order-insensitive.
 *
 * `JSON.stringify(a) !== JSON.stringify(b)` would be shorter and wrong: it is
 * sensitive to key ORDER, and the blocks editor rebuilds the objects it round-
 * trips (`{$type, plaintext, facets}` is as likely to come back as
 * `{plaintext, facets, $type}`). That would light the whole body up as changed
 * without a keystroke.
 *
 * Both sides are already plain JSON data by the time this runs — no Dates, no
 * class instances, no cycles — so the walk needs no special cases beyond arrays.
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (aIsArray) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]),
  );
}

/** Deep-remove our `_url` display annotations. Mirrors the editor's own stripper. */
function stripUrlAnnotations(value) {
  if (Array.isArray(value)) return value.map(stripUrlAnnotations);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key === '_url') continue;
      out[key] = stripUrlAnnotations(inner);
    }
    return out;
  }
  return value;
}

/**
 * Canonical comparison form for a record value.
 *
 * The JSON round-trip is load-bearing rather than a cheap clone: it runs each
 * `BlobRef`'s `toJSON`, collapsing a live instance to the `{$type:'blob', ref:
 * {$link}, …}` wire form. `structuredClone` mangles those instead (it loses
 * `toJSON` and `ref.$link`), which is the same trap `RecordEditor.toPlainRecord`
 * documents. It also drops `undefined`-valued keys, so "absent" has exactly one
 * representation on both sides of the comparison.
 *
 * @param {object|null} value
 * @param {object|null} lex   The lexicon, for its `autoOnEdit` field list.
 * @returns {object}
 */
export function normalizeForDiff(value, lex) {
  const plain = JSON.parse(JSON.stringify(value ?? {}));
  const out = stripUrlAnnotations(plain);
  // Today this is exactly `updatedAt` (COMMON_TIMESTAMPS in lexicons.js), but
  // the flag is what matters, not the name: `buildRecordPayload` stamps every
  // `autoOnEdit` field with the current time on the way out, so comparing one
  // would mean the editor is dirty on arrival and clean never again.
  for (const field of lex?.fields || []) {
    if (field.autoOnEdit) delete out[field.key];
  }
  return out;
}

/**
 * Which top-level record keys differ.
 *
 * Both arguments must ALREADY be normalized — passing a raw fetched value here
 * is the bug this module exists to prevent, so it is stated rather than guarded.
 *
 * `lex` is optional and affects ORDER only: changed keys come back in the order
 * the form draws them, so the status strip's "3 fields changed: Title, Slug,
 * Body" reads down the page rather than out of a hash. Keys the lexicon does not
 * model (a hand-edited extra, a legacy leftover) follow, alphabetically. Without
 * a lexicon everything is alphabetical.
 *
 * @param {object} baseline  already normalized
 * @param {object} next      already normalized
 * @param {object|null} [lex]
 * @returns {{ dirty: boolean, keys: string[] }}
 */
export function diffRecord(baseline, next, lex = null) {
  const base = baseline || {};
  const now = next || {};
  const changed = new Set();
  // Union of both key sets: a key added by the editor and a key deleted by it
  // are both changes, and after normalization absence is the only way either
  // side can say "not set".
  for (const key of new Set([...Object.keys(base), ...Object.keys(now)])) {
    if (!deepEqual(base[key], now[key])) changed.add(key);
  }
  if (changed.size === 0) return { dirty: false, keys: [] };

  const modelled = [];
  for (const field of lex?.fields || []) {
    if (changed.has(field.key)) {
      modelled.push(field.key);
      changed.delete(field.key);
    }
  }
  return { dirty: true, keys: [...modelled, ...[...changed].sort()] };
}

/**
 * Human labels for a list of record keys — what the status strip actually says.
 * A key the lexicon does not model falls back to the key itself, which is still
 * more use than "1 field changed".
 *
 * @param {string[]} keys
 * @param {object|null} lex
 * @returns {string[]}
 */
export function labelFields(keys, lex) {
  const labels = new Map();
  for (const field of lex?.fields || []) labels.set(field.key, field.label || field.key);
  return (keys || []).map((key) => labels.get(key) || key);
}
