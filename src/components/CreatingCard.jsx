import { Link } from 'react-router-dom';
import { renderPlainTextWithTruncatedUrls } from '../lib/feedUrlFormat.jsx';
import { coverThumb } from '../lib/creatingHelpers.js';
import { workSlug, workCategory } from '../lib/publications.js';

export default function CreatingCard({ payload, atUri }) {
  const slug = workSlug(payload);
  const title = payload?.title || slug || 'Untitled work';
  const category = workCategory(payload);
  const summary = payload?.summary || payload?.description;
  const thumb = coverThumb(payload);
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
