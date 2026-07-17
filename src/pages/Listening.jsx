import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import PageShell from '../components/PageShell.jsx';
import FeedItem from '../components/FeedItem.jsx';
import ListeningStats from '../components/ListeningStats.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import { matchesQuery } from '../components/FeedSearch.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useFeedLayout } from '../hooks/useFeedLayout.jsx';
import { newestInstant, usePublishLatestRecord } from '../hooks/useFeedFooter.jsx';
import { groupByDay } from '../lib/time.js';
import { collapseListens } from '../lib/listenSessions.js';
import { resolvePds, listRecords, getLatestCommit } from '../lib/atproto.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import '../components/Feed.css';

export default function Listening() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { title, intro } = usePageContent('listening');
  const reduce = useReducedMotion();

  // `newKeys` are plays that arrived on the latest live refresh — a collapsed
  // session row inherits its newest play's URI, so testing the row lights up.
  const { items, status, refreshedAt, newKeys } = useLiveFeed({
    name: 'listening',
    strategy: 'live-first',
    // Refresh on the shared 30s tick like the home feed. getRev skips the
    // (up to ten-page) listRecords fan-out whenever the repo hasn't advanced.
    live: true,
    getRev: async () => {
      const pds = await resolvePds(ME_DID);
      return (await getLatestCommit(pds, ME_DID))?.rev || null;
    },
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      return listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.listen, max: 1000 });
    },
    mapItems: toListeningItems,
  });

  const { removedUris, active: editActive } = useEditMode();
  const { layout } = useFeedLayout();
  // Match the home feed: the compact ledger is the default, but owner edit
  // mode steps aside to the full cards (their selection UI isn't wired into
  // the ledger rows).
  const ledger = layout === 'ledger' && !editActive;
  const loading = status === 'loading';
  const safeItems = items || [];
  // Stats reflect all listening (minus any owner-removed plays), independent
  // of the feed's text search below.
  const statsItems = useMemo(
    () => safeItems.filter((i) => !removedUris.has(i.atUri)),
    [safeItems, removedUris],
  );
  const filtered = useMemo(
    () =>
      safeItems.filter((i) => {
        if (removedUris.has(i.atUri)) return false;
        const p = i.payload || {};
        const hay = [
          p.trackName,
          p.releaseName,
          Array.isArray(p.artists) ? p.artists.map((a) => a?.artistName).filter(Boolean).join(' ') : '',
          p.artist,
        ]
          .filter(Boolean)
          .join(' ');
        return matchesQuery(hay, q);
      }),
    [safeItems, q, removedUris],
  );
  // Merge consecutive plays into "listening sessions" (same batching the
  // home feed uses) so a run of songs reads as one compact, expandable row
  // instead of one row per track. Plays are newest-first from the PDS, but
  // sort defensively so a play whose recorded time drifts from its rkey
  // doesn't split a session.
  const sessions = useMemo(() => {
    const sorted = [...filtered].sort(
      (a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
    );
    return collapseListens(sorted);
  }, [filtered]);
  const groups = useMemo(() => groupByDay(sessions, (i) => i.createdAt), [sessions]);

  // Top-down stagger order among the new arrivals currently on screen.
  const arrivalIndex = useMemo(() => {
    const map = new Map();
    let i = 0;
    for (const group of groups) {
      for (const item of group.items) {
        const uri = item?.atUri;
        if (uri && newKeys.has(uri)) map.set(uri, i++);
      }
    }
    return map;
  }, [groups, newKeys]);

  // Feed page: report the newest visible record's time in the global footer.
  usePublishLatestRecord(useMemo(() => newestInstant(filtered), [filtered]));

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/listening`}
      headTitle="dame.is listening"
      selectable
    >
      {!loading && statsItems.length > 0 && <ListeningStats items={statsItems} />}
      {loading ? (
        <FeedSkeleton rows={6} label="Loading plays" />
      ) : status === 'error' ? (
        <p className="feed-empty">Live refresh failed and no cached snapshot is available.</p>
      ) : groups.length === 0 ? (
        <p className="feed-empty">
          {q ? 'No songs match that search.' : 'No plays yet.'}
        </p>
      ) : (
        <div className={ledger ? 'feed-ledger' : undefined}>
          <ol className="feed-list reveal-stagger">
            {groups.map((group) => (
              <li key={group.dateKey} className="feed-day-group">
                <DayOfLifeHeader
                  date={group.date}
                  variant={ledger ? 'ledger' : 'default'}
                  meta={listeningDayMeta(group.items)}
                />
                <ul className="feed-list" style={ledger ? undefined : { marginTop: 'var(--space-3)' }}>
                  <AnimatePresence initial={false}>
                    {group.items.map((item) => {
                      const uri = item.atUri;
                      const isNew = uri ? newKeys.has(uri) : false;
                      const stagger = isNew ? (arrivalIndex.get(uri) ?? 0) * 0.06 : 0;
                      return (
                        <motion.li
                          key={uri}
                          layout
                          initial={isNew && !reduce ? { opacity: 0, y: -24 } : false}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: reduce ? 0 : 0.45,
                            ease: [0.22, 0.61, 0.36, 1],
                            delay: reduce ? 0 : stagger,
                          }}
                        >
                          <FeedItem
                            item={item}
                            showVerb={false}
                            layout={ledger ? 'ledger' : 'cards'}
                          />
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
              </li>
            ))}
          </ol>
        </div>
      )}
      {!loading && refreshedAt && (
        <p className="gutter feed-loaded-at" style={{ marginTop: 'var(--space-7)', textAlign: 'center' }}>
          {status === 'stale'
            ? `live refresh failed · snapshot from ${refreshedAt.toLocaleTimeString()}`
            : `refreshed ${refreshedAt.toLocaleTimeString()}`}
        </p>
      )}
    </PageShell>
  );
}

/**
 * Per-day summary for the listening ledger's day header — replaces the
 * generic "day of life" count with what was actually played that day:
 * songs, minutes, and unique artists. `sessions` are the collapsed
 * listening batches shown under the header; each carries its underlying
 * `plays`, so the numbers stay in step with the (possibly search-filtered)
 * rows below. Durations are stored in seconds.
 */
function listeningDayMeta(sessions) {
  let songs = 0;
  let seconds = 0;
  const artists = new Set();
  for (const session of sessions) {
    const plays = session.plays || [session];
    for (const play of plays) {
      const p = play.payload || {};
      songs += 1;
      const dur = Number(p.duration);
      if (Number.isFinite(dur) && dur > 0) seconds += dur;
      const list = Array.isArray(p.artists)
        ? p.artists
        : p.artist
        ? [{ artistName: p.artist }]
        : [];
      for (const a of list) {
        if (a?.artistName) artists.add(a.artistName.toLowerCase());
      }
    }
  }
  const minutes = Math.round(seconds / 60);
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  return `${plural(songs, 'song')}, ${minutes.toLocaleString()} min, ${plural(artists.size, 'artist')}`;
}

function toListeningItems(records) {
  if (!Array.isArray(records)) return [];
  return records
    .filter((r) => r?.uri && r.value)
    .map((r) => ({
      verb: 'listening',
      atUri: r.uri,
      cid: r.cid,
      createdAt: r.value?.playedTime || r.value?.createdAt || null,
      payload: r.value,
    }));
}
