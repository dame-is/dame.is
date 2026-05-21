import { Link } from 'react-router-dom';
import { relativeTime } from '../lib/time.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { renderPlainTextWithTruncatedUrls } from '../lib/feedUrlFormat.jsx';

export default function StatusEntry({ payload, atUri, createdAt }) {
  const text = (payload?.status || payload?.text || '').trim();
  const ts = createdAt || payload?.createdAt;
  const rkey = rkeyFromAtUri(atUri);
  const recordHref = rkey ? `/logging/${rkey}` : null;
  return (
    <article className="status-entry feed-card" data-at-uri={atUri}>
      <div className="status-entry-row">
        <p className="status-entry-text">
          <span className="status-entry-prefix">dame.is</span>{' '}
          <span className="status-entry-body">
            {text ? renderPlainTextWithTruncatedUrls(text) : <em>—</em>}
          </span>
        </p>
        {ts && (
          recordHref ? (
            <Link className="gutter status-entry-time" to={recordHref}>
              {relativeTime(ts)}
            </Link>
          ) : (
            <span className="gutter status-entry-time">{relativeTime(ts)}</span>
          )
        )}
      </div>
    </article>
  );
}
