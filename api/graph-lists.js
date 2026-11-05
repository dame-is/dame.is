// Managed graph lists: Bluesky lists kept in step with who you engage with and
// who sits near you in the follow graph. See api/_lib/graphLists.js for how,
// and src/lib/graphLists.js for who.
//
// Two callers:
//   the cron       GET with `Authorization: Bearer <CRON_SECRET>`; syncs every
//                  enabled list (vercel.json, every six hours).
//   the admin      POST with a service-auth token for LXM, from the Analytics
//                  studio's Graph tab. Actions:
//                    status                    definitions + live sizes
//                    preview  { definition }   who a rule picks; writes nothing
//                    save     { definition }   create/update (makes the list)
//                    sync     { key? }         one list, or every enabled one
//                    remove   { key, deleteList }
//                    orbit    { windowDays }   the proximity picture

import { authorize } from './_lib/serviceAuth.js';
import {
  orbit,
  preview,
  removeDefinition,
  saveDefinition,
  status,
  syncAll,
} from './_lib/graphLists.js';

export const config = { maxDuration: 60 };

const LXM = 'is.dame.graph.lists';

export default async function handler(req, res) {
  const caller = await authorize(req, res, { lxm: LXM });
  if (!caller) return;

  const body = req.body || {};
  const action = caller === 'cron' ? 'sync' : body.action || 'status';

  try {
    if (action === 'status') return res.status(200).json(await status());
    if (action === 'preview') {
      return res.status(200).json(await preview(body.definition || {}));
    }
    if (action === 'save') {
      return res.status(200).json(await saveDefinition(body.definition || {}));
    }
    if (action === 'sync') {
      return res.status(200).json(await syncAll({ only: body.key || null }));
    }
    if (action === 'remove') {
      if (!body.key) return res.status(400).json({ error: 'pass key' });
      return res
        .status(200)
        .json(
          await removeDefinition(body.key, {
            deleteList: Boolean(body.deleteList),
          }),
        );
    }
    if (action === 'orbit') {
      return res
        .status(200)
        .json(await orbit({ windowDays: Number(body.windowDays) || 30 }));
    }
    return res.status(400).json({ error: `unknown action ${action}` });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
