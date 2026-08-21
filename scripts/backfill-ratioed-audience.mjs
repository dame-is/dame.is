#!/usr/bin/env node
// Take a dated snapshot of the audiences behind every Ratioed participant.
//
// A piece measured from now on records each participant's follower count as it
// reads it, in the same pass that reads everything else — see buildEventLog.
// The pieces that ran before that field existed cannot have one: their log was
// harvested offline and is a finished measurement, holding records that have
// since been deleted. Editing a follower count into it would put a figure taken
// today inside a measurement dated last year, with nothing on the record to say
// which part is which.
//
// So this writes a SEPARATE, DATED table, and `applyAudience` joins it on at
// render. What that table says is "here is how big these accounts are now",
// with a timestamp attached, and the piece page says the same thing in prose.
// It is not a reconstruction of the audiences those pieces actually reached —
// nobody has that, and pretending otherwise would be the one dishonest number
// in a project made entirely of honest ones.
//
// Reads only. listRecords and getProfiles are both public, so no credentials
// are needed and nothing is written to the PDS — the output is a repo file.
//
// Usage:
//   node scripts/backfill-ratioed-audience.mjs             # write the table
//   node scripts/backfill-ratioed-audience.mjs --dry-run   # print, write nothing
//
// Re-running it takes a NEW snapshot and overwrites the old one, which moves
// every reach figure on the site. That is why it is a script you run rather
// than a step in the build: the number should move when someone decides it
// should, not on every deploy.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ME_DID, COLLECTIONS, APPVIEW } from '../src/config.js';
import { resolvePds, listRecords } from '../src/lib/atproto.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/data/ratioedAudience.json');
const EVENTS = resolve(ROOT, 'src/data/ratioedEvents.json');
const DRY_RUN = process.argv.includes('--dry-run') || process.argv.includes('-n');

const log = (...a) => console.log('[ratioed-audience]', ...a);

/**
 * Every account named by the bundled harvest, by handle.
 *
 * The harvest predates recorded DIDs, so a handle is all it has. That is a
 * weaker key than a DID — a renamed account resolves to whoever holds the name
 * now — which is a reason to report how many failed to resolve, not a reason to
 * skip the join: the alternative is no audience for the first eleven pieces at
 * all.
 */
async function fromBundle() {
  const byPiece = JSON.parse(await readFile(EVENTS, 'utf8'));
  const out = new Set();
  for (const events of Object.values(byPiece)) {
    for (const e of events || []) {
      if (e.self || !e.h || e.h === '(unresolvable)') continue;
      out.add(e.h);
    }
  }
  return out;
}

/**
 * Everyone the piece records name: accounts in a recorded log with no audience
 * of their own yet, and every breaker.
 *
 * A piece measured since the audience field landed already carries a figure for
 * the people in its log, and that one is authoritative — it was read at
 * measurement time, which this table can never be. Only the gaps are collected.
 *
 * The breakers are a gap of a different kind, and the reason this function
 * reads `breaker` at all. Most breaking likes were deleted by the people who
 * cast them, and a deleted record is in no index: those breakers appear in no
 * event log on either side, so an actor list built from logs alone could never
 * contain them. They were absent from this table for exactly as long as it has
 * existed, and the roster listed them with no audience at all — cyaneyed.lol
 * broke take 5 and has five thousand followers nothing here had ever asked
 * about. Named the way `livingRoster` names them: by DID where the
 * announcement recorded one, by handle where it did not.
 */
async function fromRecords() {
  const out = new Set();
  // listRecords is a PDS route and public: reading the repo needs no auth, only
  // the endpoint the DID document names.
  const pds = await resolvePds(ME_DID).catch(() => null);
  const records = pds
    ? await listRecords(pds, {
        repo: ME_DID,
        collection: COLLECTIONS.ratioedPiece,
        max: 200,
      }).catch(() => null)
    : null;
  if (!records) {
    log('could not read piece records; falling back to the bundled log alone');
    return out;
  }
  for (const r of records) {
    for (const e of r?.value?.events || []) {
      if (e.self || typeof e.fr === 'number') continue;
      const key = e.did || e.h;
      if (key && key !== '(unresolvable)') out.add(key);
    }
    const b = r?.value?.breaker;
    if (!b?.handle || b.handle === 'unknown') continue;
    const key = b.did || b.currentHandle || b.handle;
    if (key !== '(unresolvable)') out.add(key);
  }
  return out;
}

/** getProfiles, 25 actors per call. A chunk that fails leaves its accounts
 *  unresolved rather than failing the run — an unknown audience is a state the
 *  scorer already understands. */
async function fetchAudiences(actors) {
  const out = {};
  for (let i = 0; i < actors.length; i += 25) {
    const chunk = actors.slice(i, i + 25);
    const params = new URLSearchParams();
    for (const actor of chunk) params.append('actors', actor);
    try {
      const res = await fetch(`${APPVIEW}/xrpc/app.bsky.actor.getProfiles?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      for (const p of body?.profiles || []) {
        if (typeof p?.followersCount !== 'number') continue;
        const entry = { fr: p.followersCount, fo: p.followsCount ?? 0 };
        // Keyed both ways, because the two logs identify people differently:
        // the harvest has handles only, the recorded logs have DIDs. Storing
        // both means the join works either way round without guessing.
        if (p.did) out[p.did] = entry;
        if (p.handle) out[p.handle] = entry;
      }
    } catch (err) {
      log(`chunk ${i / 25 + 1} failed (${err.message}); those accounts stay unknown`);
    }
  }
  return out;
}

async function main() {
  const [bundled, recorded] = await Promise.all([fromBundle(), fromRecords()]);
  const actors = Array.from(new Set([...bundled, ...recorded]));
  log(`${actors.length} accounts to resolve (${bundled.size} bundled, ${recorded.size} recorded)`);

  const accounts = await fetchAudiences(actors);
  // Every account is keyed twice, by DID and by handle; the DIDs are the count.
  const resolved = Object.keys(accounts).filter((k) => k.startsWith('did:')).length;
  const missing = actors.filter((a) => !accounts[a]);
  log(`resolved ${resolved} accounts; ${missing.length} did not answer`);
  if (missing.length) log(`unresolved: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}`);

  const table = {
    measuredAt: new Date().toISOString(),
    source: 'app.bsky.actor.getProfiles',
    note:
      'Follower and follow counts as of measuredAt, NOT as of the pieces these ' +
      'accounts touched. Joined onto event logs that predate the recorded ' +
      'audience field. Accounts that did not resolve are absent, which the ' +
      'scorer reports as an unknown audience rather than an empty one — those ' +
      'are accounts that no longer answer, not accounts nobody follows.',
    accounts,
  };

  if (DRY_RUN) {
    log('dry run; nothing written');
    console.log(JSON.stringify({ ...table, accounts: `${Object.keys(accounts).length} keys` }, null, 2));
    return;
  }
  await writeFile(OUT, `${JSON.stringify(table)}\n`);
  log(`wrote ${OUT}`);
}

main().catch((err) => {
  console.error('[ratioed-audience] failed:', err);
  process.exitCode = 1;
});
