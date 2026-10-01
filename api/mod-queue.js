// The review queue, for the portal.
//
// Actions (POST body):
//   { action: 'page', reason?, offset?, limit? }   one page, with profiles
//   { action: 'decide', did, decision, reason?, band? }
//       decision: keep | remove | restore (undo a removal) | reopen (undo a keep)
//
// Removal uses the moderator account's credential, as /api/mod-remove does; the
// list lives in that account's repo and nowhere else can write it. A restore
// goes through applyCommand, so the PROTECTED veto applies to it exactly as it
// does to every other add. See api/_lib/queue.js for why decisions live in
// mod.review rather than on the audit's rows.

import { queuePage, decide } from './_lib/queue.js';
import { applyCommand } from './_lib/listWrite.js';
import { botAgent } from './_lib/botAgent.js';
import { authorize } from './_lib/serviceAuth.js';

export const config = { maxDuration: 60 };

const LXM = 'is.dame.mod.queue';

export default async function handler(req, res) {
  if (!(await authorize(req, res, { lxm: LXM }))) return;
  const body = req.body || {};
  const action = body.action || req.query?.action || 'page';

  try {
    if (action === 'page') {
      return res.status(200).json(
        await queuePage({
          reason: body.reason,
          offset: body.offset,
          limit: body.limit,
        }),
      );
    }
    if (action === 'decide') {
      const needsBot =
        body.decision === 'remove' || body.decision === 'restore';
      const agent = needsBot ? (await botAgent()).agent : null;
      return res
        .status(200)
        .json(await decide(agent, body, { addToList: applyCommand }));
    }
    return res.status(400).json({ error: `unknown action ${action}` });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
