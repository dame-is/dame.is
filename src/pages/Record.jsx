import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import PostCard from '../components/PostCard.jsx';
import StatusEntry from '../components/StatusEntry.jsx';
import ListenRow from '../components/ListenRow.jsx';
import BlogCard from '../components/BlogCard.jsx';
import CreatingCard from '../components/CreatingCard.jsx';
import MothCard from '../components/cards/MothCard.jsx';
import Comments from '../components/Comments.jsx';
import ReferenceCard from '../components/ReferenceCard.jsx';
import AtUriLink from '../components/AtUriLink.jsx';
import AturiActions from '../components/AturiActions.jsx';
import { RecordSkeleton } from '../components/Skeleton.jsx';
import { resolvePds, getRecord, getPostThread, explorerPathFromAtUri } from '../lib/atproto.js';
import { ME_DID } from '../config.js';
import { formatDateLong, formatTime, relativeTime } from '../lib/time.js';
import { dayOfLife } from '../lib/dayOfLife.js';
import { VERB_TO_COLLECTION, VERB_LABELS, recordPathFromAtUri } from '../lib/recordRoutes.js';
import { verbConfig, primaryNsid } from '../lib/verbRegistry.js';
import { musicLinksFor } from '../lib/musicLinks.js';
import { useAlbumArt } from '../hooks/useAlbumArt.js';
import { renderPostText } from '../lib/postRichText.jsx';
import PostEmbed from '../components/PostEmbed.jsx';
import Lightbox from '../components/Lightbox.jsx';
import './Blogging.css';
import './Record.css';
import '../components/Feed.css';

/**
 * One generic page that renders any single record from the user's PDS.
 *
 * Routes that resolve here are mapped in App.jsx:
 *   /:verb/:rkey                   — short form     (/posting/abc, /listening/abc, …)
 *   /:nsid/:rkey                   — lexicon form   (/app.bsky.feed.post/abc, /fm.teal.alpha.feed.play/abc, …)
 *
 * The mapping table lives in `src/lib/recordRoutes.js`.
 *
 * Strategy: always fetch live, render a skeleton while pending. Every
 * record the site addresses lives on Dame's PDS, so:
 *   - posting → `getPostThread` on the AppView (one call → post view +
 *     parents + replies), addressed as `at://<ME_DID>/app.bsky.feed.post/<rkey>`.
 *   - reposting → `getRecord` on Dame's PDS for the `app.bsky.feed.repost`
 *     record (the rkey *is* Dame's repost record's rkey), then
 *     `getPostThread` on `subject.uri` for the original post + thread.
 *   - everything else → `getRecord` on Dame's PDS for the record itself.
 */
export default function Record({ verb, nsid, source }) {
  const { rkey } = useParams();
  // Prefer the explicit NSID from the route (`/{nsid}/:rkey` form) over
  // the verb-default; this makes multi-source verbs (blogging across
  // dame/leaflet/standard, liking across bsky/grain/tangled) address the
  // exact collection.
  const collection = nsid || VERB_TO_COLLECTION[verb] || primaryNsid(verb);
  const [item, setItem] = useState(null);
  const [missing, setMissing] = useState(false);
  // Parent chain for posts. Newest-first array of condensed post views,
  // i.e. parents[0] is the immediate parent, parents[N-1] is the root.
  const [parents, setParents] = useState([]);
  // Direct replies to *this* post, as `threadViewPost` nodes (each with their
  // own nested `replies`). Drives the comments tree below the record.
  const [replies, setReplies] = useState([]);
  const [repliesStatus, setRepliesStatus] = useState('idle'); // idle | loading | ready | error

  useEffect(() => {
    if (!collection || !rkey) return;
    let cancelled = false;
    setItem(null);
    setMissing(false);
    setParents([]);
    setReplies([]);
    setRepliesStatus(verb === 'posting' || verb === 'reposting' ? 'loading' : 'idle');

    async function load() {
      try {
        if (verb === 'posting') {
          const uri = `at://${ME_DID}/app.bsky.feed.post/${rkey}`;
          const thread = await getPostThread(uri, { depth: 6, parentHeight: 6 });
          if (cancelled) return;
          const post = thread?.thread?.post;
          if (!post) {
            setMissing(true);
            setRepliesStatus('error');
            return;
          }
          setItem(postViewToFeedItem('posting', post));
          applyThreadContext(thread.thread);
          return;
        }

        if (verb === 'reposting') {
          const pds = await resolvePds(ME_DID);
          if (cancelled) return;
          const repost = await getRecord(pds, {
            repo: ME_DID,
            collection: 'app.bsky.feed.repost',
            rkey,
          });
          if (cancelled) return;
          const subjectUri = repost?.value?.subject?.uri;
          if (!subjectUri) {
            setMissing(true);
            setRepliesStatus('error');
            return;
          }
          const thread = await getPostThread(subjectUri, { depth: 6, parentHeight: 6 });
          if (cancelled) return;
          const subjectPost = thread?.thread?.post;
          if (!subjectPost) {
            // Subject post is gone (deleted/blocked); still show a degraded
            // card so the page isn't a flat 404.
            setItem(repostMissingSubjectItem(repost));
            setRepliesStatus('ready');
            return;
          }
          setItem(repostToItem(repost, subjectPost));
          applyThreadContext(thread.thread);
          return;
        }

        // Generic content / reference records on Dame's PDS.
        const pds = await resolvePds(ME_DID);
        if (cancelled) return;
        const fresh = await getRecord(pds, { repo: ME_DID, collection, rkey });
        if (cancelled) return;
        if (!fresh?.value) {
          setMissing(true);
          return;
        }
        setItem(recordToFeedItem(verb, fresh));
      } catch (err) {
        if (cancelled) return;
        // 4xx from the PDS / AppView almost always means "no such record".
        // Other errors (network blip) still surface as missing — the user
        // can refresh.
        setMissing(true);
        if (verb === 'posting' || verb === 'reposting') setRepliesStatus('error');
      }

      function applyThreadContext(threadNode) {
        if (cancelled || !threadNode) return;
        const chain = collectParents(threadNode);
        if (chain.length) setParents(chain);
        const childReplies = Array.isArray(threadNode.replies) ? threadNode.replies : [];
        setReplies(childReplies);
        setRepliesStatus('ready');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [verb, rkey, collection]);

  if (!collection) {
    return (
      <PageShell title="Unknown record type" headTitle="Not found — Dame is…">
        <p>
          No collection mapped for verb <code>{verb}</code>.{' '}
          <Link to="/">Back to the timeline.</Link>
        </p>
      </PageShell>
    );
  }

  if (missing && !item) {
    return (
      <PageShell title="Record not found" headTitle="Not found — Dame is…">
        <p>
          No <code>{collection}</code> record with rkey <code>{rkey}</code>.{' '}
          <Link to={`/${verb}`}>Back to {verb}.</Link>
        </p>
      </PageShell>
    );
  }

  const atUri = item?.atUri || `at://${ME_DID}/${collection}/${rkey}`;
  const cid = item?.cid || null;
  const createdAt = item?.createdAt;

  return (
    <PageShell
      title={titleFor(verb, item)}
      atUri={atUri}
      cid={cid}
      headTitle={headTitleFor(verb, item)}
      eyebrow={
        <Link to={`/${verb}`} className="page-back small-caps">
          ← {verb}
        </Link>
      }
    >
      <article className="record-page">
        {(verb === 'posting' || verb === 'reposting') && parents.length > 0 && (
          <ParentChain parents={parents.slice(0, 1)} />
        )}

        {item ? (
          <div className="reveal">
            <RecordBody verb={verb} item={item} collection={collection} />
          </div>
        ) : (
          <RecordSkeleton />
        )}

        {item && <RecordMeta collection={collection} createdAt={createdAt} />}

        {item && <AturiActions atUri={atUri} />}

        {(verb === 'posting' || verb === 'reposting') && item?.atUri && (
          <Comments
            atUri={item?.payload?.subjectUri || item.atUri}
            replies={replies}
            status={repliesStatus}
          />
        )}

        <p className="record-page-aturi gutter">
          <AtUriLink uri={atUri}>
            <code>{atUri}</code>
          </AtUriLink>
        </p>
      </article>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Body dispatch                                                       */
/* ------------------------------------------------------------------ */

function RecordBody({ verb, item, collection }) {
  switch (verb) {
    case 'posting':
    case 'reposting':
      return <PostCard {...item} variant="record" />;
    case 'logging':
      return <StatusEntry {...item} />;
    case 'listening':
      return (
        <>
          <AlbumArt payload={item.payload} />
          <ListenRow {...item} />
          <ListenServiceLinks payload={item.payload} />
        </>
      );
    case 'blogging':
      return <BlogCard {...item} />;
    case 'creating':
      return <CreatingCard {...item} />;
    case 'mothing':
      return <MothCard {...item} />;
    default:
      return <GenericRecordBody verb={verb} item={item} collection={collection} />;
  }
}

/**
 * Fallback body for any verb that doesn't have a specialized layout.
 *
 * Renders, top to bottom:
 *   - the resolved subject preview (for reference verbs that have a
 *     `_subject` baked in by the prefetch step or `subject` set inline),
 *   - a raw JSON dump of the underlying record, styled like the
 *     atmosphere debug overlay,
 *   - an action row mirroring the debug overlay's affordances (copy AT
 *     URI, copy raw JSON, open in the explorer).
 *
 * Specialized layouts are upgrades, not replacements — when a verb gets
 * its own branch above, the fallback simply stops being reached.
 */
function GenericRecordBody({ item, collection }) {
  const cfg = verbConfig(item.verb);
  const reference = cfg?.collections?.find((c) => c.kind === 'reference');
  const recordJson = JSON.stringify(item.raw || { uri: item.atUri, value: item.payload }, null, 2);
  const atUri = item.atUri || null;
  return (
    <div className="record-fallback">
      {reference && item.subject && (
        <ReferenceCard
          payload={item.payload}
          atUri={atUri}
          createdAt={item.createdAt}
          source={item.source}
          subject={item.subject}
          verb={item.verb}
        />
      )}
      <RecordActionsRow atUri={atUri} recordJson={recordJson} />
      <details className="record-fallback-json" open>
        <summary className="small-caps">raw record</summary>
        <pre className="debug-overlay-json record-fallback-pre">{recordJson}</pre>
      </details>
    </div>
  );
}

function RecordActionsRow({ atUri, recordJson }) {
  const [copied, setCopied] = useState(null);
  function copy(text, key) {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key);
        setTimeout(() => setCopied(null), 1800);
      },
      () => {},
    );
  }
  const explorerPath = explorerPathFromAtUri(atUri);
  return (
    <div className="record-fallback-actions">
      {explorerPath && (
        <Link to={explorerPath}>Open in explorer</Link>
      )}
      {atUri && (
        <button type="button" onClick={() => copy(atUri, 'uri')}>
          {copied === 'uri' ? 'AT URI copied' : 'Copy AT URI'}
        </button>
      )}
      {recordJson && (
        <button type="button" onClick={() => copy(recordJson, 'json')}>
          {copied === 'json' ? 'Record JSON copied' : 'Copy record JSON'}
        </button>
      )}
    </div>
  );
}

/**
 * Album art for a play, fetched from iTunes by ISRC / Apple song id /
 * track+artist text search. Renders nothing until we know either way so
 * the layout doesn't jump; renders nothing on a miss either.
 */
function AlbumArt({ payload }) {
  const result = useAlbumArt(payload, { size: 600 });
  const [lightboxOpen, setLightboxOpen] = useState(false);
  if (result.status !== 'hit') return null;
  const { art } = result;
  const release = payload?.releaseName || art.album || '';
  const alt = release
    ? `Album art for ${release}`
    : art.track
      ? `Album art for ${art.track}`
      : 'Album art';
  return (
    <figure className="listen-album-art">
      <button
        type="button"
        className="listen-album-art-trigger"
        onClick={() => setLightboxOpen(true)}
        aria-label={`Open ${alt.toLowerCase()}`}
      >
        <img
          src={art.url}
          alt={alt}
          loading="lazy"
          decoding="async"
          width="600"
          height="600"
        />
      </button>
      {release && <figcaption className="listen-album-art-caption">{release}</figcaption>}
      <Lightbox
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        images={[{ src: art.url, alt, thumb: art.url, width: 600, height: 600 }]}
      />
    </figure>
  );
}

function ListenServiceLinks({ payload }) {
  const links = musicLinksFor(payload);
  if (!links.length) return null;
  return (
    <ul className="listen-services">
      {links.map((l) => (
        <li key={l.service} className={`listen-service listen-service-${l.service}`}>
          <a href={l.url} target="_blank" rel="noreferrer noopener">
            {l.kind === 'direct' ? `Open in ${l.label}` : `Search on ${l.label}`}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * Parent-of-reply rendering. Walks oldest → newest so the visual reads
 * top-to-bottom as conversation flow.
 */
function ParentChain({ parents }) {
  const ordered = [...parents].reverse(); // root … immediate parent
  return (
    <div className="record-parent-chain" aria-label="In reply to">
      {ordered.map((p, i) => (
        <ParentPostCard
          key={p.uri || i}
          parent={p}
          isRoot={i === 0 && ordered.length > 1}
        />
      ))}
    </div>
  );
}

function ParentPostCard({ parent, isRoot }) {
  if (parent?.$type === 'app.bsky.feed.defs#notFoundPost') {
    return <div className="record-parent record-parent-missing gutter">↳ a deleted post</div>;
  }
  if (parent?.$type === 'app.bsky.feed.defs#blockedPost') {
    return <div className="record-parent record-parent-missing gutter">↳ a blocked post</div>;
  }
  const handle = parent?.author?.handle;
  const displayName = parent?.author?.displayName;
  const did = parent?.author?.did;
  const text = parent?.record?.text || '';
  const facets = parent?.record?.facets || null;
  const embed = parent?.embed || parent?.record?.embed || null;
  const ts = parent?.record?.createdAt || parent?.indexedAt;
  // Only treat the parent as a local record if it lives on this site. For
  // anyone else's posts, link the timestamp out to bsky.app so the user
  // doesn't get teleported into the wrong /posting/{rkey} on this domain.
  const isMine = did === ME_DID;
  const localHref = isMine && parent?.uri ? recordPathFromAtUri(parent.uri) : null;
  const externalHref = !isMine && handle && parent?.uri
    ? `https://bsky.app/profile/${handle}/post/${parent.uri.split('/').pop()}`
    : null;
  return (
    <article className="record-parent" data-at-uri={parent?.uri}>
      <header className="record-parent-head">
        <span className="record-parent-arrow" aria-hidden="true">↳</span>
        {isRoot && <span className="small-caps record-parent-tag">root</span>}
        <span className="small-caps record-parent-context">replying to</span>
        {(displayName || handle) && (
          <span className="record-parent-author">
            {displayName && <span className="record-parent-name">{displayName}</span>}
            {handle && <span className="record-parent-handle">@{handle}</span>}
          </span>
        )}
        {ts && (
          <span className="gutter record-parent-time">
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
      <p className="record-parent-text">
        {text ? renderPostText(text, facets) : <em>—</em>}
      </p>
      {embed && <PostEmbed embed={embed} did={did} />}
    </article>
  );
}

/**
 * Walk a thread view from app.bsky.feed.getPostThread upward through its
 * `.parent` chain. Returns the chain newest-first (immediate parent first,
 * root last), with each entry condensed to the same shape used elsewhere.
 */
function collectParents(thread) {
  const out = [];
  let cursor = thread?.parent;
  while (cursor) {
    if (cursor.$type === 'app.bsky.feed.defs#notFoundPost' || cursor.$type === 'app.bsky.feed.defs#blockedPost') {
      out.push({ $type: cursor.$type, uri: cursor.uri || null });
      break;
    }
    if (cursor.post) {
      out.push(condensePostView(cursor.post));
    }
    cursor = cursor.parent;
  }
  return out;
}

function condensePostView(view) {
  if (!view?.uri) return null;
  return {
    uri: view.uri,
    cid: view.cid || null,
    indexedAt: view.indexedAt || null,
    author: view.author
      ? {
          did: view.author.did,
          handle: view.author.handle,
          displayName: view.author.displayName,
          avatar: view.author.avatar,
        }
      : null,
    record: view.record
      ? {
          text: view.record.text || '',
          createdAt: view.record.createdAt || null,
          facets: view.record.facets || null,
          embed: view.record.embed || null,
        }
      : null,
    embed: view.embed || null,
    replyCount: view.replyCount || 0,
    repostCount: view.repostCount || 0,
    likeCount: view.likeCount || 0,
  };
}

function RecordMeta({ collection, createdAt }) {
  if (!createdAt) return null;
  const dayNum = dayOfLife(createdAt);
  return (
    <div className="blog-article-meta record-page-meta">
      {collection && <span className="record-page-meta-nsid">{collection}</span>}
      <span>· {relativeTime(createdAt)}</span>
      <span>· {formatTime(createdAt)}</span>
      <span>· {formatDateLong(createdAt)}</span>
      {dayNum && <span>· Day {dayNum.toLocaleString()}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Titles                                                              */
/* ------------------------------------------------------------------ */

/**
 * Visible h1 above the record. Only set for record types whose `title`
 * field is real metadata (blogs, works) — for short-form records we let
 * the body itself be the focal element rather than echoing it as a title.
 */
function titleFor(verb, item) {
  if (!item) return null;
  switch (verb) {
    case 'blogging':
      return item.payload?.title || 'Untitled';
    case 'creating':
      return item.payload?.title || 'Untitled work';
    default:
      return null;
  }
}

/**
 * Browser tab title — stays descriptive for every record type, including
 * short-form, by snapshotting the body text.
 */
function headTitleFor(verb, item) {
  if (!item) return `${VERB_LABELS[verb] || verb} — Dame is…`;
  switch (verb) {
    case 'blogging':
      return `${item.payload?.title || 'Untitled'} — Dame is…`;
    case 'creating':
      return `${item.payload?.title || 'Untitled work'} — Dame is…`;
    case 'listening': {
      const track = item.payload?.trackName;
      const artist = Array.isArray(item.payload?.artists)
        ? item.payload.artists.map((a) => a?.artistName).filter(Boolean).join(', ')
        : item.payload?.artist;
      const both = [track, artist].filter(Boolean).join(' · ');
      return `${both || 'A play'} — Dame is…`;
    }
    case 'posting': {
      const text = (item.payload?.text || '').trim();
      return `${text ? truncate(text, 80) : 'A post'} — Dame is…`;
    }
    case 'reposting': {
      const handle = item.payload?.author?.handle;
      const text = (item.payload?.text || '').trim();
      const snippet = text ? truncate(text, 60) : 'a post';
      return `Reposted: ${handle ? `@${handle} — ` : ''}${snippet} — Dame is…`;
    }
    case 'logging': {
      const text = (item.payload?.status || item.payload?.text || '').trim();
      return `${text ? truncate(text, 80) : 'A status'} — Dame is…`;
    }
    default:
      return `${VERB_LABELS[verb] || verb} — Dame is…`;
  }
}

function truncate(s, n) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

/* ------------------------------------------------------------------ */
/* Feed-item shaping                                                   */
/* ------------------------------------------------------------------ */

/**
 * Reshape a Bluesky `postView` (as returned by getPostThread) into the
 * internal feed-item shape that PostCard reads.
 */
function postViewToFeedItem(verb, post) {
  return {
    verb,
    atUri: post.uri,
    cid: post.cid || null,
    createdAt: post.record?.createdAt || post.indexedAt || null,
    payload: {
      text: post.record?.text || '',
      facets: post.record?.facets || null,
      langs: post.record?.langs || null,
      author: post.author
        ? {
            did: post.author.did,
            handle: post.author.handle,
            displayName: post.author.displayName,
            avatar: post.author.avatar,
          }
        : null,
      replyCount: post.replyCount || 0,
      repostCount: post.repostCount || 0,
      likeCount: post.likeCount || 0,
      // Prefer the resolved view embed (with CDN URLs); keep the raw
      // record embed as a fallback so PostEmbed can still render it.
      embed: post.embed || null,
      embedRecord: post.record?.embed || null,
      indexedAt: post.indexedAt,
    },
    raw: post,
  };
}

/**
 * Build a reposting feed item from Dame's raw `app.bsky.feed.repost`
 * record and the hydrated subject post view.
 *
 * `atUri` stays anchored to Dame's repost record so /reposting/{rkey}
 * remains the canonical URL; `payload.subjectUri` points at the original
 * post so PostCard's "by @handle" external link and the Comments thread
 * lookup both target the right thing.
 */
function repostToItem(repostRecord, subjectPost) {
  const repostedAt = repostRecord.value?.createdAt || null;
  return {
    verb: 'reposting',
    atUri: repostRecord.uri,
    cid: subjectPost.cid || repostRecord.cid || null,
    createdAt: repostedAt,
    payload: {
      text: subjectPost.record?.text || '',
      facets: subjectPost.record?.facets || null,
      langs: subjectPost.record?.langs || null,
      author: subjectPost.author
        ? {
            did: subjectPost.author.did,
            handle: subjectPost.author.handle,
            displayName: subjectPost.author.displayName,
            avatar: subjectPost.author.avatar,
          }
        : null,
      replyCount: subjectPost.replyCount || 0,
      repostCount: subjectPost.repostCount || 0,
      likeCount: subjectPost.likeCount || 0,
      embed: subjectPost.embed || null,
      embedRecord: subjectPost.record?.embed || null,
      indexedAt: subjectPost.indexedAt,
      subjectUri: subjectPost.uri,
      subjectRef: repostRecord.value?.subject || null,
      reason: {
        $type: 'app.bsky.feed.defs#reasonRepost',
        indexedAt: repostedAt,
      },
    },
    raw: repostRecord,
  };
}

/**
 * Degraded reposting item for the case where the AppView returns no view
 * for the subject (deleted, blocked, or its server is unreachable). We
 * still know the repost happened — show that, with a "subject unavailable"
 * hint inside PostCard.
 */
function repostMissingSubjectItem(repostRecord) {
  const repostedAt = repostRecord.value?.createdAt || null;
  return {
    verb: 'reposting',
    atUri: repostRecord.uri,
    cid: repostRecord.cid || null,
    createdAt: repostedAt,
    payload: {
      subjectRef: repostRecord.value?.subject || null,
      subjectMissing: true,
      reason: {
        $type: 'app.bsky.feed.defs#reasonRepost',
        indexedAt: repostedAt,
      },
    },
    raw: repostRecord,
  };
}

function recordToFeedItem(verb, record) {
  const value = record?.value || {};
  return {
    verb,
    atUri: record.uri,
    cid: record.cid,
    createdAt:
      value.createdAt ||
      value.playedTime ||
      value.playedAt ||
      value.publishedAt ||
      record.indexedAt ||
      null,
    payload: value,
    raw: record,
  };
}
