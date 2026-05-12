import { Link } from 'react-router-dom';
import { relativeTime } from '../lib/time.js';
import { rkeyFromAtUri } from '../lib/atproto.js';

export default function StatusEntry({ payload, createdAt, atUri }) {
  const text = (payload?.status || payload?.text || '').trim();
  const ts = createdAt || payload?.createdAt;
  const rkey = rkeyFromAtUri(atUri);
  const href = rkey ? `/logging/${rkey}` : null;
  return (
    <article className="status-entry feed-card" data-at-uri={atUri}>
      <p className="status-entry-text">
        <span className="small-caps status-entry-prefix">dame.is</span>{' '}
        <span className="status-entry-body">{text || <em>—</em>}</span>
      </p>
      {ts && (
        <span className="feed-card-meta gutter">
          {href ? <Link to={href}>{relativeTime(ts)}</Link> : relativeTime(ts)}
        </span>
      )}
    </article>
  );
}
