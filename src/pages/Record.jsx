import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CornerDownRight } from 'lucide-react';
import PageShell from '../components/PageShell.jsx';
import PostCard from '../components/PostCard.jsx';
import ListenRow from '../components/ListenRow.jsx';
import BlogCard from '../components/BlogCard.jsx';
import CreatingCard from '../components/CreatingCard.jsx';
import ObservationCard from '../components/cards/ObservationCard.jsx';
import AnisotaLabCard from '../components/cards/AnisotaLabCard.jsx';
import FlushCard from '../components/cards/FlushCard.jsx';
import Comments from '../components/Comments.jsx';
import ReferenceCard from '../components/ReferenceCard.jsx';
import AtUriLink from '../components/AtUriLink.jsx';
import AturiActions from '../components/AturiActions.jsx';
import SequenceFoot from '../components/SequenceFoot.jsx';
import VitalsChip from '../components/VitalsChip.jsx';
import VerbIcon from '../components/VerbIcon.jsx';
import Time from '../components/Time.jsx';
import { useRecordNeighbours, subjectNames } from '../hooks/useRecordNeighbours.js';
import {
  colophon,
  crumbStamp,
  crumbTitle,
  indexPathForVerb,
  recordSentence,
  sentenceText,
  upFrom,
} from '../lib/recordPlate.js';
import { RecordSkeleton } from '../components/Skeleton.jsx';
import {
  resolvePds,
  getRecord,
  getPostThread,
  isRecordNotFound,
} from '../lib/atproto.js';
import { createSubjectResolver } from '../lib/subjectResolver.js';
import { isDraft } from '../lib/publications.js';
import { ME_DID, ME_HANDLE } from '../config.js';
import { flushBody } from '../lib/flushText.js';
import {
  VERB_TO_COLLECTION,
  VERB_LABELS,
  recordPathFromAtUri,
  siblingCollections,
} from '../lib/recordRoutes.js';
import { nsidConfig, primaryNsid, nsidFromAtUri } from '../lib/verbRegistry.js';
import { musicLinksFor } from '../lib/musicLinks.js';
import { playArtistLine, playTrackName } from '../lib/teal.js';
import { albumIdentity, albumPath } from '../lib/albums.js';
import { useAlbumArt } from '../hooks/useAlbumArt.js';
import { useFirstSightings } from '../hooks/useFirstSightings.js';
import { isFirstSighting } from '../lib/firstSightings.js';
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
 *   /:nsid/:rkey                   — lexicon form   (/app.bsky.feed.post/abc, /fm.teal.feed.play/abc, …)
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
 *   - everything else → `getRecord` on Dame's PDS for the record itself, plus
 *     — for a record that points at something (a like, a follow, a star) —
 *     the thing it points at, so the page can show it.
 */
export default function Record({ verb, nsid, source }) {
  const { rkey } = useParams();
  // Prefer the explicit NSID from the route (`/{nsid}/:rkey` form) over
  // the verb-default; this makes multi-source verbs (blogging across
  // dame/leaflet/standard, liking across bsky/grain/tangled) address the
  // exact collection.
  const collection = nsid || VERB_TO_COLLECTION[verb] || primaryNsid(verb);
  // Posts and reposts are read from the Bluesky AppView, which answers with the
  // post and its whole thread in one call — but only Bluesky's own lexicons are
  // there. An Anisota post or repost, reachable by its lexicon-form URL, is a
  // plain record on the PDS and takes the generic path below.
  const threadMode =
    verb === 'posting' && collection === 'app.bsky.feed.post'
      ? 'post'
      : verb === 'reposting' && collection === 'app.bsky.feed.repost'
        ? 'repost'
        : null;
  // The short `/{verb}/:rkey` form names no lexicon, so a verb spanning
  // several of them has to look in each until the rkey turns up. Listening is
  // the case that makes this load-bearing: teal.fm's production and alpha play
  // lexicons share one verb and one archive, and which of them holds any given
  // play depends only on when it was scrobbled.
  const candidates = useMemo(
    () => (nsid || threadMode ? [collection] : siblingCollections(collection)),
    [nsid, threadMode, collection],
  );
  // The collection the record was actually found in — what the page reports
  // and hands to the body renderer, which is not always the one we asked for
  // first.
  const [resolvedCollection, setResolvedCollection] = useState(collection);
  const [item, setItem] = useState(null);
  // `missing` = the record is genuinely absent (definitive 4xx / RecordNotFound
  // / resolved-but-empty) → show the permanent "not found" state.
  // `loadError` = a transient/unknown fetch failure (network blip, 5xx) → show a
  // recoverable "couldn't load right now" state that keeps the URL and retries,
  // rather than falsely claiming the record doesn't exist (fatal for shared/OG
  // links). See §4.1.
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Bumped by the "Try again" button to re-run the load effect in place.
  const [retryKey, setRetryKey] = useState(0);
  // Parent chain for posts. Newest-first array of condensed post views,
  // i.e. parents[0] is the immediate parent, parents[N-1] is the root.
  const [parents, setParents] = useState([]);
  // Direct replies to *this* post, as `threadViewPost` nodes (each with their
  // own nested `replies`). Drives the comments tree below the record.
  const [replies, setReplies] = useState([]);
  const [repliesStatus, setRepliesStatus] = useState('idle'); // idle | loading | ready | error
  // The author's own linear self-reply continuation of this post, lifted out
  // of `replies` and stacked in the main post area (oldest → newest).
  const [selfThread, setSelfThread] = useState([]);

  useEffect(() => {
    if (!collection || !rkey) return;
    let cancelled = false;
    setItem(null);
    setMissing(false);
    setLoadError(false);
    setResolvedCollection(collection);
    setParents([]);
    setReplies([]);
    setSelfThread([]);
    setRepliesStatus(threadMode ? 'loading' : 'idle');

    async function load() {
      try {
        if (threadMode === 'post') {
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

        if (threadMode === 'repost') {
          const pds = await resolvePds(ME_DID);
          if (cancelled) return;
          const repost = await getRecord(pds, {
            repo: ME_DID,
            collection,
            rkey,
          });
          if (cancelled) return;
          const subjectUri = repost?.value?.subject?.uri;
          if (!subjectUri) {
            setMissing(true);
            setRepliesStatus('error');
            return;
          }
          let thread = null;
          try {
            thread = await getPostThread(subjectUri, {
              depth: 6,
              parentHeight: 6,
            });
          } catch (err) {
            // The AppView answers a deleted or taken-down post with a 400
            // NotFound rather than an empty thread. The repost itself is real,
            // so that still gets the degraded card below; only a transient
            // failure falls through to "couldn't load".
            if (!isRecordNotFound(err)) throw err;
          }
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
        const { record: fresh, collection: found } = await getFirstRecord(pds, candidates, rkey);
        if (cancelled) return;
        // Drafts are hidden from every public surface, and BlogPost and
        // CreatingWork refuse them by direct URL; the lexicon-form route
        // (`/site.standard.document/<rkey>`) must not be the way round that.
        if (
          !fresh?.value ||
          (DRAFTABLE_VERBS.has(verb) && isDraft(fresh.value))
        ) {
          setMissing(true);
          return;
        }
        const registered = nsidConfig(found)?.collection || null;
        const subject = await hydrateRecordSubject(fresh, registered);
        if (cancelled) return;
        setResolvedCollection(found);
        setItem({
          ...recordToFeedItem(verb, fresh),
          source: registered?.source || source || null,
          subject,
        });
      } catch (err) {
        if (cancelled) return;
        // Only a PDS (or AppView) saying the record isn't there makes this a
        // 404. A network blip or a 5xx must not masquerade as "not found" —
        // that breaks shared and OG links — so it gets the recoverable
        // load-error state instead. See §4.1.
        if (isRecordNotFound(err)) {
          setMissing(true);
        } else {
          setLoadError(true);
        }
        if (threadMode) setRepliesStatus('error');
      }

      function applyThreadContext(threadNode) {
        if (cancelled || !threadNode) return;
        const chain = collectParents(threadNode);
        if (chain.length) setParents(chain);
        // Lift the author's own linear self-reply chain into the main post
        // area; everything else stays in the replies tree.
        const authorDid = threadNode.post?.author?.did || ME_DID;
        const { thread, leftover } = splitSelfThread(threadNode, authorDid);
        setSelfThread(thread.map((node) => postViewToFeedItem('posting', node.post)));
        setReplies(leftover);
        setRepliesStatus('ready');
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [verb, rkey, collection, threadMode, candidates, source, retryKey]);

  // The plate's slots, worked out once the record is in hand.
  const subjectName = useSubjectName(verb, item);
  const neighbours = useRecordNeighbours({
    verb,
    // The record's own collection, read off its URI: for a repost that's
    // app.bsky.feed.repost, where `collection` names the post it renders.
    collection: item ? nsidFromAtUri(item.atUri) || resolvedCollection : null,
    rkey,
    createdAt: item?.createdAt || null,
  });
  const up = upFrom(indexPathForVerb(verb) ? `/${verb}/${rkey}` : `/${collection}/${rkey}`);

  if (!collection) {
    return (
      <PageShell title="Unknown record type" headTitle="Not found — dame.is">
        <p>
          No collection mapped for verb <code>{verb}</code>.{' '}
          <Link to="/">Back to the timeline.</Link>
        </p>
      </PageShell>
    );
  }

  if (missing && !item) {
    return (
      <PageShell title="Record not found" headTitle="Not found — dame.is">
        <p>
          No record with rkey <code>{rkey}</code> in <LexiconList nsids={candidates} />.{' '}
          <Link to={up.to}>Up to {up.label}.</Link>
        </p>
      </PageShell>
    );
  }

  if (loadError && !item) {
    return (
      <PageShell title="Couldn’t load this right now" headTitle="Couldn’t load — dame.is">
        <p>
          Couldn&rsquo;t load this record right now — refresh to try again.
        </p>
        <p>
          <button type="button" onClick={() => setRetryKey((k) => k + 1)}>
            Try again
          </button>{' '}
          <Link to={up.to}>Up to {up.label}.</Link>
        </p>
      </PageShell>
    );
  }

  const atUri = item?.atUri || `at://${ME_DID}/${resolvedCollection}/${rkey}`;
  const cid = item?.cid || null;
  const createdAt = item?.createdAt;
  const sentence = item ? recordSentence(verb, item.payload || {}, { subject: subjectName }) : null;
  const all = allInSection(verb);

  return (
    <PageShell
      title={sentence ? <RecordTitle sentence={sentence} /> : null}
      atUri={atUri}
      cid={cid}
      headTitle={headTitleFor(verb, item, sentence)}
      crumb={item ? crumbFor(verb, item) : null}
    >
      <article className="record-page">
        {/* One line in Dame's clock: the verb's past tense, the day, the time
            and the day of life. The relative age stays in the footer. */}
        {item && createdAt && (
          <p className="record-colophon">
            <VerbIcon verb={verb} size={13} aria-hidden="true" />
            {colophon(verb, createdAt)}
          </p>
        )}

        {threadMode && parents.length > 0 && (
          <ParentChain parents={parents.slice(0, 1)} />
        )}

        {item ? (
          <div className="reveal">
            <RecordBody verb={verb} item={item} />
          </div>
        ) : (
          <RecordSkeleton />
        )}

        {item && selfThread.length > 0 && (
          <div className="record-self-thread" aria-label="Thread continues">
            {selfThread.map((post) => (
              <SelfThreadPost key={post.atUri} item={post} />
            ))}
          </div>
        )}

        {item && (
          <AturiActions atUri={atUri}>
            {verb === 'listening' &&
              musicLinksFor(item.payload).map((l) => (
                <a key={l.service} className="btn btn--text btn--sm" href={l.url} target="_blank" rel="noreferrer noopener">
                  {l.kind === 'direct' ? `Open in ${l.label}` : `Search on ${l.label}`}
                </a>
              ))}
          </AturiActions>
        )}

        {/* No replies section under a repost whose post is gone: there is no
            thread to read, and "No replies yet" would claim there is. */}
        {threadMode && item?.atUri && !item.payload?.subjectMissing && (
          <Comments
            atUri={item?.payload?.subjectUri || item.atUri}
            replies={replies}
            status={repliesStatus}
          />
        )}

        {item && neighbours.ready && (neighbours.earlier || neighbours.later || all) && (
          <SequenceFoot
            label={`Other ${all?.noun || 'records'}`}
            earlier={neighbours.earlier}
            later={neighbours.later}
            earlierNone="None. This is the first."
            laterNone={verb === 'logging' ? 'None yet. This is the current status.' : 'None yet.'}
            all={all ? { to: all.to, label: `All ${all.noun} in ${verb}` } : null}
          />
        )}

        {/* The record's address, as a quiet folio. It breaks only at its
            slashes, never mid-token. Copying and exploring it are one tap
            away in x-ray. */}
        <p className="record-page-aturi">
          <AtUriLink uri={atUri}>
            <FolioUri uri={atUri} />
          </AtUriLink>
        </p>
      </article>
    </PageShell>
  );
}

/** An at:// URI with a break opportunity after each slash. */
function FolioUri({ uri }) {
  const parts = String(uri || '').split('/');
  return (
    <code>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p}
          {i < parts.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </Fragment>
      ))}
    </code>
  );
}

/**
 * The record's sentence as the H1, in the hero's three tones and on its
 * ruled lines: a quiet lead, the ink verb when there is one, the thing
 * itself in the accent ("dame is / playing tennis", "dame reposted Poe").
 */
function RecordTitle({ sentence }) {
  if (!sentence.lead && !sentence.verb) return sentence.rest;
  return (
    <span className="record-title">
      <span className="record-title-lead">{sentence.lead}</span>
      {sentence.verb && <span className="record-title-verb"> {sentence.verb}</span>}
      {sentence.rest && <span className="record-title-rest"> {sentence.rest}</span>}
    </span>
  );
}

/** The last crumb: a time for things addressed by when, a title otherwise. */
function crumbFor(verb, item) {
  if (verb === 'blogging' || verb === 'creating') return crumbTitle(item.payload?.title);
  return item.createdAt ? crumbStamp(item.createdAt) : null;
}

// What a section's records are called, for "All status updates in logging".
const SECTION_NOUNS = {
  logging: 'status updates',
  posting: 'posts',
  reposting: 'reposts',
  listening: 'plays',
  liking: 'likes',
  following: 'follows',
  mothing: 'sightings',
  observing: 'observations',
  listing: 'lists',
  feeding: 'feeds',
  commenting: 'comments',
  photographing: 'galleries',
  crafting: 'pieces',
};

function allInSection(verb) {
  const to = indexPathForVerb(verb);
  return to ? { to, noun: SECTION_NOUNS[verb] || 'records' } : null;
}

/**
 * Who a reference record points at. A repost already carries its subject's
 * author; a like or a follow is looked up (one AppView call), and until that
 * lands the title reads without a name.
 */
function useSubjectName(verb, item) {
  const [name, setName] = useState(null);
  const author = item?.payload?.author;
  const direct = verb === 'reposting' && author ? author.displayName || (author.handle ? `@${author.handle}` : null) : null;
  const subject = item?.payload?.subject;
  const key = typeof subject === 'string' ? subject : subject?.uri || null;
  useEffect(() => {
    setName(null);
    if (direct || !key) return undefined;
    let cancelled = false;
    subjectNames([item.payload]).then((nameOf) => {
      if (!cancelled) setName(nameOf(item.payload));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direct, key]);
  return direct || name;
}

/* ------------------------------------------------------------------ */
/* Collection resolution                                               */
/* ------------------------------------------------------------------ */

/**
 * getRecord across `collections` in order, returning the first hit alongside
 * the collection it came from. A collection that definitively lacks the rkey
 * is skipped; a transient failure is re-thrown once every collection has been
 * tried, so a flaky network still reads as "couldn't load" rather than as a
 * record that doesn't exist.
 */
async function getFirstRecord(pds, collections, rkey) {
  let transient = null;
  for (const collection of collections) {
    try {
      const record = await getRecord(pds, { repo: ME_DID, collection, rkey });
      if (record?.value) return { record, collection };
    } catch (err) {
      if (!isRecordNotFound(err)) transient = err;
    }
  }
  if (transient) throw transient;
  return { record: null, collection: collections[0] };
}

/**
 * Verbs whose records can be drafts (`draft: true`), which no public page may
 * show — see `isDraft` in lib/publications.js.
 */
const DRAFTABLE_VERBS = new Set(['blogging', 'creating']);

/**
 * Longest the page waits on a record's subject before drawing the record
 * without it. The subject lookups are plain fetches with no timeout of their
 * own, and a stalled AppView must not hold the whole page on its skeleton.
 */
const SUBJECT_WAIT_MS = 6000;

/**
 * The thing a record points at — the post a like is of, the account a follow
 * is of, the post a redaction erased — resolved the same way the feed resolves
 * it (subjectResolver.js), so the page can show what the record is ABOUT and
 * not only its JSON. The feed's rows carry this already; a record fetched fresh
 * from the PDS is just the pointer.
 *
 * Returns the `_subject` shape ReferenceCard and the lab cards read — with
 * `{ missing: true }` for a subject that's gone — or null when the collection
 * declares no subject or the lookup didn't finish in time.
 */
async function hydrateRecordSubject(record, collectionConfig) {
  if (!collectionConfig?.subject) return null;
  // hydrateSubjects writes `_subject` onto what it's handed. A copy keeps the
  // page's raw-record dump and "Copy record JSON" the record as the PDS has it.
  const copy = { ...record };
  let timer = null;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), SUBJECT_WAIT_MS);
  });
  // A resolver of its own rather than the module-wide one, which rests a host
  // that just failed for a minute: a record page opened in that minute would
  // draw its subject as gone without asking again.
  const lookup = createSubjectResolver()
    .hydrateSubjects([copy], collectionConfig)
    .then(
      () => copy._subject || null,
      () => null,
    );
  try {
    return await Promise.race([lookup, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** "`a`", "`a` or `b`", "`a`, `b` or `c`" — lexicons as prose. */
function LexiconList({ nsids }) {
  return nsids.map((nsid, i) => (
    <span key={nsid}>
      {i > 0 && (i === nsids.length - 1 ? ' or ' : ', ')}
      <code>{nsid}</code>
    </span>
  ));
}

/* ------------------------------------------------------------------ */
/* Body dispatch                                                       */
/* ------------------------------------------------------------------ */

function RecordBody({ verb, item }) {
  switch (verb) {
    case 'posting':
    case 'reposting':
      return <PostCard {...item} variant="record" />;
    case 'logging':
      // The status is the page's H1, so the body is what it carries beyond
      // its words: the body-state captured with it, when it has one.
      return item.payload?.stateRef?.uri ? <VitalsChip stateRef={item.payload.stateRef} /> : null;
    case 'listening':
      return (
        <>
          <AlbumArt payload={item.payload} />
          <ListenRow {...item} />
        </>
      );
    case 'blogging':
      return <BlogCard {...item} />;
    case 'creating':
      return <CreatingCard {...item} />;
    case 'mothing':
    case 'observing':
      return <ObservationRecordBody item={item} />;
    case 'crafting':
      return <AnisotaLabCard {...item} variant="record" />;
    case 'flushing':
      return <FlushCard {...item} />;
    default:
      return <GenericRecordBody item={item} />;
  }
}

/**
 * One iNaturalist observation on its own page.
 *
 * The card can't tell whether this was a lifer — that is a question about
 * every other sighting, and a record page holds exactly one — so the build's
 * index answers it (see writeFirstSightings in scripts/prefetch.mjs). A
 * sighting logged since the last build reads as an ordinary one here until the
 * next; /mothing, which pulls the whole archive on every visit, is always
 * current.
 */
function ObservationRecordBody({ item }) {
  const { ids } = useFirstSightings();
  return <ObservationCard {...item} _firstSighting={isFirstSighting(item, ids)} />;
}

/**
 * Fallback body for any verb that doesn't have a specialized layout.
 *
 * Renders, top to bottom:
 *   - the resolved subject preview, for records that point at something (a
 *     like's post, a follow's account), hydrated by the load above,
 *   - a raw JSON dump of the underlying record, styled like the
 *     atmosphere debug overlay, with copy buttons for it and its AT URI.
 *
 * "Open in…" and "Inspect Data" (the explorer) follow in the page's own
 * AturiActions row, so this body doesn't offer them a second time.
 *
 * Specialized layouts are upgrades, not replacements — when a verb gets
 * its own branch above, the fallback simply stops being reached.
 */
function GenericRecordBody({ item }) {
  const recordJson = JSON.stringify(item.raw || { uri: item.atUri, value: item.payload }, null, 2);
  const atUri = item.atUri || null;
  return (
    <div className="record-fallback">
      {item.subject && (
        <ReferenceCard
          payload={item.payload}
          atUri={atUri}
          createdAt={item.createdAt}
          source={item.source}
          subject={item.subject}
          verb={item.verb}
        />
      )}
      <details className="record-fallback-json" open>
        <summary className="small-caps">raw record</summary>
        <RecordCopyRow atUri={atUri} recordJson={recordJson} />
        {/* Focusable so a keyboard can scroll the long lines sideways. */}
        <pre
          className="debug-overlay-json record-fallback-pre"
          tabIndex={0}
          role="region"
          aria-label="Raw record JSON"
        >
          {recordJson}
        </pre>
      </details>
    </div>
  );
}

function RecordCopyRow({ atUri, recordJson }) {
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
  return (
    <div className="record-fallback-actions">
      {atUri && (
        <button type="button" className="btn btn--sm" onClick={() => copy(atUri, 'uri')}>
          {copied === 'uri' ? 'AT URI copied' : 'Copy AT URI'}
        </button>
      )}
      {recordJson && (
        <button type="button" className="btn btn--sm" onClick={() => copy(recordJson, 'json')}>
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
  // Only the play's OWN release name addresses an album page: the index groups
  // on what the scrobble said, so a name Apple supplied instead (`art.album`)
  // would compute a slug nothing in the play history answers to. Captioned
  // either way, linked only when it's the record's.
  const ownRelease = albumIdentity(payload);
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
      {release && (
        <figcaption className="listen-album-art-caption">
          {/* The record this song is off has a page of its own: every other
              play of it, and the rest of its tracks. */}
          {ownRelease ? <Link to={albumPath(ownRelease)}>{release}</Link> : release}
        </figcaption>
      )}
      <Lightbox
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        images={[{ src: art.url, alt, thumb: art.url, width: 600, height: 600 }]}
      />
    </figure>
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
              <Link to={localHref}><Time value={ts} variant="relative" /></Link>
            ) : externalHref ? (
              <a href={externalHref} target="_blank" rel="noreferrer noopener"><Time value={ts} variant="relative" /></a>
            ) : (
              <Time value={ts} variant="relative" />
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

function isRenderableReplyNode(node) {
  if (!node) return false;
  if (node.$type === 'app.bsky.feed.defs#notFoundPost') return true;
  if (node.$type === 'app.bsky.feed.defs#blockedPost') return true;
  return Boolean(node.post);
}

/**
 * A post record page for one of the author's own posts often sits at the head
 * of a self-reply thread — the author replied to their own post to keep a
 * thought going. Those continuation posts read as one linear piece, so we
 * lift them out of the replies tree and stack them in the main post area.
 *
 * Walks down from the focused post following a *single* self-reply at each
 * level. It stops as soon as a level has zero self-replies (the thread ended)
 * or more than one (the author branched — no longer a linear thread, so which
 * branch "continues" is ambiguous and we leave everything in replies).
 *
 * Returns:
 *   thread   — continuation `threadViewPost` nodes, oldest → newest
 *   leftover — every reply node NOT on the lifted chain, ready to feed the
 *              Comments tree: other people's replies to any post in the
 *              thread, plus all replies hanging off the thread's tail.
 */
function splitSelfThread(rootNode, authorDid) {
  const thread = [];
  const leftover = [];
  if (!rootNode || !authorDid) return { thread, leftover };
  let cursor = rootNode;
  const seen = new Set(); // guard against a malformed cyclic thread view
  while (cursor && cursor.post?.uri && !seen.has(cursor.post.uri)) {
    seen.add(cursor.post.uri);
    const replies = (cursor.replies || []).filter(isRenderableReplyNode);
    const selfReplies = replies.filter((r) => r.post?.author?.did === authorDid);
    if (selfReplies.length === 1) {
      const next = selfReplies[0];
      // Siblings of the continuation (replies by others at this level) stay
      // in the replies section.
      for (const r of replies) if (r !== next) leftover.push(r);
      thread.push(next);
      cursor = next;
    } else {
      // 0 → thread ended here; 2+ → branched, not linear. Either way, every
      // reply hanging off this node belongs in the replies section.
      leftover.push(...replies);
      break;
    }
  }
  return { thread, leftover };
}

/**
 * One continuation post in the author's self-reply thread, rendered as a
 * full-size post in the main area (not a nested reply). A dotted rule and a
 * "↳ continued" marker tie it to the post above; the timestamp links to the
 * post's own record page.
 */
function SelfThreadPost({ item }) {
  const text = item.payload?.text || '';
  const facets = item.payload?.facets || null;
  const embed = item.payload?.embed || item.payload?.embedRecord || null;
  const author = item.payload?.author || null;
  const authorDid = author?.did;
  const ts = item.createdAt || item.payload?.indexedAt;
  // Local permalink only for the author's own posts (the only records this
  // site hosts); a reposted foreign thread links its continuations out to
  // bsky.app instead, matching the parent-chain treatment above.
  const isMine = authorDid === ME_DID;
  const localHref = isMine ? recordPathFromAtUri(item.atUri) : null;
  const externalHref = !isMine && author?.handle && item.atUri
    ? `https://bsky.app/profile/${author.handle}/post/${item.atUri.split('/').pop()}`
    : null;
  return (
    <article className="record-thread-post" data-at-uri={item.atUri}>
      <header className="record-thread-head">
        <span className="record-thread-cont small-caps">
          <CornerDownRight size={12} strokeWidth={1.75} aria-hidden="true" />
          continued
        </span>
        {ts && (
          <span className="gutter record-thread-time">
            {localHref ? (
              <Link to={localHref}><Time value={ts} variant="relative" /></Link>
            ) : externalHref ? (
              <a href={externalHref} target="_blank" rel="noreferrer noopener"><Time value={ts} variant="relative" /></a>
            ) : (
              <Time value={ts} variant="relative" />
            )}
          </span>
        )}
      </header>
      {text && <p className="record-thread-text">{renderPostText(text, facets)}</p>}
      {embed && <PostEmbed embed={embed} did={authorDid} collapsible />}
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


/* ------------------------------------------------------------------ */
/* Titles                                                              */
/* ------------------------------------------------------------------ */


/**
 * Browser tab title — stays descriptive for every record type, including
 * short-form, by snapshotting the body text.
 */
function headTitleFor(verb, item, sentence) {
  if (!item) return `${VERB_LABELS[verb] || verb} — dame.is`;
  switch (verb) {
    case 'blogging':
      return `${item.payload?.title || 'Untitled'} — dame.is`;
    case 'creating':
      return `${item.payload?.title || 'Untitled work'} — dame.is`;
    case 'listening': {
      const both = [playTrackName(item.payload), playArtistLine(item.payload)]
        .filter(Boolean)
        .join(' · ');
      return `${both || 'A play'} — dame.is`;
    }
    case 'posting': {
      const text = (item.payload?.text || '').trim();
      return `${text ? truncate(text, 80) : 'A post'} — dame.is`;
    }
    case 'reposting': {
      const handle = item.payload?.author?.handle;
      const text = (item.payload?.text || '').trim();
      const snippet = text ? truncate(text, 60) : 'a post';
      return `Reposted: ${handle ? `@${handle} — ` : ''}${snippet} — dame.is`;
    }
    case 'logging':
      return `${truncate(sentenceText(sentence), 80)} — dame.is`;
    case 'mothing':
    case 'observing': {
      // The name the card is headed with, so the tab reads "Somber Carpet
      // Moth" rather than the verb's generic "a moth".
      const taxon = item.payload?.taxon;
      const fallback =
        verb === 'mothing' ? 'Unidentified moth' : 'Unidentified organism';
      return `${taxon?.commonName || taxon?.name || fallback} — dame.is`;
    }
    case 'flushing': {
      // The handle is already the suffix, so the tab reads the flush's own
      // words rather than repeating "dame.is" at both ends. The emoji leads
      // because for a wordless flush it's the whole message.
      const emoji = item.payload?.emoji || '';
      const body = flushBody(item.payload?.text, ME_HANDLE);
      return `${emoji ? `${emoji} ` : ''}${truncate(body, 80)} — dame.is`;
    }
    default:
      return `${sentence ? truncate(sentenceText(sentence), 80) : VERB_LABELS[verb] || verb} — dame.is`;
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
    // The page is the repost record, so its CID is the repost's; the post it
    // points at keeps its own as subjectCid.
    cid: repostRecord.cid || null,
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
      subjectCid: subjectPost.cid || repostRecord.value?.subject?.cid || null,
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
