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
import { resolvePds, getRecord } from '../lib/atproto.js';
import { ME_DID } from '../config.js';
import { formatDateLong, formatTime, relativeTime } from '../lib/time.js';
import { dayOfLife } from '../lib/dayOfLife.js';
import { VERB_TO_COLLECTION, VERB_LABELS } from '../lib/recordRoutes.js';
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

  useEffect(() => {
    setItem(null);
    setMissing(false);
  }, [verb, rkey]);

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
      <PageShell verb={verb} title="Unknown record type" headTitle="Not found — Dame is…">
        <p>
          No collection mapped for verb <code>{verb}</code>.{' '}
          <Link to="/">Back to the timeline.</Link>
        </p>
      </PageShell>
    );
  }

  if (missing && !item) {
    return (
      <PageShell verb={verb} title="Record not found" headTitle="Not found — Dame is…">
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
      verb={verb}
      title={titleFor(verb, item)}
      atUri={atUri}
      cid={cid}
      headTitle={headTitleFor(verb, item)}
    >
      <article className="record-page">
        <RecordMeta verb={verb} createdAt={createdAt} />

        {item ? (
          <RecordBody verb={verb} item={item} />
        ) : (
          <p className="feed-empty">Loading record…</p>
        )}

        {verb === 'posting' && item?.atUri && (
          <Comments atUri={item.atUri} />
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
      return <PostCard {...item} />;
    case 'logging':
      return <StatusEntry {...item} />;
    case 'listening':
      return <ListenRow {...item} />;
    case 'blogging':
      return <BlogCard {...item} />;
    case 'creating':
      return <CreatingCard {...item} />;
    default:
      return null;
  }
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

function titleFor(verb, item) {
  if (!item) return VERB_LABELS[verb] || verb;
  switch (verb) {
    case 'blogging':
      return item.payload?.title || 'Untitled';
    case 'creating':
      return item.payload?.title || 'Untitled work';
    case 'listening':
      return item.payload?.trackName || 'Untitled play';
    case 'posting': {
      const text = (item.payload?.text || '').trim();
      return text ? truncate(text, 80) : 'A post';
    }
    case 'logging': {
      const text = (item.payload?.status || item.payload?.text || '').trim();
      return text ? truncate(text, 80) : 'A status';
    }
    default:
      return VERB_LABELS[verb] || verb;
  }
}

function headTitleFor(verb, item) {
  return `${titleFor(verb, item)} — Dame is…`;
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
