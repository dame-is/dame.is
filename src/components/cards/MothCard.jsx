/**
 * Renders a mothing observation (`is.dame.mothing.observation`) in the home
 * feed. The record is mirrored from iNaturalist and carries no location — a
 * thumbnail, the taxon name (common + scientific), and a link out to the
 * iNaturalist observation. The feed row's own timestamp shows when it was
 * observed (the record's `createdAt` is derived from the observation date).
 */
import { renderPlainTextWithTruncatedUrls } from '../../lib/feedUrlFormat.jsx';
import { photoUrl } from '../../lib/inaturalist.js';

export default function MothCard({ payload, atUri }) {
  const obs = payload || {};
  const photos = Array.isArray(obs.photos) ? obs.photos : [];
  const first = photos[0];
  const src = first ? photoUrl(first, 'medium') : null;
  const common = obs.taxon?.commonName;
  const sci = obs.taxon?.name;
  const title = common || sci || 'Unidentified moth';
  const showSci = sci && sci !== title;
  const alt = common || sci || 'Moth observation';

  return (
    <article className="moth-card feed-card" data-at-uri={atUri}>
      {src && (
        <a
          className="moth-card-thumb"
          href={obs.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`View ${alt} on iNaturalist`}
        >
          <img src={src} alt={alt} loading="lazy" decoding="async" />
        </a>
      )}
      <div className="moth-card-body">
        <h3 className="moth-card-title">
          {obs.url ? (
            <a href={obs.url} target="_blank" rel="noreferrer noopener">{title}</a>
          ) : (
            title
          )}
        </h3>
        {showSci && <span className="moth-card-sci">{sci}</span>}
        {obs.qualityGrade === 'research' && (
          <span className="small-caps moth-card-grade">Research grade</span>
        )}
        {obs.description && (
          <p className="moth-card-desc">{renderPlainTextWithTruncatedUrls(obs.description)}</p>
        )}
      </div>
    </article>
  );
}
