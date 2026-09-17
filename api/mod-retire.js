// Is the old list safe to delete yet?
//
// READ ONLY. The old list lives in dame's repo, so the deleting happens in the
// browser with dame's own session; the server holds the bot's credential and
// never dame's. Same split as list removals, same reason. What the server is
// good for here is reading BOTH repos at once and answering the question that
// actually matters before anything is destroyed: is every account on the old
// list also on the new one?
//
// Deleting a list nobody has replaced is how a block list quietly stops
// blocking. The count is not the check -- a matching total with a different
// membership would pass a count and lose people -- so this compares subjects.

import { ME_DID } from '../src/config.js';
import { resolvePds } from '../src/lib/atproto.js';
import { authorize } from './_lib/serviceAuth.js';

const LXM = 'is.dame.mod.retire';

const ownerOf = (uri) =>
  /^at:\/\/(did:[^/]+)\//.exec(String(uri || ''))?.[1] ?? null;

/** Every subject on a list, read from the owning repo rather than the AppView. */
async function membersOf(listUri) {
  const did = ownerOf(listUri);
  if (!did) throw new Error(`not an at:// uri: ${listUri}`);
  const pds = await resolvePds(did);
  const subjects = new Set();
  let records = 0;
  let cursor;
  for (let page = 0; page < 400; page += 1) {
    const u = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
    u.searchParams.set('repo', did);
    u.searchParams.set('collection', 'app.bsky.graph.listitem');
    u.searchParams.set('limit', '100');
    if (cursor) u.searchParams.set('cursor', cursor);
    const res = await fetch(u);
    if (!res.ok) throw new Error(`listRecords ${res.status} for ${did}`);
    const body = await res.json();
    for (const rec of body.records || []) {
      if (rec.value?.list !== listUri) continue;
      records += 1;
      subjects.add(rec.value.subject);
    }
    cursor = body.cursor;
    if (!cursor || !(body.records || []).length) break;
  }
  return { subjects, records };
}

/** Which lists dame currently blocks through. */
async function subscriptions() {
  const pds = await resolvePds(ME_DID);
  const u = new URL(`${pds}/xrpc/com.atproto.repo.listRecords`);
  u.searchParams.set('repo', ME_DID);
  u.searchParams.set('collection', 'app.bsky.graph.listblock');
  u.searchParams.set('limit', '100');
  const res = await fetch(u);
  if (!res.ok) return [];
  const body = await res.json();
  return (body.records || []).map((r) => ({
    uri: r.uri,
    subject: r.value.subject,
  }));
}

export default async function handler(req, res) {
  if (!(await authorize(req, res, { lxm: LXM }))) return;

  const sourceList = req.body?.sourceList || req.query?.sourceList;
  const targetList = req.body?.targetList || req.query?.targetList;
  if (!sourceList || !targetList) {
    return res.status(400).json({ error: 'pass sourceList and targetList' });
  }
  if (ownerOf(sourceList) !== ME_DID) {
    // The point of this endpoint is retiring a list from dame's OWN repo. A
    // list somebody else owns is not dame's to delete, and saying so is better
    // than letting the browser discover it one failed applyWrites at a time.
    return res.status(400).json({
      error:
        'sourceList is not in your repo, so there is nothing here to retire',
    });
  }

  try {
    const [source, target, blocks] = await Promise.all([
      membersOf(sourceList),
      membersOf(targetList),
      subscriptions(),
    ]);

    const missing = [...source.subjects].filter((d) => !target.subjects.has(d));
    return res.status(200).json({
      source: {
        uri: sourceList,
        records: source.records,
        accounts: source.subjects.size,
        // A list can hold the same account twice. They all have to go, and the
        // difference between the two numbers is how many extra deletes that is.
        duplicates: source.records - source.subjects.size,
      },
      target: {
        uri: targetList,
        records: target.records,
        accounts: target.subjects.size,
      },
      missing,
      subscribedToSource: blocks.some((b) => b.subject === sourceList),
      subscribedToTarget: blocks.some((b) => b.subject === targetList),
      sourceBlockUri: blocks.find((b) => b.subject === sourceList)?.uri ?? null,
      // Deletes are 1 point each against 5,000/hour, and every one is also a
      // repo event against the relay's 2,600/hour for the whole PDS.
      points: source.records + 1,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
