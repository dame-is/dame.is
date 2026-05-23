import { useState } from 'react';
import { Link } from 'react-router-dom';
import { relativeTime } from '../lib/time.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { renderPostText } from '../lib/postRichText.jsx';
import { renderPlainTextWithTruncatedUrls } from '../lib/feedUrlFormat.jsx';
import PostEmbed from './PostEmbed.jsx';
import { ME_DID } from '../config.js';

/**
 * Renders the unified-feed entry for any reference-style record (likes,
 * reposts, follows, stars, favorites, votes). The verb badge to the
 * left is rendered by FeedItem; this component owns the body.
 *
 * Two display modes:
 *   - compact (default): a single-line lead-in like
 *       "a post by [avatar] Parker Molloy @parkermolloy.com"
 *     with an expand affordance.
 *   - expanded: the full subject preview (post text, embed, profile bio,
 *     etc.) — same component used everywhere ReferenceCard is rendered.
 *
 * Follow records skip the expand affordance: their compact form already
 * shows the same data the expanded form would (avatar, handle, name).
 *
 * The `subject` is populated by `src/lib/subjectResolver.js` (used by
 * both the build-time prefetch and the browser's live home-feed refresh).
 * When it's missing, we render a graceful "<verb> a deleted X" line.
 */
export default function ReferenceCard({ payload, atUri, createdAt, source, subject, verb }) {
  const [expanded, setExpanded] = useState(false);
  const ts = createdAt || payload?.createdAt;
  const expandable = canExpand(subject);
  return (
    <article className={`reference-card feed-card reference-card-${verb || 'reference'}`} data-at-uri={atUri}>
      <div className="reference-card-row">
        <CompactSubject subject={subject} source={source} />
        <div className="reference-card-row-meta">
          {ts && (
            <span className="gutter reference-card-time">
              {relativeTime(ts)}
            </span>
          )}
          {expandable && (
            <button
              type="button"
              className="reference-card-expand"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse subject preview' : 'Expand subject preview'}
            >
              <span className="reference-card-expand-caret" aria-hidden="true">
                {expanded ? '−' : '+'}
              </span>
            </button>
          )}
        </div>
      </div>
      {expanded && expandable && (
        <SubjectPreview subject={subject} source={source} />
      )}
    </article>
  );
}

/**
 * Whether the compact line elides any subject content worth expanding.
 * For Bluesky posts that's the body text + embed; for generic atproto
 * records it's the description. Profiles never expand because their
 * compact form already shows everything the expanded form would.
 */
function canExpand(subject) {
  if (!subject || subject.missing) return false;
  switch (subject.kind) {
    case 'bsky.post': {
      const v = subject.view;
      return Boolean(v?.record?.text || v?.embed || v?.record?.embed);
    }
    case 'atproto':
      return Boolean(subject.record?.value?.description || subject.record?.value?.summary);
    case 'bsky.profile':
    default:
      return false;
  }
}

/**
 * One-line lead-in. Tries to read like prose: "a post by …", "@handle".
 */
function CompactSubject({ subject, source }) {
  if (!subject) return <p className="reference-card-compact">an unknown record</p>;
  if (subject.missing) return <CompactMissing subject={subject} source={source} />;
  switch (subject.kind) {
    case 'bsky.post':
      return <CompactBskyPost view={subject.view} />;
    case 'bsky.profile':
      return <CompactBskyProfile view={subject.view} />;
    case 'atproto':
      return <CompactAtproto record={subject.record} ref={subject.ref} source={source} />;
    default:
      return <p className="reference-card-compact">an unknown record</p>;
  }
}

function CompactBskyPost({ view }) {
  if (!view) return <p className="reference-card-compact">an unavailable post</p>;
  const author = view.author || {};
  const isMine = author.did === ME_DID;
  const localHref = isMine && view.uri ? recordPathFromAtUri(view.uri) : null;
  const externalHref = !localHref && view.uri && author.handle
    ? `https://bsky.app/profile/${author.handle}/post/${view.uri.split('/').pop()}`
    : null;
  // The compact line intentionally drops avatar + display name — they make
  // a tall, busy chip and the wrap is awkward when the name is long. The
  // expand affordance reveals the full author header inside the preview.
  // Render the handle as a plain inline span (no inline-flex wrapper) so
  // it shares a baseline with the leading "a post by" text instead of
  // riding above it on the parent chip's vertical-align: middle.
  const handleChip = (
    <span className="reference-card-author-handle">
      {author?.handle ? `@${author.handle}` : 'an unknown author'}
    </span>
  );
  const link = localHref ? (
    <Link to={localHref} className="reference-card-compact-link">
      {handleChip}
    </Link>
  ) : externalHref ? (
    <a href={externalHref} target="_blank" rel="noreferrer noopener" className="reference-card-compact-link">
      {handleChip}
    </a>
  ) : (
    handleChip
  );
  return (
    <p className="reference-card-compact">
      a post by {link}
    </p>
  );
}

function AuthorChip({ author }) {
  return (
    <span className="reference-card-author">
      {author?.avatar && (
        <img
          className="reference-card-author-avatar"
          src={author.avatar}
          alt=""
          width={20}
          height={20}
          loading="lazy"
        />
      )}
      {author?.displayName && (
        <span className="reference-card-author-name">{author.displayName}</span>
      )}
      {author?.handle && (
        <span className="reference-card-author-handle">@{author.handle}</span>
      )}
    </span>
  );
}

function CompactBskyProfile({ view }) {
  if (!view) return <p className="reference-card-compact">an unavailable profile</p>;
  const href = view.handle ? `https://bsky.app/profile/${view.handle}` : null;
  const chip = <AuthorChip author={view} />;
  return (
    <p className="reference-card-compact">
      {href ? (
        <a href={href} target="_blank" rel="noreferrer noopener" className="reference-card-compact-link">{chip}</a>
      ) : (
        chip
      )}
    </p>
  );
}

function CompactAtproto({ record, ref, source }) {
  if (!record?.value) {
    const fallback = source ? `a ${source} record` : 'a record';
    return <p className="reference-card-compact">{fallback}</p>;
  }
  const v = record.value;
  const collection = collectionFromAtUri(record.uri);
  const title = v.title || v.name || v.displayName || v.repo || v.repoName || rkeyFromAtUri(record.uri) || 'a record';
  const externalHref = canonicalViewerFor(record.uri, source);
  const inner = (
    <span className="reference-card-author">
      {source && <span className="small-caps reference-card-author-source">{source}</span>}
      <span className="reference-card-author-name">{title}</span>
    </span>
  );
  return (
    <p className="reference-card-compact">
      a {labelForCollection(collection, source)}{' '}
      {externalHref ? (
        <a href={externalHref} target="_blank" rel="noreferrer noopener" className="reference-card-compact-link">{inner}</a>
      ) : (
        inner
      )}
    </p>
  );
}

function CompactMissing({ subject, source }) {
  const ref = subject?.ref || {};
  const externalHref = canonicalViewerFor(ref.uri || ref.did, source);
  const label = source ? `a ${source} record` : 'a record';
  return (
    <p className="reference-card-compact reference-card-missing">
      {externalHref ? (
        <a href={externalHref} target="_blank" rel="noreferrer noopener">{label}</a>
      ) : (
        label
      )}{' '}
      <span className="reference-card-missing-tag">(unavailable)</span>
    </p>
  );
}

function labelForCollection(collection, source) {
  if (collection === 'social.grain.gallery') return 'gallery';
  if (collection === 'social.grain.story') return 'story';
  if (collection === 'pub.leaflet.document') return 'document';
  if (collection === 'pub.leaflet.publication') return 'publication';
  if (collection === 'pub.leaflet.poll') return 'poll';
  if (collection === 'sh.tangled.repo') return 'repo';
  if (collection === 'site.standard.document') return 'document';
  if (collection === 'site.standard.publication') return 'publication';
  if (source) return 'record';
  return 'record';
}

/* ------------------------------------------------------------------ */
/* Expanded preview                                                    */
/* ------------------------------------------------------------------ */

function SubjectPreview({ subject, source }) {
  switch (subject.kind) {
    case 'bsky.post':
      return <BskyPostPreview view={subject.view} />;
    case 'bsky.profile':
      return <BskyProfilePreview view={subject.view} />;
    case 'atproto':
      return <AtprotoRecordPreview record={subject.record} ref={subject.ref} source={source} />;
    default:
      return null;
  }
}

function BskyPostPreview({ view }) {
  if (!view) return null;
  const author = view.author || {};
  const text = view.record?.text || '';
  const facets = view.record?.facets || null;
  const embed = view.embed || view.record?.embed || null;
  const profileHref = author.handle ? `https://bsky.app/profile/${author.handle}` : null;
  const hasAuthor = author.handle || author.displayName || author.avatar;
  return (
    <article className="reference-card-subject reference-card-subject-post">
      {hasAuthor && (
        <header className="reference-card-subject-head">
          {profileHref ? (
            <a
              href={profileHref}
              target="_blank"
              rel="noreferrer noopener"
              className="reference-card-subject-author"
            >
              <AuthorChip author={author} />
            </a>
          ) : (
            <span className="reference-card-subject-author">
              <AuthorChip author={author} />
            </span>
          )}
        </header>
      )}
      {text && (
        <p className="reference-card-subject-text">{renderPostText(text, facets)}</p>
      )}
      {embed && <PostEmbed embed={embed} did={author.did} />}
    </article>
  );
}

function BskyProfilePreview({ view }) {
  if (!view) return null;
  return (
    <article className="reference-card-subject reference-card-subject-profile">
      {view.description && (
        <p className="reference-card-subject-profile-desc">
          {renderPlainTextWithTruncatedUrls(view.description)}
        </p>
      )}
    </article>
  );
}

function AtprotoRecordPreview({ record, source }) {
  if (!record?.value) return null;
  const v = record.value;
  const summary = v.description || v.summary || v.about || '';
  if (!summary) return null;
  return (
    <article className="reference-card-subject reference-card-subject-atproto">
      <p className="reference-card-subject-desc">{renderPlainTextWithTruncatedUrls(summary)}</p>
    </article>
  );
}

/**
 * Best-effort link to the canonical viewer for a referenced record.
 * Falls back to atproto-browser for anything unrecognized.
 */
function canonicalViewerFor(uri, source) {
  if (!uri) return null;
  const m = String(uri).match(/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  const [, did, collection, rkey] = m;
  if (collection === 'app.bsky.feed.post') {
    return `https://bsky.app/profile/${did}/post/${rkey}`;
  }
  if (source === 'grain') return `https://grain.social/profile/${did}/gallery/${rkey}`;
  if (source === 'tangled') return `https://tangled.org/${did}/${rkey}`;
  if (source === 'leaflet') return `https://leaflet.pub/${did}/${rkey}`;
  if (source === 'standard') return `https://standard.site/${did}/${rkey}`;
  return `https://atproto-browser.vercel.app/at?u=${encodeURIComponent(uri)}`;
}

function collectionFromAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/[^/]+\/([^/]+)\//);
  return m ? m[1] : null;
}

function rkeyFromAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/[^/]+\/[^/]+\/([^/?#]+)/);
  return m ? m[1] : null;
}
