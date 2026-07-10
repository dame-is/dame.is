import { Link } from 'react-router-dom';
import { formatTime } from '../lib/time.js';
import { renderPostText } from '../lib/postRichText.jsx';
import { renderPlainTextWithTruncatedUrls } from '../lib/feedUrlFormat.jsx';
import { getReplyHint } from '../lib/postReplyHint.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import PostEmbed from './PostEmbed.jsx';
import { ME_DID } from '../config.js';

/**
 * The home feed's second layout ("ledger"): each record renders as one
 * hairline-ruled row of three aligned columns — verb · time · a
 * one-line typographic summary — with no icons, avatars, embeds, or
 * stats. FeedItem owns the surrounding <li> (row click, thread
 * classes); this component renders the cells inside it.
 *
 * Summaries are intentionally lossy: they compress each card down to
 * the line a reader can scan ("track — artist", "@handle", "a post by
 * @handle"). The row links to the record page, which keeps the full
 * treatment.
 */

/* Verb column labels are the same gerunds the site is named around
   ("dame.is …ing") — the registry verb itself, with replies shown as
   "replying" and self-thread follow-ons as "continuing". */
export default function FeedLedgerRow({ item, href }) {
  const replyHint = item.verb === 'posting' ? getReplyHint(item.payload) : null;
  const threadContinuation = item.verb === 'posting' && item._thread?.continuesPrev;
  const label = threadContinuation
    ? 'continuing'
    : replyHint
      ? 'replying'
      : item.verb;
  const ts =
    item.createdAt || item.payload?.createdAt || item.payload?.indexedAt || null;
  const summary = summarize(item);
  const embed = ledgerEmbed(item);
  return (
    <>
      {href ? (
        <Link className="ledger-verb" to={href}>
          {label}
        </Link>
      ) : (
        <span className="ledger-verb">{label}</span>
      )}
      <span className="ledger-time">{ts ? formatTime(ts) : ''}</span>
      <div className="ledger-body">
        {summary && <p className="ledger-text">{summary}</p>}
        {embed && (
          <div className="ledger-embed">
            <PostEmbed embed={embed.embed} did={embed.did} />
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Post embeds (images / video / link card / quote) ride along under the
 * summary line in a condensed, height-capped form (see the .ledger-embed
 * rules in Feed.css). Only posting/reposting rows carry one.
 */
function ledgerEmbed(item) {
  if (item.verb !== 'posting' && item.verb !== 'reposting') return null;
  const payload = item.payload || {};
  if (payload.subjectMissing) return null;
  const embed = payload.embed || payload.embedRecord || null;
  if (!embed) return null;
  return { embed, did: payload.author?.did };
}

function summarize(item) {
  const payload = item.payload || {};
  switch (item.verb) {
    case 'logging':
      return plain(payload.status || payload.text, 'a status');
    case 'posting':
    case 'reposting':
      return summarizePost(item);
    case 'blogging':
      return plain(payload.title || payload.name, 'an untitled entry');
    case 'listening':
      return summarizeListen(item);
    case 'creating':
      return plain(payload.title || payload.slug, 'an untitled work');
    case 'photographing': {
      const title = payload.title || payload.name || payload.description || payload.caption;
      return plain(title, 'a gallery');
    }
    case 'mothing':
    case 'observing':
      return summarizeObservation(item);
    case 'liking':
      return summarizeSubject(item.subject, item.source);
    case 'following':
      return summarizeProfile(item.subject);
    case 'listing':
      return plain(payload.name, 'an untitled list');
    case 'feeding':
      return plain(payload.displayName, 'an untitled feed');
    case 'commenting':
      return plain(payload.text || payload.body || payload.content, 'a comment');
    case 'voting': {
      const choice =
        payload.option ||
        payload.optionLabel ||
        payload.choice ||
        (typeof payload.optionIndex === 'number' ? `option ${payload.optionIndex + 1}` : null);
      if (choice) return <>chose {choice}</>;
      return summarizeSubject(item.subject, item.source);
    }
    default:
      return <Placeholder>a record</Placeholder>;
  }
}

/** Plain-text summary with URL truncation; muted placeholder when empty. */
function plain(text, fallback) {
  const t = (text || '').trim();
  if (!t) return <Placeholder>{fallback}</Placeholder>;
  return renderPlainTextWithTruncatedUrls(t);
}

function Placeholder({ children }) {
  return <em className="ledger-placeholder">{children}</em>;
}

/**
 * Posts keep their rich text (links / mentions render as anchors).
 * Text-less posts return null when an embed exists — the condensed
 * embed below carries the row on its own. Foreign authors (reposts)
 * get a leading @handle so attribution survives the loss of the
 * card's author header.
 */
function summarizePost(item) {
  const payload = item.payload || {};
  if (payload.subjectMissing) return <Placeholder>an unavailable post</Placeholder>;
  const text = payload.text || '';
  const hasEmbed = Boolean(payload.embed || payload.embedRecord);
  const body = text
    ? renderPostText(text, payload.facets || null)
    : hasEmbed
      ? null
      : <Placeholder>a post</Placeholder>;
  const author = payload.author;
  const foreignAuthor = author?.did && author.did !== ME_DID && author?.handle;
  if (!foreignAuthor) return body;
  return (
    <>
      <a
        className="ledger-handle"
        href={`https://bsky.app/profile/${author.handle}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        @{author.handle}
      </a>
      {body && <> — {body}</>}
    </>
  );
}

/**
 * "track — artist" for a single play; a collapsed session leads with
 * its artist pool (dedup'd, latest first) plus the song count, same
 * logic as ListenRow's top line.
 */
function summarizeListen(item) {
  const payload = item.payload || {};
  const plays = Array.isArray(item.plays) ? item.plays : [];
  const isBatch = (item.count || 0) > 1 && plays.length > 1;
  const countTag = isBatch ? (
    <span className="ledger-count"> · {item.count} songs</span>
  ) : null;
  if (isBatch) {
    const artists = uniqueArtistNames(plays);
    if (artists.length > 1) {
      const shown = artists.slice(0, 4).join(', ');
      const extra = artists.length > 4 ? ` + ${artists.length - 4} more` : '';
      return (
        <>
          <span className="ledger-accent">{shown + extra}</span>
          {countTag}
        </>
      );
    }
  }
  const track = payload.trackName || payload.track || '';
  const artist = Array.isArray(payload.artists)
    ? payload.artists.map((a) => a?.artistName).filter(Boolean).join(', ')
    : payload.artist || '';
  if (!track && !artist) return <Placeholder>a play</Placeholder>;
  return (
    <>
      {track}
      {track && artist ? ' — ' : ''}
      {artist && <span className="ledger-accent">{artist}</span>}
      {countTag}
    </>
  );
}

function uniqueArtistNames(plays) {
  const seen = new Set();
  const out = [];
  for (const play of plays) {
    const arr = play?.payload?.artists;
    const names = Array.isArray(arr)
      ? arr.map((a) => a?.artistName)
      : [play?.payload?.artist];
    for (const name of names) {
      if (name && !seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }
  return out;
}

function summarizeObservation(item) {
  const payload = item.payload || {};
  const common = payload.taxon?.commonName;
  const sci = payload.taxon?.name;
  const title = common || sci;
  if (!title) {
    return (
      <Placeholder>
        {item.verb === 'mothing' ? 'an unidentified moth' : 'an unidentified organism'}
      </Placeholder>
    );
  }
  return (
    <>
      {title}
      {sci && sci !== title && <span className="ledger-count"> ({sci})</span>}
    </>
  );
}

/**
 * One-line lead-in for reference records (likes, stars, favorites,
 * votes) — the ledger cousin of ReferenceCard's CompactSubject.
 */
function summarizeSubject(subject, source) {
  if (!subject) return <Placeholder>an unknown record</Placeholder>;
  if (subject.missing) return <Placeholder>an unavailable record</Placeholder>;
  switch (subject.kind) {
    case 'bsky.post': {
      const view = subject.view;
      const author = view?.author;
      if (!author?.handle) return <Placeholder>a post</Placeholder>;
      const localHref = author.did === ME_DID && view?.uri ? recordPathFromAtUri(view.uri) : null;
      const externalHref = view?.uri
        ? `https://bsky.app/profile/${author.handle}/post/${view.uri.split('/').pop()}`
        : null;
      const handle = <span className="ledger-handle">@{author.handle}</span>;
      return (
        <>
          a post by{' '}
          {localHref ? (
            <Link to={localHref}>{handle}</Link>
          ) : externalHref ? (
            <a href={externalHref} target="_blank" rel="noreferrer noopener">
              {handle}
            </a>
          ) : (
            handle
          )}
        </>
      );
    }
    case 'bsky.profile':
      return summarizeProfile(subject);
    case 'atproto': {
      const value = subject.record?.value;
      if (!value) return <Placeholder>{source ? `a ${source} record` : 'a record'}</Placeholder>;
      const title = value.title || value.name || value.displayName || value.repo || value.repoName;
      if (!title) return <Placeholder>{source ? `a ${source} record` : 'a record'}</Placeholder>;
      return (
        <>
          {source ? `a ${source} record — ` : ''}
          <span className="ledger-accent">{title}</span>
        </>
      );
    }
    default:
      return <Placeholder>a record</Placeholder>;
  }
}

/** "@handle" linking out to the profile, like the screenshot's FOLLOWED row. */
function summarizeProfile(subject) {
  const view = subject?.view;
  if (subject?.missing || !view?.handle) return <Placeholder>a profile</Placeholder>;
  return (
    <a
      href={`https://bsky.app/profile/${view.handle}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      <span className="ledger-handle">@{view.handle}</span>
    </a>
  );
}
