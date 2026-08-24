// The Analytics studio — /admin?view=analytics. Follower growth, posting
// trends, engagement, the people behind it, and the whole repo's pulse.
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
  Heart,
  MessageCircle,
  MessagesSquare,
  Quote,
  Repeat2,
  Users,
} from 'lucide-react';
import { ME_HANDLE } from '../config.js';
import { getProfile } from '../lib/atproto.js';
import {
  ANALYTICS_PERIODS,
  ENGAGEMENT_KINDS,
  EVENT_KINDS,
  bucketLabel,
  bucketSeries,
  comparePeriods,
  cumulativeSeries,
  defaultUnitFor,
  engagementOf,
  fmtCompact,
  fmtDelta,
  movingAverage,
  oldestEventMs,
  outboundFromPosts,
  topActors,
  topPosts,
  unitChoicesFor,
} from '../lib/analytics.js';
import { openAnalyticsStore } from '../lib/analyticsStore.js';
import {
  hydrateActors,
  sweepAtmosphere,
  sweepFollowers,
  sweepInbound,
  sweepOutbound,
  sweepPosts,
} from '../lib/analyticsSync.js';
import { formatDateShort, relativeTime } from '../lib/time.js';
import './AnalyticsStudio.css';

const DAY_MS = 86_400_000;

/** Sweeps re-run silently when the archive is older than this. */
const AUTO_SYNC_AFTER_MS = 60 * 60 * 1000;

/** Recent posts get their engagement counts refreshed on every sync. */
const REHYDRATE_DAYS = 30;

/** How far back the event sweeps ever dig. Matches the longest dated period. */
const EVENT_DEPTH_DAYS = 365;

/** The atmosphere scan's widest window — it pages live, so it stays bounded. */
const ATMOSPHERE_MAX_DAYS = 90;

const TABS = [
  { key: 'followers', label: 'Followers' },
  { key: 'posts', label: 'Posts' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'people', label: 'People' },
  { key: 'atmosphere', label: 'Atmosphere' },
];

export default function AnalyticsStudio({ agent, did }) {
  const archive = useAnalyticsArchive(agent, did);
  const [tab, setTab] = useState('followers');
  const [periodKey, setPeriodKey] = useState('30d');
  const [kind, setKind] = useState('all');

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
          <nav className="an-tabs" aria-label="Analytics sections">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`an-tab${tab === t.key ? ' is-active' : ''}`}
                aria-current={tab === t.key ? 'true' : undefined}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="an-filters">
            <div className="an-chiprow" role="group" aria-label="Period">
              {ANALYTICS_PERIODS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={`an-chip${periodKey === p.key ? ' is-active' : ''}`}
                  aria-pressed={periodKey === p.key}
                  onClick={() => setPeriodKey(p.key)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {showKind && (
              <div className="an-chiprow" role="group" aria-label="Engagement type">
                {kinds.map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    className={`an-chip${kind === k.key ? ' is-active' : ''}`}
                    aria-pressed={kind === k.key}
                    onClick={() => setKind(k.key)}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {tab === 'followers' && <FollowersTab archive={archive} period={period} nowMs={nowMs} />}
          {tab === 'posts' && <PostsTab archive={archive} period={period} nowMs={nowMs} />}
          {tab === 'engagement' && (
            <EngagementTab archive={archive} period={period} kind={kind === 'mention' ? 'all' : kind} nowMs={nowMs} />
          )}
          {tab === 'people' && (
            <PeopleTab archive={archive} did={did} period={period} kind={kind} nowMs={nowMs} />
          )}
          {tab === 'atmosphere' && <AtmosphereTab archive={archive} period={period} nowMs={nowMs} />}
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
    posts: [],
    followers: [],
    inbound: [],
    outbound: [],
    meta: {},
    rev: 0,
  });
  const [actors, setActors] = useState(() => new Map());
  const [sync, setSync] = useState(null); // { phase, fetched, est } while running
  const [syncError, setSyncError] = useState(null);
  const storeRef = useRef(null);
  const abortRef = useRef(null);
  const autoRanRef = useRef(false);
  const attemptedActorsRef = useRef(new Set());

  async function reload(store) {
    const [posts, followers, inbound, outbound, actorRows, pm, fm, im, om] = await Promise.all([
      store.all('posts'),
      store.all('followers'),
      store.all('inbound'),
      store.all('outbound'),
      store.all('actors'),
      store.getMeta('posts'),
      store.getMeta('followers'),
      store.getMeta('inbound'),
      store.getMeta('outbound'),
    ]);
    setActors(new Map(actorRows.map((a) => [a.did, a])));
    setData((prev) => ({
      loaded: true,
      persistent: store.persistent,
      posts,
      followers,
      inbound,
      outbound,
      meta: { posts: pm, followers: fm, inbound: im, outbound: om },
      rev: prev.rev + 1,
    }));
    return { posts, meta: { posts: pm, inbound: im, outbound: om } };
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
    const progress = (phase, est = null) => setSync({ phase, fetched: 0, est });
    const tick = (p) => setSync((s) => (s ? { ...s, fetched: p.fetched } : s));

    try {
      /* Followers — always the full set; only a full set can see unfollows. */
      progress('followers', data.meta.followers?.count ?? null);
      const fw = await sweepFollowers(agent, did, { signal: ac.signal, onProgress: tick });
      if (fw.complete) {
        await store.clear('followers');
        await store.putAll('followers', fw.followers);
        await store.setMeta('followers', { syncedAt: startedAt, count: fw.followers.length, complete: true });
      } else if (fw.error) {
        errors.push(`followers: ${fw.error}`);
      }
      if (ac.signal.aborted) return;

      /* Posts */
      const postsMeta = data.meta.posts;
      const full = mode === 'full' || !postsMeta;
      const resume = mode === 'resume' && postsMeta && !postsMeta.complete && postsMeta.cursor;
      let est = data.posts.length || null;
      if (full || resume) {
        const prof = await getProfile(did).catch(() => null);
        if (prof?.postsCount) est = prof.postsCount;
      }
      if (full) {
        await store.clear('posts');
      }
      progress('posts', est);
      const known = full || resume ? null : new Set(data.posts.map((p) => p.uri));
      const ps = await sweepPosts({
        did,
        knownUris: known,
        rehydrateSinceMs: full || resume ? -Infinity : startedAt - REHYDRATE_DAYS * DAY_MS,
        resumeCursor: resume ? postsMeta.cursor : null,
        signal: ac.signal,
        onPage: (rows) => store.putAll('posts', rows),
        onProgress: tick,
      });
      if (ps.error) errors.push(`posts: ${ps.error}`);
      if (full || resume) {
        // Checkpoint the cursor so an interrupted build resumes, not restarts.
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

      progress('inbound');
      const im = data.meta.inbound;
      const inb = await sweepInbound(agent, {
        cutoffMs,
        knownUris: new Set(data.inbound.map((e) => e.uri)),
        coveredToMs: im?.coverageMs ?? null,
        signal: ac.signal,
        onPage: (rows) => store.putAll('inbound', rows),
        onProgress: tick,
      });
      if (inb.error) errors.push(`inbound: ${inb.error}`);
      else if (!inb.aborted) {
        const coverage = Math.min(im?.coverageMs ?? Infinity, inb.complete ? cutoffMs : (inb.reachedMs ?? Infinity));
        await store.setMeta('inbound', {
          syncedAt: startedAt,
          coverageMs: Number.isFinite(coverage) ? coverage : null,
          truncated: inb.truncated,
        });
      }
      if (ac.signal.aborted) return;

      progress('outbound');
      const om = data.meta.outbound;
      const outb = await sweepOutbound(agent, did, {
        cutoffMs,
        knownUris: new Set(data.outbound.map((e) => e.uri)),
        coveredToMs: om?.coverageMs ?? null,
        signal: ac.signal,
        onPage: (rows) => store.putAll('outbound', rows),
        onProgress: tick,
      });
      if (outb.error) errors.push(`outbound: ${outb.error}`);
      else if (!outb.aborted) {
        const coverage = Math.min(om?.coverageMs ?? Infinity, outb.complete ? cutoffMs : (outb.reachedMs ?? Infinity));
        await store.setMeta('outbound', {
          syncedAt: startedAt,
          coverageMs: Number.isFinite(coverage) ? coverage : null,
          truncated: outb.truncated,
        });
      }
    } finally {
      abortRef.current = null;
      // One reload, one render of new charts — the sweeps persisted as they
      // went, so even an aborted sync surfaces everything it banked.
      const store2 = storeRef.current;
      if (store2) await reload(store2);
      setSync(null);
      if (errors.length) setSyncError(errors.join(' · '));
    }
  }

  /* Kick a quiet incremental sync when the archive has gone stale. */
  useEffect(() => {
    if (!data.loaded || !agent || autoRanRef.current) return;
    const pm = data.meta.posts;
    if (!pm) return; // first run is a button, never a surprise sweep
    autoRanRef.current = true;
    if (Date.now() - (pm.syncedAt || 0) < AUTO_SYNC_AFTER_MS) return;
    runSync(pm.complete ? 'incremental' : 'resume');
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
    wantActors,
    cancelSync: () => abortRef.current?.abort(),
    agent,
    did,
  };
}

/* ================================================================== */
/* Sync strip + first run                                               */
/* ================================================================== */

const PHASE_LABEL = {
  followers: 'Sweeping followers',
  posts: 'Archiving posts',
  inbound: 'Reading notifications',
  outbound: 'Reading likes & reposts',
};

function SyncStrip({ archive }) {
  const { sync, syncError, meta, posts, followers, persistent, runSync, cancelSync } = archive;

  if (sync) {
    const pct = sync.est ? Math.min(100, Math.round((sync.fetched / sync.est) * 100)) : null;
    return (
      <div className="an-strip" role="status">
        <span className="an-strip-label">
          {PHASE_LABEL[sync.phase] || 'Syncing'}… {sync.fetched.toLocaleString('en-US')}
          {sync.est ? ` of ~${sync.est.toLocaleString('en-US')}` : ''}
        </span>
        <span className="an-strip-track" aria-hidden="true">
          <span className="an-strip-fill" style={{ width: pct != null ? `${pct}%` : '30%' }} data-indeterminate={pct == null ? '' : undefined} />
        </span>
        <button type="button" className="an-strip-cancel" onClick={cancelSync}>
          Cancel
        </button>
      </div>
    );
  }

  const pm = meta.posts;
  if (!pm) return null;
  return (
    <div className="an-strip">
      <span className="an-strip-label">
        {posts.length.toLocaleString('en-US')} posts · {followers.length.toLocaleString('en-US')} followers
        {pm.syncedAt ? ` · synced ${relativeTime(pm.syncedAt)}` : ''}
        {!pm.complete && ' · archive incomplete'}
        {!persistent && ' · this browser holds the archive for this session only'}
      </span>
      {syncError && <span className="an-strip-error">{syncError}</span>}
      <span className="an-strip-actions">
        {!pm.complete && pm.cursor && (
          <button type="button" className="admin-gate-button admin-gate-button-tight" onClick={() => archive.runSync('resume')}>
            Resume build
          </button>
        )}
        <button type="button" className="admin-gate-button admin-gate-button-tight" onClick={() => runSync('incremental')}>
          Sync
        </button>
        <button
          type="button"
          className="an-strip-rebuild"
          title="Clear the post archive and rebuild it from the AppView — the only way deleted posts leave, and old posts' counts fully refresh."
          onClick={() => runSync('full')}
        >
          Rebuild
        </button>
      </span>
    </div>
  );
}

function FirstRun({ archive }) {
  return (
    <div className="an-hero">
      <Users className="an-hero-glyph" size={22} aria-hidden="true" />
      <h2 className="an-hero-title">Build the archive</h2>
      <p className="an-hero-body">
        Analytics are derived client-side from your own data: every post with its engagement counts
        (via the public AppView), every current follower with the date their follow record was
        minted, and your recent notifications, likes and reposts. The first build pages the whole
        author feed — a couple of hundred requests, a minute or two — and lands in this browser’s
        IndexedDB. After that, syncs only top up what’s new.
        {!archive.persistent &&
          ' This browser is blocking IndexedDB, so the archive will only last the session.'}
      </p>
      <button type="button" className="admin-gate-button" onClick={() => archive.runSync('full')} disabled={Boolean(archive.sync)}>
        Build the archive
      </button>
    </div>
  );
}

/* ================================================================== */
/* Followers                                                            */
/* ================================================================== */

function FollowersTab({ archive, period, nowMs }) {
  const { followers } = archive;
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
    const compare = comparePeriods(dated, { days: period.days || spanDays, now: nowMs, pickTime: (f) => f.atMs });
    return {
      total: followers.length,
      undated,
      unit,
      units,
      counts,
      cumulative: cumulativeSeries(counts, baseline),
      gained: inWindow.length,
      perDay: inWindow.length / spanDays,
      compare,
      spanDays,
    };
  }, [followers, period, mode, nowMs]);

  if (!followers.length) {
    return <p className="an-empty">No follower sweep yet — run a sync to gather the current follower list.</p>;
  }

  const cumulative = mode === 'cumulative';
  return (
    <section className="an-panel" aria-label="Follower growth">
      <div className="an-tiles">
        <StatTile label="Followers" value={model.total} />
        <StatTile
          label={`New in ${period.label.toLowerCase()}`}
          value={model.gained}
          delta={period.days ? model.compare.pct : null}
          deltaTitle={period.days ? `vs previous ${period.label.toLowerCase()}: ${model.compare.previous.toLocaleString('en-US')}` : null}
        />
        <StatTile label="Per day" value={model.perDay < 10 ? Math.round(model.perDay * 10) / 10 : Math.round(model.perDay)} exact />
      </div>

      <div className="an-card">
        <div className="an-card-head">
          <h3 className="an-card-title">Growth</h3>
          <ModeToggle
            value={mode}
            onChange={setMode}
            options={[
              { key: 'cumulative', label: 'Cumulative' },
              ...model.units.map((u) => ({ key: u, label: unitLabel(u) })),
            ]}
          />
        </div>
        <SeriesChart
          series={cumulative ? model.cumulative : model.counts}
          mode={cumulative ? 'line' : 'bars'}
          unit={model.unit}
          zeroBase={!cumulative}
          ariaLabel={
            cumulative
              ? `Cumulative followers over ${period.label}`
              : `New followers per ${model.unit} over ${period.label}`
          }
        />
        <ChartTable
          series={cumulative ? model.cumulative : model.counts}
          unit={model.unit}
          valueHead={cumulative ? 'Followers' : 'New followers'}
        />
      </div>

      <p className="an-note">
        Dated by each current follower’s follow record, so the curve is the present follower list
        laid out in time — accounts that unfollowed or were deleted are invisible to it.
        {model.undated > 0 && ` ${model.undated.toLocaleString('en-US')} followers carry no readable follow date and sit outside the chart.`}
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
      <div className="an-tiles">
        <StatTile
          label={`Posts in ${period.label.toLowerCase()}`}
          value={model.count}
          delta={period.days ? model.compare.pct : null}
          deltaTitle={period.days ? `vs previous ${period.label.toLowerCase()}: ${model.compare.previous.toLocaleString('en-US')}` : null}
        />
        <StatTile label="Per day" value={model.perDay < 10 ? Math.round(model.perDay * 10) / 10 : Math.round(model.perDay)} exact />
        <StatTile label="Replies" value={model.count ? Math.round((model.replies / model.count) * 100) : 0} unit="%" exact />
        <StatTile label="With media" value={model.count ? Math.round((model.withMedia / model.count) * 100) : 0} unit="%" exact />
      </div>

      <div className="an-card">
        <div className="an-card-head">
          <h3 className="an-card-title">Posts per {unitNoun(model.unit)}</h3>
          <ModeToggle
            value={model.unit}
            onChange={setUnitPick}
            options={model.units.map((u) => ({ key: u, label: unitLabel(u) }))}
          />
        </div>
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

function EngagementTab({ archive, period, kind, nowMs }) {
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
    const value = (p) => engagementOf(p, kind);
    const total = inWindow.reduce((sum, p) => sum + value(p), 0);
    return {
      unit,
      units,
      series: bucketSeries(inWindow, { unit, t0, t1: nowMs, pickTime: (p) => p.atMs, pickValue: value }),
      total,
      perPost: inWindow.length ? total / inWindow.length : 0,
      top: topPosts(inWindow, { kind, t0, t1: nowMs, limit: 10 }),
      compare: comparePeriods(dated, { days: period.days || spanDays, now: nowMs, pickTime: (p) => p.atMs, pickValue: value }),
    };
  }, [posts, period, kind, unitPick, nowMs]);

  if (!posts.length) {
    return <p className="an-empty">The post archive is empty — build it from the strip above.</p>;
  }

  const kindLabel = (ENGAGEMENT_KINDS.find((k) => k.key === kind)?.label || 'All').toLowerCase();
  const head = kind === 'all' ? 'Engagement' : `${ENGAGEMENT_KINDS.find((k) => k.key === kind)?.label}`;

  return (
    <section className="an-panel" aria-label="Engagement">
      <div className="an-tiles">
        <StatTile
          label={kind === 'all' ? 'Engagement received' : `${head} received`}
          value={model.total}
          delta={period.days ? model.compare.pct : null}
          deltaTitle={period.days ? `on posts from the previous ${period.label.toLowerCase()}: ${model.compare.previous.toLocaleString('en-US')}` : null}
        />
        <StatTile label="Per post" value={Math.round(model.perPost * 10) / 10} exact />
        <StatTile label="Best post" value={model.top.length ? engagementOf(model.top[0], kind) : 0} />
      </div>

      <div className="an-card">
        <div className="an-card-head">
          <h3 className="an-card-title">{head} by post date</h3>
          <ModeToggle
            value={model.unit}
            onChange={setUnitPick}
            options={model.units.map((u) => ({ key: u, label: unitLabel(u) }))}
          />
        </div>
        <SeriesChart
          series={model.series}
          mode="bars"
          unit={model.unit}
          zeroBase
          ariaLabel={`${head} on posts made each ${model.unit}, over ${period.label}`}
        />
        <ChartTable series={model.series} unit={model.unit} valueHead={head} />
        <p className="an-card-caption">
          Counted against the day each post was made, with counts as of the last archive sync — a
          bar is “how much {kindLabel === 'all' ? 'engagement' : kindLabel} that {model.unit}’s posts have earned”, not when it arrived.
        </p>
      </div>

      <div className="an-card">
        <h3 className="an-card-title">Top posts</h3>
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

function PeopleTab({ archive, did, period, kind, nowMs }) {
  const { posts, inbound, outbound, followers, actors, wantActors } = archive;

  const model = useMemo(() => {
    const t1 = nowMs;
    const windowFor = (events) => {
      if (period.days) return nowMs - period.days * DAY_MS;
      const oldest = oldestEventMs(events);
      return oldest ?? nowMs;
    };
    const outboundAll = [...outbound, ...outboundFromPosts(posts)];
    const inT0 = windowFor(inbound);
    const outT0 = windowFor(outboundAll);
    return {
      inTop: topActors(inbound, { kind, t0: inT0, t1, limit: 12, excludeDid: did }),
      outTop: topActors(outboundAll, { kind, t0: outT0, t1, limit: 12, excludeDid: did }),
      inOldest: oldestEventMs(inbound),
      outOldest: oldestEventMs(outboundAll),
      inT0,
    };
  }, [posts, inbound, outbound, period, kind, did, nowMs]);

  // Resolve the faces this render actually shows — two getProfiles calls at
  // most, cached in the actors store afterwards.
  const wanted = useMemo(
    () => [...model.inTop, ...model.outTop].map((r) => r.did).filter((d) => !actors.get(d)?.handle),
    [model, actors],
  );
  useEffect(() => {
    if (wanted.length) wantActors(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted.join('|')]);

  const followerCards = useMemo(() => new Map(followers.map((f) => [f.did, f])), [followers]);
  const cardFor = (actorDid) => actors.get(actorDid) || followerCards.get(actorDid) || null;

  const inCoverage =
    model.inOldest != null && period.days && model.inOldest > model.inT0
      ? `Notification history reaches back to ${formatDateShort(model.inOldest)} so far — earlier ${period.label.toLowerCase()} events are outside it.`
      : null;

  return (
    <section className="an-panel" aria-label="People">
      <div className="an-people">
        <div className="an-card">
          <h3 className="an-card-title">
            <MessagesSquare size={13} aria-hidden="true" className="an-card-glyph" />
            They engage with you
          </h3>
          <ActorList rows={model.inTop} cardFor={cardFor} empty="No inbound engagement recorded in this window yet — sync to gather notifications." />
          {inCoverage && <p className="an-card-caption">{inCoverage}</p>}
        </div>
        <div className="an-card">
          <h3 className="an-card-title">
            <Heart size={13} aria-hidden="true" className="an-card-glyph" />
            You engage with them
          </h3>
          {kind === 'mention' ? (
            <p className="an-empty">Mentions are tracked inbound only.</p>
          ) : (
            <ActorList rows={model.outTop} cardFor={cardFor} empty="No outbound engagement in this window — likes, reposts, replies and quotes land here after a sync." />
          )}
        </div>
      </div>
      <p className="an-note">
        Inbound counts come from notifications (likes, reposts, replies, quotes, mentions aimed at
        you); outbound counts from your own like and repost records plus the replies and quotes in
        the post archive.
      </p>
    </section>
  );
}

function ActorList({ rows, cardFor, empty }) {
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
        return (
          <li key={row.did} className="an-actor">
            {card?.avatar ? (
              <img className="an-actor-avatar" src={card.avatar} alt="" loading="lazy" />
            ) : (
              <span className="an-actor-avatar an-actor-avatar-empty" aria-hidden="true" />
            )}
            <span className="an-actor-main">
              <a className="an-actor-name" href={href} target="_blank" rel="noopener noreferrer">
                {name}
              </a>
              {card?.handle && <span className="an-actor-handle">@{card.handle}</span>}
            </span>
            <span className="an-actor-track" aria-hidden="true">
              <span className="an-actor-fill" style={{ width: `${(row.total / max) * 100}%` }} />
            </span>
            <span className="an-actor-count" title={detail}>
              {row.total.toLocaleString('en-US')}
            </span>
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
  const { agent, did } = archive;
  const [scan, setScan] = useState(null); // {running, progress} | {collections, cutoffMs, clamped, scannedAt}
  const abortRef = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const wantDays = Math.min(period.days ?? ATMOSPHERE_MAX_DAYS, ATMOSPHERE_MAX_DAYS);
  const clamped = (period.days ?? Infinity) > ATMOSPHERE_MAX_DAYS;

  async function runScan() {
    if (scan?.running || !agent) return;
    const ac = new AbortController();
    abortRef.current = ac;
    const cutoffMs = Date.now() - wantDays * DAY_MS;
    setScan({ running: true, progress: { scanned: 0, total: 0 } });
    const res = await sweepAtmosphere(agent, did, {
      cutoffMs,
      signal: ac.signal,
      onProgress: (p) => setScan((s) => (s?.running ? { ...s, progress: p } : s)),
    });
    abortRef.current = null;
    setScan({ collections: res.collections, error: res.error, cutoffMs, days: wantDays, scannedAt: Date.now() });
  }

  const model = useMemo(() => {
    if (!scan?.collections) return null;
    const t0 = scan.cutoffMs;
    const unit = defaultUnitFor(scan.days);
    const all = scan.collections.flatMap((c) => c.times);
    const ranked = [...scan.collections].filter((c) => c.count > 0 || c.truncated).sort((a, b) => b.count - a.count);
    return {
      unit,
      total: all.length,
      anyTruncated: scan.collections.some((c) => c.truncated),
      series: bucketSeries(all, { unit, t0, t1: nowMs, pickTime: (t) => t }),
      ranked,
      collections: scan.collections.length,
    };
  }, [scan, nowMs]);

  if (scan?.running) {
    const { scanned, total, collection } = scan.progress;
    return (
      <section className="an-panel" aria-label="Atmosphere">
        <p className="an-empty" role="status">
          Scanning the repo… {scanned}/{total || '?'} collections{collection ? ` — ${collection}` : ''}
        </p>
        <button type="button" className="admin-gate-button admin-gate-button-tight" onClick={() => abortRef.current?.abort()}>
          Cancel
        </button>
      </section>
    );
  }

  if (!model) {
    return (
      <section className="an-panel an-hero" aria-label="Atmosphere">
        <h2 className="an-hero-title">The whole repo, not just Bluesky</h2>
        <p className="an-hero-body">
          Scan every collection on the PDS — statuses, plays, observations, guestbook, the lot — and
          chart records written over the last {wantDays} days. The scan pages each collection live,
          so it runs on demand rather than on every visit.
        </p>
        <button type="button" className="admin-gate-button" onClick={runScan}>
          Scan the repo
        </button>
      </section>
    );
  }

  return (
    <section className="an-panel" aria-label="Atmosphere">
      <div className="an-tiles">
        <StatTile label={`Records in ${scan.days}d`} value={model.total} approx={model.anyTruncated} />
        <StatTile label="Collections" value={model.collections} exact />
        <StatTile label="Per day" value={Math.round(model.total / scan.days)} />
      </div>

      <div className="an-card">
        <div className="an-card-head">
          <h3 className="an-card-title">Records written per {unitNoun(model.unit)}</h3>
          <button type="button" className="admin-gate-button admin-gate-button-tight" onClick={runScan}>
            Re-scan
          </button>
        </div>
        <SeriesChart
          series={model.series}
          mode="bars"
          unit={model.unit}
          zeroBase
          ariaLabel={`Records written to the repo per ${model.unit} over the last ${scan.days} days`}
        />
        <ChartTable series={model.series} unit={model.unit} valueHead="Records" />
      </div>

      <div className="an-card">
        <h3 className="an-card-title">By collection</h3>
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
                <span className="an-actor-count">
                  {c.count.toLocaleString('en-US')}
                  {c.truncated ? '+' : ''}
                </span>
              </li>
            );
          })}
        </ol>
        {(clamped || model.anyTruncated) && (
          <p className="an-card-caption">
            {clamped && `The scan pages live, so it is windowed to the last ${ATMOSPHERE_MAX_DAYS} days even on longer periods. `}
            {model.anyTruncated && 'A “+” marks a collection whose scan hit its page cap — the count is a floor.'}
          </p>
        )}
      </div>
      <p className="an-note">Scanned {relativeTime(scan.scannedAt)} through your PDS. {scan.error && `Ended early: ${scan.error}`}</p>
    </section>
  );
}

/* ================================================================== */
/* Shared pieces — tiles, toggles, the chart                            */
/* ================================================================== */

function StatTile({ label, value, unit = null, delta = undefined, deltaTitle = null, exact = false, approx = false }) {
  const shown = exact ? Number(value).toLocaleString('en-US') : fmtCompact(value);
  // A delta renders whenever a comparison exists (deltaTitle names it); a null
  // delta inside one is the "new" case — something over nothing has no honest
  // percentage. No comparison, no delta element at all.
  const hasDelta = deltaTitle != null;
  return (
    <div className="an-tile">
      <span className="an-tile-value" title={exact ? undefined : Number(value).toLocaleString('en-US')}>
        {approx ? '~' : ''}
        {shown}
        {unit && <span className="an-tile-inline-unit">{unit}</span>}
      </span>
      <span className="an-tile-label">{label}</span>
      {hasDelta && (
        <span
          className={`an-tile-delta${delta != null && delta > 0 ? ' is-up' : delta != null && delta < 0 ? ' is-down' : ''}`}
          title={deltaTitle}
        >
          {fmtDelta(delta)}
        </span>
      )}
    </div>
  );
}

function ModeToggle({ value, onChange, options }) {
  return (
    <div className="an-chiprow an-chiprow-tight" role="group">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`an-chip${value === o.key ? ' is-active' : ''}`}
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
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
 * The one chart. `mode: 'bars'` draws columns from a zero baseline with a 2px
 * surface gap and rounded data-ends; `mode: 'line'` draws a 2px line over a
 * 10%-opacity wash (the cumulative view). `trend` overlays a moving average
 * with a direct end label. Hover is a nearest-X crosshair with one readout —
 * the same interaction on both forms — and the values are all reachable
 * without it through the ChartTable twin rendered alongside.
 */
function SeriesChart({ series, trend = null, mode = 'bars', unit = 'day', zeroBase = true, ariaLabel }) {
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
  const values = series.map((p) => p.v);
  const dataMax = Math.max(...values, trend ? Math.max(...trend.map((p) => p.v)) : 0);
  const dataMin = Math.min(...values);
  // Bars grow from zero, always. A line (the cumulative view) may sit on a
  // nearby floor instead — a follower count living between 5,500 and 5,935
  // pinned to a zero axis is a flat wire that says nothing.
  const { min: yMin, max: yMax } = niceScale(zeroBase ? 0 : Math.max(0, dataMin), Math.max(dataMax, zeroBase ? 1 : dataMax));
  const ySpan = Math.max(1e-9, yMax - yMin);
  const plotW = Math.max(1, w - PAD.l - PAD.r);
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
  const line = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)},${baseY} ${series.map((p, i) => `L${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} L${x(n - 1).toFixed(1)},${baseY} Z`;
  const trendPath = trend
    ? trend.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
    : null;

  return (
    <div className="an-chart">
      <div className="an-chart-plot" ref={plotRef} style={{ height: H }}>
        {ready && (
          <svg
            className="an-chart-svg"
            width={w}
            height={H}
            viewBox={`0 0 ${w} ${H}`}
            role="img"
            aria-label={`${ariaLabel || 'Series'}: ${n} ${unit} buckets, peak ${Math.round(dataMax).toLocaleString('en-US')}`}
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

            {mode === 'bars' &&
              series.map((p, i) =>
                p.v > 0 ? (
                  <path
                    key={p.t}
                    className={`an-chart-bar${hover === i ? ' is-hover' : ''}`}
                    d={barPath(x(i) - barW / 2, y(p.v), barW, baseY - y(p.v))}
                  />
                ) : null,
              )}

            {mode === 'line' && (
              <>
                <path className="an-chart-area" d={area} />
                <path className="an-chart-line" d={line} />
                <circle className="an-chart-dot" cx={x(n - 1)} cy={y(series[n - 1].v)} r="3.4" />
              </>
            )}

            {trendPath && (
              <>
                <path className="an-chart-trend" d={trendPath} />
                <text className="an-chart-trendlabel" x={Math.min(x(n - 1) + 4, w - PAD.r)} y={y(trend[n - 1].v) - 4} textAnchor="end">
                  trend
                </text>
              </>
            )}

            {hp && (
              <g>
                <line className="an-chart-cross" x1={x(hp.i)} x2={x(hp.i)} y1={PAD.t - 6} y2={baseY} />
                {mode === 'line' && <circle className="an-chart-marker" cx={x(hp.i)} cy={y(hp.v)} r="4" />}
              </g>
            )}
          </svg>
        )}

        {hp && (
          <div
            className="an-chart-tip"
            style={{ left: clamp(x(hp.i), 40, w - 40), top: Math.max(PAD.t, y(hp.v)) }}
          >
            <strong>{Math.round(hp.v).toLocaleString('en-US')}</strong>
            <span className="an-chart-tip-when">{bucketLabel(hp.t, unit)}</span>
            {trend && trend[hp.i] && (
              <span className="an-chart-tip-trend">trend {Math.round(trend[hp.i].v).toLocaleString('en-US')}</span>
            )}
          </div>
        )}
      </div>
      <div className="an-chart-xaxis" aria-hidden="true">
        <span>{bucketLabel(series[0].t, unit)}</span>
        <span>{bucketLabel(series[n - 1].t, unit)}</span>
      </div>
    </div>
  );
}

/** Column with a 4px-rounded data end and a square baseline. */
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  const right = x + w;
  return [
    `M${x.toFixed(1)},${(y + h).toFixed(1)}`,
    `L${x.toFixed(1)},${(y + r).toFixed(1)}`,
    `Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)}`,
    `L${(right - r).toFixed(1)},${y.toFixed(1)}`,
    `Q${right.toFixed(1)},${y.toFixed(1)} ${right.toFixed(1)},${(y + r).toFixed(1)}`,
    `L${right.toFixed(1)},${(y + h).toFixed(1)}`,
    'Z',
  ].join(' ');
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

/** Every chart's plain twin — the same buckets as a real table. */
function ChartTable({ series, trend = null, unit, valueHead }) {
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
              {trend && <th scope="col">Trend</th>}
            </tr>
          </thead>
          <tbody>
            {series.map((p, i) => (
              <tr key={p.t}>
                <th scope="row">{bucketLabel(p.t, unit)}</th>
                <td>{Math.round(p.v).toLocaleString('en-US')}</td>
                {trend && <td>{Math.round(trend[i]?.v ?? 0).toLocaleString('en-US')}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
