// Admin panel for the Ratioed measurement records.
//
// The bundled seed (src/data/ratioedPieces.json) is the measurement taken from
// Constellation. This panel publishes it to the PDS, shows what's already
// there, and can re-measure the post-seal figures — which keep growing, since
// people go on liking pieces that have been sealed for a year.
//
// What it deliberately CANNOT do is re-derive the pre-seal figures or the
// reaction times. Six of the eleven breaking likes were deleted by the people
// who cast them; no index can recover those, which is the whole reason this is
// a record rather than a live query. Re-measuring only ever touches postSeal.
//
// The one exception is "Re-measure scanned", which repairs pieces this panel
// measured while its backlink reader was broken. Those records were written
// with every figure at zero, so there is no earlier measurement to protect.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Upload, Trash2, ExternalLink, ListPlus, Search } from 'lucide-react';
import PageShell from './PageShell.jsx';
import { AdminRecordListSkeleton } from './Skeleton.jsx';
import { COLLECTIONS, RATIOED_DOC_RKEY, RATIOED_SOURCE, ME_DID } from '../config.js';
import {
  SEED_PIECES,
  normalizePiece,
  fetchPieceRecords,
  fmtDuration,
  fmtSeconds,
} from '../lib/ratioed.js';
import {
  findPieces,
  isAnnouncement,
  measureWindows,
  buildEventLog,
  buildPieceRecord,
} from '../lib/ratioedDiscovery.js';
import { resolveHandles } from '../lib/atproto.js';
import { getBacklinkSources, flattenSources, getBacklinkCount } from '../lib/constellation.js';
import './RatioedPanel.css';

const NSID = COLLECTIONS.ratioedPiece;
const STANDARD_DOC = 'site.standard.document';

// The pieces the bundled event log covers. They were measured before records
// carried their own log, and the site still draws them from the bundle, so
// they don't need one written.
const SEEDED = new Set(SEED_PIECES.map((p) => p.rkey));

const SOURCE_BUCKETS = {
  'app.bsky.feed.like:subject.uri': 'likes',
  'app.bsky.feed.repost:subject.uri': 'reposts',
  'app.bsky.feed.post:embed.record.uri': 'quotes',
  'app.bsky.feed.post:embed.record.record.uri': 'quotes',
  'app.bsky.feed.post:reply.root.uri': 'threadPosts',
};

export default function RatioedPanel({ agent, did }) {
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState({}); // rkey → record value on the PDS
  const [busy, setBusy] = useState(null); // label of the running job
  const [progress, setProgress] = useState('');
  const [error, setError] = useState(null);
  const [backlinks, setBacklinks] = useState(null);
  const [measured, setMeasured] = useState(null); // rkey → fresh postSeal
  const [found, setFound] = useState(null); // pieces on the PDS with no record yet

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: NSID,
        limit: 100,
      });
      const map = {};
      for (const r of res?.data?.records || []) {
        map[String(r.uri).split('/').pop()] = r.value;
      }
      setLive(map);
    } catch (err) {
      // A brand-new collection 400s on some PDS implementations rather than
      // returning an empty list — that's "nothing published yet", not a fault.
      if (!/could not|not found|invalid/i.test(err?.message || '')) {
        setError(err?.message || String(err));
      }
      setLive({});
    } finally {
      setLoading(false);
    }
  }, [agent, did]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Once the records exist they become backlinks on the artwork itself. Show
  // the count so it's obvious the catalogue has joined the graph it catalogues.
  useEffect(() => {
    const subject = SEED_PIECES[0]?.subject;
    if (!subject) return;
    getBacklinkCount(subject, RATIOED_SOURCE).then((r) => {
      if (r) setBacklinks(r.total ?? r.count ?? 0);
    });
  }, [live]);

  const publishedCount = Object.keys(live).length;
  // Pieces on the PDS with no recorded event log. The first eleven were
  // measured before the field existed and are drawn from the bundled log
  // instead, so they're not counted as missing.
  const missingLogs = Object.entries(live)
    .filter(([rkey, v]) => !v?.events?.length && !SEEDED.has(rkey))
    .map(([rkey, v]) => ({ rkey, value: v }));

  /** Write every seed piece with putRecord — deterministic rkeys, so re-running
   *  updates in place instead of duplicating. */
  async function publishAll() {
    if (
      !window.confirm(
        `Write ${SEED_PIECES.length} ${NSID} records to your PDS?\n\n` +
          'Record keys match each post, so this overwrites rather than duplicates. ' +
          'Publishing also makes each record a backlink on the post it measures.',
      )
    ) {
      return;
    }
    setBusy('publish');
    setError(null);
    try {
      let n = 0;
      for (const piece of SEED_PIECES) {
        const { rkey, ...value } = piece;
        const fresh = measured?.[rkey];
        await agent.com.atproto.repo.putRecord({
          repo: did,
          collection: NSID,
          rkey,
          record: {
            $type: NSID,
            ...value,
            ...(fresh ? { postSeal: fresh, measuredAt: new Date().toISOString() } : {}),
          },
        });
        n += 1;
        setProgress(`${n}/${SEED_PIECES.length} — take ${piece.take}`);
      }
      setProgress('');
      await refresh();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /** Re-count the post-seal figures from Constellation. Does not write. */
  async function remeasure() {
    setBusy('measure');
    setError(null);
    try {
      const out = {};
      let n = 0;
      for (const piece of SEED_PIECES) {
        const flat = flattenSources(await getBacklinkSources(piece.subject));
        n += 1;
        setProgress(`${n}/${SEED_PIECES.length} — take ${piece.take}`);
        if (!flat) continue;
        const now = { likes: 0, reposts: 0, quotes: 0, threadPosts: 0 };
        for (const row of flat) {
          const bucket = SOURCE_BUCKETS[row.source];
          if (bucket) now[bucket] += row.count || 0;
        }
        // Total minus what was alive = what has landed since the seal. The
        // artist's own replies sit in the totals but not in the recorded
        // pre-seal figures, so clamp at zero rather than going negative.
        out[piece.rkey] = {
          likes: Math.max(0, now.likes - piece.preSeal.likes),
          reposts: Math.max(0, now.reposts - piece.preSeal.reposts),
          quotes: Math.max(0, now.quotes - piece.preSeal.quotes),
          threadPosts: Math.max(0, now.threadPosts - piece.preSeal.threadPosts),
          participants: piece.postSeal.participants,
        };
      }
      setProgress('');
      setMeasured(out);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Look for sealed pieces on the PDS that have no measurement record yet, and
   * measure each one from its own records.
   *
   * Everything except the reaction time survives indefinitely, so a late scan
   * still gets the lifespan, the engagement split and the breaker's name from
   * the concluding reply. The reaction time is the exception: it needs the
   * breaking like to still exist, and six of the first eleven were deleted.
   * Scan soon after sealing a piece and that number is captured; scan late and
   * it reads "deleted", permanently.
   */
  async function scan() {
    setBusy('scan');
    setError(null);
    setFound(null);
    try {
      setProgress('Reading posts and threadgates…');
      const [postRes, gateRes] = await Promise.all([
        agent.com.atproto.repo.listRecords({
          repo: did,
          collection: 'app.bsky.feed.post',
          limit: 100,
        }),
        agent.com.atproto.repo.listRecords({
          repo: did,
          collection: 'app.bsky.feed.threadgate',
          limit: 100,
        }),
      ]);
      const posts = postRes?.data?.records || [];
      const gates = gateRes?.data?.records || [];
      const known = new Set(Object.keys(live));
      const candidates = findPieces(posts, gates, known).filter((p) => !p.known);
      if (!candidates.length) {
        setFound([]);
        setProgress('');
        return;
      }
      const measuredAt = new Date().toISOString();
      const out = [];
      let n = 0;
      for (const piece of candidates) {
        n += 1;
        setProgress(`Measuring ${n}/${candidates.length} — ${piece.rkey}`);
        const subject = `at://${did}/app.bsky.feed.post/${piece.rkey}`;
        const records = await fetchPieceRecords(subject);
        const windows = measureWindows(records, Date.parse(piece.sealedAt), did);
        // Handles are resolved now, while the accounts still exist — the same
        // reason the counts are recorded rather than re-queried.
        setProgress(`Resolving handles ${n}/${candidates.length} — ${piece.rkey}`);
        const handles = await resolveHandles(records.map((r) => r.did));
        const events = buildEventLog(records, {
          postedAtMs: Date.parse(piece.postedAt),
          sealedAtMs: Date.parse(piece.sealedAt),
          selfDid: did,
          handles,
        });
        // The concluding reply names the breaker; it's one of dame's own posts
        // replying to this piece.
        const announcement = posts
          .map((r) => ({ rkey: String(r.uri).split('/').pop(), ...r.value }))
          .find((v) => v.reply?.parent?.uri === subject && isAnnouncement(v));
        out.push({
          piece,
          record: buildPieceRecord({ piece, windows, announcement, subject, measuredAt, events }),
        });
      }
      setFound(out);
      setProgress('');
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /** Publish the pieces the scan turned up. */
  async function publishFound() {
    if (!found?.length) return;
    if (!window.confirm(`Write ${found.length} newly discovered piece(s) to your PDS?`)) return;
    setBusy('publish-found');
    setError(null);
    try {
      for (const { piece, record } of found) {
        await agent.com.atproto.repo.putRecord({
          repo: did,
          collection: NSID,
          rkey: piece.rkey,
          record: { $type: NSID, ...record },
        });
      }
      setFound(null);
      await refresh();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Re-measure pieces that were scanned while the backlink reader was broken.
   *
   * It read the paged response under `linking_records`, which is the field the
   * older /links route uses; the XRPC route calls them `records`. The call
   * returned 200 with an empty array, so every piece the panel measured came
   * out as a post nobody touched — zero engagement, and a breaking like that
   * looked deleted because no like could be found.
   *
   * Normally re-measuring the living window is exactly what this panel refuses
   * to do: a like deleted since is gone, and the recorded figure is the only
   * evidence it existed. That reasoning doesn't protect a measurement that was
   * never taken. These pieces are re-read in full — counts, breaking like,
   * reaction time, and the event log the charts plot from.
   */
  async function repairScanned() {
    if (!missingLogs.length) return;
    if (
      !window.confirm(
        `Re-measure ${missingLogs.length} piece(s)?\n\n` +
          'These were scanned before the backlink reader was fixed and recorded ' +
          'as untouched. This reads their records again and overwrites the ' +
          'engagement figures, the reaction time and the event log.',
      )
    ) {
      return;
    }
    setBusy('repair');
    setError(null);
    try {
      let n = 0;
      for (const { rkey, value } of missingLogs) {
        n += 1;
        setProgress(`Re-measuring ${n}/${missingLogs.length} — take ${value.take}`);
        const records = await fetchPieceRecords(value.subject);
        if (!records.length) continue;
        const sealedMs = Date.parse(value.sealedAt);
        const windows = measureWindows(records, sealedMs, did);
        const handles = await resolveHandles(records.map((r) => r.did));
        const events = buildEventLog(records, {
          postedAtMs: Date.parse(value.postedAt),
          sealedAtMs: sealedMs,
          selfDid: did,
          handles,
        });
        const likeSurvives = Boolean(windows.breakingLike);
        // The breaker's handle came from the announcement reply and is still
        // good; only whether their like is still standing was wrong. Rebuilt
        // field by field so a stale reactionMs can't survive a "deleted"
        // verdict by riding along in the spread.
        const breaker = { ...(value.breaker || {}) };
        delete breaker.reactionMs;
        await agent.com.atproto.repo.putRecord({
          repo: did,
          collection: NSID,
          rkey,
          record: {
            $type: NSID,
            ...value,
            breaker: {
              ...breaker,
              likeSurvives,
              ...(likeSurvives ? { reactionMs: sealedMs - windows.breakingLike.at } : {}),
            },
            preSeal: windows.preSeal,
            postSeal: windows.postSeal,
            events,
            measuredAt: new Date().toISOString(),
          },
        });
      }
      setProgress('');
      await refresh();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteAll() {
    const keys = Object.keys(live);
    if (!keys.length) return;
    if (!window.confirm(`Delete all ${keys.length} ${NSID} records from your PDS?`)) return;
    setBusy('delete');
    setError(null);
    try {
      for (const rkey of keys) {
        await agent.com.atproto.repo.deleteRecord({ repo: did, collection: NSID, rkey });
      }
      await refresh();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell
      title="Ratioed"
      intro="Per-piece measurements for the Ratioed art project. Publishing these makes each record a backlink on the post it measures, so the catalogue joins the graph it catalogues."
      headTitle="Ratioed — Admin"
    >
      <p className="admin-back-link">
        <Link to="/admin">← All collections</Link>
      </p>

      <div className="ratioed-panel-summary">
        <div>
          <span className="ratioed-panel-figure">{publishedCount}</span>
          <span className="ratioed-panel-label">on your PDS</span>
        </div>
        <div>
          <span className="ratioed-panel-figure">{SEED_PIECES.length}</span>
          <span className="ratioed-panel-label">in the bundled measurement</span>
        </div>
        <div>
          <span className="ratioed-panel-figure">{backlinks == null ? '—' : backlinks}</span>
          <span className="ratioed-panel-label">backlinks on take 01</span>
        </div>
      </div>

      <div className="ratioed-panel-actions">
        <button
          type="button"
          className="admin-gate-button"
          onClick={publishAll}
          disabled={!!busy}
        >
          <Upload size={14} aria-hidden="true" />
          {busy === 'publish' ? 'Publishing…' : publishedCount ? 'Republish all' : 'Publish all to PDS'}
        </button>
        <button type="button" className="admin-gate-button" onClick={scan} disabled={!!busy}>
          <Search size={14} aria-hidden="true" />
          {busy === 'scan' ? 'Scanning…' : 'Scan for new pieces'}
        </button>
        <button type="button" className="admin-gate-button" onClick={remeasure} disabled={!!busy}>
          <RefreshCw size={14} aria-hidden="true" />
          {busy === 'measure' ? 'Measuring…' : 'Re-measure afterlife'}
        </button>
        {missingLogs.length > 0 && (
          <button
            type="button"
            className="admin-gate-button"
            onClick={repairScanned}
            disabled={!!busy}
            title="These were scanned while the backlink reader was broken and recorded as posts nobody touched. Reads their records again and overwrites the engagement figures, the reaction time and the event log."
          >
            <ListPlus size={14} aria-hidden="true" />
            {busy === 'repair' ? 'Re-measuring…' : `Re-measure scanned (${missingLogs.length})`}
          </button>
        )}
        {publishedCount > 0 && (
          <button
            type="button"
            className="admin-gate-button admin-gate-button-danger"
            onClick={deleteAll}
            disabled={!!busy}
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete all
          </button>
        )}
        <Link
          className="admin-gate-button"
          to={`/admin?c=${encodeURIComponent(STANDARD_DOC)}&r=${RATIOED_DOC_RKEY}`}
        >
          <ExternalLink size={14} aria-hidden="true" />
          Edit the essay
        </Link>
      </div>

      {progress && <p className="admin-field-hint">{progress}</p>}
      {error && <p className="admin-error">{error}</p>}
      {measured && (
        <p className="admin-field-hint">
          Fresh afterlife counts below. They aren&rsquo;t saved until you republish — pre-seal
          figures and reaction times are never touched, because the deleted likes they rest on
          can&rsquo;t be recovered from any index.
        </p>
      )}

      {found && (
        <section className="ratioed-panel-found">
          <h2 className="ratioed-panel-found-head">
            {found.length ? `${found.length} unrecorded piece(s)` : 'Nothing new'}
          </h2>
          {!found.length ? (
            <p className="admin-field-hint">
              Every sealed piece on your PDS already has a measurement record.
            </p>
          ) : (
            <>
              {found.map(({ piece, record }) => (
                <article className="ratioed-panel-row" key={piece.rkey}>
                  <header>
                    <span className="ratioed-panel-take">
                      {record.take ? String(record.take).padStart(2, '0') : '??'}
                    </span>
                    <span className="ratioed-panel-state">discovered</span>
                  </header>
                  <dl className="ratioed-panel-kv">
                    <dt>alive</dt>
                    <dd>{fmtDuration(record.lifespanMs)}</dd>
                    <dt>broken by</dt>
                    <dd>
                      @{record.breaker.handle}
                      {record.breaker.likeSurvives ? (
                        <> · reacted in {fmtSeconds(record.breaker.reactionMs)}</>
                      ) : (
                        <span className="ratioed-panel-deleted">
                          {' '}
                          · like already deleted — reaction time unrecoverable
                        </span>
                      )}
                    </dd>
                    <dt>alive</dt>
                    <dd>
                      {record.preSeal.threadPosts} thread · {record.preSeal.reposts} RT ·{' '}
                      {record.preSeal.quotes} QT · {record.preSeal.likes} ♥ ·{' '}
                      {record.preSeal.participants} people
                    </dd>
                    <dt>afterlife</dt>
                    <dd>
                      {record.postSeal.threadPosts} thread · {record.postSeal.reposts} RT ·{' '}
                      {record.postSeal.quotes} QT · {record.postSeal.likes} ♥
                    </dd>
                  </dl>
                </article>
              ))}
              <div className="ratioed-panel-actions">
                <button
                  type="button"
                  className="admin-gate-button"
                  onClick={publishFound}
                  disabled={!!busy}
                >
                  <Upload size={14} aria-hidden="true" />
                  {busy === 'publish-found' ? 'Publishing…' : 'Publish these'}
                </button>
                <button type="button" className="admin-gate-button" onClick={() => setFound(null)}>
                  Dismiss
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {loading ? (
        <AdminRecordListSkeleton rows={6} label="Loading pieces" />
      ) : (
        <div className="ratioed-panel-list">
          {SEED_PIECES.map((piece) => {
            const onPds = live[piece.rkey];
            const published = normalizePiece(piece.rkey, onPds);
            const fresh = measured?.[piece.rkey];
            const b = piece.breaker || {};
            return (
              <article className="ratioed-panel-row" key={piece.rkey}>
                <header>
                  <span className="ratioed-panel-take">{String(piece.take).padStart(2, '0')}</span>
                  <span className={`ratioed-panel-state${onPds ? ' live' : ''}`}>
                    {onPds ? 'published' : 'not published'}
                  </span>
                  {onPds && (
                    <Link
                      className="ratioed-panel-edit"
                      to={`/admin?c=${encodeURIComponent(NSID)}&r=${piece.rkey}`}
                    >
                      edit record
                    </Link>
                  )}
                </header>
                <dl className="ratioed-panel-kv">
                  <dt>alive</dt>
                  <dd>{fmtDuration(piece.lifespanMs)}</dd>
                  <dt>broken by</dt>
                  <dd>
                    @{b.handle}
                    {b.likeSurvives ? (
                      <> · reacted in {fmtSeconds(b.reactionMs)}</>
                    ) : (
                      <span className="ratioed-panel-deleted"> · like deleted</span>
                    )}
                  </dd>
                  <dt>alive</dt>
                  <dd>
                    {piece.preSeal.threadPosts} thread · {piece.preSeal.reposts} RT ·{' '}
                    {piece.preSeal.quotes} QT · {piece.preSeal.likes} ♥ ·{' '}
                    {piece.preSeal.participants} people
                  </dd>
                  <dt>afterlife</dt>
                  <dd>
                    {piece.postSeal.threadPosts} thread · {piece.postSeal.reposts} RT ·{' '}
                    {piece.postSeal.quotes} QT · {piece.postSeal.likes} ♥
                    {fresh && (
                      <span className="ratioed-panel-fresh">
                        {' '}
                        → now {fresh.threadPosts} · {fresh.reposts} · {fresh.quotes} ·{' '}
                        {fresh.likes}
                      </span>
                    )}
                  </dd>
                  {published && published.measuredAt !== piece.measuredAt && (
                    <>
                      <dt>on pds</dt>
                      <dd>measured {published.measuredAt.slice(0, 10)}</dd>
                    </>
                  )}
                </dl>
                <p className="ratioed-panel-uri">
                  <a
                    href={`https://bsky.app/profile/${ME_DID}/post/${piece.rkey}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    view the piece
                  </a>
                </p>
              </article>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
