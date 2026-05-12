import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import PostCard from '../components/PostCard.jsx';
import StatusEntry from '../components/StatusEntry.jsx';
import ListenRow from '../components/ListenRow.jsx';
import BlogCard from '../components/BlogCard.jsx';
import CreatingCard from '../components/CreatingCard.jsx';
import Comments from '../components/Comments.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, getRecord, getPostThread } from '../lib/atproto.js';
import { ME_DID } from '../config.js';
import { formatDateLong, formatTime, relativeTime } from '../lib/time.js';
import { dayOfLife } from '../lib/dayOfLife.js';
import { VERB_TO_COLLECTION, VERB_LABELS, recordPathFromAtUri } from '../lib/recordRoutes.js';
import { musicLinksFor } from '../lib/musicLinks.js';
import { useAlbumArt } from '../hooks/useAlbumArt.js';
import './Blogging.css';
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
 * Strategy:
 *   1. Look up by rkey in the relevant snapshot for instant first paint.
 *   2. For our own PDS-backed records (logging / blogging / creating /
 *      listening) also fetch fresh from the PDS so the displayed copy is
 *      never stale. Bluesky posts skip the live fetch — the snapshot's
 *      AppView shape (handle, counts) is richer than the raw PDS record.
 *   3. If neither finds anything after a beat, render a "not found" page.
 */
export default function Record({ verb }) {
  const { rkey } = useParams();
  const collection = VERB_TO_COLLECTION[verb];
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
    setItem(null);
    setMissing(false);
    setParents([]);
    setReplies([]);
    setRepliesStatus('idle');
  }, [verb, rkey]);

  // Single AppView round-trip resolves both halves of the conversation:
  //   - parents (walk up `thread.parent…`) for the context block above
  //   - replies (`thread.replies`) for the comments tree below
  // This used to be split across two effects (and a third-party comments
  // package). The seeded parent from the snapshot still paints first so the
  // page never feels empty while the request is in flight.
  useEffect(() => {
    if (verb !== 'posting' || !item?.atUri) return;
    const isReply = Boolean(item?.payload?.parent || item?.payload?.reply?.parent);

    if (isReply && item.payload.parent?.uri && item.payload.parent.author) {
      setParents([item.payload.parent]);
    }

    let cancelled = false;
    setRepliesStatus('loading');
    async function load() {
      try {
        const thread = await getPostThread(item.atUri, {
          parentHeight: 6,
          depth: 6,
        });
        if (cancelled) return;
        const chain = collectParents(thread?.thread);
        if (chain.length) setParents(chain);
        const childReplies = Array.isArray(thread?.thread?.replies)
          ? thread.thread.replies
          : [];
        setReplies(childReplies);
        setRepliesStatus('ready');
      } catch {
        if (!cancelled) setRepliesStatus('error');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [verb, item?.atUri]);

  useEffect(() => {
    if (!collection || !rkey) return;
    let cancelled = false;
    let foundAnything = false;

    async function load() {
      const seed = await loadFromSnapshot(verb, rkey);
      if (cancelled) return;
      if (seed) {
        foundAnything = true;
        setItem(seed);
      }

      if (verb !== 'posting') {
        try {
          const pds = await resolvePds(ME_DID);
          if (cancelled) return;
          const fresh = await getRecord(pds, { repo: ME_DID, collection, rkey });
          if (cancelled) return;
          if (fresh?.value) {
            foundAnything = true;
            setItem(recordToFeedItem(verb, fresh));
          }
        } catch {
          // ignore; we'll fall back to the snapshot result
        }
      }

      if (cancelled) return;
      if (!foundAnything) setMissing(true);
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
    >
      <article className="record-page">
        <RecordMeta verb={verb} createdAt={createdAt} />

        {verb === 'posting' && parents.length > 0 && (
          <ParentChain parents={parents} />
        )}

        {item ? (
          <RecordBody verb={verb} item={item} />
        ) : (
          <p className="feed-empty">Loading record…</p>
        )}

        {verb === 'posting' && item?.atUri && (
          <Comments
            atUri={item.atUri}
            replies={replies}
            status={repliesStatus}
          />
        )}

        <p className="record-page-aturi gutter">
          <code>{atUri}</code>
        </p>
      </article>
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Body dispatch                                                       */
/* ------------------------------------------------------------------ */

function RecordBody({ verb, item }) {
  switch (verb) {
    case 'posting':
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
    default:
      return null;
  }
}

/**
 * Album art for a play, fetched from iTunes by ISRC / Apple song id /
 * track+artist text search. Renders nothing until we know either way so
 * the layout doesn't jump; renders nothing on a miss either.
 */
function AlbumArt({ payload }) {
  const result = useAlbumArt(payload, { size: 600 });
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
      <img
        src={art.url}
        alt={alt}
        loading="lazy"
        decoding="async"
        width="600"
        height="600"
      />
      {release && <figcaption className="listen-album-art-caption">{release}</figcaption>}
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
      <p className="record-parent-text">{text || <em>—</em>}</p>
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
      ? { text: view.record.text || '', createdAt: view.record.createdAt || null }
      : null,
    replyCount: view.replyCount || 0,
    repostCount: view.repostCount || 0,
    likeCount: view.likeCount || 0,
  };
}

function RecordMeta({ verb, createdAt }) {
  if (!createdAt) return null;
  const dayNum = dayOfLife(createdAt);
  return (
    <div className="blog-article-meta record-page-meta">
      <span className="small-caps">{VERB_LABELS[verb] || verb}</span>
      <span>· {formatDateLong(createdAt)}</span>
      <span>· {formatTime(createdAt)}</span>
      {dayNum && <span>· Day {dayNum.toLocaleString()}</span>}
      <span>· {relativeTime(createdAt)}</span>
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
/* Snapshot lookups                                                    */
/* ------------------------------------------------------------------ */

async function loadFromSnapshot(verb, rkey) {
  switch (verb) {
    case 'posting':
      return loadPostFromSnapshot(rkey);
    case 'logging':
      return loadByRkey('now', rkey, (r) => recordToFeedItem('logging', r));
    case 'listening':
      return loadByRkey('listening', rkey, (r) => recordToFeedItem('listening', r));
    case 'blogging':
      return loadByRkey('blogs', rkey, (r) => recordToFeedItem('blogging', r));
    case 'creating':
      return loadByRkey('creations', rkey, (r) => recordToFeedItem('creating', r));
    default:
      return null;
  }
}

async function loadByRkey(snapshotName, rkey, mapper) {
  const snap = await fetchSnapshot(snapshotName);
  if (!Array.isArray(snap)) return null;
  const found = snap.find((r) => {
    const m = String(r?.uri || '').match(/\/([^/]+)$/);
    return m && m[1] === rkey;
  });
  return found ? mapper(found) : null;
}

async function loadPostFromSnapshot(rkey) {
  const snap = await fetchSnapshot('posts');
  if (!Array.isArray(snap)) return null;
  const found = snap.find((row) => {
    const m = String(row?.post?.uri || '').match(/\/([^/]+)$/);
    return m && m[1] === rkey;
  });
  if (!found?.post) return null;
  const post = found.post;
  return {
    verb: 'posting',
    atUri: post.uri,
    cid: post.cid,
    createdAt: post.record?.createdAt || post.indexedAt,
    payload: {
      text: post.record?.text || '',
      author: {
        did: post.author?.did,
        handle: post.author?.handle,
        displayName: post.author?.displayName,
      },
      replyCount: post.replyCount || 0,
      repostCount: post.repostCount || 0,
      likeCount: post.likeCount || 0,
      embed: post.record?.embed || post.embed || null,
      indexedAt: post.indexedAt,
    },
    raw: post,
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
      record.indexedAt ||
      null,
    payload: value,
    raw: record,
  };
}
