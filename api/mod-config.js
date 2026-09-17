// The analyst's configuration, as the server sees it.
//
// READ-ONLY, deliberately. The record lives in dame's repo and is written in the
// browser with dame's own OAuth session — the same split as list removals, and
// for the same reason: the server holds the BOT's credential, and the bot must
// not be able to rewrite what it was told to do. This endpoint resolves the
// effective config and refreshes the server-side cache; it never writes the
// record.
//
// GET  -> { config, default: { style }, nsid, rkey, maxChars }
// POST -> the same, after re-reading the record. Call it once after a putRecord
//         so the cached fallback matches what was just published.

import { DEFAULT_VOICE } from '../src/lib/moderation/agent.js';
import {
  loadAgentConfig,
  CONFIG_NSID,
  CONFIG_RKEY,
  MAX_FIELD_CHARS,
} from './_lib/agentConfig.js';
import { authorize } from './_lib/serviceAuth.js';

const LXM = 'is.dame.mod.config';

export default async function handler(req, res) {
  if (!(await authorize(req, res, { lxm: LXM }))) return;
  try {
    const config = await loadAgentConfig();
    return res.status(200).json({
      config,
      default: { style: DEFAULT_VOICE },
      nsid: CONFIG_NSID,
      rkey: CONFIG_RKEY,
      maxChars: MAX_FIELD_CHARS,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
