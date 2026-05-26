import { Link } from 'react-router-dom';
import { renderPlainTextWithTruncatedUrls } from '../lib/feedUrlFormat.jsx';
import { firstImageFromContent } from '../lib/creatingHelpers.js';

export default function CreatingCard({ payload, atUri }) {
  const slug = payload?.slug;
  const title = payload?.title || slug || 'Untitled work';
  const category = payload?.category || payload?.kind;
  const summary = payload?.summary;
  const thumb =
    firstImageFromContent(payload?.content) ||
    payload?.media?.find((m) => m?.kind === 'image' && m?.url) ||
    null;
  return (
    <article className="creating-card feed-card" data-at-uri={atUri}>
      {thumb && (
        <div className="creating-card-thumb">
          <img src={thumb.url} alt={thumb.alt || ''} loading="lazy" />
        </div>
      )}
      <div className="creating-card-body">
        <header className="creating-card-head">
          <h3 className="creating-card-title">
            {slug ? <Link to={`/creating/${slug}`}>{title}</Link> : title}
          </h3>
        </header>
        {category && <span className="small-caps creating-card-kind">{category}</span>}
        {summary && (
          <p className="creating-card-summary">{renderPlainTextWithTruncatedUrls(summary)}</p>
        )}
      </div>
    </article>
  );
}
