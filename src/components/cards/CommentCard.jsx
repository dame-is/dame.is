/**
 * Renders a comment record. Both `social.grain.comment` and
 * `pub.leaflet.comment` carry a body of text plus a reference to the
 * thing they comment on (`subject` / `on` / `target`). We surface the
 * comment text and a small "on …" hint linking to the parent.
 */
import { Link } from 'react-router-dom';
import { renderPlainTextWithTruncatedUrls } from '../../lib/feedUrlFormat.jsx';
import { explorerPathFromAtUri } from '../../lib/atproto.js';

export default function CommentCard({ payload, atUri, source }) {
  const text = payload?.text || payload?.body || payload?.content || '';
  const subjectRef = payload?.subject || payload?.on || payload?.target || null;
  const subjectUri = typeof subjectRef === 'string' ? subjectRef : subjectRef?.uri;
  const subjectHref = canonicalViewer(subjectUri, source);
  const subjectInternal = typeof subjectHref === 'string' && subjectHref.startsWith('/');
  const label = labelForSubject(subjectUri, source);

  return (
    <article className="comment-card feed-card" data-at-uri={atUri}>
      <p className="comment-card-text">
        {text ? renderPlainTextWithTruncatedUrls(text) : <em>—</em>}
      </p>
      {subjectUri && (
        <p className="comment-card-on gutter small-caps">
          on{' '}
          {subjectHref ? (
            subjectInternal ? (
              <Link to={subjectHref}>{label}</Link>
            ) : (
              <a href={subjectHref} target="_blank" rel="noreferrer noopener">{label}</a>
            )
          ) : (
            label
          )}
        </p>
      )}
    </article>
  );
}

function labelForSubject(uri, source) {
  if (!uri) return '';
  if (source === 'grain') return 'a photo';
  if (source === 'leaflet') return 'a document';
  return 'a record';
}

function canonicalViewer(uri, source) {
  if (!uri) return null;
  const m = String(uri).match(/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  const [, did, , rkey] = m;
  if (source === 'grain') return `https://grain.social/profile/${did}/gallery/${rkey}`;
  if (source === 'leaflet') return `https://leaflet.pub/${did}/${rkey}`;
  // Anything else lands in our own explorer.
  return explorerPathFromAtUri(uri);
}
