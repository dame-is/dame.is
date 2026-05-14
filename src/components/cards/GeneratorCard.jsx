import { renderPlainTextWithTruncatedUrls } from '../../lib/feedUrlFormat.jsx';

/**
 * Renders an `app.bsky.feed.generator` record — a custom feed that the
 * user has published. Avatar (when the record carries one as a blob) is
 * surfaced via `payload.avatar?._url`; otherwise we render a text-only
 * card.
 */
export default function GeneratorCard({ payload, atUri }) {
  const displayName = payload?.displayName || 'Untitled feed';
  const description = payload?.description || '';
  const did = ownerDidFromAtUri(atUri);
  const rkey = rkeyFromAtUri(atUri);
  const externalHref = did && rkey
    ? `https://bsky.app/profile/${did}/feed/${rkey}`
    : null;
  const avatarUrl = payload?.avatar?._url || null;

  return (
    <article className="generator-card feed-card" data-at-uri={atUri}>
      <div className="generator-card-row">
        {avatarUrl && (
          <img
            className="generator-card-avatar"
            src={avatarUrl}
            alt=""
            width={40}
            height={40}
            loading="lazy"
          />
        )}
        <div className="generator-card-body">
          <h3 className="generator-card-title">
            {externalHref ? (
              <a href={externalHref} target="_blank" rel="noreferrer noopener">{displayName}</a>
            ) : (
              displayName
            )}
          </h3>
          {description && (
            <p className="generator-card-desc">{renderPlainTextWithTruncatedUrls(description)}</p>
          )}
        </div>
      </div>
    </article>
  );
}

function ownerDidFromAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/([^/]+)\//);
  return m ? m[1] : '';
}

function rkeyFromAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/[^/]+\/[^/]+\/([^/?#]+)/);
  return m ? m[1] : '';
}
