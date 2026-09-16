// Vercel serverless function: the moderator account's DM loop, on demand.
//
// NO LONGER ON A CRON. The droplet consumer owns DM intake now and answers in
// about two seconds instead of up to ten minutes; see services/mod-consumer.
// This endpoint stays as the escape hatch for when that box is down, and it
// runs the same pass over the same cursor via api/_lib/dmLoop.js, so the
// fallback cannot answer differently from the fast path.
//
// Because there is no lease on mod.dm_cursor, running this WHILE the droplet is
// up can answer a message twice: both sides can read the same cursor during the
// 5-20s model call. That is why it is not scheduled. It is a thing you do
// deliberately, with the consumer stopped.
//
//   curl -sS -X POST https://dame.is/api/mod-agent -H "Authorization: Bearer $CRON_SECRET"

import { loadReference, makeIo } from './_lib/reference.js';
import { runDmPass } from './_lib/dmLoop.js';
import { botAgent } from './_lib/botAgent.js';
import { authorize } from './_lib/serviceAuth.js';

export const config = { maxDuration: 60 };

const LXM = 'is.dame.mod.agent';

export default async function handler(req, res) {
  if (!(await authorize(req, res, { lxm: LXM }))) return;

  try {
    const { agent, via } = await botAgent({ chat: true });

    const result = await runDmPass({
      chat: agent,
      // Lazy: a firing with nothing to answer never loads the snapshot, which
      // is most firings and most of the 60s budget.
      getIo: async () => makeIo(await loadReference()),
      botDid: agent.session?.did,
    });

    return res.status(200).json({ ...result, via });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
