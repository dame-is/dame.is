// Vercel serverless function: remove accounts from a list the bot owns.
//
// This exists because the browser-only removal path was right for exactly one
// configuration and silently wrong for the other. While the list lives in
// dame's repo, only dame's credentials can delete from it, and the server does
// not hold those — so the browser does it. Once the list moves to the moderator
// account, the browser cannot write to that repo at all, and the old path would
// have listed dame's records, matched none, and reported success having done
// nothing.
//
// The boundary worth keeping is narrower than "the server must not write". The
// server ALREADY holds the more dangerous capability: mod-migrate adds thousands
// of accounts to a list with the same credential this uses. Withholding the
// safer one buys nothing, and removal is the direction that undoes harm.
//
// What stays true is that the server never holds dame's PERSONAL credentials.
// A request to remove from a list dame owns is refused here and sent back to
// the browser, where dame's own session signs it. The moderator account is a bot
// and automating it is the entire point of it existing.
//
// POST { listUri, dids: [...] }

import { ME_DID } from '../src/config.js';
import { upsert } from './_lib/modDb.js';
import { botAgent } from './_lib/botAgent.js';
import { authorize } from './_lib/serviceAuth.js';

export const config = { maxDuration: 60 };

const LXM = 'is.dame.mod.remove';

/** applyWrites batches deletes; a delete is 1 point against the write budget. */
const BATCH = 50;

/** at://<did>/<collection>/<rkey> — the repo segment is the owner. */
function ownerOf(uri) {
  const match = String(uri || '').match(/^at:\/\/(did:[^/]+)\//);
  return match ? match[1] : null;
}

export default async function handler(req, res) {
  if (!(await authorize(req, res, { lxm: LXM }))) return;

  const listUri = req.body?.listUri;
  const dids = Array.isArray(req.body?.dids) ? [...new Set(req.body.dids)] : [];
  if (!listUri || !dids.length) {
    return res
      .status(400)
      .json({ error: 'pass listUri and a non-empty dids array' });
  }

  const owner = ownerOf(listUri);
  if (!owner)
    return res.status(400).json({ error: 'listUri is not an at:// URI' });

  if (owner === ME_DID) {
    // Deliberate refusal, not a limitation to route around. Removing from
    // dame's own repo needs dame's own session, and the day this server holds
    // that credential is the day a bug in it can rewrite dame's account.
    return res.status(409).json({
      error:
        'that list belongs to your personal account — remove from it in the browser, where your own session signs the delete',
      owner,
      useBrowser: true,
    });
  }

  try {
    const { agent, via } = await botAgent();
    if (agent.session?.did !== owner) {
      return res.status(403).json({
        error: `the moderator account (${agent.session?.did}) does not own that list (${owner})`,
      });
    }

    // Read the listitems back to find record keys. The audit stores DIDs rather
    // than rkeys on purpose: a listitem can be deleted and recreated, which
    // changes the rkey while the membership it represents did not.
    const wanted = new Set(dids);
    const rkeys = [];
    let cursor;
    for (let page = 0; page < 200; page += 1) {
      const out = await agent.com.atproto.repo.listRecords({
        repo: owner,
        collection: 'app.bsky.graph.listitem',
        limit: 100,
        cursor,
      });
      for (const rec of out.data.records || []) {
        if (rec.value?.list !== listUri) continue;
        if (!wanted.has(rec.value?.subject)) continue;
        rkeys.push({ rkey: rec.uri.split('/').pop(), did: rec.value.subject });
      }
      cursor = out.data.cursor;
      if (!cursor) break;
    }

    let removed = 0;
    for (let i = 0; i < rkeys.length; i += BATCH) {
      const slice = rkeys.slice(i, i + BATCH);
      await agent.com.atproto.repo.applyWrites({
        repo: owner,
        writes: slice.map(({ rkey }) => ({
          $type: 'com.atproto.repo.applyWrites#delete',
          collection: 'app.bsky.graph.listitem',
          rkey,
        })),
      });
      removed += slice.length;
    }

    // Mark them so a re-run of the migration does not carry them back. Without
    // this, removing someone and then resuming a migration would quietly undo
    // the removal, which is the kind of loop that erodes trust in the whole tool.
    if (rkeys.length) {
      await upsert(
        'migration_item',
        rkeys.map(({ did }) => ({
          did,
          band: 'REMOVED',
          carried_at: new Date().toISOString(),
        })),
      );
    }

    return res.status(200).json({
      removed,
      found: rkeys.length,
      asked: dids.length,
      via,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
