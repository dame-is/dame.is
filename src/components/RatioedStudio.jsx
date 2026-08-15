// The Ratioed studio: compose a piece, watch it, seal it, announce it.
//
// A piece has a fixed lifecycle that dame has been running by hand since June
// 2025 — write the post, watch, close replies the instant somebody likes it,
// reply naming them, measure. Every step of that is here except the one that
// matters: the studio never seals on its own. The reaction time is the
// project's central finding and it measures a person noticing; a loop that
// sealed for you would replace it with a polling interval and end the
// measurement without saying so. What the studio does instead is watch hard
// and shout, so the person noticing does it sooner.
//
// The piece's RECORD is written when the post goes up, not when it's sealed.
// That's what makes the link inside the post work while the piece is still
// alive, and it's why the lexicon's seal fields are optional (see the note on
// `isLive`). Sealing fills them in.
//
// As a studio it is a BODY, not a page: the workbench pane draws the title, the
// blurb and the NSID, and the rail is the way back — so this file renders no
// PageShell and no back link of its own. Two things follow from living in a
// shell that never remounts:
//
//  1. **Seal is not routed through the shell's status strip.** Every
//     millisecond between the like and the threadgate write is in the recorded
//     reaction time, so the button stays here, next to the alarm, with no
//     confirm and no debounce in front of it. Nothing in this studio is a
//     staged edit waiting on a generic Save, so it reports no dirty state
//     either.
//  2. **Unmounting is what stops the watch.** The pane keys the studio on the
//     surface, so selecting another surface really does unmount this component
//     — and the effect teardowns below are the only thing that close a ~166
//     KB/s firehose socket, an 8s poll and a 1s clock. Every effect that starts
//     something here returns the thing that stops it.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RichText } from '@atproto/api';
import { Send, Lock, RefreshCw, ExternalLink, FileText, Radio } from 'lucide-react';
import { COLLECTIONS, ME_DID, ME_HANDLE, RATIOED_PATH } from '../config.js';
import {
  loadPieces,
  normalizePiece,
  isLive,
  finished,
  piecePath,
  pieceSlug,
  fetchPieceRecords,
  fmtDuration,
  fmtSeconds,
} from '../lib/ratioed.js';
import { measureWindows, buildEventLog } from '../lib/ratioedDiscovery.js';
import {
  DEFAULT_TEMPLATE,
  fillTemplate,
  templateProblems,
  nextTake,
  previousPiece,
  announcementDraft,
} from '../lib/ratioedStudio.js';
import { watchSubject } from '../lib/jetstream.js';
import {
  resolvePds,
  getRecord,
  getLikes,
  resolveProfiles,
  resolveHandles,
  rkeyFromAtUri,
  tidToTimestamp,
} from '../lib/atproto.js';
import './RatioedStudio.css';

const NSID = COLLECTIONS.ratioedPiece;
const TEMPLATE_NSID = COLLECTIONS.ratioedTemplate;
const POST = 'app.bsky.feed.post';
const GATE = 'app.bsky.feed.threadgate';

// How often the live watch asks the AppView whether anybody has liked it.
//
// The stream is the fast reader and the poll is the backstop, which is why this
// stays on even while the socket is open: a websocket can drop, a laptop can
// sleep through a reconnect, and the cost of missing the one like this whole
// panel exists to catch is the piece. Slower than it was, because the stream is
// now doing the noticing.
const WATCH_MS = 8000;

const KIND_VERB = { like: 'liked it', repost: 'reposted', quote: 'quoted', reply: 'replied' };

// How many rows the feed keeps. Enough to hold any piece the project has ever
// produced several times over, and a ceiling all the same.
const FEED_MAX = 300;

/** The subject post's at:// URI for a piece record key. */
const subjectUri = (rkey) => `at://${ME_DID}/${POST}/${rkey}`;

/** A piece's subject: the field the record carries, or the key it implies. */
const subjectOf = (piece) => piece?.subject || subjectUri(piece?.rkey);

export default function RatioedStudio({ agent, did }) {
  const [pieces, setPieces] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState('');

  const [draft, setDraft] = useState('');
  const [likes, setLikes] = useState(null); // AppView view while a piece is up
  const [announce, setAnnounce] = useState(null); // { text, piece, ref } after a seal
  const [now, setNow] = useState(() => Date.now());
  // Set the instant the threadgate lands, before the measurement that follows
  // it. The gate IS the seal; measuring is a slow read over an index that lags.
  // Without this the panel went on offering "Seal this piece" for as long as
  // the read took, on a piece that was already closed.
  const [sealed, setSealed] = useState(null); // { rkey, sealedAt }
  // The strong ref to the piece a new one will quote. Resolved when the
  // composer opens, not when Post is pressed: an embed needs the target post's
  // CID, and looking it up mid-publish means a momentary network failure takes
  // the piece down with it. Resolving early also makes the composer honest —
  // it can say whether the quote is actually in hand.
  const [quote, setQuote] = useState(undefined); // undefined = looking, null = no

  // The template, as stored on the PDS. `undefined` while it's being read;
  // DEFAULT_TEMPLATE when no record exists yet.
  const [template, setTemplate] = useState(undefined);
  const [tplDraft, setTplDraft] = useState(null); // non-null while editing

  // What the stream has seen on the live piece, newest first. Separate from the
  // measurement: this is a witness, not a record, and it is thrown away when
  // the panel closes. Its value is that it arrives in real time and it carries
  // rkeys — so at seal time the breaking like's exact write time is already in
  // hand, without waiting for the backlink index to catch up.
  const [feed, setFeed] = useState([]);
  const [stream, setStream] = useState(null); // { state, bytes, seen }
  const [profiles, setProfiles] = useState({});
  const [streamOn, setStreamOn] = useState(true);
  // Bumped to force a fresh socket (and a fresh byte budget) after one has
  // stopped itself.
  const [streamRun, setStreamRun] = useState(0);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const pds = await resolvePds(did).catch(() => null);
      setPieces(await loadPieces(pds));
    } catch (err) {
      setError(err?.message || String(err));
      setPieces([]);
    }
  }, [did]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    agent.com.atproto.repo
      .getRecord({ repo: did, collection: TEMPLATE_NSID, rkey: 'self' })
      .then((res) => {
        if (alive) setTemplate(res?.data?.value?.text || DEFAULT_TEMPLATE);
      })
      // No record yet is the normal state until one is saved, not a fault.
      .catch(() => {
        if (alive) setTemplate(DEFAULT_TEMPLATE);
      });
    return () => {
      alive = false;
    };
  }, [agent, did]);

  const live = useMemo(() => (pieces || []).find(isLive) || null, [pieces]);
  const done = useMemo(() => finished(pieces), [pieces]);
  const take = useMemo(() => nextTake(pieces), [pieces]);
  const prev = useMemo(() => previousPiece(done), [done]);

  useEffect(() => {
    if (!prev || live) {
      setQuote(null);
      return undefined;
    }
    let alive = true;
    setQuote(undefined);
    (async () => {
      const rec = await resolvePds(did)
        .then((pds) => getRecord(pds, { repo: did, collection: POST, rkey: prev.rkey }))
        .catch(() => null);
      if (!alive) return;
      setQuote(rec?.cid ? { uri: subjectUri(prev.rkey), cid: rec.cid } : null);
    })();
    return () => {
      alive = false;
    };
  }, [prev, live, did]);

  // Seed the composer once the take number is known, and leave it alone after —
  // it's a draft, and a background refresh must not overwrite typing.
  useEffect(() => {
    if (!pieces || live || draft || template === undefined) return;
    setDraft(fillTemplate(template, take));
  }, [pieces, live, draft, take, template]);

  // A ticking clock while a piece is up, so "alive for" counts rather than
  // sits. It stops at the seal: after that the number is the lifespan, and a
  // lifespan does not keep growing.
  useEffect(() => {
    if (!live || sealed) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live, sealed]);

  // The watch. Only runs while something is actually up and unsealed.
  // Either reader will do; the stream simply gets there first.
  const streamLike = feed.find((e) => e.kind === 'like' && !e.deleted) || null;
  const seenLike = Boolean(streamLike) || Boolean(likes?.likes?.length);
  // Somebody liked it and took it back before it was sealed. The alarm must not
  // simply go quiet on that: it's the project's own subject matter happening in
  // front of you, and whether a withdrawn like still ends a piece is a question
  // for the artist, not for a boolean.
  const withdrawn = !seenLike && feed.some((e) => e.kind === 'like' && e.deleted);
  useEffect(() => {
    if (!live || sealed) {
      if (!live) setLikes(null);
      return undefined;
    }
    let alive = true;
    const poll = async () => {
      const res = await getLikes(subjectOf(live)).catch(() => null);
      if (alive && res) setLikes(res);
    };
    poll();
    const id = setInterval(poll, WATCH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [live, sealed]);

  // The stream. Open only while a piece is actually up and unsealed — it is a
  // firehose, ~180 KB/s, and it exists to shave four seconds off noticing one
  // like. The moment the piece is sealed there is nothing left to notice.
  useEffect(() => {
    if (!live || sealed || !streamOn) return undefined;
    setFeed([]);
    const close = watchSubject(subjectOf(live), {
      onStatus: setStream,
      onEvent: (ev) => {
        setFeed((f) => {
          if (ev.op === 'delete') {
            // Somebody taking it back, watched rather than inferred. Six of the
            // thirteen breaking likes were deleted; this is the only way to see
            // one happen.
            return f.map((x) => (x.rkey === ev.rkey ? { ...x, deleted: true } : x));
          }
          if (f.some((x) => x.rkey === ev.rkey)) return f; // a replayed cursor
          // Newest first, and bounded: a piece draws tens of records, but this
          // is pointed at whatever post it's given and must not grow forever.
          return [{ ...ev, at: tidToTimestamp(ev.rkey) }, ...f].slice(0, FEED_MAX);
        });
      },
    });
    return close;
  }, [live, sealed, streamOn, streamRun]);

  // Faces for whoever turns up. Resolved in batches as new DIDs appear.
  //
  // Cancellable: on a busy piece this re-runs every time the stream delivers an
  // unknown DID, so a surface flip can leave several of these in flight against
  // an AppView that answers in its own time. Without the guard each one lands
  // on an unmounted component.
  useEffect(() => {
    const missing = feed.map((e) => e.did).filter((d) => d && !profiles[d]);
    if (!missing.length) return undefined;
    let alive = true;
    resolveProfiles(Array.from(new Set(missing))).then((p) => {
      if (alive) setProfiles((old) => ({ ...old, ...p }));
    });
    return () => {
      alive = false;
    };
  }, [feed, profiles]);

  // The tab title carries the alarm, so a piece that gets liked while this is
  // in a background tab still says so in the tab strip.
  //
  // It sits ON TOP of the shell's title rather than replacing it: the surface's
  // own "Ratioed studio — Admin — dame.is" is set by the pane, this captures
  // whatever is there and puts it back on the way out, and React flushes every
  // cleanup in a commit before any effect — so leaving the surface restores the
  // shell's title a beat before the next surface sets its own. With no piece
  // live this effect does nothing at all, which is why the tab reads correctly
  // on arrival.
  useEffect(() => {
    if (!live) return undefined;
    const prevTitle = document.title;
    document.title = sealed
      ? `sealed · take ${live.take}`
      : seenLike
        ? '● LIKED — seal it'
        : withdrawn
          ? '○ un-liked · take ' + live.take
          : `alive · take ${live.take}`;
    return () => {
      document.title = prevTitle;
    };
  }, [live, seenLike, withdrawn, sealed]);

  /* ---------------------------------------------------------------- */

  /** Write the post, then its record. The piece is alive from here. */
  async function publish() {
    if (!draft.trim()) return;
    if (!window.confirm(`Post take ${take} to Bluesky now?\n\nThe piece is live the moment this lands.`)) {
      return;
    }
    setBusy('publish');
    setError(null);
    try {
      const rt = new RichText({ text: draft.trim() });
      await rt.detectFacets(agent);

      const embed = quote ? { $type: 'app.bsky.embed.record', record: quote } : undefined;

      const res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: POST,
        record: {
          $type: POST,
          text: rt.text,
          ...(rt.facets?.length ? { facets: rt.facets } : {}),
          ...(embed ? { embed } : {}),
          langs: ['en'],
          createdAt: new Date().toISOString(),
        },
      });
      const rkey = rkeyFromAtUri(res?.data?.uri);
      if (!rkey) throw new Error('the post was written but its record key came back empty');

      // The record, immediately: a live piece with nothing measured. The link
      // inside the post points at a page that needs this to resolve.
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: NSID,
        rkey,
        record: {
          $type: NSID,
          take,
          subject: subjectUri(rkey),
          // The PDS write time, decoded from the key it just assigned — the
          // same clock every other piece's postedAt was read from.
          postedAt: tidToTimestamp(rkey) || new Date().toISOString(),
        },
      });
      setDraft('');
      setNote(`Take ${take} is up. Watching for the like.`);
      await refresh();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Close replies, then measure.
   *
   * The gate goes first and alone: it is the artwork, and every millisecond
   * between the like and this write is in the recorded reaction time. Measuring
   * is a read and can wait the extra second.
   */
  async function seal() {
    if (!live) return;
    setBusy('seal');
    setError(null);
    try {
      const sealedAt = new Date().toISOString();
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: GATE,
        rkey: live.rkey,
        record: {
          $type: GATE,
          post: subjectOf(live),
          allow: [],
          createdAt: sealedAt,
        },
      });
      // The artwork is finished as of this line. Say so before the read.
      setSealed({ rkey: live.rkey, sealedAt });
      setNote('Sealed. Measuring…');
      await measureAndFinish(live, sealedAt);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Read the piece's backlinks and fill in everything the record was missing.
   *
   * Separate from `seal` and re-runnable, because the backlink index lags: a
   * like cast eight seconds ago may not be indexed yet, and the reaction time
   * depends on its record key. Pressing this again a minute later is how a
   * measurement that came back empty gets taken properly.
   */
  async function measureAndFinish(piece, sealedAtIso) {
    const sealedAt = sealedAtIso || piece.sealedAt;
    if (!sealedAt) return;
    const subject = subjectOf(piece);
    const records = await fetchPieceRecords(subject);
    const sealedMs = Date.parse(sealedAt);
    const postedMs = Date.parse(piece.postedAt);
    const windows = measureWindows(records, sealedMs, did);
    const handles = await resolveHandles(records.map((r) => r.did));
    const events = buildEventLog(records, {
      postedAtMs: postedMs,
      sealedAtMs: sealedMs,
      selfDid: did,
      handles,
    });

    // Who to name, and when they did it.
    //
    // The backlink index is the authority and lags by up to a minute; the
    // stream saw the like as it happened and kept its record key, which is the
    // same TID the index would eventually report. So when the index hasn't
    // caught up, the witnessed like stands in — the reaction time is otherwise
    // lost to a wait, which is exactly the failure this project can't absorb.
    const witnessed = feed.filter((e) => e.kind === 'like' && !e.deleted).sort((a, b) =>
      String(a.rkey).localeCompare(String(b.rkey)),
    )[0] || null;
    const witnessedAt = witnessed ? Date.parse(tidToTimestamp(witnessed.rkey) || '') : NaN;
    const breaking =
      windows.breakingLike ||
      (witnessed && Number.isFinite(witnessedAt) && witnessedAt < sealedMs
        ? { at: witnessedAt, did: witnessed.did }
        : null);

    const breakerDid = breaking?.did || likes?.likes?.[0]?.actor?.did || null;
    const handle =
      (breakerDid && handles[breakerDid]) ||
      (breakerDid && profiles[breakerDid]?.handle) ||
      likes?.likes?.[0]?.actor?.handle ||
      'unknown';
    const likeSurvives = Boolean(breaking);

    const value = {
      $type: NSID,
      take: piece.take,
      subject,
      postedAt: piece.postedAt,
      sealedAt,
      lifespanMs: sealedMs - postedMs,
      breaker: {
        handle,
        ...(breakerDid ? { did: breakerDid } : {}),
        likeSurvives,
        ...(likeSurvives ? { reactionMs: sealedMs - breaking.at } : {}),
      },
      preSeal: windows.preSeal,
      postSeal: windows.postSeal,
      ...(events.length ? { events } : {}),
      measuredAt: new Date().toISOString(),
      source: 'constellation.microcosm.blue',
    };
    await agent.com.atproto.repo.putRecord({ repo: did, collection: NSID, rkey: piece.rkey, record: value });

    const shaped = normalizePiece(piece.rkey, value);
    // The reply needs a strong ref to the post it concludes. Read it here,
    // while already on the network, so pressing "Post the reply" is one write
    // and can't fail on a lookup.
    const pds = await resolvePds(did).catch(() => null);
    const post = pds
      ? await getRecord(pds, { repo: did, collection: POST, rkey: piece.rkey }).catch(() => null)
      : null;
    setAnnounce({
      piece: shaped,
      ref: post?.cid ? { uri: subject, cid: post.cid } : null,
      text: announcementDraft({ handle, piece: shaped, others: finished(pieces) }),
    });
    setNote(
      likeSurvives
        ? `Measured. Reaction ${fmtSeconds(sealedMs - breaking.at)}${
            windows.breakingLike ? '.' : ', from the like the stream witnessed — measure again once the index catches up.'
          }`
        : 'Measured, but neither the index nor the stream has a like — measure again in a minute.',
    );
    await refresh();
  }

  async function remeasure() {
    if (!announce?.piece) return;
    setBusy('measure');
    setError(null);
    try {
      await measureAndFinish(announce.piece, announce.piece.sealedAt);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Save the template.
   *
   * Refused if the discovery scan wouldn't recognise what it produces. That is
   * the failure this whole editor risks introducing and the one the project
   * has already had: take #13 reworded the opening line, the scan stopped
   * seeing it, and it went unmeasured until somebody checked by hand.
   */
  async function saveTemplate() {
    const problems = templateProblems(tplDraft, take);
    if (problems.length) {
      setError(problems.join(' '));
      return;
    }
    setBusy('template');
    setError(null);
    try {
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: TEMPLATE_NSID,
        rkey: 'self',
        record: {
          $type: TEMPLATE_NSID,
          text: tplDraft,
          updatedAt: new Date().toISOString(),
        },
      });
      setTemplate(tplDraft);
      setDraft(fillTemplate(tplDraft, take));
      setTplDraft(null);
      setNote('Template saved. The composer above is rewritten from it.');
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /** Post the concluding reply, in the thread it concludes. */
  async function postAnnouncement() {
    if (!announce?.text.trim() || !announce.piece) return;
    setBusy('announce');
    setError(null);
    try {
      let ref = announce.ref;
      if (!ref) {
        // The seal-time lookup didn't land. One retry, since without a strong
        // ref there is no reply.
        const pds = await resolvePds(did);
        const post = await getRecord(pds, { repo: did, collection: POST, rkey: announce.piece.rkey });
        if (!post?.cid) throw new Error('could not read the piece post’s CID to reply to it');
        ref = { uri: subjectUri(announce.piece.rkey), cid: post.cid };
      }

      const rt = new RichText({ text: announce.text.trim() });
      await rt.detectFacets(agent);
      await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: POST,
        record: {
          $type: POST,
          text: rt.text,
          ...(rt.facets?.length ? { facets: rt.facets } : {}),
          reply: { root: ref, parent: ref },
          langs: ['en'],
          createdAt: new Date().toISOString(),
        },
      });
      setAnnounce(null);
      setSealed(null);
      setNote(`Take ${announce.piece.take} is finished.`);
      await refresh();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /* ---------------------------------------------------------------- */

  const justSealed = Boolean(live && sealed?.rkey === live.rkey);
  const aliveMs = live
    ? (justSealed ? Date.parse(sealed.sealedAt) : now) - Date.parse(live.postedAt)
    : 0;
  const firstLike = likes?.likes?.[0] || null;

  return (
    // `.rs-root` earns its place twice over. It is where the three --ratioed-*
    // hues are defined (see RatioedStudio.css — they belong to the .ratioed
    // chart block, which is not on this page, so the studio was rendering their
    // fallbacks by accident). And as a plain block it keeps the studio's own
    // vertical rhythm: the sections below space themselves with collapsing
    // margins, which only happens inside a block container — the pane itself is
    // a flex column with a gap.
    <div className="rs-root">
      {error && <p className="admin-error">{error}</p>}
      {note && <p className="admin-field-hint">{note}</p>}

      {pieces === null ? (
        <p className="admin-field-hint">Reading the series…</p>
      ) : live ? (
        <section
          className={`rs-live${justSealed ? '' : seenLike ? ' liked' : withdrawn ? ' withdrawn' : ''}`}
        >
          <header className="rs-live-head">
            <span className="rs-live-take">take {pieceSlug(live)}</span>
            <span className="rs-live-clock">{fmtDuration(aliveMs)}</span>
          </header>

          <p className="rs-live-state">
            {justSealed ? (
              <>Sealed. Reading its records&hellip;</>
            ) : withdrawn ? (
              <>
                Somebody liked it and <strong>un-liked it</strong>. Nothing is standing against it
                now — seal it or let it run.
              </>
            ) : firstLike ? (
              <>
                <strong>@{firstLike.actor?.handle || 'somebody'}</strong> liked it. Seal it.
              </>
            ) : (
              'Nobody has liked it yet.'
            )}
          </p>

          <div className="rs-actions">
            {!justSealed && (
              <button type="button" className="rs-seal" onClick={seal} disabled={!!busy}>
                <Lock size={15} aria-hidden="true" />
                {busy === 'seal' ? 'Sealing…' : 'Seal this piece'}
              </button>
            )}
            <a
              className="admin-gate-button"
              href={`https://bsky.app/profile/${ME_HANDLE}/post/${live.rkey}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              <ExternalLink size={14} aria-hidden="true" />
              the post
            </a>
            <Link className="admin-gate-button" to={piecePath(live)}>
              its page
            </Link>
          </div>

          {justSealed && (
            <p className="admin-field-hint">
              Replies are closed. The figures below come from the backlink index, which lags — but
              the stream already witnessed the like, so the reaction time is in hand either way.
            </p>
          )}

          <div className="rs-feed">
            <header className="rs-feed-head">
              <span className="small-caps">as it happens</span>
              <span className={`rs-feed-state is-${!streamOn ? 'off' : stream?.state || 'connecting'}`}>
                <Radio size={12} aria-hidden="true" />
                {!streamOn
                  ? 'stream off · polling'
                  : stream?.state === 'spent'
                    ? `stopped at ${Math.round((stream.bytes || 0) / 1024 / 1024)} MB · polling`
                    : stream?.state === 'open'
                      ? `live · ${((stream.bytes || 0) / 1024 / 1024).toFixed(1)} MB read`
                      : stream?.state || 'connecting'}
              </span>
              {stream?.state === 'spent' ? (
                <button
                  type="button"
                  className="admin-link-subtle"
                  onClick={() => setStreamRun((n) => n + 1)}
                >
                  start it again
                </button>
              ) : (
                <button
                  type="button"
                  className="admin-link-subtle"
                  onClick={() => setStreamOn((v) => !v)}
                >
                  {streamOn ? 'stop the stream' : 'start the stream'}
                </button>
              )}
            </header>

            {feed.length === 0 ? (
              <p className="admin-field-hint rs-feed-empty">
                Nothing yet. Every like, repost, quote and reply on the network is arriving here and
                being tested against this post — ~166&nbsp;KB/s, which is what buys sub-second
                notice instead of a {WATCH_MS / 1000}s poll. It stops itself at 256&nbsp;MB, and
                the poll carries on either way.
              </p>
            ) : (
              <ul className="rs-feed-list">
                {feed.map((e) => (
                  <li key={e.rkey} className={`rs-feed-row rs-k-${e.kind}${e.deleted ? ' gone' : ''}`}>
                    <span className="rs-feed-when">
                      {e.at ? `+${fmtDuration(Date.parse(e.at) - Date.parse(live.postedAt))}` : '—'}
                    </span>
                    <span className="rs-feed-who">
                      @{profiles[e.did]?.handle || e.did.slice(0, 18)}
                    </span>
                    <span className="rs-feed-kind">{KIND_VERB[e.kind] || e.kind}</span>
                    {e.deleted && <span className="rs-feed-gone">deleted it</span>}
                    {e.text && <span className="rs-feed-text">{e.text.slice(0, 90)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="admin-field-hint">
            The stream is the fast reader; the AppView is polled every {WATCH_MS / 1000}s underneath
            it as a backstop, because a socket can drop and a missed like costs the piece. The
            measurement afterwards uses the backlink index, which is slower and more complete.
          </p>
        </section>
      ) : announce ? null : (
        <section className="rs-compose">
          <h2 className="rs-h2">Take {String(take).padStart(2, '0')}</h2>
          <p className="admin-field-hint">
            {!prev ? (
              <>Nothing to quote yet. </>
            ) : quote === undefined ? (
              <>Reading take {pieceSlug(prev)} to quote it… </>
            ) : quote ? (
              <>Quoting take {pieceSlug(prev)}. </>
            ) : (
              <>
                <strong>Take {pieceSlug(prev)} couldn&rsquo;t be read, so this will post without
                the quote.</strong>{' '}
              </>
            )}
            The link resolves to this piece&rsquo;s own page, which works from the moment it&rsquo;s
            posted because the record is written with it.
          </p>
          <textarea
            className="admin-input rs-draft"
            rows={13}
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="rs-actions">
            <button type="button" className="admin-gate-button" onClick={publish} disabled={!!busy}>
              <Send size={14} aria-hidden="true" />
              {busy === 'publish' ? 'Posting…' : `Post take ${String(take).padStart(2, '0')}`}
            </button>
            <button
              type="button"
              className="admin-link-subtle"
              onClick={() => setDraft(fillTemplate(template ?? DEFAULT_TEMPLATE, take))}
              disabled={!!busy}
            >
              reset to the template
            </button>
          </div>
        </section>
      )}

      {announce && (
        <section className="rs-announce">
          <h2 className="rs-h2">Take {pieceSlug(announce.piece)} is sealed</h2>
          <dl className="rs-figures">
            <div>
              <dt>alive</dt>
              <dd>{fmtDuration(announce.piece.lifespanMs)}</dd>
            </div>
            <div>
              <dt>broken by</dt>
              <dd>@{announce.piece.breaker?.handle}</dd>
            </div>
            <div>
              <dt>reaction</dt>
              <dd>
                {announce.piece.breaker?.likeSurvives
                  ? fmtSeconds(announce.piece.breaker.reactionMs)
                  : 'not indexed yet'}
              </dd>
            </div>
          </dl>
          <p className="admin-field-hint">
            The first line is the one every take has carried, and it&rsquo;s what the site reads
            the breaker back out of — keep its shape. The rest is computed and yours to cut.
          </p>
          <textarea
            className="admin-input rs-draft"
            rows={8}
            value={announce.text}
            onChange={(e) => setAnnounce((a) => ({ ...a, text: e.target.value }))}
          />
          <div className="rs-actions">
            <button
              type="button"
              className="admin-gate-button"
              onClick={postAnnouncement}
              disabled={!!busy}
            >
              <Send size={14} aria-hidden="true" />
              {busy === 'announce' ? 'Replying…' : 'Post the reply'}
            </button>
            <button type="button" className="admin-gate-button" onClick={remeasure} disabled={!!busy}>
              <RefreshCw size={14} aria-hidden="true" />
              {busy === 'measure' ? 'Measuring…' : 'Measure again'}
            </button>
            <button type="button" className="admin-link-subtle" onClick={() => setAnnounce(null)}>
              dismiss
            </button>
          </div>
        </section>
      )}

      {!live && (
        <section className="rs-template">
          <h2 className="rs-h2">
            <FileText size={15} aria-hidden="true" /> The template
          </h2>
          {tplDraft === null ? (
            <>
              <p className="admin-field-hint">
                Stored on your PDS at <code>{TEMPLATE_NSID}/self</code>, so the wording can change
                without a deploy. <code>{'{take}'}</code> becomes the number and{' '}
                <code>{'{link}'}</code> the piece&rsquo;s own page.
              </p>
              <pre className="rs-template-preview">{template ?? '…'}</pre>
              <div className="rs-actions">
                <button
                  type="button"
                  className="admin-gate-button"
                  onClick={() => setTplDraft(template ?? DEFAULT_TEMPLATE)}
                  disabled={template === undefined}
                >
                  Edit the template
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="admin-field-hint">
                Checked against the scan that measures pieces before it saves. A template the scan
                can&rsquo;t recognise makes pieces the site never finds — which is exactly how take
                13 went missing.
              </p>
              <textarea
                className="admin-input rs-draft"
                rows={13}
                spellCheck={false}
                value={tplDraft}
                onChange={(e) => setTplDraft(e.target.value)}
              />
              {templateProblems(tplDraft, take).map((p) => (
                <p className="admin-error-inline" key={p}>{p}</p>
              ))}
              <div className="rs-actions">
                <button
                  type="button"
                  className="admin-gate-button"
                  onClick={saveTemplate}
                  disabled={!!busy || templateProblems(tplDraft, take).length > 0}
                >
                  {busy === 'template' ? 'Saving…' : 'Save the template'}
                </button>
                <button type="button" className="admin-link-subtle" onClick={() => setTplDraft(null)}>
                  cancel
                </button>
                <button
                  type="button"
                  className="admin-link-subtle"
                  onClick={() => setTplDraft(DEFAULT_TEMPLATE)}
                >
                  restore the built-in
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <section className="rs-series">
        <h2 className="rs-h2">The series</h2>
        <ul className="rs-series-list">
          {[...done]
            .sort((a, b) => b.take - a.take)
            .slice(0, 6)
            .map((p) => (
              <li key={p.rkey}>
                <Link to={piecePath(p)}>take {pieceSlug(p)}</Link>
                <span className="rs-series-meta">
                  {fmtDuration(p.lifespanMs)} · @{p.breaker?.handle}
                  {p.breaker?.likeSurvives ? ` · ${fmtSeconds(p.breaker.reactionMs)}` : ' · like deleted'}
                </span>
              </li>
            ))}
        </ul>
        <p className="admin-field-hint">
          <Link to={`/creating/${RATIOED_PATH}`}>The essay</Link> ·{' '}
          {/* An ordinary <Link>: it is a whole-query replacement rather than a
              merge, so it cannot leave a stale `c` or `r` behind, and this
              studio never holds an unsaved edit for the shell's `go` guard to
              protect. */}
          <Link to="/admin?view=ratioed">the full catalogue</Link>
        </p>
      </section>
    </div>
  );
}
