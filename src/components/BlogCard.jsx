import { Link } from 'react-router-dom';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { renderPlainTextWithTruncatedUrls } from '../lib/feedUrlFormat.jsx';

/**
 * Compact card for a long-form entry inside the unified Home feed.
 * Handles all five "blogging" sources currently in the registry:
 *   - is.dame.blogging.post  — addressed by `slug`, native /blogging page
 *   - pub.leaflet.document   — addressed by rkey, native /blogging page (mirrored)
 *   - pub.leaflet.publication — leaflet publication (links out to leaflet)
 *   - site.standard.document  — standard.site document (links out)
 *   - site.standard.publication — standard.site publication (links out)
 *
 * The `source` prop is set by the prefetch step; falling back to the
 * record's `$type` keeps live-merged AppView responses working too.
 */
export default function BlogCard({ payload, atUri, source }) {
  const nsid = payload?.$type || collectionFromAtUri(atUri);
  const resolvedSource = source || sourceForNsid(nsid);
  const rkey = rkeyFromAtUri(atUri);

  const title =
    payload?.title ||
    payload?.name ||
    payload?.slug ||
    rkey ||
    'Untitled';

  const summary = pickSummary(payload, nsid);

  const href = blogHref({ payload, rkey, nsid, source: resolvedSource });
  const isExternal = href?.startsWith('http');

  return (
    <article className={`blog-card feed-card blog-card-source-${resolvedSource}`} data-at-uri={atUri}>
      <header className="blog-card-head">
        <h3 className="blog-card-title">
          {href ? (
            isExternal ? (
              <a href={href} target="_blank" rel="noreferrer noopener">{title}</a>
            ) : (
              <Link to={href}>{title}</Link>
            )
          ) : (
            title
          )}
        </h3>
        {resolvedSource && resolvedSource !== 'dame' && (
          <span className="small-caps blog-card-source">{resolvedSource}</span>
        )}
      </header>
      {summary && (
        <p className="blog-card-summary">{renderPlainTextWithTruncatedUrls(summary)}</p>
      )}
    </article>
  );
}

function pickSummary(payload, nsid) {
  if (!payload) return '';
  if (payload.summary) return payload.summary;
  if (payload.description) return payload.description;
  if (payload.body) return String(payload.body).slice(0, 280);
  if (nsid === 'pub.leaflet.publication' || nsid === 'site.standard.publication') {
    return payload.tagline || payload.about || '';
  }
  return '';
}

function blogHref({ payload, rkey, nsid, source }) {
  // Records mirrored to the /blogging index get a same-site link.
  if (nsid === 'is.dame.blogging.post' && payload?.slug) {
    return `/blogging/${payload.slug}`;
  }
  if (nsid === 'pub.leaflet.document' && rkey) {
    return `/blogging/${rkey}`;
  }
  // Everything else links out to its native viewer. We don't host a
  // first-class reader for leaflet publications or standard.site yet, but
  // the `Record` page (via `/{nsid}/{rkey}`) gives a deep-linkable JSON
  // fallback if a visitor wants to inspect the raw record.
  if (source === 'leaflet' || source === 'standard') {
    return externalViewer({ source, atUri: payload?.atUri, rkey, nsid }) || nsidPath(nsid, rkey);
  }
  return nsidPath(nsid, rkey);
}

function externalViewer({ source, rkey, nsid }) {
  // Without a DID handy we can't always build a per-author URL; the
  // canonical-viewer logic on the prefetch side / ReferenceCard does the
  // heavy lifting. For BlogCard we fall back to the in-app record page.
  return null;
}

function nsidPath(nsid, rkey) {
  return nsid && rkey ? `/${nsid}/${encodeURIComponent(rkey)}` : null;
}

function collectionFromAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/[^/]+\/([^/]+)\//);
  return m ? m[1] : null;
}

function sourceForNsid(nsid) {
  if (!nsid) return 'dame';
  if (nsid.startsWith('pub.leaflet.')) return 'leaflet';
  if (nsid.startsWith('site.standard.')) return 'standard';
  return 'dame';
}
