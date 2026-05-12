import { useEffect, useState } from 'react';
import PageShell from '../components/PageShell.jsx';
import FeedItem from '../components/FeedItem.jsx';
import DayOfLifeHeader from '../components/DayOfLifeHeader.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { groupByDay } from '../lib/time.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';

export default function Posting() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetchSnapshot('posts').then((snap) => {
      if (cancelled || !Array.isArray(snap)) return;
      const mapped = snap
        .filter((row) => row?.post?.uri)
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
                did: post.author?.did,
              },
              replyCount: post.replyCount,
              repostCount: post.repostCount,
              likeCount: post.likeCount,
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

  const groups = groupByDay(items, (i) => i.createdAt);

  return (
    <PageShell
      verb="posting"
      title={<><span className="gerund">Dame is&hellip;</span> posting</>}
      intro="Bluesky posts, freshest first, grouped by day-of-life."
      atUri={`at://${ME_DID}/is.dame.page/posting`}
      headTitle="Posting — Dame is&hellip;"
    >
      {groups.length === 0 ? (
        <p className="feed-empty">No posts yet.</p>
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
