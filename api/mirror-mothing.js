// Vercel serverless function: mirror moth observations from iNaturalist onto
// the PDS. Wired into vercel.json as a daily cron; the same work can be run
// locally with `node scripts/mirror-inaturalist.mjs`.
//
// Writes `is.dame.mothing/self` (summary) + one
// `is.dame.mothing.observation/<inatId>` record per observation. Location
// data is stripped upstream in `src/lib/inaturalist.js` and never reaches
// the PDS.
//
// Auth: if CRON_SECRET is set, the request must carry
// `Authorization: Bearer <CRON_SECRET>` (Vercel sends this automatically for
// cron invocations). Requires BSKY_APP_PASSWORD (+ optional BSKY_IDENTIFIER).

import { AtpAgent } from '@atproto/api';

import { ME_HANDLE, INATURALIST_USER, MOTHING_NSID } from '../src/config.js';
import { resolveIdentifier } from '../src/lib/atproto.js';
import { fetchMothData, buildMirrorWrites } from '../src/lib/inaturalist.js';

export const config = { maxDuration: 60 };

async function pool(items, size, worker) {
  let i = 0;
  let ok = 0;
  let fail = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const item = items[i++];
        try {
          await worker(item);
          ok++;
        } catch {
          fail++;
        }
      }
    }),
  );
  return { ok, fail };
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers?.authorization || '';
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const identifier = process.env.BSKY_IDENTIFIER || process.env.ATP_IDENTIFIER || ME_HANDLE;
  const password = process.env.BSKY_APP_PASSWORD || process.env.ATP_APP_PASSWORD;
  if (!password) {
    return res.status(500).json({ error: 'BSKY_APP_PASSWORD is not configured.' });
  }

  try {
    const { stats, observations } = await fetchMothData({ user: INATURALIST_USER });
    const now = new Date().toISOString();
    const { summary, records } = buildMirrorWrites({ observations, stats, now });
    const writes = [summary, ...records];

    const { did, pds } = await resolveIdentifier(identifier);
    const agent = new AtpAgent({ service: pds });
    await agent.login({ identifier, password });

    const { ok, fail } = await pool(writes, 6, async (w) => {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: w.collection,
        rkey: w.rkey,
        record: w.value,
        validate: false,
      });
    });

    return res.status(fail ? 207 : 200).json({
      ok: true,
      user: INATURALIST_USER,
      observations: observations.length,
      species: stats.speciesCount,
      written: ok,
      failed: fail,
      summary: `at://${did}/${MOTHING_NSID}/self`,
      at: now,
    });
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'mirror failed' });
  }
}
