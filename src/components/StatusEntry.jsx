import { relativeTime } from '../lib/time.js';

export default function StatusEntry({ payload, createdAt, atUri }) {
  const text = (payload?.status || payload?.text || '').trim();
  const ts = createdAt || payload?.createdAt;
  return (
    <article className="status-entry feed-card" data-at-uri={atUri}>
      <p className="status-entry-text">
        <span className="small-caps status-entry-prefix">dame.is</span>{' '}
        <span className="status-entry-body">{text || <em>—</em>}</span>
      </p>
      <span className="feed-card-meta gutter">{ts ? relativeTime(ts) : ''}</span>
    </article>
  );
}
