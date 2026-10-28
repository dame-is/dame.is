import { safeHref } from '../lib/safeHref.js';
import './LinkCard.css';

/**
 * The one reference card: a link to somewhere off the site, with its host as
 * an eyebrow, its title, an optional description and thumbnail, on one nest
 * step of fill inside a --rule-soft hairline. Two sizes of the same object:
 *   - 'compact' (default): a post's external embed, in the feed or on a
 *     record page;
 *   - 'full': a website block in a long document (Leaflet), with a larger
 *     thumbnail and title.
 * It replaces two builds that disagreed about every one of those (the host's
 * case and tracking, the fill, the hairline, and a title on an undefined
 * --text-md).
 *
 * The class names are the post embed's (`post-embed-link-card…`), kept
 * because the ledger's compact rows and the sky theme's nest inks address
 * the card by them.
 *
 * `href` is foreign data (an embed, a document block), so it goes through the
 * scheme allowlist; a rejected one renders the same card as an inert <div>.
 */
export default function LinkCard({ href, title, description, thumb, host, size = 'compact', className = '', style }) {
  const safe = safeHref(href);
  const shownHost = host || hostOf(href);
  const cls = `post-embed-link-card is-${size === 'full' ? 'full' : 'compact'} ${className}`.trim();
  const inner = (
    <>
      {thumb && (
        <div className="post-embed-link-card-thumb">
          <img src={thumb} alt="" loading="lazy" />
        </div>
      )}
      <div className="post-embed-link-card-body">
        {/* An eyebrow, with the host itself exempt from the capitals: a
            hostname reads in the case it's typed in. */}
        <div className="post-embed-link-card-host eyebrow">
          <span className="unit">{shownHost}</span>
        </div>
        {title && <div className="post-embed-link-card-title">{title}</div>}
        {description && <div className="post-embed-link-card-desc">{description}</div>}
      </div>
    </>
  );
  if (!safe) {
    return (
      <div className={cls} style={style || undefined}>
        {inner}
      </div>
    );
  }
  return (
    <a className={cls} href={safe} target="_blank" rel="noreferrer noopener" style={style || undefined}>
      {inner}
    </a>
  );
}

function hostOf(href) {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href || '';
  }
}
