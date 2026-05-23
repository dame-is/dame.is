/**
 * Renders Grain galleries (`social.grain.gallery`) and Grain stories
 * (`social.grain.story`). Both lexicons carry an array of image / item
 * blobs plus optional title and description; the card surfaces a thumb
 * grid (or first frame for stories) with caption + link out.
 */
import { Link } from 'react-router-dom';
import { renderPlainTextWithTruncatedUrls } from '../../lib/feedUrlFormat.jsx';
import { explorerPathFromAtUri } from '../../lib/atproto.js';

export default function MediaCard({ payload, atUri, source }) {
  const title = payload?.title || payload?.name || '';
  const description = payload?.description || payload?.caption || '';
  const items = pickItems(payload);
  const viewerHref = canonicalViewer(atUri, source);
  const viewerIsInternal = typeof viewerHref === 'string' && viewerHref.startsWith('/');
  const visible = items.slice(0, 4);
  const overflow = Math.max(0, items.length - visible.length);

  return (
    <article className="media-card feed-card" data-at-uri={atUri}>
      {(title || description) && (
        <header className="media-card-head">
          {title && (
            <h3 className="media-card-title">
              {viewerHref ? (
                viewerIsInternal ? (
                  <Link to={viewerHref}>{title}</Link>
                ) : (
                  <a href={viewerHref} target="_blank" rel="noreferrer noopener">{title}</a>
                )
              ) : (
                title
              )}
            </h3>
          )}
          {description && (
            <p className="media-card-desc">{renderPlainTextWithTruncatedUrls(description)}</p>
          )}
        </header>
      )}
      {visible.length > 0 && (
        <div className="media-card-grid" data-count={visible.length}>
          {visible.map((it, i) => {
            const inner = it.url ? (
              <img src={it.url} alt={it.alt || ''} loading="lazy" decoding="async" />
            ) : (
              <span className="media-card-thumb-placeholder">image</span>
            );
            // Prefer the canonical record viewer (Grain page, or our
            // explorer) when we have one; fall back to the bare image URL.
            if (viewerIsInternal) {
              return (
                <Link
                  key={i}
                  to={viewerHref}
                  className="media-card-thumb"
                  aria-label={it.alt || 'Open image'}
                >
                  {inner}
                </Link>
              );
            }
            return (
              <a
                key={i}
                className="media-card-thumb"
                href={viewerHref || it.url || '#'}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={it.alt || 'Open image'}
              >
                {inner}
              </a>
            );
          })}
          {overflow > 0 && (
            <span className="media-card-overflow gutter">+{overflow}</span>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Both Grain lexicons store image references in a few possible shapes.
 * Try the common ones — `items`, `images`, `media` — and bake a URL out
 * of any blob refs we recognise. If nothing matches we render the card
 * sans grid so the title/description still show.
 */
function pickItems(payload) {
  const arr =
    pickArray(payload?.items) ||
    pickArray(payload?.images) ||
    pickArray(payload?.media) ||
    pickArray(payload?.frames) ||
    [];
  return arr
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const url = entry.url || entry._url || entry.fullsize || entry.thumb || null;
      const alt = entry.alt || entry.caption || '';
      if (!url) return null;
      return { url, alt };
    })
    .filter(Boolean);
}

function pickArray(maybe) {
  return Array.isArray(maybe) ? maybe : null;
}

function canonicalViewer(atUri, source) {
  if (!atUri) return null;
  const m = String(atUri).match(/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  const [, did, , rkey] = m;
  if (source === 'grain') return `https://grain.social/profile/${did}/gallery/${rkey}`;
  // Anything we don't have a bespoke external viewer for lands in our
  // own explorer.
  return explorerPathFromAtUri(atUri);
}
