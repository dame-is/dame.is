import { Link } from 'react-router-dom';
import { ME_DID } from '../../config.js';
import { recordPathFromAtUri } from '../../lib/recordRoutes.js';
import { redactionSpans } from '../../lib/anisotaLab.js';
import { useSourcePost } from '../../hooks/useSourcePost.js';
import RelativeTimeText from '../RelativeTimeText.jsx';

/**
 * An erasure poem (`net.anisota.lab.redaction`) as the thing it actually is:
 * somebody's post, shown in the same quoted-post frame a repost gets, with the
 * blacked-out words struck by carved marker bars. The words left standing are
 * the found poem — they read straight off the post, so the record's assembled
 * `text` is never printed a second time underneath (it does carry the piece's
 * accessible label, since the struck words are hidden from a reader).
 *
 * The frame's author line comes from the source post itself. The home feed
 * hydrates it while it builds (the redaction collection declares its `source`
 * backlink as a subject — see verbRegistry); everywhere else the hook fetches
 * it. Either way the piece still reads if the post is gone: the erasure is
 * laid over the record's own snapshot of the text, and the record's stored
 * `author` handle carries the attribution.
 *
 * Shared by AnisotaLabCard (feed + record page) and FeedLedgerRow.
 */
export default function RedactedPost({ value, subject }) {
  const v = value || {};
  const hydrated = subject?.kind === 'bsky.post' && !subject.missing ? subject.view : null;
  const fetched = useSourcePost(hydrated ? null : v.source);
  const view = hydrated || fetched;

  // The erasure only lines up over the text its indices were counted against:
  // the snapshot saved with the piece, or — for a piece saved before those
  // were kept — the post as it reads now.
  const original =
    (typeof v.original === 'string' && v.original) || view?.record?.text || '';
  if (!original) {
    return v.text ? <p className="lab-card-text">{v.text}</p> : null;
  }

  const author = view?.author || null;
  // The source post's author DID is the authority of its own at:// URI, so
  // attribution survives even when the post can't be re-fetched.
  const did = author?.did || didFromAtUri(v.source);
  // A record saved before handles were kept stores a DID here; that's the
  // one thing not worth printing as "@…".
  const storedHandle = typeof v.author === 'string' && !v.author.startsWith('did:')
    ? v.author
    : null;
  const handle = author?.handle || storedHandle;
  const ts = view?.record?.createdAt || view?.indexedAt || null;
  const href = sourceHref(v.source, did, handle);

  const spans = redactionSpans(original, v.redacted);
  const label = v.text ? `Erasure poem: ${v.text}` : 'An erasure poem';

  return (
    <article className="post-embed-quote lab-redaction-source">
      <header className="post-embed-quote-head">
        {author?.avatar && (
          <img
            className="post-embed-quote-avatar"
            src={author.avatar}
            alt=""
            width={20}
            height={20}
            loading="lazy"
          />
        )}
        <span className="post-embed-quote-author">
          {author?.displayName && (
            <span className="post-embed-quote-name">{author.displayName}</span>
          )}
          {handle && <span className="post-embed-quote-handle">@{handle}</span>}
        </span>
        {ts && (
          <span className="post-embed-quote-time gutter">
            <SourceLink href={href}>
              <RelativeTimeText value={ts} />
            </SourceLink>
          </span>
        )}
      </header>
      <p className="post-embed-quote-text lab-redaction" aria-label={label}>
        {spans.map((span, i) =>
          span.redacted ? (
            <span
              key={i}
              className={`lab-redaction-word is-redacted${span.joinedLeft ? ' redact-join-left' : ''}${span.joinedRight ? ' redact-join-right' : ''}`}
              style={span.style}
              aria-hidden="true"
            >
              {span.text}
            </span>
          ) : (
            <span key={i}>{span.text}</span>
          ),
        )}
      </p>
    </article>
  );
}

/** Dame's own posts have a page here; everyone else's live on bsky.app. */
function sourceHref(atUri, did, handle) {
  if (!atUri) return null;
  if (did === ME_DID) return recordPathFromAtUri(atUri) || null;
  const rkey = String(atUri).split('/').pop();
  const who = handle || did;
  return who && rkey ? `https://bsky.app/profile/${who}/post/${rkey}` : null;
}

function SourceLink({ href, children }) {
  if (!href) return children;
  if (href.startsWith('/')) return <Link to={href}>{children}</Link>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

function didFromAtUri(atUri) {
  const m = String(atUri || '').match(/^at:\/\/([^/]+)\//);
  return m ? m[1] : null;
}
