// Vercel serverless function: what /experimenting/unblocking shows.
//
//   /api/unblocked             the accounts the most people have unblocked,
//                              and what the tracker says about itself
//   /api/unblocked?did=did:…   one account: who has unblocked it, and when
//
// Both are read from the `unblock` schema on Supabase (docs/sql/unblock.sql),
// which a consumer on the droplet fills (services/unblock-consumer). This
// function only reads.
//
// Why the page asks here and not Supabase: the schema is closed to everything
// but the service role, which no browser may hold; and the ranking reads the
// whole table, so the CDN is asked to answer for five minutes at a time
// instead of Postgres answering every visitor.
//
// Nothing here is private. A block is a public record in its author's
// repository, and so is its deletion; anyone watching the network sees both.
// A lookup takes any account for the same reason the tools that show who
// blocks you do.

import { rpc } from './_lib/unblockDb.js';
import { BOARD_SIZE, LOOKUP_SIZE, QUICK_SECONDS, isDid } from '../src/lib/unblocking.js';

const BOARD_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';
const LOOKUP_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    res.status(405).json({ error: 'GET only' });
    return;
  }

  const did = String((req.query && req.query.did) || '').trim();
  if (did && !isDid(did)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'did must be a DID' });
    return;
  }

  try {
    if (did) {
      const body = await rpc('lookup', { who: did, min_seconds: QUICK_SECONDS, max_rows: LOOKUP_SIZE });
      res.setHeader('Cache-Control', LOOKUP_CACHE);
      res.status(200).json(body);
      return;
    }
    const body = await rpc('board', { min_seconds: QUICK_SECONDS, max_rows: BOARD_SIZE });
    res.setHeader('Cache-Control', BOARD_CACHE);
    res.status(200).json(body);
  } catch (err) {
    // The schema not existing yet, Supabase being unreachable, the key being
    // absent: to a visitor these are one thing, and the page says so. The
    // detail goes to the function's log, not to the response.
    console.error('[unblocked]', err?.message || err);
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: 'the tracker can’t be reached right now' });
  }
}
