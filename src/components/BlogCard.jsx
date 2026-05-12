import { Link } from 'react-router-dom';
import { rkeyFromAtUri } from '../lib/atproto.js';

/**
 * Compact card used for a blog entry inside the unified Home feed.
 * Handles both blog source shapes:
 *   - is.dame.blogging.post  — addressed by `slug`
 *   - pub.leaflet.document   — addressed by rkey (no slug field)
 */
export default function BlogCard({ payload, atUri }) {
  const isLeaflet = payload?.$type === 'pub.leaflet.document';
  const slug = payload?.slug;
  const rkey = rkeyFromAtUri(atUri);
  const id = isLeaflet ? rkey : slug;
  const title = payload?.title || id || 'Untitled';
  const summary = isLeaflet
    ? payload?.description || payload?.summary || ''
    : payload?.summary || (payload?.body ? payload.body.slice(0, 280) : '');
  return (
    <article className="blog-card feed-card" data-at-uri={atUri}>
      <header className="blog-card-head">
        <h3 className="blog-card-title">
          {id ? <Link to={`/blogging/${id}`}>{title}</Link> : title}
        </h3>
      </header>
      {summary && <p className="blog-card-summary">{summary}</p>}
    </article>
  );
}
