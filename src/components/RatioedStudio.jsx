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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RichText } from '@atproto/api';
import { Send, Lock, RefreshCw, ExternalLink } from 'lucide-react';
import PageShell from './PageShell.jsx';
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
  pieceTemplate,
  nextTake,
  previousPiece,
  announcementDraft,
} from '../lib/ratioedStudio.js';
import {
  resolvePds,
  getRecord,
  getLikes,
  resolveHandles,
  rkeyFromAtUri,
  tidToTimestamp,
} from '../lib/atproto.js';
import './RatioedStudio.css';

const NSID = COLLECTIONS.ratioedPiece;
const POST = 'app.bsky.feed.post';
const GATE = 'app.bsky.feed.threadgate';

// How often the live watch asks the AppView whether anybody has liked it. Fast,
// because every second here is a second on the reaction time; the request is
// one small read and a piece is only ever up for minutes.
const WATCH_MS = 4000;

/** The subject post's at:// URI for a piece record key. */
const subjectUri = (rkey) => `at://${ME_DID}/${POST}/${rkey}`;

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
    if (!pieces || live || draft) return;
    setDraft(pieceTemplate(take));
  }, [pieces, live, draft, take]);

  // A ticking clock while a piece is up, so "alive for" counts rather than
  // sits. It stops at the seal: after that the number is the lifespan, and a
  // lifespan does not keep growing.
  useEffect(() => {
    if (!live || sealed) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live, sealed]);

  // The watch. Only runs while something is actually up and unsealed.
  const seenLike = Boolean(likes?.likes?.length);
  useEffect(() => {
    if (!live || sealed) {
      if (!live) setLikes(null);
      return undefined;
    }
    let alive = true;
    const poll = async () => {
      const res = await getLikes(subjectUri(live.rkey)).catch(() => null);
      if (alive && res) setLikes(res);
    };
    poll();
    const id = setInterval(poll, WATCH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [live, sealed]);

  // The tab title carries the alarm, so a piece that gets liked while this is
  // in a background tab still says so in the tab strip.
  useEffect(() => {
    if (!live) return undefined;
    const prevTitle = document.title;
    document.title = sealed
      ? `sealed · take ${live.take}`
      : seenLike
        ? '● LIKED — seal it'
        : `alive · take ${live.take}`;
    return () => {
      document.title = prevTitle;
    };
  }, [live, seenLike, sealed]);

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
          post: subjectUri(live.rkey),
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
    const subject = subjectUri(piece.rkey);
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

    // Who to name. The measurement's own breaking like when the index has it;
    // otherwise whoever the AppView is showing, which is what the watch saw.
    const breakerDid = windows.breakingLike?.did || likes?.likes?.[0]?.actor?.did || null;
    const handle =
      (breakerDid && handles[breakerDid]) ||
      likes?.likes?.[0]?.actor?.handle ||
      'unknown';
    const likeSurvives = Boolean(windows.breakingLike);

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
        ...(likeSurvives ? { reactionMs: sealedMs - windows.breakingLike.at } : {}),
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
        ? `Measured. Reaction ${fmtSeconds(sealedMs - windows.breakingLike.at)}.`
        : 'Measured, but the backlink index has no like yet — measure again in a minute to catch the reaction time.',
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
    <PageShell
      title="Ratioed studio"
      intro="Compose the next piece, watch it, seal it, announce it. The studio never seals on its own — the reaction time measures you noticing, and a loop that did it for you would quietly end the measurement."
      headTitle="Ratioed studio — Admin — dame.is"
    >
      <div className="admin-toolbar">
        <Link to="/admin?view=ratioed" className="admin-link-subtle">← Ratioed catalogue</Link>
        <code className="admin-collection-nsid">{NSID}</code>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {note && <p className="admin-field-hint">{note}</p>}

      {pieces === null ? (
        <p className="admin-field-hint">Reading the series…</p>
      ) : live ? (
        <section className={`rs-live${justSealed ? '' : seenLike ? ' liked' : ''}`}>
          <header className="rs-live-head">
            <span className="rs-live-take">take {pieceSlug(live)}</span>
            <span className="rs-live-clock">{fmtDuration(aliveMs)}</span>
          </header>

          <p className="rs-live-state">
            {justSealed ? (
              <>Sealed. Reading its records&hellip;</>
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

          <p className="admin-field-hint">
            {justSealed
              ? 'Replies are closed. The figures below arrive once the backlink index catches up — a like cast seconds ago can take a minute to appear there.'
              : null}
          </p>
          <p className="admin-field-hint">
            Checking every {WATCH_MS / 1000}s through the AppView, which sees a like sooner than
            the backlink index does. The measurement afterwards uses the index, which is the more
            complete reader.
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
              onClick={() => setDraft(pieceTemplate(take))}
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
          <Link to="/admin?view=ratioed">the full catalogue</Link>
        </p>
      </section>
    </PageShell>
  );
}
