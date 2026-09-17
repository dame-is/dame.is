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

/**
 * The numeric knobs, and the range each is allowed.
 *
 * CLAMPED, not merely defaulted. Unlike voice, these have a bill attached: a
 * typo in maxSteps is a runaway loop, not an awkward sentence. The record can
 * move them within a range someone chose; it cannot set maxSteps to 400.
 */
export const LIMITS = {
  /** Conversation turns kept as history. */
  maxTurns: { min: 1, max: 40, def: 12 },
  /** Tool-loop steps. Every step resends the system prompt and the tools. */
  maxSteps: { min: 1, max: 20, def: 12 },
  /** How old a DM can be and still count as this conversation. 0 disables. */
  historyHours: { min: 0, max: 168, def: 4 },
  /** Accounts named in a preflight result. */
  reviewRows: { min: 1, max: 40, def: 40 },
};

/** provider/model, loosely. A malformed value would break every turn. */
const MODEL_SHAPE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/i;

export function clampLimits(raw) {
  const out = {};
  for (const [key, spec] of Object.entries(LIMITS)) {
    const v = Number(raw?.[key]);
    out[key] = Number.isFinite(v)
      ? Math.min(spec.max, Math.max(spec.min, Math.round(v)))
      : spec.def;
  }
  return out;
}

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
  const model = String(value.model || '').trim();
  return {
    style: clip(value.style),
    guidance: clip(value.guidance),
    openers: clip(value.openers),
    report: clip(value.report, 4000),
    postReport: clip(value.postReport, 4000),
    // An unusable model string is dropped rather than carried: falling back to
    // the configured default is recoverable, and a 400 on every turn is not.
    model: MODEL_SHAPE.test(model) ? model : '',
    limits: value.limits ? clampLimits(value.limits) : null,
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
  const openers = clip(v.openers);
  const report = clip(v.report, 4000);
  const postReport = clip(v.postReport, 4000);
  const model = String(v.model || '').trim();
  if (
    !style &&
    !guidance &&
    !openers &&
    !report &&
    !postReport &&
    !model &&
    !v.limits
  ) {
    return null;
  }
  return {
    style,
    guidance,
    openers,
    report,
    postReport,
    model: MODEL_SHAPE.test(model) ? model : '',
    limits: v.limits ? clampLimits(v.limits) : null,
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
    const has = (c) =>
      c &&
      (c.style ||
        c.guidance ||
        c.openers ||
        c.report ||
        c.postReport ||
        c.model ||
        c.limits);
    await writeCache(has(fromPds) ? fromPds : null).catch(() => {});
    if (has(fromPds)) return fromPds;
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
export function recordFrom({
  style,
  guidance,
  openers,
  report,
  postReport,
  model,
  limits,
}) {
  return {
    $type: CONFIG_NSID,
    style: clip(style),
    guidance: clip(guidance),
    openers: clip(openers),
    report: clip(report, 4000),
    postReport: clip(postReport, 4000),
    model: MODEL_SHAPE.test(String(model || '').trim())
      ? String(model).trim()
      : '',
    limits: clampLimits(limits),
    updatedAt: new Date().toISOString(),
  };
}
