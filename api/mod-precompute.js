// Vercel serverless function: keep the moderation reference data fresh.
//
// Wired into vercel.json as a weekly cron. One firing does as much of the work
// as fits in its time budget and returns what is left; the cron picks the rest
// up next time. That is the same shape as api/mirror-arena.js and for the same
// reason — ~2,000 AppView calls will not fit in one invocation, and a job that
// dies halfway through is worse than one that stops on purpose.
//
// A run moves through three states, and reports which one it is in:
//   collecting  circle members still need their follow lists read
//   finalising  all members read; aggregate the staged edges into vouch counts
//   idle        current snapshot is complete and fresher than MAX_AGE_DAYS
//
// Auth: if CRON_SECRET is set, the request must carry
// `Authorization: Bearer <CRON_SECRET>` (Vercel sends this on cron firings).
// POST ?restart=1 forces a new snapshot regardless of age.

import { ME_DID } from '../src/config.js';
import { resolvePds } from '../src/lib/atproto.js';
import {
  readCircle,
  readCurationMembers,
  indexCircleFollows,
} from '../src/lib/moderation/precompute.js';
import { select, upsert, update, rpc, count, del } from './_lib/modDb.js';
import { authorize } from './_lib/serviceAuth.js';

export const config = { maxDuration: 60 };

/** See the note on LXM in mod-preflight.js. */
const LXM = 'is.dame.mod.precompute';

/** Rebuild the snapshot when the newest complete one is older than this. */
const MAX_AGE_DAYS = 7;

/**
 * Wall-clock budget per firing.
 *
 * Well under the 60s maxDuration, and deliberately so. The budget bounds when
 * work STOPS BEING STARTED; the writes that follow, plus any request already in
 * flight, land after it. At 45s that overran and Vercel returned
 * FUNCTION_INVOCATION_TIMEOUT, which loses the response but not the progress —
 * indexed members are already committed and pending ones retry.
 *
 * The deadline is now also enforced inside each member's paging, so the tail is
 * one request rather than one whole follow list.
 */
const BUDGET_MS = 25_000;

/**
 * Transient read failures to tolerate before a member is written off.
 *
 * A permanent failure (a 400 from a deactivated or taken-down account) needs no
 * attempts at all. This is only for the case that looks transient every time:
 * without a ceiling, one unreachable host holds a snapshot open indefinitely.
 */
const MAX_ATTEMPTS = 3;

async function currentSnapshot() {
  const rows = await select('circle', {
    select: 'taken_at',
    order: 'taken_at.desc',
    limit: 1,
  });
  return rows?.[0]?.taken_at ?? null;
}

async function startSnapshot(pds) {
  const takenAt = new Date().toISOString();
  const circle = await readCircle({ pds, did: ME_DID });
  if (!circle.length)
    throw new Error('read zero follows — refusing to snapshot');

  await upsert(
    'circle',
    circle.map((did) => ({ taken_at: takenAt, did })),
  );

  // The protected set is rebuilt with each snapshot rather than appended to, so
  // removing someone from a curation list actually removes their protection
  // instead of leaving a veto nobody remembers granting. Manual entries are
  // kept: those were added by hand and are nobody's derived state.
  const curated = await readCurationMembers({ pds, did: ME_DID });
  await del('protected', { eq: { source: 'derived' } });
  const rows = [
    ...circle.map((did) => ({
      did,
      reason: 'you follow them',
      source: 'derived',
    })),
    ...[...curated]
      .filter(([did]) => !circle.includes(did))
      .map(([did, reason]) => ({ did, reason, source: 'derived' })),
  ];
  await upsert('protected', rows);

  return { takenAt, members: circle.length, protected: rows.length };
}

export default async function handler(req, res) {
  if (!(await authorize(req, res, { lxm: LXM }))) return;

  try {
    const restart = req.query?.restart === '1' || req.query?.restart === 'true';
    const pds = await resolvePds(ME_DID);

    let takenAt = await currentSnapshot();
    let started = null;

    if (takenAt && !restart) {
      const pending = await count('circle', {
        eq: { taken_at: takenAt },
        is: { follows_indexed_at: 'null' },
      });
      const ageDays = (Date.now() - Date.parse(takenAt)) / 86_400_000;
      if (pending === 0 && ageDays < MAX_AGE_DAYS) {
        const vouches = await count('vouch', { eq: { taken_at: takenAt } });
        return res.status(200).json({
          state: 'idle',
          snapshot: takenAt,
          vouches,
          ageDays: Number(ageDays.toFixed(2)),
        });
      }
      if (pending === 0) {
        started = await startSnapshot(pds);
        takenAt = started.takenAt;
      }
    } else {
      started = await startSnapshot(pds);
      takenAt = started.takenAt;
    }

    const pendingRows = await select('circle', {
      select: 'did,attempts',
      eq: { taken_at: takenAt },
      is: { follows_indexed_at: 'null' },
      limit: 500,
    });

    if (pendingRows.length) {
      const attemptsByDid = new Map(
        pendingRows.map((r) => [r.did, r.attempts ?? 0]),
      );
      const result = await indexCircleFollows({
        pending: pendingRows.map((r) => r.did),
        budgetMs: BUDGET_MS,
        writeEdges: (edges) =>
          upsert(
            'circle_follow',
            edges.map((e) => ({
              taken_at: takenAt,
              member_did: e.member,
              target_did: e.target,
            })),
          ),
        markDone: (member) =>
          update(
            'circle',
            { eq: { taken_at: takenAt, did: member } },
            { follows_indexed_at: new Date().toISOString() },
          ),
      });

      // A member that cannot be read contributes nothing and must not hold the
      // snapshot open. Permanent failures are closed out immediately; transient
      // ones get MAX_ATTEMPTS before being treated the same way, so one flaky
      // host cannot block a build forever either.
      for (const { member, permanent } of result.unreadable) {
        const attempts = (attemptsByDid.get(member) ?? 0) + 1;
        if (permanent || attempts >= MAX_ATTEMPTS) {
          await update(
            'circle',
            { eq: { taken_at: takenAt, did: member } },
            {
              follows_indexed_at: new Date().toISOString(),
              attempts,
              unreadable: permanent
                ? 'account inactive or removed'
                : `unreadable after ${attempts} attempts`,
            },
          );
        } else {
          await update(
            'circle',
            { eq: { taken_at: takenAt, did: member } },
            { attempts },
          );
        }
      }

      // Report what the DATABASE says is left, not what the in-memory queue
      // drained to. Those diverge exactly when a member is consumed but not
      // completed, which is the case that matters — the UI once read "0 left to
      // read" while five members were still pending and the build could not end.
      const stillPending = await count('circle', {
        eq: { taken_at: takenAt },
        is: { follows_indexed_at: 'null' },
      });
      return res.status(200).json({
        state: stillPending > 0 ? 'collecting' : 'finalising',
        snapshot: takenAt,
        started,
        ...result,
        remaining: stillPending,
        unreadable: result.unreadable.length,
      });
    }

    // Everything read. finalise_snapshot refuses to run on partial data, so a
    // success here means the vouch table is a complete count of this snapshot.
    const written = await rpc('finalise_snapshot', { snapshot: takenAt });
    const gaps = await count('circle', {
      eq: { taken_at: takenAt },
      not_null: 'unreadable',
    });
    return res.status(200).json({
      state: 'finalised',
      snapshot: takenAt,
      vouches: written,
      // Surfaced rather than buried: these members contributed no edges, so
      // every vouch count is a slight undercount, and that is worth knowing.
      unreadableMembers: gaps,
    });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}
