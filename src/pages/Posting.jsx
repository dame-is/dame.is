import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import FeedSearch, { matchesQuery } from '../components/FeedSearch.jsx';
import { FeedSkeleton } from '../components/Skeleton.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { groupByDay } from '../lib/time.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';

export default function Posting() {
  // `null` = snapshot still loading; `[]` = loaded but empty.
  const [items, setItems] = useState(null);
  const [params] = useSearchParams();
  const q = params.get('q') || '';

  useEffect(() => {
    let cancelled = false;
    fetchSnapshot('posts').then((snap) => {
      if (cancelled) return;
      if (!Array.isArray(snap)) {
        setItems([]);
        return;
      }
      const mapped = snap
        // Reposts are surfaced under the dedicated `reposting` verb (and
        // their own per-record pages). The /posting index only shows
        // posts Dame actually authored.
        .filter((row) => row?.post?.uri && row?.reason?.$type !== 'app.bsky.feed.defs#reasonRepost')
        .map((row) => {
          const post = row.post;
          return {
            verb: 'posting',
            atUri: post.uri,
            cid: post.cid,
            createdAt: post.record?.createdAt || post.indexedAt,
            payload: {
              text: post.record?.text || '',
              author: {
                handle: post.author?.handle,
                displayName: post.author?.displayName,
                avatar: post.author?.avatar,
                did: post.author?.did,
              },
              replyCount: post.replyCount,
              repostCount: post.repostCount,
              likeCount: post.likeCount,
              embed: post.embed || null,
              embedRecord: post.record?.embed || null,
              indexedAt: post.indexedAt,
              reply: post.record?.reply || null,
              parent: condenseParentView(row.reply?.parent),
              root: condenseParentView(row.reply?.root),
            },
          };
        });
      setItems(mapped);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = items === null;
  const safeItems = items || [];
  const filtered = useMemo(
    () => safeItems.filter((i) => matchesQuery(i.payload?.text, q)),
    [safeItems, q],
  );
  const groups = groupByDay(filtered, (i) => i.createdAt);

  return (
    <PageShell
      title="Posting"
      intro="Bluesky posts, freshest first, grouped by day-of-life."
      atUri={`at://${ME_DID}/is.dame.page/posting`}
      headTitle="Posting — Dame is&hellip;"
    >
      <div className="feed-filters feed-filters-search-only">
        <FeedSearch label="Search posts" />
      </div>
      {loading ? (
        <FeedSkeleton rows={6} label="Loading posts" />
      ) : groups.length === 0 ? (
        <p className="feed-empty">{q ? 'No posts match that search.' : 'No posts yet.'}</p>
      ) : (
        <ol className="feed-list">
          {groups.map((group) => (
            <li key={group.dateKey} className="feed-day-group">
              <DayOfLifeHeader date={group.date} />
              <ul className="feed-list" style={{ marginTop: 'var(--space-3)' }}>
                {group.items.map((item) => (
                  <FeedItem key={item.atUri} item={item} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </PageShell>
  );
}

function condenseParentView(view) {
  if (!view) return null;
  if (view.$type === 'app.bsky.feed.defs#notFoundPost' || view.$type === 'app.bsky.feed.defs#blockedPost') {
    return { $type: view.$type, uri: view.uri || null };
  }
  if (!view.uri) return null;
  return {
    uri: view.uri,
    cid: view.cid || null,
    author: view.author
      ? {
          did: view.author.did,
          handle: view.author.handle,
          displayName: view.author.displayName,
          avatar: view.author.avatar,
        }
      : null,
    record: view.record
      ? { text: view.record.text || '', createdAt: view.record.createdAt || null }
      : null,
  };
}
