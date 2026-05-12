import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FeedFilters, { filterFeed } from '../components/FeedFilters.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import { fetchSnapshot, mergeByKey } from '../lib/snapshot.js';
import { groupByDay } from '../lib/time.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';

function dayKey(iso) {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '';
}

/**
 * Collapse runs of consecutive `listening` items on the same day into one
 * row with a count, so /  doesn't drown in single-track plays.
 */
function collapseListens(items) {
  const out = [];
  let run = null;
  for (const item of items) {
    if (item.verb === 'listening') {
      const key = dayKey(item.createdAt);
      if (run && run.verb === 'listening' && dayKey(run.createdAt) === key) {
        run.count = (run.count || 1) + 1;
        continue;
      }
      run = { ...item, count: 1 };
      out.push(run);
    } else {
      run = null;
      out.push(item);
    }
  }
  return out;
}

export default function Home() {
  const [params] = useSearchParams();
  const [feed, setFeed] = useState([]);
  const [loadedAt, setLoadedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const snap = await fetchSnapshot('unifiedFeed');
      if (!cancelled && Array.isArray(snap)) {
        setFeed(snap);
        setLoadedAt(new Date());
      }
      // Live merge: refetch the constituent snapshots in case the cron rebuilt them.
      const [now, blogs, creations, posts, listening] = await Promise.all([
        fetchSnapshot('now'),
        fetchSnapshot('blogs'),
        fetchSnapshot('creations'),
        fetchSnapshot('posts'),
        fetchSnapshot('listening'),
      ]);
      if (cancelled) return;
      const live = [];
      for (const r of now || []) live.push(toFeedItem('logging', r));
      for (const r of blogs || []) live.push(toFeedItem('blogging', r));
      for (const r of creations || []) live.push(toFeedItem('creating', r));
      for (const r of listening || []) live.push(toFeedItem('listening', r));
      for (const item of posts || []) {
        const f = blueskyToFeedItem(item);
        if (f) live.push(f);
      }
      const merged = mergeByKey(snap || [], live, (i) => i.atUri || `${i.verb}:${i.createdAt}`);
      if (!cancelled) {
        setFeed(merged);
        setLoadedAt(new Date());
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => {
    const c = {};
    for (const item of feed) c[item.verb] = (c[item.verb] || 0) + 1;
    return c;
  }, [feed]);

  const filtered = useMemo(() => filterFeed(feed, params), [feed, params]);
  const collapsed = useMemo(() => collapseListens(filtered), [filtered]);
  const groups = useMemo(() => groupByDay(collapsed, (i) => i.createdAt), [collapsed]);

  return (
    <PageShell
      verb="being"
      title={<><span className="gerund">Dame is&hellip;</span> a website built atop records</>}
      intro="An atmospheric site. Every entry below is a record on the AT Protocol — statuses, posts, blogs, plays, and works, interleaved by time."
      atUri={`at://${ME_DID}/is.dame.page/home`}
      headTitle="Dame is&hellip;"
    >
      <FeedFilters counts={counts} />
      {filtered.length === 0 ? (
        <p className="feed-empty">No records match these filters.</p>
      ) : (
        <ol className="feed-list">
          {groups.map((group) => (
            <li key={group.dateKey} className="feed-day-group">
              <DayOfLifeHeader date={group.date} />
              <ul className="feed-list" style={{ marginTop: 'var(--space-3)' }}>
                {group.items.map((item, i) => (
                  <FeedItem key={(item.atUri || '') + i} item={item} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {loadedAt && (
        <p className="gutter feed-loaded-at" style={{ marginTop: 'var(--space-7)', textAlign: 'center' }}>
          {filtered.length} of {feed.length} records · refreshed {loadedAt.toLocaleTimeString()}
        </p>
      )}
    </PageShell>
  );
}

function toFeedItem(verb, record) {
  const value = record.value || {};
  const createdAt =
    value.createdAt ||
    value.playedTime ||
    value.playedAt ||
    record.indexedAt ||
    null;
  return {
    verb,
    createdAt,
    atUri: record.uri,
    cid: record.cid,
    payload: value,
  };
}

function blueskyToFeedItem(item) {
  const post = item?.post;
  if (!post?.uri) return null;
  return {
    verb: 'posting',
    createdAt: post.record?.createdAt || post.indexedAt,
    atUri: post.uri,
    cid: post.cid,
    payload: {
      text: post.record?.text || '',
      author: {
        did: post.author?.did,
        handle: post.author?.handle,
        displayName: post.author?.displayName,
      },
      replyCount: post.replyCount || 0,
      repostCount: post.repostCount || 0,
      likeCount: post.likeCount || 0,
      indexedAt: post.indexedAt,
    },
  };
}
