// The Analytics studio — /admin?view=analytics. Follower growth, posting
// trends, engagement, the people behind it, the whole repo's pulse, and (in
// the Graph tab, AnalyticsGraph.jsx) where people sit in your follow graph
// plus the Bluesky lists kept in step with it.
//
// The shape of the thing:
//
//   useAnalyticsArchive   owns the archive (IndexedDB via analyticsStore),
//                         the sync orchestration (sweeps from analyticsSync)
//                         and their progress. Data lives in this browser —
//                         there is no analytics server, no tracker, nothing
//                         written anywhere but the owner's own IndexedDB.
//   the tabs              pure derivation over that archive via analytics.js,
//                         all scoped by ONE period filter row — every number
//                         on screen answers for the same window.
//
// Chart discipline (matching StateStats/ListeningStats, plus the rules that
// keep charts honest): single-hue accent series — the type FILTER switches
// what one series shows rather than stacking four hues; dense zero-filled
// buckets so a quiet week draws as a quiet week; bars grow from a zero
// baseline; every chart carries a hover readout AND a plain-table twin, so
// no value is reachable only by pointer. The palette is the site's hourly
// sky theme, so everything is tokens — a literal color would be wrong for
// twenty-three hours of the day.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Check,
  Heart,
  MessageCircle,
  MessagesSquare,
  Quote,
  Repeat2,
} from 'lucide-react';
import Button from './Button.jsx';
import GraphTab from './AnalyticsGraph.jsx';
import Figures from './Figures.jsx';
import SectionHead from './SectionHead.jsx';
import Segmented from './Segmented.jsx';
import { ME_HANDLE } from '../config.js';
import { getProfile, resolvePds, rkeyFromAtUri } from '../lib/atproto.js';
import {
  ANALYTICS_PERIODS,
  ENGAGEMENT_KINDS,
  EVENT_KINDS,
  blockReach,
  bucketLabel,
  bucketSeries,
  comparePeriods,
  compactPostFromRecord,
  compareRates,
  cumulativeSeries,
  defaultUnitFor,
  engagementOf,
  fmtCompact,
  fmtDelta,
  givenEvents,
  isOwnVoicePost,
  movingAverage,
  oldestEventMs,
  outboundFromPosts,
  outboundFromRecord,
  rateSeries,
  rollingRate,
  topActors,
  topPosts,
  unitChoicesFor,
} from '../lib/analytics.js';
import { archiveJson, exportFilename, postsCsv } from '../lib/analyticsExport.js';
import { openAnalyticsStore } from '../lib/analyticsStore.js';
import { atmosphereRowFromEntry, fetchRepoCar, readRepoCar } from '../lib/carRepo.js';
import { holdReload } from '../lib/reloadHold.js';
import {
  hydrateActors,
  sweepBlocks,
  sweepFollowers,
  sweepFollowing,
  sweepInbound,
  sweepOutbound,
  sweepPosts,
} from '../lib/analyticsSync.js';
import {
  SYNC_PLAN,
  SYNC_STEPS,
  blocksFraction,
  partsFraction,
  repoDownloadFraction,
  repoReadFraction,
  repoSaveFraction,
  share,
  timeFraction,
  walkFraction,
} from '../lib/syncProgress.js';
import { formatDateShort, relativeTime } from '../lib/time.js';
import './AnalyticsStudio.css';

const DAY_MS = 86_400_000;

/** Sweeps re-run silently when the archive is older than this. */
const AUTO_SYNC_AFTER_MS = 60 * 60 * 1000;

/** Recent posts get their engagement counts refreshed on every sync. */
const REHYDRATE_DAYS = 30;

/** How far back the event sweeps ever dig. Matches the longest dated period. */
const EVENT_DEPTH_DAYS = 365;

const FOLLOW = 'app.bsky.graph.follow';

/** The People tab's relationship filter, against the owner's own follows. */
const RELATIONS = [
  { key: 'all', label: 'Everyone' },
  { key: 'not', label: 'Not following' },
  { key: 'following', label: 'Following' },
];

/** The Engagement tab's two directions: what your posts earn, what you give. */
const DIRECTIONS = [
  { key: 'received', label: 'Received' },
  { key: 'given', label: 'Given' },
];

/** How many people a People list shows at first, and adds per "Show more". */
const PEOPLE_PAGE = 12;

const TABS = [
  { key: 'followers', label: 'Followers' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'posts', label: 'Posts' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'people', label: 'People' },
  { key: 'atmosphere', label: 'Atmosphere' },
  { key: 'graph', label: 'Graph' },
];

export default function AnalyticsStudio({ agent, did }) {
  const archive = useAnalyticsArchive(agent, did);
  const [tab, setTab] = useState('followers');
  const [periodKey, setPeriodKey] = useState('30d');
  const [kind, setKind] = useState('all');
  const [relation, setRelation] = useState('all');
  const [direction, setDirection] = useState('received');

  const period = ANALYTICS_PERIODS.find((p) => p.key === periodKey) || ANALYTICS_PERIODS[1];
  // One "now" per data/filter change, so every memo below agrees about it —
  // a per-render Date.now() would quietly re-bucket between two memos.
  const nowMs = useMemo(
    () => Date.now(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [archive.rev, periodKey],
  );

  if (!archive.loaded) {
    return <p className="an-loading">Opening the archive…</p>;
  }

  const firstRun = !archive.meta.posts;
  const showKind = tab === 'engagement' || tab === 'people';
  const kinds = tab === 'people' ? EVENT_KINDS : ENGAGEMENT_KINDS;

  return (
    <div className="an">
      <SyncStrip archive={archive} />

      {firstRun ? (
        <FirstRun archive={archive} />
      ) : (
        <>
          {/* The sections, then the window and (where it applies) the
              kind of engagement: three rows of keys, each the kit's
              Segmented, so "which one is on" reads the same in all three. */}
          <Segmented
            className="an-tabs"
            label="Analytics sections"
            value={tab}
            onChange={setTab}
            options={TABS.map((t) => ({ value: t.key, label: t.label }))}
          />

          {/* The Graph tab keeps its own rolling 30 days: its lists are
              rebuilt by a cron over that window, so a period key here would
              change the picture without changing the lists. */}
          {tab !== 'graph' && (
            <div className="an-filters">
              <Segmented
                label="Period"
                value={periodKey}
                onChange={setPeriodKey}
                options={ANALYTICS_PERIODS.map((p) => ({ value: p.key, label: p.label }))}
              />
              {tab === 'engagement' && (
                <Segmented
                  label="Engagement direction"
                  value={direction}
                  onChange={setDirection}
                  options={DIRECTIONS.map((d) => ({ value: d.key, label: d.label }))}
                />
              )}
              {showKind && (
                <Segmented
                  label="Engagement type"
                  value={kind}
                  onChange={setKind}
                  options={kinds.map((k) => ({ value: k.key, label: k.label }))}
                />
              )}
              {/* Only once the follows are known: filtering against an empty
                  set would call everyone "not following". */}
              {tab === 'people' && archive.meta.following && (
                <Segmented
                  label="Show people"
                  value={relation}
                  onChange={setRelation}
                  options={RELATIONS.map((r) => ({ value: r.key, label: r.label }))}
                />
              )}
            </div>
          )}

          {tab === 'followers' && <FollowersTab archive={archive} period={period} nowMs={nowMs} />}
          {tab === 'blocks' && <BlocksTab archive={archive} period={period} nowMs={nowMs} />}
          {tab === 'posts' && <PostsTab archive={archive} period={period} nowMs={nowMs} />}
          {tab === 'engagement' && direction === 'received' && (
            <EngagementTab
              archive={archive}
              did={did}
              period={period}
              kind={kind === 'mention' ? 'all' : kind}
              nowMs={nowMs}
            />
          )}
          {tab === 'engagement' && direction === 'given' && (
            <GivenTab archive={archive} did={did} period={period} kind={kind === 'mention' ? 'all' : kind} nowMs={nowMs} />
          )}
          {tab === 'people' && (
            <PeopleTab
              archive={archive}
              did={did}
              period={period}
              kind={kind}
              relation={archive.meta.following ? relation : 'all'}
              nowMs={nowMs}
            />
          )}
          {tab === 'atmosphere' && <AtmosphereTab archive={archive} period={period} nowMs={nowMs} />}
          {tab === 'graph' && <GraphTab agent={agent} />}
        </>
      )}
    </div>
  );
}

/* ================================================================== */
/* The archive + sync orchestration                                     */
/* ================================================================== */

function useAnalyticsArchive(agent, did) {
  const [data, setData] = useState({
    loaded: false,
    persistent: true,
    blocked: false,
    posts: [],
    followers: [],
    following: [],
    blocks: [],
    inbound: [],
    outbound: [],
    atmosphere: [],
    meta: {},
    rev: 0,
  });
  const [actors, setActors] = useState(() => new Map());
  // While running: { plan, done, failed, step, fraction, detail, doing } —
  // the steps this sync will take, which have finished or failed, and the
  // one under way with its own measured share (null: nothing to measure by).
  const [sync, setSync] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const storeRef = useRef(null);
  const abortRef = useRef(null);
  const autoRanRef = useRef(false);
  const attemptedActorsRef = useRef(new Set());

  async function reload(store) {
    const [posts, followers, following, blocks, inbound, outbound, atmosphere, actorRows, pm, fm, gm, bm, im, om, rm] =
      await Promise.all([
        store.all('posts'),
        store.all('followers'),
        store.all('following'),
        store.all('blocks'),
        store.all('inbound'),
        store.all('outbound'),
        store.all('atmosphere'),
        store.all('actors'),
        store.getMeta('posts'),
        store.getMeta('followers'),
        store.getMeta('following'),
        store.getMeta('blocks'),
        store.getMeta('inbound'),
        store.getMeta('outbound'),
        store.getMeta('repo'),
      ]);
    setActors(new Map(actorRows.map((a) => [a.did, a])));
    setData((prev) => ({
      loaded: true,
      persistent: store.persistent,
      // Session-only because another tab holds the database at an older
      // version, rather than because this browser refuses IndexedDB — which is
      // fixable, so the studio says how.
      blocked: store.blocked === true,
      posts,
      followers,
      following,
      blocks,
      inbound,
      outbound,
      atmosphere,
      meta: { posts: pm, followers: fm, following: gm, blocks: bm, inbound: im, outbound: om, repo: rm },
      rev: prev.rev + 1,
    }));
    return { posts, meta: { posts: pm, blocks: bm, inbound: im, outbound: om } };
  }

  useEffect(() => {
    let cancelled = false;
    openAnalyticsStore().then(async (store) => {
      if (cancelled) return;
      storeRef.current = store;
      await reload(store);
    });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  /**
   * The one sync entry point. `mode`:
   *   'incremental'  top up posts, refresh followers, deepen events (default)
   *   'full'         clear the post archive and rebuild it from page one
   *   'resume'       continue an interrupted full build from its cursor
   */
  async function runSync(mode = 'incremental') {
    const store = storeRef.current;
    if (!store || !agent || abortRef.current) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setSyncError(null);
    const startedAt = Date.now();
    const errors = [];

    /* The bar: one segment per step, each filled by its own measurement.
       `begin` closes the step before it and returns a reporter bound to the
       new one, so a late report from a finished step can never move the
       next step's segment. A share only ever moves forward. */
    const plan = [...SYNC_PLAN];
    const done = [];
    const failed = [];
    let current = null;
    const begin = (step, { fraction = 0, detail = '', doing = null } = {}) => {
      // Starting the same step again (a repo diff falling back to a full
      // pull) restarts its segment; it never marks it finished.
      if (current && current !== step && !failed.includes(current) && !done.includes(current)) done.push(current);
      current = step;
      setSync({ plan: [...plan], done: [...done], failed: [...failed], step, fraction, detail, doing });
      return (nextFraction, nextDetail, nextDoing) =>
        setSync((s) => {
          if (!s || s.step !== step) return s;
          const fraction =
            nextFraction == null ? s.fraction : s.fraction == null ? nextFraction : Math.max(s.fraction, nextFraction);
          return {
            ...s,
            plan: [...plan],
            fraction,
            detail: nextDetail ?? s.detail,
            doing: nextDoing ?? s.doing,
          };
        });
    };
    const fail = (step, message) => {
      errors.push(`${step}: ${message}`);
      if (!failed.includes(step)) failed.push(step);
    };
    // A deploy landing mid-sweep must not reload the tab out from under a
    // 250-page build; the auto-updater applies it on a poll after release.
    const releaseHold = holdReload('analytics-sync');

    try {
      /* One public profile read up front: Bluesky's own follower/post
         counters, kept as the yardstick the sweeps are measured against.
         The follower counter in particular still counts deactivated,
         suspended and deleted accounts, so it sits ABOVE what getFollowers
         can list — recording it at sync time is what lets the Followers tab
         explain that gap with real numbers instead of leaving the owner to
         wonder why two parts of their own site disagree. */
      const prof = await getProfile(did).catch(() => null);

      /* Followers — always the full set; only a full set can see unfollows.
         Measured against the last sweep's listable count rather than the
         profile counter, which runs ahead of what can be listed. */
      const followerEst = data.meta.followers?.count || prof?.followersCount || null;
      let report = begin('followers', { fraction: followerEst ? 0 : null });
      const fw = await sweepFollowers(agent, did, {
        signal: ac.signal,
        onProgress: (p) => report(share(p.fetched, followerEst), ofAbout(p.fetched, followerEst, 'followers')),
      });
      if (fw.complete) {
        await store.clear('followers');
        await store.putAll('followers', fw.followers);
        await store.setMeta('followers', {
          syncedAt: startedAt,
          count: fw.followers.length,
          complete: true,
          profileCount: typeof prof?.followersCount === 'number' ? prof.followersCount : null,
        });
      } else if (fw.error) {
        fail('followers', fw.error);
      }
      if (ac.signal.aborted) return;

      /* Who the owner follows — the People tab's Follow buttons. A few pages
         of the owner's own repo; replaced only by a complete set, so a
         failed read never turns a real follow into a "Follow" button. */
      const followingEst = data.meta.following?.count || prof?.followsCount || null;
      report = begin('following', { fraction: followingEst ? 0 : null });
      const fl = await sweepFollowing(agent, did, {
        signal: ac.signal,
        onProgress: (p) => report(share(p.fetched, followingEst), ofAbout(p.fetched, followingEst, 'follows')),
      });
      if (fl.complete) {
        await store.clear('following');
        await store.putAll('following', fl.following);
        await store.setMeta('following', { syncedAt: startedAt, count: fl.following.length, complete: true });
      } else if (fl.error) {
        fail('following', fl.error);
      }
      if (ac.signal.aborted) return;

      /* Blocks received — Constellation enumerates block records in other
         repos that point at this DID. Their rkeys are TIDs, giving the same
         reconstructed timeline the follower graph uses. Replace only after
         a complete sweep so a failed request cannot erase good data. */
      const directEstimate = data.blocks.filter((b) => b.source === 'direct').length || null;
      report = begin('blocks');
      const bw = await sweepBlocks(did, {
        signal: ac.signal,
        onProgress: (p) => report(blocksFraction(p, { directEstimate }), blocksDetail(p, directEstimate)),
      });
      if (bw.complete) {
        const reach = blockReach(bw.blocks);
        await store.clear('blocks');
        await store.putAll('blocks', bw.blocks);
        await store.setMeta('blocks', {
          syncedAt: startedAt,
          count: reach.people.length,
          pathCount: bw.blocks.length,
          version: 2,
          complete: true,
        });
      } else if (bw.error) {
        fail('blocks', bw.error);
      }
      if (ac.signal.aborted) return;

      /* The repo CAR — every record in every collection, one download.
         Feeds the atmosphere rows and the COMPLETE outbound like/repost
         history; on a first build its post records also seed the charts
         long before the engagement hydration lands. `since=rev` keeps
         later syncs to a small diff. */
      let carEntries = null;
      const repoMeta = data.meta.repo;
      try {
        const pds = await resolvePds(did);
        // The PDS streams the CAR without a Content-Length, so a full pull
        // is measured against the size of the last one. A diff has no such
        // yardstick — it is small, and shows motion rather than a guess.
        const pull = async (since) => {
          const full = since == null;
          const totalGuess = full ? repoMeta?.bytes || null : null;
          report = begin('repo', {
            fraction: totalGuess ? 0 : null,
            doing: full ? 'Downloading the repo' : 'Downloading what changed in the repo',
          });
          const bytes = await fetchRepoCar(pds, did, {
            since,
            signal: ac.signal,
            onProgress: (p) =>
              report(repoDownloadFraction(p.bytes, p.total || totalGuess), megabytes(p.bytes, p.total || totalGuess)),
          });
          const expectedRecords = full ? data.atmosphere.length || null : null;
          report(null, '', 'Reading the repo archive');
          const parsed = await readRepoCar(bytes, {
            onProgress: (p) => report(repoReadFraction(p, { expectedRecords }), carDetail(p)),
          });
          return { parsed, size: bytes.byteLength };
        };
        let since = mode !== 'full' && repoMeta?.rev ? repoMeta.rev : null;
        let pulled;
        try {
          pulled = await pull(since);
        } catch (err) {
          // A diff 400s when the PDS no longer holds that rev; the honest
          // recovery is a full pull, not a failed phase.
          if (!since || ac.signal.aborted) throw err;
          since = null;
          pulled = await pull(null);
        }
        const { parsed } = pulled;
        if (ac.signal.aborted) return;

        const atmoRows = [];
        const outRows = [];
        for (const entry of parsed.entries) {
          const row = atmosphereRowFromEntry(entry);
          if (row) atmoRows.push(row);
          const kind =
            entry.collection === 'app.bsky.feed.like'
              ? 'like'
              : entry.collection === 'app.bsky.feed.repost'
                ? 'repost'
                : null;
          if (kind) {
            const ev = outboundFromRecord(kind, { uri: entry.uri, value: entry.record });
            if (ev) outRows.push(ev);
          }
        }
        // The size of the last FULL pull is the next one's yardstick.
        const bytesMeta = since == null ? pulled.size : (repoMeta?.bytes ?? null);
        // Writing ~190,000 rows into IndexedDB is the longest part of a full
        // pull, so it is measured too: in chunks, row by row.
        const toWrite = atmoRows.length + outRows.length;
        let written = 0;
        const saved = (rows) => {
          written += rows;
          report(repoSaveFraction(written, toWrite), `${num(written)} of ${num(toWrite)} rows`);
        };
        report(repoSaveFraction(0, toWrite), `${num(0)} of ${num(toWrite)} rows`, 'Saving the repo to this browser');
        if (since == null) {
          // Full pull: replace, so deleted records actually leave. The rev
          // is nulled first — a death mid-write must make the NEXT sync
          // pull full again, never diff across a half-written store.
          await store.clear('atmosphere');
          await store.clear('outbound');
          await store.setMeta('repo', { syncedAt: startedAt, rev: null, bytes: bytesMeta });
        }
        for (let i = 0; i < atmoRows.length; i += 5000) {
          const chunk = atmoRows.slice(i, i + 5000);
          await store.putAll('atmosphere', chunk);
          saved(chunk.length);
        }
        for (let i = 0; i < outRows.length; i += 5000) {
          const chunk = outRows.slice(i, i + 5000);
          await store.putAll('outbound', chunk);
          saved(chunk.length);
        }
        // An empty diff names no rev — nothing was written since the one held.
        await store.setMeta('repo', { syncedAt: startedAt, rev: parsed.rev || since, bytes: bytesMeta });
        // The CAR is now the complete outbound record: mark coverage as
        // total so the fallback sweep, if it ever runs again, knows it.
        await store.setMeta('outbound', { syncedAt: startedAt, coverageMs: 0, truncated: false });
        carEntries = parsed.entries;
      } catch (err) {
        if (ac.signal.aborted) return;
        if (current !== 'repo') begin('repo');
        fail('repo', err?.message || String(err));
        // Without the CAR, likes and reposts need their own walk at the end.
        plan.push('outbound');
      }
      if (ac.signal.aborted) return;

      /* Posts */
      const postsMeta = data.meta.posts;
      const full = mode === 'full' || !postsMeta;
      // Resume finishes any incomplete build. With a checkpointed cursor it
      // continues from that page; without one (the build died before its
      // first checkpoint) it walks from page one again but WITHOUT clearing,
      // so every page is an upsert and nothing already banked is lost.
      const resume = !full && mode === 'resume' && !postsMeta.complete;
      let est = data.posts.length || null;
      if ((full || resume) && prof?.postsCount) est = prof.postsCount;
      // The dates the walk is measured against: the repo's own post records
      // on a fresh build, the archive otherwise.
      let heldPosts = data.posts;
      const building = full || resume;
      report = begin('posts', {
        fraction: null,
        doing: building ? 'Archiving posts' : 'Refreshing recent posts',
      });
      if (full) {
        await store.clear('posts');
        // Mark the build as underway BEFORE page one. From here on, however
        // the tab dies — cancel, crash, the deploy auto-reload — the archive
        // reads as incomplete and resumable, never as "never started".
        await store.setMeta('posts', { syncedAt: startedAt, complete: false, cursor: null });
        heldPosts = [];
        if (carEntries) {
          // Seed the freshly-cleared archive with the repo's own post
          // records — counts all zero, because only the AppView knows them —
          // and paint the charts NOW. The sweep below overwrites every one
          // of these rows with counted rows in this same sync, so the zeros
          // are a first-build transient, never a lasting understatement.
          const seed = [];
          for (const entry of carEntries) {
            if (entry.collection !== 'app.bsky.feed.post') continue;
            const row = compactPostFromRecord(entry.uri, entry.record);
            if (row) seed.push(row);
          }
          if (seed.length) {
            report(null, `copying ${num(seed.length)} posts from the repo so the charts can draw`);
            await store.putAll('posts', seed);
            await reload(store);
          }
          heldPosts = seed;
        }
      }
      const postTimes = heldPosts
        .map((p) => Date.parse(p.at))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      // A build walks to the oldest post; a top-up walks back through the
      // recent window whose counts it refreshes.
      const postTarget = building ? (postTimes[0] ?? null) : startedAt - REHYDRATE_DAYS * DAY_MS;
      const measurable = postTarget != null && walkFraction(postTimes, null, postTarget) != null;
      const postsEst = building ? est : null;
      if (measurable || postsEst) report(0, '');
      const known = building ? null : new Set(data.posts.map((p) => p.uri));
      const ps = await sweepPosts({
        did,
        knownUris: known,
        rehydrateSinceMs: building ? -Infinity : startedAt - REHYDRATE_DAYS * DAY_MS,
        resumeCursor: resume ? postsMeta.cursor || null : null,
        signal: ac.signal,
        // Persist the page, THEN checkpoint the cursor that resumes after
        // it — in that order, so a kill between the two writes only costs
        // one page re-fetched, never a page skipped.
        onPage: async (rows, { cursor } = {}) => {
          await store.putAll('posts', rows);
          if (building && cursor) {
            await store.setMeta('posts', { syncedAt: startedAt, complete: false, cursor });
          }
        },
        onProgress: (p) =>
          report(
            (measurable ? walkFraction(postTimes, p.reachedMs, postTarget) : null) ?? share(p.fetched, postsEst),
            reachedDetail(ofAbout(p.fetched, postsEst, 'posts'), p.reachedMs),
          ),
      });
      if (ps.error) fail('posts', ps.error);
      if (building) {
        await store.setMeta('posts', {
          syncedAt: startedAt,
          complete: ps.complete,
          cursor: ps.complete ? null : ps.cursor,
        });
      } else {
        await store.setMeta('posts', { ...postsMeta, syncedAt: startedAt });
      }
      if (ac.signal.aborted) return;

      /* Inbound + outbound engagement events */
      const cutoffMs = startedAt - EVENT_DEPTH_DAYS * DAY_MS;

      const im = data.meta.inbound;
      // A top-up stops about where the last sync started; a sweep still
      // digging toward the cutoff has the cutoff to reach. Measured by time:
      // nothing held can say how many notifications lie in between.
      const inCovered = im?.coverageMs != null && im.coverageMs <= cutoffMs;
      const inTarget = inCovered && im?.syncedAt ? im.syncedAt : cutoffMs;
      report = begin('inbound');
      const inb = await sweepInbound(agent, {
        cutoffMs,
        knownUris: new Set(data.inbound.map((e) => e.uri)),
        coveredToMs: im?.coverageMs ?? null,
        signal: ac.signal,
        onPage: (rows) => store.putAll('inbound', rows),
        onProgress: (p) =>
          report(
            timeFraction(startedAt, p.reachedMs, inTarget),
            reachedDetail(`${num(p.fetched)} engagement ${p.fetched === 1 ? 'event' : 'events'} read`, p.reachedMs),
          ),
      });
      if (inb.error) fail('inbound', inb.error);
      else if (!inb.aborted) {
        const coverage = Math.min(im?.coverageMs ?? Infinity, inb.complete ? cutoffMs : (inb.reachedMs ?? Infinity));
        await store.setMeta('inbound', {
          syncedAt: startedAt,
          coverageMs: Number.isFinite(coverage) ? coverage : null,
          truncated: inb.truncated,
        });
      }
      if (ac.signal.aborted) return;

      /* Outbound — only as the fallback when the repo pull failed. A
         successful CAR already wrote the complete like/repost history, and
         a 240-page sweep after it would re-fetch a strict subset. */
      if (!carEntries) {
        const om = data.meta.outbound;
        const outCovered = om?.coverageMs != null && om.coverageMs <= cutoffMs;
        const outTarget = outCovered && om?.syncedAt ? om.syncedAt : cutoffMs;
        report = begin('outbound');
        const outb = await sweepOutbound(agent, did, {
          cutoffMs,
          knownUris: new Set(data.outbound.map((e) => e.uri)),
          coveredToMs: om?.coverageMs ?? null,
          signal: ac.signal,
          onPage: (rows) => store.putAll('outbound', rows),
          onProgress: (p) =>
            report(
              partsFraction(p.part, p.parts, timeFraction(startedAt, p.reachedMs, outTarget)),
              reachedDetail(`${p.part === 0 ? 'likes' : 'reposts'} · ${p.fetched.toLocaleString('en-US')} read`, p.reachedMs),
            ),
        });
        if (outb.error) fail('outbound', outb.error);
        else if (!outb.aborted) {
          const coverage = Math.min(om?.coverageMs ?? Infinity, outb.complete ? cutoffMs : (outb.reachedMs ?? Infinity));
          await store.setMeta('outbound', {
            syncedAt: startedAt,
            coverageMs: Number.isFinite(coverage) ? coverage : null,
            truncated: outb.truncated,
          });
        }
      }
    } finally {
      releaseHold();
      abortRef.current = null;
      // Every step has had its turn; what is left is reading the archive back
      // for the charts. Said as such, so the last step's segment doesn't sit
      // short of full while it happens.
      if (current && !failed.includes(current) && !done.includes(current) && !ac.signal.aborted) {
        done.push(current);
      }
      setSync((s) =>
        s ? { ...s, done: [...done], failed: [...failed], step: null, fraction: null, detail: '', doing: null } : s,
      );
      // One reload, one render of new charts — the sweeps persisted as they
      // went, so even an aborted sync surfaces everything it banked.
      const store2 = storeRef.current;
      if (store2) await reload(store2);
      setSync(null);
      if (errors.length) setSyncError(errors.join(' · '));
    }
  }

  /**
   * Follow or unfollow one account from the People tab: a follow record
   * written to (or every one deleted from) the owner's own repo, then the
   * archive's copy updated to match, so the button holds across a reload
   * without waiting for the next sync. Throws on failure — the row says so.
   */
  async function setFollow(subject, on) {
    const store = storeRef.current;
    if (!agent || !store || !subject) return;
    if (on) {
      const createdAt = new Date().toISOString();
      const res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: FOLLOW,
        record: { $type: FOLLOW, subject, createdAt },
      });
      const row = { uri: res?.data?.uri, did: subject, followedAt: createdAt };
      if (!row.uri) throw new Error('the PDS did not return the follow record');
      await store.putAll('following', [row]);
      setData((prev) => ({ ...prev, following: [...prev.following, row] }));
      return;
    }
    // Every record for this subject: a repo can hold more than one, and
    // deleting only the first would leave the account still followed.
    const rows = data.following.filter((f) => f.did === subject);
    for (const row of rows) {
      const rkey = rkeyFromAtUri(row.uri);
      if (rkey) await agent.com.atproto.repo.deleteRecord({ repo: did, collection: FOLLOW, rkey });
    }
    await store.remove('following', rows.map((r) => r.uri));
    setData((prev) => ({ ...prev, following: prev.following.filter((f) => f.did !== subject) }));
  }

  /* Pick incomplete builds back up, and top up a stale archive, quietly. */
  useEffect(() => {
    if (!data.loaded || !agent || autoRanRef.current) return;
    const pm = data.meta.posts;
    if (!pm) return; // first run is a button, never a surprise sweep
    autoRanRef.current = true;
    // An interrupted build resumes IMMEDIATELY, staleness be damned — the
    // interruption may have been the deploy auto-reload seconds ago, and an
    // incomplete archive is not a state worth being fresh in.
    if (!pm.complete) {
      runSync('resume');
      return;
    }
    // Existing archives may predate the blocks store, moderation-list reach
    // or the follows the People tab marks. Populate the current shape even
    // when posts are still fresh.
    if (data.meta.blocks?.version !== 2 || !data.meta.following) {
      runSync('incremental');
      return;
    }
    if (Date.now() - (pm.syncedAt || 0) < AUTO_SYNC_AFTER_MS) return;
    runSync('incremental');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.loaded]);

  /** Resolve profile cards for DIDs a People list wants but the cache lacks. */
  async function wantActors(dids) {
    const attempted = attemptedActorsRef.current;
    const missing = (dids || []).filter((d) => d && !actors.get(d)?.handle && !attempted.has(d));
    if (!missing.length) return;
    missing.forEach((d) => attempted.add(d));
    const cache = new Map(actors);
    const fresh = await hydrateActors(missing, cache).catch(() => []);
    if (!fresh.length) return;
    storeRef.current?.putAll('actors', fresh);
    setActors((prev) => {
      const next = new Map(prev);
      for (const card of fresh) next.set(card.did, card);
      return next;
    });
  }

  return {
    ...data,
    actors,
    sync,
    syncError,
    runSync,
    setFollow,
    wantActors,
    cancelSync: () => abortRef.current?.abort(),
    agent,
    did,
  };
}

/* ================================================================== */
/* Sync strip + first run                                               */
/* ================================================================== */

/* The words beside the bar. Each says what was measured, in its own unit. */

const num = (v) => Math.round(v).toLocaleString('en-US');

/** "2,300 of ~5,592 followers", or "2,300 followers" with nothing to go by. */
function ofAbout(fetched, est, noun) {
  return est ? `${num(fetched)} of ~${num(est)} ${noun}` : `${num(fetched)} ${noun}`;
}

/** A walk's count, then how far back in time it has reached. */
function reachedDetail(head, reachedMs) {
  return reachedMs != null ? `${head} · back to ${formatDateShort(reachedMs)}` : head;
}

function blocksDetail(p, directEstimate) {
  switch (p?.stage) {
    case 'direct':
      return ofAbout(p.done, directEstimate, 'direct blocks');
    case 'lists':
      return `finding the lists you’re on · ${num(p.done)} ${p.done === 1 ? 'membership' : 'memberships'}`;
    case 'check':
      return `checking ${num(p.done)} of ${num(p.total)} lists for moderation lists`;
    case 'subscribers':
      return `moderation lists ${num(p.done)} of ${num(p.total)} · ${num(p.fetched)} block paths`;
    default:
      return '';
  }
}

function megabytes(bytes, total) {
  const mb = (v) => (v / 1048576).toFixed(v < 10 * 1048576 ? 1 : 0);
  return total ? `${mb(bytes)} of ~${mb(total)} MB` : `${mb(bytes)} MB`;
}

function carDetail(p) {
  if (p?.stage === 'index') return 'indexing blocks';
  if (p?.stage === 'walk') return `${num(p.done)} records found`;
  if (p?.stage === 'decode') return `${num(p.done)} of ${num(p.total)} records`;
  return '';
}

function SyncStrip({ archive }) {
  const {
    sync,
    syncError,
    meta,
    posts,
    followers,
    blocks,
    persistent,
    blocked,
    runSync,
    cancelSync,
  } = archive;
  const currentBlockReach = blockReach(blocks).people.length;

  if (sync) return <SyncProgress sync={sync} onCancel={cancelSync} />;

  const pm = meta.posts;
  if (!pm) return null;
  return (
    <div className="an-strip">
      <span className="an-strip-label">
        {posts.length.toLocaleString('en-US')} {posts.length === 1 ? 'post' : 'posts'} ·{' '}
        {followers.length.toLocaleString('en-US')} {followers.length === 1 ? 'follower' : 'followers'} ·{' '}
        {currentBlockReach.toLocaleString('en-US')} block {currentBlockReach === 1 ? 'person' : 'people'}
        {pm.syncedAt ? ` · synced ${relativeTime(pm.syncedAt)}` : ''}
        {!pm.complete && ' · archive incomplete'}
        {!persistent &&
          (blocked
            ? ' · another dame.is tab is holding the archive open, so this sync lasts the session only — close it and reload to keep it'
            : ' · this browser holds the archive for this session only')}
      </span>
      {syncError && <span className="an-strip-error">{syncError}</span>}
      <span className="an-strip-actions">
        {!pm.complete && (
          <Button size="sm" onClick={() => archive.runSync('resume')}>
            Resume build
          </Button>
        )}
        <Button size="sm" onClick={() => runSync('incremental')}>
          Sync
        </Button>
        <Button
          size="sm"
          variant="text"
          title="Clear the post archive and rebuild it from the AppView — the only way deleted posts leave, and old posts' counts fully refresh."
          onClick={() => runSync('full')}
        >
          Rebuild
        </Button>
        {/* The archive's two exports (#341), as text Buttons beside Rebuild:
            occasional actions, not the strip's main one. */}
        <Button
          size="sm"
          variant="text"
          title="Download everything this browser holds (posts, followers, blocks, engagement, repo records) as one JSON file."
          onClick={() => exportArchive(archive)}
        >
          Export all (JSON)
        </Button>
        <Button
          size="sm"
          variant="text"
          title="Download the post archive with its engagement counts as a spreadsheet, newest first."
          onClick={() => exportPosts(archive)}
        >
          Export posts (CSV)
        </Button>
      </span>
    </div>
  );
}

/**
 * A sync under way: which step of how many, what it is doing and how far,
 * then every step, named, with its own segment and state — finished ones
 * full and ticked, failed ones marked, the one under way filled by its own
 * measured share (or moving, when there is nothing honest to measure it by),
 * the rest waiting. The segments are equal on purpose: they say where in the
 * sync it is, and each one's fill is the only number on the bar, so no part
 * of it is a guess about the whole. A row of six on a wide screen, a grid of
 * three across on a phone — every stage stays named either way.
 */
function SyncProgress({ sync, onCancel }) {
  const { plan, done, failed, step, fraction, detail, doing } = sync;
  const index = plan.indexOf(step);
  const finishing = step == null;
  const pct = fraction == null || finishing ? null : Math.round(fraction * 100);
  const stateOf = (key) =>
    failed.includes(key) ? 'failed' : done.includes(key) ? 'done' : key === step ? 'active' : 'pending';
  return (
    <div className="an-strip an-sync">
      <div className="an-sync-head">
        <span className="an-strip-label" role="status">
          <span className="an-sync-count">
            {finishing ? 'Finishing' : `Step ${index + 1} of ${plan.length}`}
          </span>{' '}
          <span className="an-sync-doing">
            {finishing ? 'Loading the archive into the charts' : doing || SYNC_STEPS[step]?.doing || 'Syncing'}
          </span>
          {detail && <span className="an-sync-detail"> · {detail}</span>}
          {pct != null && <span className="an-sync-pct"> · {pct}%</span>}
        </span>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <ol className="an-sync-steps" aria-label="Sync steps">
        {plan.map((key) => {
          const state = stateOf(key);
          const width = state === 'done' || state === 'failed' ? 100 : state === 'active' ? (pct ?? 0) : 0;
          return (
            <li key={key} className="an-sync-step" data-state={state}>
              <span className="an-sync-track" aria-hidden="true">
                <span
                  className="an-sync-fill"
                  style={state === 'active' && pct == null ? undefined : { width: `${width}%` }}
                  data-indeterminate={state === 'active' && pct == null ? '' : undefined}
                />
              </span>
              <span className="an-sync-name">
                <span className="an-sync-label">{SYNC_STEPS[key]?.label || key}</span>
                <span className="an-sync-state" aria-hidden="true">
                  {state === 'done' ? (
                    <Check size={12} />
                  ) : state === 'failed' ? (
                    'failed'
                  ) : state === 'active' ? (
                    pct != null ? `${pct}%` : '…'
                  ) : null}
                </span>
                <span className="visually-hidden">
                  {state === 'done'
                    ? ', done'
                    : state === 'failed'
                      ? ', failed'
                      : state === 'active'
                        ? pct != null
                          ? `, ${pct}% done`
                          : ', under way'
                        : ', waiting'}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* The export reads the archive already in memory, the same rows the charts
   draw, so a file always matches what the studio is showing. */

function exportArchive(archive) {
  const now = Date.now();
  const json = archiveJson(archive, { did: archive.did, handle: ME_HANDLE, actors: archive.actors, now });
  downloadText(json, exportFilename(ME_HANDLE, 'analytics', 'json', now), 'application/json');
}

function exportPosts(archive) {
  const now = Date.now();
  const csv = postsCsv(archive.posts, { did: archive.did, handle: ME_HANDLE });
  downloadText(csv, exportFilename(ME_HANDLE, 'posts', 'csv', now), 'text/csv;charset=utf-8');
}

function downloadText(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // The download starts after the click returns, and Safari can still be
  // reading the blob well after that; revoking at once can cut it off.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function FirstRun({ archive }) {
  return (
    <section className="an-first" aria-labelledby="an-first-head">
      <SectionHead id="an-first-head" title="Build the archive" />
      <p className="an-hero-body">
        Analytics are derived client-side from your own data: the repo’s own archive (one download
        that yields every record in every collection, all-time), every current follower with the
        date their follow record was minted, everyone you follow, every current direct or
        moderation-list block path, your recent notifications — and every post’s engagement counts via the public AppView, which is
        the long part: a couple of hundred requests, a minute or two, with the charts painting from
        the repo archive while it runs.
        Everything lands in this browser’s IndexedDB; after the first build, syncs only top up
        what’s new.
        {!archive.persistent &&
          (archive.blocked
            ? ' Another dame.is tab is holding the archive open, so a build here would only last the session. Close that tab, then reload this one to keep it.'
            : ' This browser is blocking IndexedDB, so the archive will only last the session.')}
      </p>
      <div>
        <Button variant="primary" onClick={() => archive.runSync('full')} disabled={Boolean(archive.sync)}>
          Build the archive
        </Button>
      </div>
    </section>
  );
}

/* ================================================================== */
/* Followers                                                            */
/* ================================================================== */

function FollowersTab({ archive, period, nowMs }) {
  const { followers, blocks } = archive;
  const [mode, setMode] = useState('cumulative');

  const model = useMemo(() => {
    const dated = followers
      .map((f) => ({ ...f, atMs: Date.parse(f.followedAt || '') }))
      .filter((f) => Number.isFinite(f.atMs));
    const undated = followers.length - dated.length;
    const oldest = dated.length ? Math.min(...dated.map((f) => f.atMs)) : nowMs;
    const t0 = period.days ? nowMs - period.days * DAY_MS : oldest;
    const spanDays = Math.max(1, Math.round((nowMs - t0) / DAY_MS));
    const units = unitChoicesFor(period.days ? period.days : spanDays);
    const unit = mode !== 'cumulative' && units.includes(mode) ? mode : defaultUnitFor(period.days ?? spanDays);
    const inWindow = dated.filter((f) => f.atMs >= t0 && f.atMs <= nowMs);
    const counts = bucketSeries(inWindow, { unit, t0, t1: nowMs, pickTime: (f) => f.atMs });
    const baseline = dated.filter((f) => f.atMs < t0).length;
    const datedBlocks = blocks
      .map((block) => ({ ...block, atMs: Date.parse(block.blockedAt || '') }))
      .filter((block) => Number.isFinite(block.atMs));
    const blockCounts = bucketSeries(datedBlocks, {
      unit,
      t0,
      t1: nowMs,
      pickTime: (block) => block.atMs,
    });
    const blockBaseline = datedBlocks.filter((block) => block.atMs < t0).length;
    const compare = comparePeriods(dated, { days: period.days || spanDays, now: nowMs, pickTime: (f) => f.atMs });
    return {
      total: followers.length,
      undated,
      unit,
      units,
      counts,
      cumulative: cumulativeSeries(counts, baseline),
      blockCumulative: cumulativeSeries(blockCounts, blockBaseline),
      gained: inWindow.length,
      perDay: inWindow.length / spanDays,
      compare,
      spanDays,
    };
  }, [followers, blocks, period, mode, nowMs]);

  if (!followers.length) {
    return <p className="an-empty">No follower sweep yet — run a sync to gather the current follower list.</p>;
  }

  // Bluesky's own counter at sweep time. It sits above the swept total
  // because it still counts deactivated, suspended and deleted accounts —
  // and it is the number shown everywhere else, so the disagreement needs
  // naming or it reads as a bug.
  const profileCount = archive.meta.followers?.profileCount ?? null;
  const counterGap = profileCount != null ? profileCount - model.total : null;

  const together = mode === 'together';
  const cumulative = mode === 'cumulative' || together;
  return (
    <section className="an-panel" aria-label="Follower growth">
      <Figures
        className="an-figures"
        label="Followers in figures"
        items={[
          stat({
            label: 'Followers',
            value: model.total,
            sub:
              counterGap != null && counterGap !== 0
                ? `${profileCount.toLocaleString('en-US')} on the profile`
                : null,
          }),
          stat({
            label: `New in ${period.label.toLowerCase()}`,
            value: model.gained,
            delta: period.days ? model.compare.pct : null,
            deltaTitle: period.days
              ? `vs previous ${period.label.toLowerCase()}: ${model.compare.previous.toLocaleString('en-US')}`
              : null,
          }),
          stat({
            label: 'Per day',
            value: model.perDay < 10 ? Math.round(model.perDay * 10) / 10 : Math.round(model.perDay),
            exact: true,
          }),
        ]}
      />

      <div className="an-card">
        <SectionHead
          as="h3"
          title="Growth"
          meta={
            <ModeToggle
              value={mode}
              onChange={setMode}
              options={[
                MODE_TOTAL,
                { ...MODE_BOTH, title: 'Followers and blocks on one chart' },
                ...model.units.map((u) => ({ key: u, label: unitLabel(u), title: unitTitle(u, 'new followers') })),
              ]}
            />
          }
        />
        <SeriesChart
          series={cumulative ? model.cumulative : model.counts}
          seriesLabel={together ? 'Followers' : null}
          secondary={together ? { series: model.blockCumulative, label: 'Blocks' } : null}
          mode={cumulative ? 'line' : 'bars'}
          unit={model.unit}
          zeroBase={!cumulative}
          // The dashed reach up to Bluesky's own counter — the simulated
          // altitude of the deactivated, suspended and deleted followers the
          // swept curve cannot see. Only meaningful upward, and only on the
          // cumulative form; a per-bucket bar has no "now" to reach from.
          ghost={!together && cumulative && counterGap != null && counterGap > 0 ? { v: profileCount } : null}
          ariaLabel={
            together
              ? `Cumulative followers and current blocks over ${period.label}`
              : cumulative
              ? `Cumulative followers over ${period.label}`
              : `New followers per ${model.unit} over ${period.label}`
          }
        />
        <ChartTable
          series={cumulative ? model.cumulative : model.counts}
          secondary={together ? model.blockCumulative : null}
          unit={model.unit}
          valueHead={cumulative ? 'Followers' : 'New followers'}
          secondaryHead={together ? 'Blocks' : null}
        />
      </div>

      <p className="an-note">
        Counted by walking the follower list itself, so the total here is followers whose accounts
        exist right now.
        {counterGap != null && counterGap > 0 && (
          <>
            {' '}Bluesky’s profile counter says {profileCount.toLocaleString('en-US')} — it keeps
            counting deactivated, suspended and deleted accounts, so the{' '}
            {counterGap.toLocaleString('en-US')}-account gap is followers who can’t currently be
            listed. The dashed reach on the cumulative chart marks that counter: a simulation of
            those unlistable accounts, not measured growth.
          </>
        )}
        {counterGap != null && counterGap < 0 && (
          <>
            {' '}Bluesky’s profile counter says {profileCount.toLocaleString('en-US')}; it is a
            cached tally and drifts.
          </>
        )}{' '}
        The curve dates each follower by their follow record — accounts that unfollowed are
        invisible to it.
        {model.undated > 0 && ` ${model.undated.toLocaleString('en-US')} followers carry no readable follow date and sit outside the chart.`}
      </p>
    </section>
  );
}

/* ================================================================== */
/* Blocks                                                               */
/* ================================================================== */

function BlocksTab({ archive, period, nowMs }) {
  const { blocks, followers } = archive;
  const [mode, setMode] = useState('cumulative');

  const model = useMemo(() => {
    const reach = blockReach(blocks);
    const dated = reach.people
      .map((person) => ({ ...person, atMs: Date.parse(person.blockedAt || '') }))
      .filter((person) => Number.isFinite(person.atMs));
    const undated = reach.people.length - dated.length;
    const oldest = dated.length ? Math.min(...dated.map((block) => block.atMs)) : nowMs;
    const t0 = period.days ? nowMs - period.days * DAY_MS : oldest;
    const spanDays = Math.max(1, Math.round((nowMs - t0) / DAY_MS));
    const units = unitChoicesFor(period.days ? period.days : spanDays);
    const unit = units.includes(mode) ? mode : defaultUnitFor(period.days ?? spanDays);
    const inWindow = dated.filter((block) => block.atMs >= t0 && block.atMs <= nowMs);
    const counts = bucketSeries(inWindow, {
      unit,
      t0,
      t1: nowMs,
      pickTime: (block) => block.atMs,
    });
    const baseline = dated.filter((block) => block.atMs < t0).length;
    const direct = dated.filter((person) => person.source === 'direct');
    const viaLists = dated.filter((person) => person.source === 'list');
    const directCounts = bucketSeries(direct, {
      unit,
      t0,
      t1: nowMs,
      pickTime: (person) => person.atMs,
    });
    const listCounts = bucketSeries(viaLists, {
      unit,
      t0,
      t1: nowMs,
      pickTime: (person) => person.atMs,
    });
    const datedFollowers = followers
      .map((follower) => ({ ...follower, atMs: Date.parse(follower.followedAt || '') }))
      .filter((follower) => Number.isFinite(follower.atMs));
    const followerCounts = bucketSeries(datedFollowers, {
      unit,
      t0,
      t1: nowMs,
      pickTime: (follower) => follower.atMs,
    });
    const followerBaseline = datedFollowers.filter((follower) => follower.atMs < t0).length;
    return {
      total: reach.people.length,
      directTotal: reach.directCount,
      listTotal: reach.listCount,
      overlap: reach.overlapCount,
      undated,
      unit,
      units,
      counts,
      trend: movingAverage(counts, 7),
      cumulative: cumulativeSeries(counts, baseline),
      directCumulative: cumulativeSeries(
        directCounts,
        direct.filter((person) => person.atMs < t0).length,
      ),
      listCumulative: cumulativeSeries(
        listCounts,
        viaLists.filter((person) => person.atMs < t0).length,
      ),
      followerCumulative: cumulativeSeries(followerCounts, followerBaseline),
      received: inWindow.length,
      perDay: inWindow.length / spanDays,
      compare: comparePeriods(dated, {
        days: period.days || spanDays,
        now: nowMs,
        pickTime: (block) => block.atMs,
      }),
    };
  }, [blocks, followers, period, mode, nowMs]);

  if (!archive.meta.blocks) {
    return <p className="an-empty">No block backlink sweep yet — run a sync to build this timeline.</p>;
  }

  const together = mode === 'together';
  const stacked = mode === 'stacked';
  const cumulative = mode === 'cumulative' || together || stacked;
  const chartSeries = together
    ? model.followerCumulative
    : stacked
      ? model.directCumulative
      : cumulative
        ? model.cumulative
        : model.counts;
  const secondary = together
    ? { series: model.cumulative, label: 'Block reach' }
    : stacked
      ? { series: model.listCumulative, label: 'Moderation lists' }
      : null;
  return (
    <section className="an-panel" aria-label="Blocks received">
      <Figures
        className="an-figures"
        label="Blocks in figures"
        items={[
          stat({ label: 'Current block reach', value: model.total }),
          stat({ label: 'Direct blocks', value: model.directTotal }),
          stat({ label: 'Via moderation lists', value: model.listTotal }),
          stat({
            label: `New in ${period.label.toLowerCase()}`,
            value: model.received,
            delta: period.days ? model.compare.pct : null,
            deltaTitle: period.days
              ? `vs previous ${period.label.toLowerCase()}: ${model.compare.previous.toLocaleString('en-US')}`
              : null,
          }),
        ]}
      />

      <div className="an-card">
        <SectionHead
          as="h3"
          title={together ? 'Followers & block reach' : stacked ? 'Block reach by path' : 'Blocks received'}
          meta={
            <ModeToggle
              value={mode}
              onChange={setMode}
              options={[
                MODE_TOTAL,
                MODE_STACK,
                { ...MODE_BOTH, title: 'Block reach and followers on one chart' },
                ...model.units.map((unit) => ({ key: unit, label: unitLabel(unit), title: unitTitle(unit, 'new blocks') })),
              ]}
            />
          }
        />
        <SeriesChart
          series={chartSeries}
          seriesLabel={together ? 'Followers' : stacked ? 'Direct' : null}
          secondary={secondary}
          stacked={stacked}
          trend={!cumulative ? model.trend : null}
          mode={cumulative ? 'line' : 'bars'}
          unit={model.unit}
          zeroBase={!cumulative}
          ariaLabel={
            together
              ? `Cumulative followers and current block reach over ${period.label}`
              : stacked
              ? `Stacked direct and moderation-list block reach over ${period.label}`
              : cumulative
              ? `Cumulative current block reach over ${period.label}`
              : `New blocks per ${model.unit} over ${period.label}`
          }
        />
        <ChartTable
          series={chartSeries}
          secondary={secondary?.series || null}
          trend={!cumulative ? model.trend : null}
          unit={model.unit}
          valueHead={together ? 'Followers' : stacked ? 'Direct' : cumulative ? 'Block reach' : 'New blocks'}
          secondaryHead={together ? 'Block reach' : stacked ? 'Moderation lists' : null}
        />
      </div>

      <p className="an-note">
        Reconstructed from current <code>app.bsky.graph.block</code> records and moderation lists
        that currently contain this account. List reach follows each list&rsquo;s current{' '}
        <code>app.bsky.graph.listblock</code> subscribers. A list block begins at the later of the
        membership and subscription TIDs. People reached through several lists or through both a
        list and a direct block count once in the total
        {model.overlap > 0 &&
          `; ${model.overlap.toLocaleString('en-US')} also have a direct block`}.
        {' '}Removed blocks, memberships and subscriptions disappear on the next sync, so this is
        a reconstruction of blocks that still exist, not a permanent event history.
        {model.undated > 0 &&
          ` ${model.undated.toLocaleString('en-US')} people have no complete readable date and sit outside the chart.`}
      </p>
    </section>
  );
}

/* ================================================================== */
/* Posts                                                                */
/* ================================================================== */

function PostsTab({ archive, period, nowMs }) {
  const { posts } = archive;
  const [unitPick, setUnitPick] = useState(null);

  const model = useMemo(() => {
    const dated = posts.map((p) => ({ ...p, atMs: Date.parse(p.at) })).filter((p) => Number.isFinite(p.atMs));
    const oldest = dated.length ? Math.min(...dated.map((p) => p.atMs)) : nowMs;
    const t0 = period.days ? nowMs - period.days * DAY_MS : oldest;
    const spanDays = Math.max(1, Math.round((nowMs - t0) / DAY_MS));
    const units = unitChoicesFor(period.days ?? spanDays);
    const unit = unitPick && units.includes(unitPick) ? unitPick : defaultUnitFor(period.days ?? spanDays);
    const inWindow = dated.filter((p) => p.atMs >= t0 && p.atMs <= nowMs);
    const counts = bucketSeries(inWindow, { unit, t0, t1: nowMs, pickTime: (p) => p.atMs });
    const replies = inWindow.filter((p) => p.replyTo).length;
    const quotes = inWindow.filter((p) => p.quoteOf).length;
    const withMedia = inWindow.filter((p) => p.hasMedia).length;
    return {
      unit,
      units,
      counts,
      trend: movingAverage(counts, 7),
      count: inWindow.length,
      perDay: inWindow.length / spanDays,
      replies,
      quotes,
      originals: inWindow.length - replies,
      withMedia,
      compare: comparePeriods(dated, { days: period.days || spanDays, now: nowMs, pickTime: (p) => p.atMs }),
      spanDays,
    };
  }, [posts, period, unitPick, nowMs]);

  if (!posts.length) {
    return <p className="an-empty">The post archive is empty — build it from the strip above.</p>;
  }

  return (
    <section className="an-panel" aria-label="Posting trends">
      <Figures
        className="an-figures"
        label="Posts in figures"
        items={[
          stat({
            label: `Posts in ${period.label.toLowerCase()}`,
            value: model.count,
            delta: period.days ? model.compare.pct : null,
            deltaTitle: period.days
              ? `vs previous ${period.label.toLowerCase()}: ${model.compare.previous.toLocaleString('en-US')}`
              : null,
          }),
          stat({
            label: 'Per day',
            value: model.perDay < 10 ? Math.round(model.perDay * 10) / 10 : Math.round(model.perDay),
            exact: true,
          }),
          stat({
            label: 'Replies',
            value: model.count ? Math.round((model.replies / model.count) * 100) : 0,
            unit: '%',
            exact: true,
          }),
          stat({
            label: 'With media',
            value: model.count ? Math.round((model.withMedia / model.count) * 100) : 0,
            unit: '%',
            exact: true,
          }),
        ]}
      />

      <div className="an-card">
        <SectionHead
          as="h3"
          title={`Posts per ${unitNoun(model.unit)}`}
          meta={
            <ModeToggle
              value={model.unit}
              onChange={setUnitPick}
              options={model.units.map((u) => ({ key: u, label: unitLabel(u) }))}
            />
          }
        />
        <SeriesChart
          series={model.counts}
          trend={model.trend}
          mode="bars"
          unit={model.unit}
          zeroBase
          ariaLabel={`Posts per ${model.unit} over ${period.label}`}
        />
        <ChartTable series={model.counts} trend={model.trend} unit={model.unit} valueHead="Posts" />
      </div>

      {period.days && (
        <p className="an-note">
          Previous {period.label.toLowerCase()}: {model.compare.previous.toLocaleString('en-US')} posts —{' '}
          {model.compare.delta >= 0 ? `${model.compare.delta.toLocaleString('en-US')} more` : `${Math.abs(model.compare.delta).toLocaleString('en-US')} fewer`}{' '}
          this period. Of the {model.count.toLocaleString('en-US')} in the window: {model.originals.toLocaleString('en-US')} standalone,{' '}
          {model.replies.toLocaleString('en-US')} replies, {model.quotes.toLocaleString('en-US')} quote posts.
        </p>
      )}
    </section>
  );
}

/* ================================================================== */
/* Engagement                                                           */
/* ================================================================== */

function EngagementTab({ archive, did, period, kind, nowMs }) {
  const { posts } = archive;
  const [unitPick, setUnitPick] = useState(null);
  const [rateUnitPick, setRateUnitPick] = useState(null);

  const model = useMemo(() => {
    const dated = posts.map((p) => ({ ...p, atMs: Date.parse(p.at) })).filter((p) => Number.isFinite(p.atMs));
    const oldest = dated.length ? Math.min(...dated.map((p) => p.atMs)) : nowMs;
    const t0 = period.days ? nowMs - period.days * DAY_MS : oldest;
    const spanDays = Math.max(1, Math.round((nowMs - t0) / DAY_MS));
    const units = unitChoicesFor(period.days ?? spanDays);
    const unit = unitPick && units.includes(unitPick) ? unitPick : defaultUnitFor(period.days ?? spanDays);
    const inWindow = dated.filter((p) => p.atMs >= t0 && p.atMs <= nowMs);
    const value = (p) => engagementOf(p, kind);
    const total = inWindow.reduce((sum, p) => sum + value(p), 0);
    const series = bucketSeries(inWindow, { unit, t0, t1: nowMs, pickTime: (p) => p.atMs, pickValue: value });

    // The rate: engagement per post, over the owner's own voice only — top-
    // level posts and threads, never replies to other people.
    const own = dated.filter((p) => isOwnVoicePost(p, did));
    const ownInWindow = own.filter((p) => p.atMs >= t0 && p.atMs <= nowMs);
    const ownTotal = ownInWindow.reduce((sum, p) => sum + value(p), 0);
    const rateUnit =
      rateUnitPick && units.includes(rateUnitPick) ? rateUnitPick : units.includes('week') ? 'week' : unit;
    const rate = rateSeries(ownInWindow, { unit: rateUnit, t0, t1: nowMs, kind });
    return {
      unit,
      units,
      series,
      trend: movingAverage(series, 7),
      total,
      top: topPosts(inWindow, { kind, t0, t1: nowMs, limit: 10 }),
      compare: comparePeriods(dated, { days: period.days || spanDays, now: nowMs, pickTime: (p) => p.atMs, pickValue: value }),
      rateUnit,
      rate,
      rateTrend: rollingRate(rate, 5),
      ownPosts: ownInWindow.length,
      ownRate: ownInWindow.length ? ownTotal / ownInWindow.length : null,
      rateCompare: period.days ? compareRates(own, { days: period.days, now: nowMs, kind }) : null,
    };
  }, [posts, did, period, kind, unitPick, rateUnitPick, nowMs]);

  if (!posts.length) {
    return <p className="an-empty">The post archive is empty — build it from the strip above.</p>;
  }

  const kindLabel = (ENGAGEMENT_KINDS.find((k) => k.key === kind)?.label || 'All').toLowerCase();
  const head = kind === 'all' ? 'Engagement' : `${ENGAGEMENT_KINDS.find((k) => k.key === kind)?.label}`;

  return (
    <section className="an-panel" aria-label="Engagement">
      <Figures
        className="an-figures"
        label="Engagement in figures"
        items={[
          stat({
            label: kind === 'all' ? 'Engagement received' : `${head} received`,
            value: model.total,
            delta: period.days ? model.compare.pct : null,
            deltaTitle: period.days
              ? `on posts from the previous ${period.label.toLowerCase()}: ${model.compare.previous.toLocaleString('en-US')}`
              : null,
          }),
          // Per post is the engagement rate charted below: posts and threads only.
          stat({
            label: 'Per post',
            value: model.ownRate == null ? 0 : Math.round(model.ownRate * 10) / 10,
            exact: true,
            sub: 'posts & threads',
            delta: model.rateCompare ? model.rateCompare.pct : undefined,
            deltaTitle: model.rateCompare
              ? `vs previous ${period.label.toLowerCase()}: ${fmtRate(model.rateCompare.previous)} per post`
              : null,
          }),
          stat({ label: 'Best post', value: model.top.length ? engagementOf(model.top[0], kind) : 0 }),
        ]}
      />

      <div className="an-card">
        <SectionHead
          as="h3"
          title={`${head} by post date`}
          meta={
            <ModeToggle
              value={model.unit}
              onChange={setUnitPick}
              options={model.units.map((u) => ({ key: u, label: unitLabel(u) }))}
            />
          }
        />
        <SeriesChart
          series={model.series}
          trend={model.trend}
          mode="bars"
          unit={model.unit}
          zeroBase
          ariaLabel={`${head} on posts made each ${model.unit}, over ${period.label}`}
        />
        <ChartTable series={model.series} trend={model.trend} unit={model.unit} valueHead={head} />
        <p className="an-card-caption">
          Counted against the day each post was made, with counts as of the last archive sync — a
          bar is “how {kindLabel === 'all' ? 'much engagement' : `many ${kindLabel}`} that {model.unit}’s posts have earned”, not when it arrived.
        </p>
      </div>

      <div className="an-card">
        <SectionHead
          as="h3"
          title={kind === 'all' ? 'Engagement rate' : `${head} per post`}
          meta={
            <ModeToggle
              value={model.rateUnit}
              onChange={setRateUnitPick}
              options={model.units.map((u) => ({ key: u, label: unitLabel(u), title: `Per post, by ${unitNoun(u)}` }))}
            />
          }
        />
        <SeriesChart
          series={model.rate}
          trend={model.rateTrend}
          mode="bars"
          unit={model.rateUnit}
          zeroBase
          format={fmtRate}
          ariaLabel={`${head} per post, by the ${model.rateUnit} each post was made, over ${period.label}`}
        />
        <ChartTable
          series={model.rate}
          secondary={model.rate.map((b) => ({ t: b.t, v: b.posts }))}
          trend={model.rateTrend}
          unit={model.rateUnit}
          valueHead="Per post"
          secondaryHead="Posts"
          format={fmtRate}
        />
        <p className="an-card-caption">
          {kindLabel === 'all' ? 'Engagement' : head} per post, averaged over the posts made each{' '}
          {unitNoun(model.rateUnit)}: your top-level posts and the replies in your own threads, so
          replies to other people don’t pull it down. A gap is a {unitNoun(model.rateUnit)} with
          nothing posted. The trend weighs every post equally, so a busy {unitNoun(model.rateUnit)}{' '}
          counts for more than a quiet one. The newest posts are still collecting engagement, so the
          last bar can run low.
          {model.ownPosts > 0 &&
            ` ${model.ownPosts.toLocaleString('en-US')} ${model.ownPosts === 1 ? 'post' : 'posts'} in this window.`}
        </p>
      </div>

      <div className="an-card">
        <SectionHead as="h3" title="Top posts" />
        {model.top.length === 0 ? (
          <p className="an-empty">No posts in this window.</p>
        ) : (
          <ol className="an-toplist">
            {model.top.map((p) => (
              <TopPostRow key={p.uri} post={p} kind={kind} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

/* ================================================================== */
/* Engagement given                                                     */
/* ================================================================== */

const GIVEN_NOUN = { like: 'likes', repost: 'reposts', reply: 'replies', quote: 'quotes' };

function GivenTab({ archive, did, period, kind, nowMs }) {
  const { posts, outbound, meta } = archive;
  const [unitPick, setUnitPick] = useState(null);

  const model = useMemo(() => {
    const all = [];
    let oldest = Infinity;
    for (const ev of givenEvents(outbound, posts, did)) {
      const atMs = Date.parse(ev.at);
      if (!Number.isFinite(atMs)) continue;
      all.push({ ...ev, atMs });
      if (atMs < oldest) oldest = atMs;
    }
    const t0 = period.days ? nowMs - period.days * DAY_MS : Number.isFinite(oldest) ? oldest : nowMs;
    const spanDays = Math.max(1, Math.round((nowMs - t0) / DAY_MS));
    const units = unitChoicesFor(period.days ?? spanDays);
    const unit = unitPick && units.includes(unitPick) ? unitPick : defaultUnitFor(period.days ?? spanDays);
    const inWindowAll = all.filter((e) => e.atMs >= t0 && e.atMs <= nowMs);
    const byKind = Object.keys(GIVEN_NOUN)
      .map((k) => ({ kind: k, count: inWindowAll.filter((e) => e.kind === k).length }))
      .sort((a, b) => b.count - a.count);
    const events = kind === 'all' ? all : all.filter((e) => e.kind === kind);
    const inWindow = kind === 'all' ? inWindowAll : inWindowAll.filter((e) => e.kind === kind);
    const series = bucketSeries(inWindow, { unit, t0, t1: nowMs, pickTime: (e) => e.atMs });
    return {
      unit,
      units,
      series,
      trend: movingAverage(series, 7),
      total: inWindow.length,
      perDay: inWindow.length / spanDays,
      accounts: new Set(inWindow.map((e) => e.did)).size,
      byKind,
      compare: comparePeriods(events, { days: period.days || spanDays, now: nowMs, pickTime: (e) => e.atMs }),
    };
  }, [posts, outbound, did, period, kind, unitPick, nowMs]);

  if (!posts.length && !outbound.length) {
    return <p className="an-empty">Nothing given on record yet — build the archive from the strip above.</p>;
  }

  const head = kind === 'all' ? 'Engagement' : ENGAGEMENT_KINDS.find((k) => k.key === kind)?.label || 'Engagement';
  // The CAR carries every like and repost ever; only the fallback sweep (when
  // the repo pull failed) stops short, and says how far it reached.
  const coverageMs = meta.outbound?.coverageMs || 0;
  const maxKind = model.byKind[0]?.count || 1;

  return (
    <section className="an-panel" aria-label="Engagement given">
      <Figures
        className="an-figures"
        label="Engagement given in figures"
        items={[
          stat({
            label: `${head} given`,
            value: model.total,
            delta: period.days ? model.compare.pct : null,
            deltaTitle: period.days
              ? `vs previous ${period.label.toLowerCase()}: ${model.compare.previous.toLocaleString('en-US')}`
              : null,
          }),
          stat({
            label: 'Per day',
            value: model.perDay < 10 ? Math.round(model.perDay * 10) / 10 : Math.round(model.perDay),
            exact: true,
          }),
          stat({ label: 'Accounts', value: model.accounts, sub: 'engaged with' }),
        ]}
      />

      <div className="an-card">
        <SectionHead
          as="h3"
          title={`${head} given per ${unitNoun(model.unit)}`}
          meta={
            <ModeToggle
              value={model.unit}
              onChange={setUnitPick}
              options={model.units.map((u) => ({ key: u, label: unitLabel(u) }))}
            />
          }
        />
        <SeriesChart
          series={model.series}
          trend={model.trend}
          mode="bars"
          unit={model.unit}
          zeroBase
          ariaLabel={`${head} given per ${model.unit} over ${period.label}`}
        />
        <ChartTable series={model.series} trend={model.trend} unit={model.unit} valueHead={`${head} given`} />
        <p className="an-card-caption">
          Counted on the day you gave it. Replies and quotes aimed at your own posts are threading,
          not engagement, and are left out.
        </p>
      </div>

      {kind === 'all' && (
        <div className="an-card">
          <SectionHead as="h3" title="By kind" />
          <ol className="an-actors an-collections">
            {model.byKind.map((k) => (
              <li key={k.kind} className="an-actor">
                <span className="an-actor-main">
                  <span className="an-actor-name">{GIVEN_NOUN[k.kind].charAt(0).toUpperCase() + GIVEN_NOUN[k.kind].slice(1)}</span>
                </span>
                <span className="an-actor-track" aria-hidden="true">
                  <span className="an-actor-fill" style={{ width: `${(k.count / maxKind) * 100}%` }} />
                </span>
                <span className="an-actor-count">{k.count.toLocaleString('en-US')}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="an-note">
        Likes and reposts come from your repo archive
        {coverageMs > 0
          ? `, which reaches back to ${formatDateShort(coverageMs)} so far`
          : ' — every one you have ever made'}
        ; replies and quotes from the post archive. Who you engage with most is on the People tab.
      </p>
    </section>
  );
}

function TopPostRow({ post, kind }) {
  const href = `https://bsky.app/profile/${encodeURIComponent(ME_HANDLE)}/post/${encodeURIComponent(post.rkey)}`;
  const text = post.text.trim() || (post.hasMedia ? '(media post)' : post.quoteOf ? '(quote post)' : '(no text)');
  return (
    <li className="an-toprow">
      <div className="an-toprow-main">
        {/* The arrow rides the meta line, not the clamped text — an inline
            SVG at the end of a two-line clamp wraps onto a line of its own. */}
        <a className="an-toprow-text" href={href} target="_blank" rel="noopener noreferrer" title="Open on Bluesky">
          {text}
        </a>
        <span className="an-toprow-meta">
          {formatDateShort(post.at)}
          {post.replyTo ? ' · reply' : ''}
          {post.quoteOf ? ' · quote' : ''}
          <ArrowUpRight className="an-toprow-out" size={12} aria-hidden="true" />
        </span>
      </div>
      <span className="an-toprow-counts">
        <KindCount glyph={Heart} label="likes" value={post.likes} dim={kind !== 'all' && kind !== 'like'} />
        <KindCount glyph={Repeat2} label="reposts" value={post.reposts} dim={kind !== 'all' && kind !== 'repost'} />
        <KindCount glyph={MessageCircle} label="replies" value={post.replies} dim={kind !== 'all' && kind !== 'reply'} />
        <KindCount glyph={Quote} label="quotes" value={post.quotes} dim={kind !== 'all' && kind !== 'quote'} />
      </span>
    </li>
  );
}

function KindCount({ glyph: Glyph, label, value, dim }) {
  return (
    <span className={`an-kindcount${dim ? ' is-dim' : ''}`} title={`${value.toLocaleString('en-US')} ${label}`}>
      <Glyph size={12} aria-hidden="true" />
      <span aria-label={label}>{fmtCompact(value)}</span>
    </span>
  );
}

/* ================================================================== */
/* People                                                               */
/* ================================================================== */

function PeopleTab({ archive, did, period, kind, relation, nowMs }) {
  const { posts, inbound, outbound, followers, following, actors, wantActors, setFollow, sync } = archive;
  const followsKnown = Boolean(archive.meta.following);
  const [limits, setLimits] = useState({ in: PEOPLE_PAGE, out: PEOPLE_PAGE });
  // did → { busy, error } for the Follow buttons pressed this visit.
  const [pending, setPending] = useState(() => new Map());
  // People followed or unfollowed under the current relationship filter stay
  // in its list until the filter changes: following someone from "Not
  // following" leaves their row in place, now reading Following, rather than
  // snatching it away with the undo under it.
  const [kept, setKept] = useState(() => ({ relation, dids: new Set() }));
  const keptDids = kept.relation === relation ? kept.dids : null;

  const followingSet = useMemo(() => new Set(following.map((f) => f.did)), [following]);
  const followerSet = useMemo(() => new Set(followers.map((f) => f.did)), [followers]);

  const model = useMemo(() => {
    const t1 = nowMs;
    const windowFor = (events) => {
      if (period.days) return nowMs - period.days * DAY_MS;
      const oldest = oldestEventMs(events);
      return oldest ?? nowMs;
    };
    // The relationship filter runs BEFORE the cut to a page, so "Not
    // following" shows the top people you don't follow — not whichever of
    // the overall top twelve happen not to be followed.
    const keep = (row) =>
      keptDids?.has(row.did) ||
      (relation === 'not' ? !followingSet.has(row.did) : relation === 'following' ? followingSet.has(row.did) : true);
    const outboundAll = [...outbound, ...outboundFromPosts(posts)];
    const inT0 = windowFor(inbound);
    const outT0 = windowFor(outboundAll);
    const inAll = topActors(inbound, { kind, t0: inT0, t1, limit: Infinity, excludeDid: did });
    const outAll = topActors(outboundAll, { kind, t0: outT0, t1, limit: Infinity, excludeDid: did });
    return {
      inRanked: inAll.filter(keep),
      outRanked: outAll.filter(keep),
      inAny: inAll.length > 0,
      outAny: outAll.length > 0,
      // Of everyone in the window, how many the owner doesn't follow yet.
      inNotFollowing: inAll.filter((r) => !followingSet.has(r.did)).length,
      inOldest: oldestEventMs(inbound),
      inT0,
    };
  }, [posts, inbound, outbound, period, kind, relation, followingSet, keptDids, did, nowMs]);

  const inTop = useMemo(() => model.inRanked.slice(0, limits.in), [model, limits.in]);
  const outTop = useMemo(
    () => (kind === 'mention' ? [] : model.outRanked.slice(0, limits.out)),
    [model, kind, limits.out],
  );

  // Resolve the faces this render actually shows — two getProfiles calls at
  // most, cached in the actors store afterwards.
  const wanted = useMemo(
    () => [...inTop, ...outTop].map((r) => r.did).filter((d) => !actors.get(d)?.handle),
    [inTop, outTop, actors],
  );
  useEffect(() => {
    if (wanted.length) wantActors(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted.join('|')]);

  const followerCards = useMemo(() => new Map(followers.map((f) => [f.did, f])), [followers]);
  const cardFor = (actorDid) => actors.get(actorDid) || followerCards.get(actorDid) || null;

  // While the sync is re-reading the follows, a button pressed now could be
  // overwritten by the read already in flight; hold them for that second.
  const followsLocked = sync?.step === 'following';

  async function toggleFollow(actorDid) {
    const on = !followingSet.has(actorDid);
    setPending((m) => new Map(m).set(actorDid, { busy: true, error: null }));
    try {
      await setFollow(actorDid, on);
      setKept((k) => ({ relation, dids: new Set(k.relation === relation ? k.dids : []).add(actorDid) }));
      setPending((m) => {
        const next = new Map(m);
        next.delete(actorDid);
        return next;
      });
    } catch (err) {
      setPending((m) =>
        new Map(m).set(actorDid, {
          busy: false,
          error: `Couldn’t ${on ? 'follow' : 'unfollow'}: ${err?.message || String(err)}`,
        }),
      );
    }
  }

  const relationFor = (actorDid) => ({
    following: followsKnown ? followingSet.has(actorDid) : null,
    followsYou: followerSet.has(actorDid),
    busy: followsLocked || Boolean(pending.get(actorDid)?.busy),
    error: pending.get(actorDid)?.error || null,
  });

  const inCoverage =
    model.inOldest != null && period.days && model.inOldest > model.inT0
      ? `Notification history reaches back to ${formatDateShort(model.inOldest)} so far — earlier ${period.label.toLowerCase()} events are outside it.`
      : null;

  // A filtered list is only "everyone's followed" when there was someone in
  // it to begin with; an empty window says so in its own words.
  const emptyFor = (side) =>
    relation === 'not' && (side === 'in' ? model.inAny : model.outAny)
      ? side === 'in'
        ? 'You already follow everyone who engaged with you in this window.'
        : 'You already follow everyone you engaged with in this window.'
      : relation === 'following' && (side === 'in' ? model.inAny : model.outAny)
        ? 'Nobody you follow in this window.'
        : side === 'in'
          ? 'No inbound engagement recorded in this window yet — sync to gather notifications.'
          : 'No outbound engagement in this window — likes, reposts, replies and quotes land here after a sync.';

  return (
    <section className="an-panel" aria-label="People">
      <div className="an-people">
        <div className="an-card">
          <SectionHead
            as="h3"
            title={
              <>
                <MessagesSquare size={18} aria-hidden="true" className="an-card-glyph" />
                They engage with you
              </>
            }
            meta={
              followsKnown && relation !== 'not' && model.inNotFollowing > 0
                ? `${model.inNotFollowing.toLocaleString('en-US')} you don’t follow`
                : null
            }
          />
          <ActorList
            rows={inTop}
            cardFor={cardFor}
            relationFor={relationFor}
            onToggleFollow={toggleFollow}
            empty={emptyFor('in')}
          />
          <MoreButton
            shown={inTop.length}
            total={model.inRanked.length}
            onMore={() => setLimits((l) => ({ ...l, in: l.in + PEOPLE_PAGE }))}
          />
          {inCoverage && <p className="an-card-caption">{inCoverage}</p>}
        </div>
        <div className="an-card">
          <SectionHead
            as="h3"
            title={
              <>
                <Heart size={18} aria-hidden="true" className="an-card-glyph" />
                You engage with them
              </>
            }
          />
          {kind === 'mention' ? (
            <p className="an-empty">Mentions are tracked inbound only.</p>
          ) : (
            <>
              <ActorList
                rows={outTop}
                cardFor={cardFor}
                relationFor={relationFor}
                onToggleFollow={toggleFollow}
                empty={emptyFor('out')}
              />
              <MoreButton
                shown={outTop.length}
                total={model.outRanked.length}
                onMore={() => setLimits((l) => ({ ...l, out: l.out + PEOPLE_PAGE }))}
              />
            </>
          )}
        </div>
      </div>
      <p className="an-note">
        Inbound counts come from notifications (likes, reposts, replies, quotes, mentions aimed at
        you); outbound counts from the repo archive&rsquo;s complete like and repost history plus
        the replies and quotes in the post archive.{' '}
        {followsKnown
          ? 'Following is read from the follow records in your own repo at each sync; Follow writes one there, and pressing Following again deletes it.'
          : 'Who you follow arrives with the next sync; until then there are no Follow buttons, so none can follow someone twice.'}
      </p>
    </section>
  );
}

function MoreButton({ shown, total, onMore }) {
  if (total <= shown) return null;
  const next = Math.min(PEOPLE_PAGE, total - shown);
  return (
    <div className="an-more">
      <Button size="sm" variant="text" onClick={onMore}>
        Show {next} more
      </Button>
      <span className="an-more-count">
        {shown.toLocaleString('en-US')} of {total.toLocaleString('en-US')}
      </span>
    </div>
  );
}

function ActorList({ rows, cardFor, relationFor = null, onToggleFollow = null, empty }) {
  if (!rows.length) return <p className="an-empty">{empty}</p>;
  const max = rows[0]?.total || 1;
  return (
    <ol className="an-actors">
      {rows.map((row) => {
        const card = cardFor(row.did);
        const name = card?.displayName || card?.handle || row.did;
        const href = `https://bsky.app/profile/${encodeURIComponent(card?.handle || row.did)}`;
        const detail = Object.entries(row.byKind)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`)
          .join(', ');
        const rel = relationFor ? relationFor(row.did) : null;
        return (
          <li key={row.did} className={`an-actor${rel ? ' an-actor--follow' : ''}`}>
            {card?.avatar ? (
              <img className="an-actor-avatar" src={card.avatar} alt="" loading="lazy" />
            ) : (
              <span className="an-actor-avatar an-actor-avatar-empty" aria-hidden="true" />
            )}
            <span className="an-actor-main">
              <a className="an-actor-name" href={href} target="_blank" rel="noopener noreferrer">
                {name}
              </a>
              {(card?.handle || rel?.followsYou) && (
                <span className="an-actor-handle">
                  {card?.handle && `@${card.handle}`}
                  {card?.handle && rel?.followsYou && ' · '}
                  {rel?.followsYou && <span className="an-actor-rel">follows you</span>}
                </span>
              )}
              {rel?.error && (
                <span className="an-actor-error" role="alert">
                  {rel.error}
                </span>
              )}
            </span>
            <span className="an-actor-track" aria-hidden="true">
              <span className="an-actor-fill" style={{ width: `${(row.total / max) * 100}%` }} />
            </span>
            <span className="an-actor-count" title={detail}>
              {row.total.toLocaleString('en-US')}
            </span>
            {rel && (
              <span className="an-actor-action">
                {rel.following == null ? null : (
                  <Button
                    size="sm"
                    on={rel.following}
                    disabled={rel.busy}
                    aria-busy={rel.busy || undefined}
                    title={rel.following ? `Unfollow ${name}` : `Follow ${name}`}
                    onClick={() => onToggleFollow?.(row.did)}
                  >
                    {rel.following ? 'Following' : 'Follow'}
                    <span className="visually-hidden"> {name}</span>
                  </Button>
                )}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ================================================================== */
/* Atmosphere                                                           */
/* ================================================================== */

function AtmosphereTab({ archive, period, nowMs }) {
  const { atmosphere, meta, sync } = archive;
  const [unitPick, setUnitPick] = useState(null);

  const model = useMemo(() => {
    if (!atmosphere.length) return null;
    let oldest = Infinity;
    for (const r of atmosphere) if (r.at < oldest) oldest = r.at;
    const t0 = period.days ? nowMs - period.days * DAY_MS : oldest;
    const spanDays = Math.max(1, Math.round((nowMs - t0) / DAY_MS));
    const units = unitChoicesFor(period.days ?? spanDays);
    const unit = unitPick && units.includes(unitPick) ? unitPick : defaultUnitFor(period.days ?? spanDays);
    const inWindow = atmosphere.filter((r) => r.at >= t0 && r.at <= nowMs);
    const byCollection = new Map();
    for (const r of inWindow) byCollection.set(r.collection, (byCollection.get(r.collection) || 0) + 1);
    const ranked = [...byCollection.entries()]
      .map(([collection, count]) => ({ collection, count }))
      .sort((a, b) => b.count - a.count || (a.collection < b.collection ? -1 : 1));
    const series = bucketSeries(inWindow, { unit, t0, t1: nowMs, pickTime: (r) => r.at });
    return {
      unit,
      units,
      series,
      trend: movingAverage(series, 7),
      total: inWindow.length,
      collections: ranked.length,
      ranked: ranked.slice(0, 24),
      rankedMore: Math.max(0, ranked.length - 24),
      spanDays,
    };
  }, [atmosphere, period, unitPick, nowMs]);

  if (!model) {
    // No repo archive yet — either it is being pulled right now, or the
    // last pull failed and the sync error in the strip says why.
    return (
      <section className="an-panel an-first" aria-labelledby="an-atmo-head">
        <SectionHead id="an-atmo-head" title="The whole repo, not just Bluesky" />
        <p className="an-hero-body">
          One sync downloads the repo&rsquo;s own archive — every record in every collection, back
          to the very first — and charts what got written when.
          {sync ? ' Syncing now…' : ' Run a sync to build it.'}
        </p>
        {!sync && (
          <div>
            <Button variant="primary" onClick={() => archive.runSync('incremental')}>
              Sync now
            </Button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="an-panel" aria-label="Atmosphere">
      <Figures
        className="an-figures"
        label="The repo in figures"
        items={[
          stat({ label: `Records in ${period.label.toLowerCase()}`, value: model.total }),
          stat({ label: 'Collections', value: model.collections, exact: true }),
          stat({
            label: 'Per day',
            value:
              model.total / model.spanDays < 10
                ? Math.round((model.total / model.spanDays) * 10) / 10
                : Math.round(model.total / model.spanDays),
            exact: true,
          }),
        ]}
      />

      <div className="an-card">
        <SectionHead
          as="h3"
          title={`Records written per ${unitNoun(model.unit)}`}
          meta={
            <ModeToggle
              value={model.unit}
              onChange={setUnitPick}
              options={model.units.map((u) => ({ key: u, label: unitLabel(u) }))}
            />
          }
        />
        <SeriesChart
          series={model.series}
          trend={model.trend}
          mode="bars"
          unit={model.unit}
          zeroBase
          ariaLabel={`Records written to the repo per ${model.unit} over ${period.label}`}
        />
        <ChartTable series={model.series} trend={model.trend} unit={model.unit} valueHead="Records" />
      </div>

      <div className="an-card">
        <SectionHead as="h3" title="By collection" />
        {model.ranked.length === 0 && <p className="an-empty">No records written in this window.</p>}
        <ol className="an-actors an-collections">
          {model.ranked.map((c) => {
            const max = model.ranked[0]?.count || 1;
            return (
              <li key={c.collection} className="an-actor">
                <span className="an-actor-main">
                  <code className="an-collection-nsid">{c.collection}</code>
                </span>
                <span className="an-actor-track" aria-hidden="true">
                  <span className="an-actor-fill" style={{ width: `${(c.count / max) * 100}%` }} />
                </span>
                <span className="an-actor-count">{c.count.toLocaleString('en-US')}</span>
              </li>
            );
          })}
        </ol>
        {model.rankedMore > 0 && (
          <p className="an-card-caption">…and {model.rankedMore} more collections with fewer records in this window.</p>
        )}
      </div>
      <p className="an-note">
        From the repo archive — every record in every collection, exact and all-time, dated by
        record key (falling back to the record&rsquo;s own createdAt; the rare record with neither
        is left out). Pulled from your PDS {relativeTime(meta.repo?.syncedAt)}; syncs top it up
        from the repo&rsquo;s revision log.
      </p>
    </section>
  );
}

/* ================================================================== */
/* Shared pieces — tiles, toggles, the chart                            */
/* ================================================================== */

/**
 * One figure for the kit's Figures band: the label above, the number on the
 * shared baseline, and a note under it carrying the qualifier (`sub`) and the
 * change against the previous window (`delta`).
 *
 * A compact number ("1.2K") keeps the exact one as its tooltip. A delta renders
 * whenever a comparison exists (deltaTitle names it); a null delta inside one
 * is the "new" case, since something over nothing has no honest percentage.
 * No comparison, no delta at all.
 */
function stat({ label, value, unit = null, delta = undefined, deltaTitle = null, sub = null, exact = false, approx = false }) {
  const full = Number(value).toLocaleString('en-US');
  const shown = exact ? full : fmtCompact(value);
  const hasDelta = deltaTitle != null;
  const direction = delta != null && delta > 0 ? ' is-up' : delta != null && delta < 0 ? ' is-down' : '';
  return {
    key: label,
    label,
    value: (
      <span title={exact ? undefined : full}>
        {approx ? '~' : ''}
        {shown}
        {unit && <span className="an-fig-unit">{unit}</span>}
      </span>
    ),
    note:
      sub || hasDelta ? (
        <>
          {sub}
          {sub && hasDelta && ' · '}
          {hasDelta && (
            <span className={`an-fig-delta${direction}`} title={deltaTitle}>
              {fmtDelta(delta)}
            </span>
          )}
        </>
      ) : null,
  };
}

/**
 * A chart's own switch: the kit's Segmented. The keys are one short word each
 * — Total, Stack, Both, Daily — so a chart's whole switch fits one row on a
 * phone; each key's tooltip says it in full.
 */
function ModeToggle({ value, onChange, options, label = 'Chart' }) {
  return (
    <Segmented
      label={label}
      value={value}
      onChange={onChange}
      options={options.map((o) => ({ value: o.key, label: o.label, title: o.title }))}
    />
  );
}

const MODE_TOTAL = { key: 'cumulative', label: 'Total', title: 'Running total over the window' };
const MODE_STACK = { key: 'stacked', label: 'Stack', title: 'Running total, stacked by direct blocks and moderation lists' };
const MODE_BOTH = { key: 'together', label: 'Both' };

/** "New followers per week", for a unit key's tooltip. */
function unitTitle(unit, noun) {
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} per ${unitNoun(unit)}`;
}

function unitLabel(unit) {
  return unit === 'month' ? 'Monthly' : unit === 'week' ? 'Weekly' : 'Daily';
}

/** The noun form, for card titles: "Posts per day", never "per daily". */
function unitNoun(unit) {
  return unit === 'month' ? 'month' : unit === 'week' ? 'week' : 'day';
}

const CHART_H = 190;
const PAD = { l: 8, r: 12, t: 18, b: 20 };
/**
 * Horizontal room for the ghost's reach past the last bucket. Narrow on
 * purpose: the reach must read as a step UP at the edge of now, not as a
 * projection ambling into future time — the time axis itself stops under the
 * real curve's end (the x-axis row is padded by this same amount), so the
 * ghost visibly stands past the end of time rather than extending it.
 */
const GHOST_GUTTER = 28;

/**
 * The one chart. `mode: 'bars'` draws columns from a zero baseline with a 2px
 * surface gap; `mode: 'line'` draws a 2px line over a 10%-opacity wash (the
 * cumulative view). `trend` overlays a moving average with a direct end
 * label. `secondary` overlays a second line for same-bucket comparisons.
 * With `stacked`, that second series is treated as an additive layer rather
 * than another absolute line.
 * Hover is a nearest-X crosshair with one readout — the same
 * interaction on both forms — and the values are all reachable without it
 * through the ChartTable twin rendered alongside.
 *
 * `ghost` (line mode only) draws a dashed reach from the line's end up to a
 * reference value the line itself cannot arrive at — the followers chart
 * uses it for Bluesky's profile counter, which still includes deactivated
 * and suspended accounts the swept curve cannot see. Dashed and in faint
 * ink on purpose: it is a simulation, not a measurement, and it must never
 * dress like the data. `{ v, label }`.
 *
 * `format` writes a value for the readout and the table — a rate wants a
 * decimal, and a bucket with no value (null: nothing posted that week) wants
 * words, not a zero. Null points draw no bar and break the trend line.
 */
function SeriesChart({
  series,
  seriesLabel = null,
  secondary = null,
  stacked = false,
  trend = null,
  mode = 'bars',
  unit = 'day',
  zeroBase = true,
  ghost = null,
  format = null,
  ariaLabel,
}) {
  const fmt = format || fmtCount;
  const plotRef = useRef(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState(null);

  // Real pixels (measured width, fixed height), exactly as StateStats draws:
  // uniform scaling keeps the dots circular and the hairlines hairlines.
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return undefined;
    const measure = () => setW(el.clientWidth || 0);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => ro?.disconnect();
  }, []);

  if (!series || series.length === 0) {
    return <p className="an-empty">Nothing in this window.</p>;
  }

  const H = CHART_H;
  const ready = w > 0;
  const n = series.length;
  const secondarySeries = mode === 'line' && secondary?.series?.length === n ? secondary.series : null;
  const secondaryPlotSeries =
    stacked && secondarySeries
      ? secondarySeries.map((point, index) => ({ ...point, v: point.v + series[index].v }))
      : secondarySeries;
  const showGhost = Boolean(ghost) && mode === 'line' && n > 0;
  // The ghost reaches PAST the last bucket, so the real series cedes it a
  // fixed gutter on the right rather than being silently rescaled under it.
  const gutter = showGhost ? GHOST_GUTTER : 0;
  const values = series.map((p) => p.v);
  const secondaryValues = secondaryPlotSeries ? secondaryPlotSeries.map((p) => p.v) : [];
  const dataMax = Math.max(
    ...values,
    ...secondaryValues,
    trend ? Math.max(...trend.map((p) => p.v ?? 0)) : 0,
    showGhost ? ghost.v : 0,
  );
  const dataMin = Math.min(...values, ...secondaryValues);
  // Bars grow from zero, always. A line (the cumulative view) may sit on a
  // nearby floor instead — a follower count living between 5,500 and 5,935
  // pinned to a zero axis is a flat wire that says nothing.
  const { min: yMin, max: yMax } = niceScale(zeroBase ? 0 : Math.max(0, dataMin), Math.max(dataMax, zeroBase ? 1 : dataMax));
  const ySpan = Math.max(1e-9, yMax - yMin);
  const plotW = Math.max(1, w - PAD.l - PAD.r - gutter);
  const slot = plotW / n;
  const x = (i) => PAD.l + slot * (i + 0.5);
  const y = (v) => H - PAD.b - ((v - yMin) / ySpan) * (H - PAD.t - PAD.b);
  const baseY = H - PAD.b;

  // Bars: ≤24px thick, 2px surface gap between neighbours, never negative.
  const barW = Math.max(1, Math.min(24, slot - 2));
  const ticks = uniqueTicks([yMax, (yMax + yMin) / 2, yMin]);

  function onMove(e) {
    if (!ready || !plotRef.current) return;
    const rect = plotRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.min(n - 1, Math.max(0, Math.round((px - PAD.l) / slot - 0.5)));
    setHover(i);
  }

  const hp = hover != null && series[hover] ? { ...series[hover], i: hover } : null;
  const secondaryHp = hover != null && secondarySeries?.[hover] ? secondarySeries[hover] : null;
  const secondaryPlotHp =
    hover != null && secondaryPlotSeries?.[hover] ? secondaryPlotSeries[hover] : null;
  const line = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)},${baseY} ${series.map((p, i) => `L${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} L${x(n - 1).toFixed(1)},${baseY} Z`;
  const secondaryLine = secondaryPlotSeries
    ? secondaryPlotSeries.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
    : null;
  const stackedArea =
    stacked && secondaryPlotSeries
      ? `${secondaryPlotSeries
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`)
          .join(' ')} ${series
          .map((p, i) => ({ p, i }))
          .reverse()
          .map(({ p, i }) => `L${x(i).toFixed(1)},${y(p.v).toFixed(1)}`)
          .join(' ')} Z`
      : null;
  // A trend point with no value (a window with nothing in it) breaks the
  // line; the next real point starts a new run rather than diving to zero.
  const trendPath = trend
    ? trend
        .map((p, i) => {
          if (p.v == null) return '';
          const move = i === 0 || trend[i - 1].v == null ? 'M' : 'L';
          return `${move}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`;
        })
        .filter(Boolean)
        .join(' ')
    : null;
  const trendEnd = trend ? trend.findLastIndex((p) => p.v != null) : -1;

  return (
    <div className="an-chart">
      {secondarySeries && (
        <div className="an-chart-legend" aria-hidden="true">
          <span><i className="an-chart-legend-primary" />{seriesLabel || 'Primary'}</span>
          <span><i className="an-chart-legend-secondary" />{secondary.label || 'Secondary'}</span>
        </div>
      )}
      <div className="an-chart-plot" ref={plotRef} style={{ height: H }}>
        {ready && (
          <svg
            className="an-chart-svg"
            width={w}
            height={H}
            viewBox={`0 0 ${w} ${H}`}
            role="img"
            aria-label={`${ariaLabel || 'Series'}: ${n} ${unit} buckets, peak ${fmt(dataMax)}${showGhost ? `; dashed reference reaching ${Math.round(ghost.v).toLocaleString('en-US')}` : ''}`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line className="an-chart-grid" x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} />
                <text className="an-chart-ylabel" x={PAD.l + 1} y={y(v) - 3}>
                  {fmtTick(v)}
                </text>
              </g>
            ))}

            {/* Square-cornered on purpose: the whole site draws at radius 0,
                and a chart is not the place the system softens. */}
            {mode === 'bars' &&
              series.map((p, i) =>
                p.v != null && p.v > 0 ? (
                  <rect
                    key={p.t}
                    className={`an-chart-bar${hover === i ? ' is-hover' : ''}`}
                    x={(x(i) - barW / 2).toFixed(1)}
                    y={y(p.v).toFixed(1)}
                    width={barW.toFixed(1)}
                    height={(baseY - y(p.v)).toFixed(1)}
                  />
                ) : null,
              )}

            {mode === 'line' && (
              <>
                {(!secondarySeries || stacked) && <path className="an-chart-area" d={area} />}
                {stackedArea && <path className="an-chart-area-secondary" d={stackedArea} />}
                <path className="an-chart-line" d={line} />
                <circle className="an-chart-dot" cx={x(n - 1)} cy={y(series[n - 1].v)} r="3.4" />
                {secondaryLine && (
                  <>
                    <path className="an-chart-line-secondary" d={secondaryLine} />
                    <circle className="an-chart-dot-secondary" cx={x(n - 1)} cy={y(secondaryPlotSeries[n - 1].v)} r="3.4" />
                  </>
                )}
              </>
            )}

            {showGhost &&
              (() => {
                const gx0 = x(n - 1);
                const gy0 = y(series[n - 1].v);
                const gx1 = w - PAD.r - 4;
                const gy1 = y(ghost.v);
                // The label rides above the open dot, or below it when the
                // dot is already brushing the top of the plot.
                const labelY = gy1 - 8 < 12 ? gy1 + 16 : gy1 - 8;
                return (
                  <g>
                    {/* The same wash the measured curve carries, continued
                        under the dashed cap — the reach completes the shape
                        instead of floating over blank ground; the dashed
                        edge and open dot are what keep saying "simulated". */}
                    <path
                      className="an-chart-area"
                      d={`M${gx0.toFixed(1)},${baseY} L${gx0.toFixed(1)},${gy0.toFixed(1)} L${gx1.toFixed(1)},${gy1.toFixed(1)} L${gx1.toFixed(1)},${baseY} Z`}
                    />
                    <path
                      className="an-chart-ghost"
                      d={`M${gx0.toFixed(1)},${gy0.toFixed(1)} L${gx1.toFixed(1)},${gy1.toFixed(1)}`}
                    />
                    <circle className="an-chart-ghost-dot" cx={gx1} cy={gy1} r="3.4" />
                    <text className="an-chart-ghost-label" x={gx1} y={labelY} textAnchor="end">
                      {ghost.label || fmtCompact(ghost.v)}
                    </text>
                  </g>
                );
              })()}

            {trendPath && trendEnd >= 0 && (
              <>
                <path className="an-chart-trend" d={trendPath} />
                <text
                  className="an-chart-trendlabel"
                  x={Math.min(x(trendEnd) + 4, w - PAD.r)}
                  y={y(trend[trendEnd].v) - 4}
                  textAnchor="end"
                >
                  trend
                </text>
              </>
            )}

            {hp && (
              <g>
                <line className="an-chart-cross" x1={x(hp.i)} x2={x(hp.i)} y1={PAD.t - 6} y2={baseY} />
                {mode === 'line' && <circle className="an-chart-marker" cx={x(hp.i)} cy={y(hp.v)} r="4" />}
                {secondaryPlotHp && <circle className="an-chart-marker-secondary" cx={x(hp.i)} cy={y(secondaryPlotHp.v)} r="4" />}
              </g>
            )}
          </svg>
        )}

        {hp && (
          <div
            className="an-chart-tip"
            style={{ left: clamp(x(hp.i), 40, w - 40), top: Math.max(PAD.t, y(hp.v)) }}
          >
            <strong>{seriesLabel && `${seriesLabel} `}{fmt(hp.v)}</strong>
            {secondaryHp && (
              <strong className="an-chart-tip-secondary">
                {secondary.label} {Math.round(secondaryHp.v).toLocaleString('en-US')}
              </strong>
            )}
            {stacked && secondaryPlotHp && (
              <strong>
                Total {Math.round(secondaryPlotHp.v).toLocaleString('en-US')}
              </strong>
            )}
            <span className="an-chart-tip-when">{bucketLabel(hp.t, unit)}</span>
            {trend && trend[hp.i]?.v != null && (
              <span className="an-chart-tip-trend">trend {fmt(trend[hp.i].v)}</span>
            )}
          </div>
        )}
      </div>
      {/* Padded by the ghost's gutter so the last date sits under the real
          curve's end — the axis stops where measured time stops, and the
          ghost visibly stands past it. */}
      <div className="an-chart-xaxis" aria-hidden="true" style={gutter ? { paddingRight: gutter } : undefined}>
        <span>{bucketLabel(series[0].t, unit)}</span>
        {/* A midpoint stop, once there are enough buckets that three labels
            read as an axis rather than a crowd. */}
        {n >= 5 && <span>{bucketLabel(series[Math.floor((n - 1) / 2)].t, unit)}</span>}
        <span>{bucketLabel(series[n - 1].t, unit)}</span>
      </div>
    </div>
  );
}

/**
 * A clean axis around [min, max]: pick a 1/2/2.5/5×10ⁿ step near a quarter of
 * the span, then floor/ceil the bounds onto it. Bars pass min=0 and keep it
 * (0 floors to 0); lines get a floor near their data instead of a flat wire
 * pinned to zero.
 */
function niceScale(min, max) {
  if (max <= min) max = min + 1;
  const rawStep = (max - min) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= rawStep) || 10 * mag;
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}

function uniqueTicks(list) {
  const out = [];
  for (const v of list) {
    const r = Math.round(v * 100) / 100;
    if (!out.includes(r)) out.push(r);
  }
  // Counts are integers; a fractional midpoint (0.5 on a 0–1 axis) would
  // round to a duplicate of a neighbour and read as a doubled label.
  return out.filter((v) => Number.isInteger(v) || v >= 10);
}

/** Axis-tick formatting — compact like the tiles, but honest about halves. */
function fmtTick(v) {
  return Number.isInteger(v) ? fmtCompact(v) : String(Math.round(v * 10) / 10);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** A count as the charts write it: whole, with thousands separators. */
function fmtCount(v) {
  return v == null ? '—' : Math.round(v).toLocaleString('en-US');
}

/** A rate (engagement per post): one decimal while small; words for none. */
function fmtRate(v) {
  if (v == null) return 'no posts';
  return v < 10 ? (Math.round(v * 10) / 10).toLocaleString('en-US') : Math.round(v).toLocaleString('en-US');
}

/** Every chart's plain twin — the same buckets as a real table. */
function ChartTable({ series, secondary = null, trend = null, unit, valueHead, secondaryHead = null, format = fmtCount }) {
  if (!series || series.length === 0) return null;
  return (
    <details className="an-tableview">
      <summary>As table</summary>
      <div className="an-tableview-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{unit === 'month' ? 'Month' : unit === 'week' ? 'Week' : 'Day'}</th>
              <th scope="col">{valueHead}</th>
              {secondary && <th scope="col">{secondaryHead || 'Compared series'}</th>}
              {trend && <th scope="col">Trend</th>}
            </tr>
          </thead>
          <tbody>
            {series.map((p, i) => (
              <tr key={p.t}>
                <th scope="row">{bucketLabel(p.t, unit)}</th>
                <td>{format(p.v)}</td>
                {secondary && <td>{fmtCount(secondary[i]?.v ?? 0)}</td>}
                {trend && <td>{trend[i]?.v == null ? '—' : format(trend[i].v)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
