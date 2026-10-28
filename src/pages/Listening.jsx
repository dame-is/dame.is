import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useReducedMotion } from 'motion/react';
import PageShell from '../components/PageShell.jsx';
import FeedItem from '../components/FeedItem.jsx';
import ListeningStats from '../components/ListeningStats.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import FeedMore from '../components/FeedMore.jsx';
import QueryNote from '../components/QueryNote.jsx';
import { matchesQuery } from '../components/FeedSearch.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { useFeedWindow } from '../hooks/useFeedWindow.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useFeedLayout } from '../hooks/useFeedLayout.jsx';
import { newestInstant, usePublishLatestRecord } from '../hooks/useFeedFooter.jsx';
import { groupByDay } from '../lib/time.js';
import { collapseListens } from '../lib/listenSessions.js';
import { dropGhostPlays } from '../lib/ghostPlays.js';
import { resolvePds, getLatestCommit } from '../lib/atproto.js';
import { listTealPlays, playArtistNames, playTrackName, playedAtOf } from '../lib/teal.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';

// New arrivals cascade in 60ms apart, up to this many steps, as on the home
// feed.
const ARRIVAL_STAGGER_STEPS = 8;

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
    // Coming back here (Back from a record, say) redraws the last list at once
    // and refreshes behind it, so the page and its scroll position return on
    // the first frame rather than after a skeleton.
    remember: 'listening',
    // Refresh on the shared 30s tick like the home feed. getRev skips the
    // (up to ten-page) listRecords fan-out whenever the repo hasn't advanced.
    live: true,
    getRev: async () => {
      const pds = await resolvePds(ME_DID);
      return (await getLatestCommit(pds, ME_DID))?.rev || null;
    },
    // Both teal.fm namespaces, collapsed by rkey — the archive predates the
    // move to production lexicons and has to keep reading as one history.
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      return listTealPlays(pds, { repo: ME_DID, max: 1000, reuse: true });
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
  const safeItems = useMemo(() => items || [], [items]);
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
        const hay = [playTrackName(p), p.releaseName, playArtistNames(p).join(' ')]
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
  const feedWindow = useFeedWindow(sessions, q);
  const { visible } = feedWindow;
  const groups = useMemo(
    () => groupByDay(visible, (i) => i.createdAt),
    [visible],
  );

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
      <QueryNote noun="plays" />
      {loading ? (
        <FeedSkeleton rows={6} label="Loading plays" />
      ) : status === 'error' ? (
        <p className="feed-empty">Live refresh failed and no cached snapshot is available.</p>
      ) : groups.length === 0 ? (
        <p className="feed-empty">
          {q ? 'No songs match that search.' : 'No plays yet.'}
        </p>
      ) : (
        // The ledger's margin holds each session's cover here, not the word
        // "listening" on every row.
        <div className={ledger ? 'feed-ledger feed-ledger-covers' : undefined}>
          <ol className="feed-list reveal-stagger">
            {groups.map((group) => (
              <li key={group.dateKey} className="feed-day-group">
                <DayOfLifeHeader
                  date={group.date}
                  variant={ledger ? 'ledger' : 'default'}
                  meta={listeningDayMeta(group.items)}
                />
                <ul className="feed-list" style={ledger ? undefined : { marginTop: 'var(--space-3)' }}>
                  {group.items.map((item) => {
                    // FeedItem is the list item itself, and memoized, as on the
                    // home feed: no wrapping <li> (a list item inside a list
                    // item), and no layout animation measuring every row's box
                    // on each refresh — just the slide-in a new arrival plays
                    // once, on mount.
                    const uri = item.atUri;
                    const isNew = !reduce && uri ? newKeys.has(uri) : false;
                    const step = isNew
                      ? Math.min(
                          arrivalIndex.get(uri) ?? 0,
                          ARRIVAL_STAGGER_STEPS,
                        )
                      : 0;
                    return (
                      <FeedItem
                        key={uri}
                        item={item}
                        showVerb={false}
                        layout={ledger ? 'ledger' : 'cards'}
                        arriving={isNew}
                        arrivalDelay={step * 0.06}
                      />
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>
          <FeedMore {...feedWindow} />
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
 * Per-day summary for the listening ledger's day header: what was actually
 * played that day, in songs, minutes and unique artists, ahead of the
 * day-of-life folio. `sessions` are the collapsed listening batches shown
 * under the header; each carries its underlying `plays`, so the numbers stay
 * in step with the (possibly search-filtered) rows below. Durations are
 * stored in seconds. The artist count gives way on a phone, where the line
 * has to share its width with the date.
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
      for (const name of playArtistNames(p)) artists.add(name.toLowerCase());
    }
  }
  const minutes = Math.round(seconds / 60);
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  return (
    <>
      {plural(songs, 'song')} · {minutes.toLocaleString()} min
      <span className="day-header-wide"> · {plural(artists.size, 'artist')}</span>
    </>
  );
}

// Ghost plays (see src/lib/ghostPlays.js) are dropped here, ahead of both the
// feed and the stats header, so neither counts a song nobody played.
function toListeningItems(records) {
  if (!Array.isArray(records)) return [];
  return dropGhostPlays(
    records
      .filter((r) => r?.uri && r.value)
      .map((r) => ({
        verb: 'listening',
        atUri: r.uri,
        cid: r.cid,
        createdAt: playedAtOf(r.value) || r.value?.createdAt || null,
        payload: r.value,
      })),
  );
}
