import { Link } from 'react-router-dom';
import { relativeTime } from '../lib/time.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { renderPostText } from '../lib/postRichText.jsx';
import PostEmbed from './PostEmbed.jsx';
import { ME_DID } from '../config.js';

/**
 * Renders the unified-feed entry for any reference-style record (likes,
 * reposts, follows, stars, favorites, votes). The verb badge to the left
 * is rendered by FeedItem; this component owns the body — a short
 * "<verb> <subject>" lead-in followed by an inline preview of the
 * referenced record.
 *
 * The `item.subject` field is populated at prefetch time by
 * `scripts/lib/resolveSubject.mjs`. When the subject is missing we still
 * render a graceful "<verb> a deleted X" line.
 */
export default function ReferenceCard({ payload, atUri, createdAt, source, subject, verb }) {
  const ts = createdAt || payload?.createdAt;
  return (
    <article className={`reference-card feed-card reference-card-${verb || 'reference'}`} data-at-uri={atUri}>
      <SubjectPreview subject={subject} source={source} />
      {ts && (
        <span className="gutter reference-card-time">
          {relativeTime(ts)}
        </span>
      )}
    </article>
  );
}

/**
 * Polymorphic preview block. Switches on the resolved subject's kind so
 * each protocol gets a fitting card without duplicating logic across
 * verbs (a "like" of a post and a "repost" of a post both use the post
 * preview here).
 */
function SubjectPreview({ subject, source }) {
  if (!subject) {
    return <p className="reference-card-missing">an unknown record</p>;
  }
  if (subject.missing) {
    return <SubjectMissing subject={subject} source={source} />;
  }
  switch (subject.kind) {
    case 'bsky.post':
      return <BskyPostPreview view={subject.view} />;
    case 'bsky.profile':
      return <BskyProfilePreview view={subject.view} />;
    case 'atproto':
      return <AtprotoRecordPreview record={subject.record} ref={subject.ref} source={source} />;
    default:
      return <p className="reference-card-missing">an unknown record</p>;
  }
}

function SubjectMissing({ subject, source }) {
  const ref = subject?.ref || {};
  const externalHref = canonicalViewerFor(ref.uri || ref.did, source);
  const label = source ? `a ${source} record` : 'a record';
  return (
    <p className="reference-card-missing">
      {externalHref ? (
        <a href={externalHref} target="_blank" rel="noreferrer noopener">{label}</a>
      ) : (
        label
      )}
      {' '}
      <span className="reference-card-missing-tag">(unavailable)</span>
    </p>
  );
}

function BskyPostPreview({ view }) {
  if (!view) return <p className="reference-card-missing">an unavailable post</p>;
  const author = view.author || {};
  const text = view.record?.text || '';
  const facets = view.record?.facets || null;
  const embed = view.embed || view.record?.embed || null;
  const ts = view.record?.createdAt || view.indexedAt;
  const isMine = author.did === ME_DID;
  const localHref = isMine && view.uri ? recordPathFromAtUri(view.uri) : null;
  const externalHref = !localHref && view.uri && author.handle
    ? `https://bsky.app/profile/${author.handle}/post/${view.uri.split('/').pop()}`
    : null;
  return (
    <article className="reference-card-subject reference-card-subject-post">
      <header className="reference-card-subject-head">
        {author.avatar && (
          <img
            className="reference-card-subject-avatar"
            src={author.avatar}
            alt=""
            width={20}
            height={20}
            loading="lazy"
          />
        )}
        <span className="reference-card-subject-author">
          {author.displayName && <span className="reference-card-subject-name">{author.displayName}</span>}
          {author.handle && <span className="reference-card-subject-handle">@{author.handle}</span>}
        </span>
        {ts && (
          <span className="gutter reference-card-subject-time">
            {localHref ? (
              <Link to={localHref}>{relativeTime(ts)}</Link>
            ) : externalHref ? (
              <a href={externalHref} target="_blank" rel="noreferrer noopener">{relativeTime(ts)}</a>
            ) : (
              relativeTime(ts)
            )}
          </span>
        )}
      </header>
      {text && (
        <p className="reference-card-subject-text">{renderPostText(text, facets)}</p>
      )}
      {embed && <PostEmbed embed={embed} did={author.did} />}
    </article>
  );
}

function BskyProfilePreview({ view }) {
  if (!view) return <p className="reference-card-missing">an unavailable profile</p>;
  const href = view.handle ? `https://bsky.app/profile/${view.handle}` : null;
  const name = view.displayName || view.handle || view.did;
  return (
    <article className="reference-card-subject reference-card-subject-profile">
      {view.avatar && (
        <img
          className="reference-card-subject-avatar"
          src={view.avatar}
          alt=""
          width={28}
          height={28}
          loading="lazy"
        />
      )}
      <div className="reference-card-subject-profile-body">
        <p className="reference-card-subject-profile-name">
          {href ? (
            <a href={href} target="_blank" rel="noreferrer noopener">{name}</a>
          ) : (
            name
          )}
          {view.handle && <span className="reference-card-subject-handle"> @{view.handle}</span>}
        </p>
        {view.description && (
          <p className="reference-card-subject-profile-desc">{view.description}</p>
        )}
      </div>
    </article>
  );
}

/**
 * Universal preview for non-bsky records (Grain galleries, Tangled repos,
 * Leaflet docs, standard.site posts). We don't have a per-protocol
 * AppView resolution layer for each one yet, so we render the lexicon's
 * native fields (title / description / kind) and link out to the
 * canonical viewer.
 */
function AtprotoRecordPreview({ record, ref, source }) {
  if (!record?.value) return <p className="reference-card-missing">an unavailable record</p>;
  const v = record.value;
  const collection = collectionFromAtUri(record.uri);
  const title = v.title || v.name || v.displayName || v.repo || v.repoName || rkeyFromAtUri(record.uri) || 'a record';
  const summary = v.description || v.summary || v.about || '';
  const externalHref = canonicalViewerFor(record.uri, source);
  return (
    <article className="reference-card-subject reference-card-subject-atproto">
      <header className="reference-card-subject-head">
        {source && <span className="small-caps reference-card-subject-source">{source}</span>}
        {collection && <span className="reference-card-subject-collection gutter">{collection}</span>}
      </header>
      <p className="reference-card-subject-title">
        {externalHref ? (
          <a href={externalHref} target="_blank" rel="noreferrer noopener">{title}</a>
        ) : (
          title
        )}
      </p>
      {summary && <p className="reference-card-subject-desc">{summary}</p>}
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
