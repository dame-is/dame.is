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

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Upload, Trash2, ExternalLink } from 'lucide-react';
import PageShell from './PageShell.jsx';
import { AdminRecordListSkeleton } from './Skeleton.jsx';
import { COLLECTIONS, RATIOED_DOC_RKEY, RATIOED_SOURCE, ME_DID } from '../config.js';
import { SEED_PIECES, normalizePiece, fmtDuration, fmtSeconds } from '../lib/ratioed.js';
import { getBacklinkSources, flattenSources, getBacklinkCount } from '../lib/constellation.js';
import './RatioedPanel.css';

const NSID = COLLECTIONS.ratioedPiece;
const STANDARD_DOC = 'site.standard.document';

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
        <button type="button" className="admin-gate-button" onClick={remeasure} disabled={!!busy}>
          <RefreshCw size={14} aria-hidden="true" />
          {busy === 'measure' ? 'Measuring…' : 'Re-measure afterlife'}
        </button>
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
