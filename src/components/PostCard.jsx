import { relativeTime } from '../lib/time.js';

function bskyUrlFromAtUri(atUri, handle) {
  const m = String(atUri || '').match(/^at:\/\/[^/]+\/app\.bsky\.feed\.post\/([^/]+)/);
  if (!m || !handle) return null;
  return `https://bsky.app/profile/${handle}/post/${m[1]}`;
}

export default function PostCard({ payload, createdAt, atUri }) {
  const text = payload?.text || '';
  const ts = createdAt || payload?.indexedAt;
  const handle = payload?.author?.handle || 'dame.is';
  const url = bskyUrlFromAtUri(atUri, handle);
  return (
    <article className="post-card feed-card" data-at-uri={atUri}>
      <header className="post-card-head">
        <span className="small-caps post-card-handle">@{handle}</span>
        {ts && (
          <a className="gutter post-card-time" href={url || '#'} target="_blank" rel="noreferrer noopener">
            {relativeTime(ts)}
          </a>
        )}
      </header>
      <p className="post-card-text">{text || <em>—</em>}</p>
      {(payload?.replyCount || payload?.repostCount || payload?.likeCount) ? (
        <footer className="post-card-stats gutter">
          {payload.replyCount ? `${payload.replyCount} replies · ` : ''}
          {payload.repostCount ? `${payload.repostCount} reposts · ` : ''}
          {payload.likeCount ? `${payload.likeCount} likes` : ''}
        </footer>
      ) : null}
    </article>
  );
}
