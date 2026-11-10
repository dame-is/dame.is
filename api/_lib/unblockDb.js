// The `unblock` schema on the atpota.to project, reached the one way anything
// reaches it: its functions, through PostgREST, with the service role key.
//
// Server-side only, like modDb.js beside it and for the same reason: the key
// bypasses row-level security, so nothing the bundler can reach may import
// this. Two callers do. api/unblocked.js reads (`board`, `lookup`), and the
// consumer on the droplet writes (`ingest`); see docs/sql/unblock.sql for
// what each function does.
//
// Everything is a function call, so there is no table verb here to get the
// schema header wrong on. A POST selects its schema with Content-Profile.

const SCHEMA = 'unblock';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to reach the unblock schema');
  }
  return { url: url.replace(/\/$/, ''), key };
}

/** Whether the two settings `rpc` needs are present. */
export function configured() {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

/**
 * Call `unblock.<fn>(args)` and return what it returns.
 *
 * Throws on anything but success, with the status on the error so a caller
 * can tell "the schema isn't there yet" (404, 406) from "Postgres is having a
 * moment".
 */
export async function rpc(fn, args = {}, { timeoutMs = 8000, fetchImpl = fetch } = {}) {
  const { url, key } = config();
  const res = await fetchImpl(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Content-Profile': SCHEMA,
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`unblock db ${fn} failed: ${res.status} ${detail.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
