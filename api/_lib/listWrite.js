// The only write the moderator account makes to the graph on dame's say-so.
//
// Reached from `parseCommand`, never from the tool loop — see
// src/lib/moderation/command.js for why that distinction is the whole design.
// Nothing here is callable by the model.
//
// THE PROTECTED VETO IS ENFORCED HERE, not only in the scorer. `mod.protected`
// is the hard set: accounts dame follows, mutuals, curation-list members. The
// documented rule is that no automated path may ever act on them, and a typed
// command travelling down an automated path is still an automated path. The
// audit found three of them already sitting on the block list, which is the
// argument for checking at the write rather than trusting that nothing upstream
// will ever get it wrong. dame can still do it by hand in a client; what is
// refused is this system doing it quietly.

import { resolveActor } from '../../src/lib/moderation/target.js';
import { select, upsert } from './modDb.js';

/** Which list a command acts on. */
export function listUri() {
  return (
    process.env.MOD_LIST_URI ||
    'at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/app.bsky.graph.list/3ll5hna42x52o'
  );
}

function ownerOf(uri) {
  const m = /^at:\/\/(did:[^/]+)\//.exec(String(uri ?? ''));
  return m ? m[1] : null;
}

/** Is this DID in the hard veto set, and why? */
async function protectedReason(did) {
  try {
    const rows = await select('protected', {
      select: 'reason',
      eq: { did },
    });
    return rows?.[0]?.reason ?? null;
  } catch {
    // A veto table we cannot read is a veto we cannot honour. Refuse rather
    // than fall through to the write: the failure mode of guessing wrong here
    // is blocking someone dame follows.
    throw new Error(
      'could not read the protected set, so the write is refused rather than risked',
    );
  }
}

/**
 * Add to or remove from the moderation list.
 *
 * @param {object} agent  the moderator account's agent (NOT chat-proxied)
 * @param {'list_add'|'list_remove'} action
 * @param {string} actor  handle, DID or profile link, as dame typed it
 * @param {object} [opts]
 * @param {string} [opts.raw]   dame's literal message, for the decision log
 * @param {string} [opts.band]  the band at the time, if it was scored
 * @returns {Promise<{ ok: boolean, message: string, did?: string }>}
 */
export async function applyCommand(
  agent,
  action,
  actor,
  { raw = '', band = null, lookUp = null } = {},
) {
  const uri = listUri();
  const bot = agent.session?.did;
  const owner = ownerOf(uri);

  if (owner !== bot) {
    // The honest error. This is the state the system is in until the migration
    // runs, and a permission failure from the PDS would say nothing useful.
    return {
      ok: false,
      message:
        `That list is in ${owner === null ? 'an unreadable repo' : "dame's own repo"}, and I can only write to lists this account owns. ` +
        'Run the migration first (Migrate tab), or remove them from your client.',
    };
  }

  let did;
  try {
    did = await resolveActor(actor);
  } catch {
    return {
      ok: false,
      message: `I could not resolve ${actor} to an account.`,
    };
  }

  // Score it before writing, so the log records what the gate saw rather than
  // UNSCORED. The whole claim of this system is that a decision is replayable,
  // and a row that says only "dame typed this" cannot be replayed against
  // anything. Best effort: a scoring failure must not stop dame acting.
  let scored = band;
  if (!scored && lookUp) {
    try {
      scored = (await lookUp(actor))?.band ?? null;
    } catch {
      scored = null;
    }
  }

  const reason = await protectedReason(did);
  if (reason && action === 'list_add') {
    return {
      ok: false,
      did,
      message:
        `${actor} is PROTECTED (${reason}). You follow them, or they are on one of your curation lists. ` +
        'No automated path acts on those, including this one. Do it in your client if you mean it.',
    };
  }

  if (action === 'list_add') {
    const existing = await findItem(agent, uri, did);
    if (existing) {
      return { ok: true, did, message: `${actor} was already on the list.` };
    }
    await agent.com.atproto.repo.createRecord({
      repo: bot,
      collection: 'app.bsky.graph.listitem',
      record: {
        $type: 'app.bsky.graph.listitem',
        subject: did,
        list: uri,
        createdAt: new Date().toISOString(),
      },
    });
    await log(did, 'list_add', raw, scored);
    return { ok: true, did, message: `Added ${actor} to the list.` };
  }

  const found = await findItem(agent, uri, did);
  if (!found) {
    return { ok: true, did, message: `${actor} was not on the list.` };
  }
  await agent.com.atproto.repo.deleteRecord({
    repo: bot,
    collection: 'app.bsky.graph.listitem',
    rkey: found,
  });
  await log(did, 'list_remove', raw, scored);
  return { ok: true, did, message: `Removed ${actor} from the list.` };
}

/** The listitem rkey for this subject on this list, or null. */
async function findItem(agent, uri, did) {
  let cursor;
  for (let page = 0; page < 200; page += 1) {
    const res = await agent.com.atproto.repo.listRecords({
      repo: agent.session.did,
      collection: 'app.bsky.graph.listitem',
      limit: 100,
      cursor,
    });
    for (const rec of res.data.records || []) {
      if (rec.value?.list === uri && rec.value?.subject === did) {
        return rec.uri.split('/').pop();
      }
    }
    cursor = res.data.cursor;
    if (!cursor) break;
  }
  return null;
}

/**
 * Record it where "why am I on your list" is already answered.
 *
 * A command is a plan of one, approved by dame at the moment she typed it, so
 * it goes in mod.plan + mod.decision like every other action rather than into a
 * log of its own. `note` keeps her LITERAL words: when someone asks why they
 * were listed, "dame typed this sentence on this date" is the whole answer, and
 * it is the one kind of entry in that table that needs no reconstruction.
 *
 * Best effort. A write that happened and was not logged is bad; refusing to
 * write because the log is down is worse, and the repo itself is the record.
 */
async function log(did, action, raw, band) {
  try {
    const planId = crypto.randomUUID();
    await upsert('plan', [
      {
        id: planId,
        created_at: new Date().toISOString(),
        approved_at: new Date().toISOString(),
        approved_bands: ['command'],
        note: raw,
      },
    ]);
    await upsert('decision', [
      {
        plan_id: planId,
        did,
        band: band || 'UNSCORED',
        action,
        acted_at: new Date().toISOString(),
        approved_via: 'command',
      },
    ]);
  } catch {
    /* the repo is the record; the log is the convenience */
  }
}
