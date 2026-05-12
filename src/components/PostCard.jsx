import { Link } from 'react-router-dom';
import { relativeTime } from '../lib/time.js';
import { rkeyFromAtUri } from '../lib/atproto.js';

function bskyUrlFromAtUri(atUri, handle) {
  const m = String(atUri || '').match(/^at:\/\/[^/]+\/app\.bsky\.feed\.post\/([^/]+)/);
  if (!m || !handle) return null;
  return `https://bsky.app/profile/${handle}/post/${m[1]}`;
}

export default function PostCard({ payload, createdAt, atUri }) {
  const text = payload?.text || '';
  const ts = createdAt || payload?.indexedAt;
  const handle = payload?.author?.handle || 'dame.is';
  const bsky = bskyUrlFromAtUri(atUri, handle);
  const rkey = rkeyFromAtUri(atUri);
  const recordHref = rkey ? `/posting/${rkey}` : null;
  return (
    <article className="post-card feed-card" data-at-uri={atUri}>
      <header className="post-card-head">
        <span className="small-caps post-card-handle">@{handle}</span>
        {ts && (
          recordHref ? (
            <Link className="gutter post-card-time" to={recordHref}>
              {relativeTime(ts)}
            </Link>
          ) : (
            <span className="gutter post-card-time">{relativeTime(ts)}</span>
          )
        )}
      </header>
      <p className="post-card-text">{text || <em>—</em>}</p>
      {(payload?.replyCount || payload?.repostCount || payload?.likeCount || bsky) ? (
        <footer className="post-card-stats gutter">
          {payload?.replyCount ? `${payload.replyCount} replies · ` : ''}
          {payload?.repostCount ? `${payload.repostCount} reposts · ` : ''}
          {payload?.likeCount ? `${payload.likeCount} likes` : ''}
          {bsky && (
            <>
              {(payload?.replyCount || payload?.repostCount || payload?.likeCount) ? ' · ' : ''}
              <a href={bsky} target="_blank" rel="noreferrer noopener">on bsky</a>
            </>
          )}
        </footer>
      ) : null}
    </article>
  );
}
