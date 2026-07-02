// Vercel serverless function: mirror moth observations from iNaturalist onto
// the PDS. Wired into vercel.json as a daily cron; the same work can be run
// locally with `node scripts/mirror-inaturalist.mjs`.
//
// Incremental: a cheap freshness check skips the run when nothing changed;
// otherwise only changed/new observations are re-pulled and written, and
// removed ones are deleted. Location data is stripped upstream in
// `src/lib/inaturalist.js` and never reaches the PDS.
//
// Auth: if CRON_SECRET is set, the request must carry
// `Authorization: Bearer <CRON_SECRET>` (Vercel sends this automatically for
// cron invocations). Requires BSKY_APP_PASSWORD (+ optional BSKY_IDENTIFIER).

import { AtpAgent } from '@atproto/api';

import { ME_HANDLE, INATURALIST_USER, MOTHING_NSID } from '../src/config.js';
import { resolveIdentifier } from '../src/lib/atproto.js';
import { syncMothingMirror } from '../src/lib/mothingMirror.js';

export const config = { maxDuration: 60 };

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
    const { did, pds } = await resolveIdentifier(identifier);
    const agent = new AtpAgent({ service: pds });
    await agent.login({ identifier, password });

    const report = await syncMothingMirror({
      agent,
      did,
      user: INATURALIST_USER,
      log: (...a) => console.log('[mirror-mothing]', ...a),
    });

    return res.status(report.failed ? 207 : 200).json({
      ok: true,
      user: INATURALIST_USER,
      noop: Boolean(report.noop),
      changed: report.changed ?? 0,
      written: report.written ?? 0,
      deleted: report.deleted ?? 0,
      failed: report.failed ?? 0,
      observations: report.observations,
      species: report.species,
      summary: `at://${did}/${MOTHING_NSID}/self`,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'mirror failed' });
  }
}
