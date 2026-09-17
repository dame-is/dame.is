// Read and write the analyst's voice from the portal.
//
// GET  -> { voice: { style, source, updated_at } | null, default: "..." }
// POST { style } -> stores it; an empty string clears it back to the default.
//
// Taste only. The character budgets and the public/private rules are structural
// and live in src/lib/moderation/agent.js, out of reach of this endpoint — see
// api/_lib/voice.js for why that line is drawn where it is.

import { DEFAULT_VOICE } from '../src/lib/moderation/agent.js';
import { loadVoice, saveVoice, MAX_STYLE_CHARS } from './_lib/voice.js';
import { authorize } from './_lib/serviceAuth.js';

const LXM = 'is.dame.mod.voice';

export default async function handler(req, res) {
  if (!(await authorize(req, res, { lxm: LXM }))) return;

  try {
    if (req.method === 'POST') {
      const style = req.body?.style;
      if (typeof style !== 'string') {
        return res.status(400).json({ error: 'style must be a string' });
      }
      const voice = await saveVoice(style);
      return res.status(200).json({ voice, default: DEFAULT_VOICE });
    }
    const voice = await loadVoice();
    return res
      .status(200)
      .json({ voice, default: DEFAULT_VOICE, maxChars: MAX_STYLE_CHARS });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
