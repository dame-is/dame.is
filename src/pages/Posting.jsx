import { useEffect, useState } from 'react';
import PageShell from '../components/PageShell.jsx';
import PostCard from '../components/PostCard.jsx';
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
        .map((row) => row?.post)
        .filter((p) => p?.uri)
        .map((post) => ({
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
          },
        }));
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
                  <li key={item.atUri} className="feed-item feed-item-posting">
                    <span className="feed-item-verb small-caps">posting</span>
                    <PostCard {...item} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </PageShell>
  );
}
