/**
 * Renders an `app.bsky.graph.list` record. The prefetch step folds the
 * list's `app.bsky.graph.listitem` members into a `_members` array on
 * the underlying record, so `payload.members` (when populated) gives us
 * the count without an extra round-trip.
 */
import { renderPlainTextWithTruncatedUrls } from '../../lib/feedUrlFormat.jsx';

export default function ListCard({ payload, atUri }) {
  const name = payload?.name || 'Untitled list';
  const purpose = payload?.purpose || '';
  const description = payload?.description || '';
  const members = Array.isArray(payload?._members) ? payload._members : [];
  const count = members.length;
  const externalHref = atUri ? `https://bsky.app/profile/${ownerDidFromAtUri(atUri)}/lists/${rkeyFromAtUri(atUri)}` : null;

  return (
    <article className="list-card feed-card" data-at-uri={atUri}>
      <header className="list-card-head">
        <h3 className="list-card-title">
          {externalHref ? (
            <a href={externalHref} target="_blank" rel="noreferrer noopener">{name}</a>
          ) : (
            name
          )}
        </h3>
        {purpose && (
          <span className="small-caps list-card-purpose">{purposeLabel(purpose)}</span>
        )}
      </header>
      {description && (
        <p className="list-card-desc">{renderPlainTextWithTruncatedUrls(description)}</p>
      )}
      {count > 0 && (
        <p className="gutter list-card-count">
          {count} {count === 1 ? 'member' : 'members'}
        </p>
      )}
    </article>
  );
}

function purposeLabel(purpose) {
  const m = String(purpose).match(/#(\w+)/);
  return m ? m[1] : purpose;
}

function ownerDidFromAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/([^/]+)\//);
  return m ? m[1] : '';
}

function rkeyFromAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/[^/]+\/[^/]+\/([^/?#]+)/);
  return m ? m[1] : '';
}
