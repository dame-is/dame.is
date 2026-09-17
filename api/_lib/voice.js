// How the analyst sounds, loaded at runtime instead of compiled in.
//
// The register was hardcoded next to the rules about what the score means, so
// "make it less lecture-y" was a commit, a push and a deploy. Those are two
// different kinds of thing: what the bands mean is a claim the system has to
// keep making the same way, and whether it opens with a headline or a sentence
// is taste. Only the second belongs in a database.
//
// WHAT IS NOT EDITABLE HERE. The character budgets and the public/private rules
// stay in src/lib/moderation/agent.js. A DM caps at 1000 graphemes and a post at
// 300; those are lexicon limits, and a tone setting that could edit them is a
// tone setting that can produce messages the server refuses. Likewise "this
// reply is public" is a fact about where the text is going, not a preference.
//
// WHERE THIS IS HEADED. The natural home is a record in the moderator account's
// own repo — the bot's voice published in the same atmosphere it reads from,
// versioned by the PDS, inspectable by anyone who wonders how it is configured.
// This module is the seam for that: callers ask `loadVoice()` and do not know
// where it came from, and the stored shape is already record-shaped, so the PDS
// version becomes a second `source` rather than a migration.

import { select, upsert } from './modDb.js';

/** Long enough to be a voice, short enough not to be a second system prompt. */
export const MAX_STYLE_CHARS = 2000;

/**
 * The stored voice, or null to use the built-in default.
 *
 * Never throws. A voice that cannot be read is a cosmetic loss, and failing an
 * answer over it would trade the thing that matters for the thing that does not.
 *
 * @returns {Promise<{ style: string, source: string, updated_at: string }|null>}
 */
export async function loadVoice() {
  try {
    const rows = await select('settings', { select: 'voice', eq: { id: 1 } });
    const voice = rows?.[0]?.voice;
    const style = String(voice?.style || '').trim();
    if (!style) return null;
    return {
      style: style.slice(0, MAX_STYLE_CHARS),
      source: voice.source || 'settings',
      updated_at: voice.updated_at || null,
    };
  } catch {
    return null;
  }
}

/**
 * Store a voice. Returns what was stored.
 *
 * An empty string clears it, which is the way back to the default — a setting
 * you cannot unset is a setting that has to be got right first time.
 */
export async function saveVoice(style, { source = 'settings' } = {}) {
  const trimmed = String(style || '').trim();
  if (trimmed.length > MAX_STYLE_CHARS) {
    throw new Error(
      `voice is ${trimmed.length} characters; the limit is ${MAX_STYLE_CHARS}`,
    );
  }
  const voice = trimmed
    ? { style: trimmed, source, updated_at: new Date().toISOString() }
    : null;
  await upsert('settings', [
    { id: 1, voice, updated_at: new Date().toISOString() },
  ]);
  return voice;
}
