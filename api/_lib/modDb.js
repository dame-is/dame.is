// Tiny PostgREST client for the `mod` schema on the atpota.to project.
//
// Server-side only, and that is the whole reason this file is under `api/`
// rather than `src/lib/`. It authenticates with the SERVICE ROLE key, which
// bypasses row-level security — importing it from anywhere the bundler can
// reach would ship that key to the browser. The `mod` tables have RLS on with
// no policies precisely so that nothing but this path can read them; putting
// the key in a client bundle would hand every visitor the moderation log.
//
// No `@supabase/supabase-js`: everything here is four verbs over PostgREST, and
// a dependency that large earns its place in a client bundle, not in a handful
// of serverless upserts.
//
// ONE PIECE OF SETUP is required before any of this works. PostgREST only
// serves schemas on its exposed list, and `mod` is not `public`. Add it in the
// Supabase dashboard under Settings -> API -> Exposed schemas. Without that,
// every call here fails with "The schema must be one of the following". RLS
// still governs access afterwards, so exposing the schema grants nothing: anon
// and authenticated have been revoked and hold no policies.

const SCHEMA = 'mod';

function config() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to reach the mod schema',
    );
  }
  return { url: url.replace(/\/$/, ''), key };
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const { url, key } = config();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      // Accept-Profile selects the schema for reads, Content-Profile for
      // writes. Sending the wrong one for the verb silently targets `public`.
      ...(method === 'GET' || method === 'HEAD'
        ? { 'Accept-Profile': SCHEMA }
        : { 'Content-Profile': SCHEMA }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(
      `mod db ${method} ${path} failed: ${res.status} ${detail.slice(0, 400)}`,
    );
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** `select(table, { eq: {...}, is: {...}, select, order, limit })` */
export function select(table, opts = {}) {
  const q = new URLSearchParams();
  q.set('select', opts.select || '*');
  for (const [col, val] of Object.entries(opts.eq || {})) {
    q.set(col, `eq.${val}`);
  }
  for (const [col, val] of Object.entries(opts.is || {})) {
    q.set(col, `is.${val}`);
  }
  if (opts.order) q.set('order', opts.order);
  if (opts.limit) q.set('limit', String(opts.limit));
  return request(`${table}?${q}`);
}

/**
 * Insert rows, updating on primary-key conflict.
 *
 * Chunked because PostgREST holds the whole body in memory and a snapshot's
 * edge set runs to six figures. `returning=minimal` keeps the response empty:
 * we never want 190k rows echoed back at us.
 */
export async function upsert(table, rows, { chunk = 1000 } = {}) {
  if (!rows?.length) return 0;
  for (let i = 0; i < rows.length; i += chunk) {
    await request(table, {
      method: 'POST',
      body: rows.slice(i, i + chunk),
      headers: {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
    });
  }
  return rows.length;
}

/** `update(table, { eq: {...} }, patch)` */
export function update(table, match, patch) {
  const q = new URLSearchParams();
  for (const [col, val] of Object.entries(match.eq || {})) {
    q.set(col, `eq.${val}`);
  }
  return request(`${table}?${q}`, {
    method: 'PATCH',
    body: patch,
    headers: { Prefer: 'return=minimal' },
  });
}

/** `del(table, { eq: {...} })` */
export function del(table, match) {
  const q = new URLSearchParams();
  for (const [col, val] of Object.entries(match.eq || {})) {
    q.set(col, `eq.${val}`);
  }
  return request(`${table}?${q}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal' },
  });
}

/** Call a Postgres function, e.g. `rpc('finalise_snapshot', { snapshot })`. */
export function rpc(fn, args = {}) {
  return request(`rpc/${fn}`, { method: 'POST', body: args });
}

/** `count(table, { eq: {...} })` — HEAD with an exact count, no rows returned. */
export async function count(table, opts = {}) {
  const { url, key } = config();
  const q = new URLSearchParams();
  q.set('select', 'count');
  for (const [col, val] of Object.entries(opts.eq || {})) {
    q.set(col, `eq.${val}`);
  }
  for (const [col, val] of Object.entries(opts.is || {})) {
    q.set(col, `is.${val}`);
  }
  if (opts.not_null) q.set(opts.not_null, 'not.is.null');
  const res = await fetch(`${url}/rest/v1/${table}?${q}`, {
    method: 'HEAD',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Accept-Profile': SCHEMA,
      Prefer: 'count=exact',
    },
  });
  const range = res.headers.get('content-range') || '';
  const total = range.split('/')[1];
  return total === '*' || total == null ? null : Number(total);
}
