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
import { rkeysForWrite, noteListed, noteUnlisted } from './graphFacts.js';

/**
 * Which list a command acts on.
 *
 * THE FALLBACK IS THE MIGRATED LIST, not the one this started as. It pointed at
 * dame's own repo long after that list was deleted in the retire step, so
 * anywhere MOD_LIST_URI is unset -- Vercel, as it turned out -- every read asked
 * the AppView for a record that no longer exists and got a 400 with nothing to
 * say why. A hardcoded default that outlives the thing it names is worse than
 * no default: it fails as a bug rather than as a missing setting.
 */
export function listUri() {
  return (
    process.env.MOD_LIST_URI ||
    'at://did:plc:louxcf2mpmyrsbmf2axmchat/app.bsky.graph.list/3mvog3lqj5c2k'
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
 * @param {string} [opts.via]   how it was asked for. 'command' is dame's typed
 *   verb; 'agent' is agent mode acting on what she wrote in words. Both are her
 *   say-so, and the log still has to tell them apart: one is her literal
 *   target and the other is a model's reading of her sentence.
 * @returns {Promise<{ ok: boolean, message: string, did?: string,
 *   changed?: boolean, already?: boolean, vetoed?: string, account?: object }>}
 *   `changed` is whether the list moved; `already` is "was already on / not
 *   on"; `vetoed` is the PROTECTED reason; `account` is the scored account, so
 *   a receipt can say who that was without scoring them a second time.
 */
export async function applyCommand(
  agent,
  action,
  actor,
  { raw = '', band = null, lookUp = null, via = 'command' } = {},
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
  //
  // IN PARALLEL with the veto and the membership check. A block used to do them
  // one after another, and the membership check alone walked every listitem in
  // the repo -- 102 pages, 2.7 seconds -- on every block. It is one
  // Constellation request now; see rkeysForWrite in graphFacts.js.
  const [account, reason, rkeys] = await Promise.all([
    !band && lookUp
      ? Promise.resolve(lookUp(actor)).catch(() => null)
      : Promise.resolve(null),
    protectedReason(did),
    rkeysForWrite(uri, did),
  ]);
  const scored = band || account?.band || null;

  if (reason && action === 'list_add') {
    return {
      ok: false,
      did,
      vetoed: reason,
      account,
      message:
        `${actor} is PROTECTED (${reason}). You follow them, or they are on one of your curation lists. ` +
        'No automated path acts on those, including this one. Do it in your client if you mean it.',
    };
  }

  if (action === 'list_add') {
    if (rkeys?.length) {
      return {
        ok: true,
        did,
        already: true,
        changed: false,
        account,
        message: `${actor} was already on the list.`,
      };
    }
    const created = await agent.com.atproto.repo.createRecord({
      repo: bot,
      collection: 'app.bsky.graph.listitem',
      record: {
        $type: 'app.bsky.graph.listitem',
        subject: did,
        list: uri,
        createdAt: new Date().toISOString(),
      },
    });
    noteListed(
      uri,
      did,
      String(created?.data?.uri || '')
        .split('/')
        .pop(),
    );
    await log(did, 'list_add', raw, scored, via);
    return {
      ok: true,
      did,
      changed: true,
      account,
      message: `Added ${actor} to the list.`,
    };
  }

  if (rkeys === null) {
    return {
      ok: false,
      did,
      account,
      message: `I could not check whether ${actor} is on the list, so I changed nothing.`,
    };
  }
  if (!rkeys.length) {
    return {
      ok: true,
      did,
      already: true,
      changed: false,
      account,
      message: `${actor} was not on the list.`,
    };
  }
  // EVERY copy. An account two plans both added has two listitems, and
  // deleting only the first left them on the list while this said "Removed".
  for (const rkey of rkeys) {
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: bot,
        collection: 'app.bsky.graph.listitem',
        rkey,
      });
    } catch (err) {
      // Constellation can lag a deletion. Already gone is the outcome asked for.
      if (!/not ?found|could not locate/i.test(String(err?.message || err))) {
        throw err;
      }
    }
  }
  noteUnlisted(uri, did);
  await log(did, 'list_remove', raw, scored, via);
  return {
    ok: true,
    did,
    changed: true,
    account,
    message: `Removed ${actor} from the list.`,
  };
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
async function log(did, action, raw, band, via = 'command') {
  try {
    const planId = crypto.randomUUID();
    await upsert('plan', [
      {
        id: planId,
        created_at: new Date().toISOString(),
        approved_at: new Date().toISOString(),
        approved_bands: [via],
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
        approved_via: via,
      },
    ]);
  } catch {
    /* the repo is the record; the log is the convenience */
  }
}
