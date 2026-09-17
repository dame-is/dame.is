// How the analyst is steered, read from a record in dame's own repo.
//
// WHY DAME'S REPO AND NOT THE BOT'S. The bot's app password lives on a droplet.
// If it ever leaks, the attacker gets the bot — and should not also get the
// ability to rewrite the instructions the bot runs under. Keeping the record in
// dame's repo makes the configuration READ-ONLY TO THE THING BEING CONFIGURED,
// which the bot's own repo could not do however the write was guarded. Writes
// happen in the browser with dame's OAuth session; this module only ever reads.
//
// It also puts the configuration in the atmosphere rather than in a private
// database: anyone who wonders how the bot is set up can fetch the record. That
// fits a system whose whole claim is "here is exactly what it saw".
//
// WHAT A RECORD CAN AND CANNOT DO. `style` replaces the voice block; `guidance`
// is appended after the rules as standing instructions. Neither can remove what
// the bands mean, the untrusted-input handling, or the length budgets — those
// are earlier in the same prompt string and stay in version control, because
// they are the claims that keep the decision log replayable and the reply
// well-formed. See systemPromptFor in src/lib/moderation/agent.js.
//
// THE CACHE IS A FALLBACK, NOT A SOURCE. Every successful read is written to
// mod.settings so an unreachable PDS degrades to the last known good config
// rather than dropping the analyst back to defaults mid-conversation — a silent
// change of register is exactly the kind of thing nobody notices for a week.

import { ME_DID } from '../../src/config.js';
import { resolvePds } from '../../src/lib/atproto.js';
import { select, upsert } from './modDb.js';

export const CONFIG_NSID = 'is.dame.mod.config';
export const CONFIG_RKEY = 'self';

/** Long enough to be a voice, short enough not to be a second system prompt. */
export const MAX_FIELD_CHARS = 2000;

const clip = (v) =>
  String(v ?? '')
    .trim()
    .slice(0, MAX_FIELD_CHARS);

/** The record as dame published it, or null if there isn't one. */
export async function readFromPds({ did = ME_DID, fetchImpl = fetch } = {}) {
  const pds = await resolvePds(did);
  const url =
    `${pds}/xrpc/com.atproto.repo.getRecord` +
    `?repo=${encodeURIComponent(did)}` +
    `&collection=${CONFIG_NSID}&rkey=${CONFIG_RKEY}`;
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  // A missing record is the normal state before one is ever written, not an
  // error worth surfacing.
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw new Error(`config record read failed: ${res.status}`);
  const body = await res.json();
  const value = body?.value;
  if (!value) return null;
  return {
    style: clip(value.style),
    guidance: clip(value.guidance),
    source: 'pds',
    updated_at: value.updatedAt || null,
  };
}

async function readCache() {
  const rows = await select('settings', { select: 'voice', eq: { id: 1 } });
  const v = rows?.[0]?.voice;
  if (!v) return null;
  const style = clip(v.style);
  const guidance = clip(v.guidance);
  if (!style && !guidance) return null;
  return {
    style,
    guidance,
    source: v.source === 'pds' ? 'cache' : v.source || 'cache',
    updated_at: v.updated_at || null,
  };
}

async function writeCache(config) {
  await upsert('settings', [
    {
      id: 1,
      voice: config
        ? { ...config, source: 'pds', cached_at: new Date().toISOString() }
        : null,
      updated_at: new Date().toISOString(),
    },
  ]);
}

/**
 * The effective configuration: the record if it can be read, the cached copy if
 * not, and null to mean "use the built-in defaults".
 *
 * Never throws. Losing the register is cosmetic; losing the answer is not.
 *
 * @returns {Promise<{style: string, guidance: string, source: string, updated_at: string|null}|null>}
 */
export async function loadAgentConfig({ did = ME_DID } = {}) {
  try {
    const fromPds = await readFromPds({ did });
    // Cache even an empty record: "dame cleared it" is a state worth persisting,
    // or the next PDS outage restores a voice she deliberately removed.
    await writeCache(
      fromPds && (fromPds.style || fromPds.guidance) ? fromPds : null,
    ).catch(() => {});
    if (fromPds && (fromPds.style || fromPds.guidance)) return fromPds;
    return null;
  } catch {
    try {
      return await readCache();
    } catch {
      return null;
    }
  }
}

/** The shape the browser should putRecord, so one definition drives both. */
export function recordFrom({ style, guidance }) {
  return {
    $type: CONFIG_NSID,
    style: clip(style),
    guidance: clip(guidance),
    updatedAt: new Date().toISOString(),
  };
}
