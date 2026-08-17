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
//
// As a studio it is a BODY, not a page: the workbench pane draws the title, the
// blurb and the NSID, and the rail is the way back — so this file renders no
// PageShell and no back link of its own.
//
// It is also the one studio EXEMPT from the shell's dirty tracking, and that is
// a statement about what this panel is rather than an oversight. `measured` and
// `found` are the results of scans that take minutes over Constellation, and
// they are deliberately not written: `remeasure` computes fresh afterlife
// figures and stops there, because publishing them is a decision the artist
// makes. Reporting them as "unsaved changes" would turn a finished reading into
// a nagging to-do, and offering a generic Save for them would overwrite
// pre-seal figures that no index can reconstruct. So: never reportDirty, never
// registerActions.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  RefreshCw,
  Upload,
  Trash2,
  ExternalLink,
  ListPlus,
  Search,
  Wrench,
} from 'lucide-react';
import { AdminRecordListSkeleton } from './Skeleton.jsx';
import { useAdminShell } from '../admin/useAdminShell.jsx';
import { COLLECTIONS, RATIOED_DOC_RKEY, RATIOED_SOURCE, ME_DID } from '../config.js';
import {
  SEED_PIECES,
  normalizePiece,
  fetchPieceRecords,
  fmtDuration,
  fmtSeconds,
} from '../lib/ratioed.js';
import {
  anchorsFromTemplate,
  findPieces,
  isAnnouncement,
  measureWindows,
  buildEventLog,
  buildPieceRecord,
} from '../lib/ratioedDiscovery.js';
import { repairPiece, worthRepairing } from '../lib/ratioedRepair.js';
import { loadTemplate } from '../lib/ratioedStudio.js';
import { resolveProfiles } from '../lib/atproto.js';
import { getBacklinkSources, flattenSources, getBacklinkCount } from '../lib/constellation.js';
import './RatioedPanel.css';

const NSID = COLLECTIONS.ratioedPiece;
const STANDARD_DOC = 'site.standard.document';

// The pieces the bundled event log covers. They were measured before records
// carried their own log, and the site still draws them from the bundle, so
// they don't need one written.
const SEEDED = new Set(SEED_PIECES.map((p) => p.rkey));

// How far back the scan reads, per collection. The scan used to take a single
// page of 100, which is about three days of dame's timeline — so a piece not
// scanned within days of sealing went invisible. 500 is a couple of weeks of
// slack, five requests, and nowhere near a trawl of the whole repo. Anything
// older is already recorded; if it isn't, the panel says so rather than
// reporting a partial read as "nothing new".
const SCAN_LIMIT = 500;
const PAGE_SIZE = 100; // listRecords' own maximum

/**
 * Read a collection newest-first, following the cursor up to SCAN_LIMIT.
 *
 * Reports `truncated` when it stopped at the bound rather than at the end of
 * the collection.
 */
async function listPaged(agent, did, collection, onCount) {
  const records = [];
  let cursor;
  while (records.length < SCAN_LIMIT) {
    const res = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection,
      limit: Math.min(PAGE_SIZE, SCAN_LIMIT - records.length),
      ...(cursor ? { cursor } : {}),
    });
    const batch = res?.data?.records || [];
    records.push(...batch);
    onCount?.(records.length);
    cursor = res?.data?.cursor;
    if (!cursor || !batch.length) return { records, truncated: false };
  }
  return { records, truncated: true };
}

const SOURCE_BUCKETS = {
  'app.bsky.feed.like:subject.uri': 'likes',
  'app.bsky.feed.repost:subject.uri': 'reposts',
  'app.bsky.feed.post:embed.record.uri': 'quotes',
  'app.bsky.feed.post:embed.record.record.uri': 'quotes',
  'app.bsky.feed.post:reply.root.uri': 'threadPosts',
};

export default function RatioedPanel({ agent, did }) {
  // The only thing this panel takes from the shell. Its bulk writes change the
  // SIZE of the collection — nothing to eleven, eleven to nothing — and the
  // counts behind the rail and the Front Desk are cached for a minute, so
  // without this the rail would go on showing a surface that has just been
  // emptied. Deliberately not `registerActions` / `reportDirty`: see above.
  const { invalidate, stacked } = useAdminShell();
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState({}); // rkey → record value on the PDS
  const [busy, setBusy] = useState(null); // label of the running job
  const [progress, setProgress] = useState('');
  const [error, setError] = useState(null);
  const [backlinks, setBacklinks] = useState(null);
  const [measured, setMeasured] = useState(null); // rkey → fresh postSeal
  const [found, setFound] = useState(null); // pieces on the PDS with no record yet
  const [truncated, setTruncated] = useState(false); // the scan hit its page bound

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
  //
  // Cancellable: Constellation is a third-party index that can take seconds to
  // answer, and this re-runs on every refresh of the published set — so leaving
  // the surface mid-flight would otherwise land a setState on a pane the shell
  // has already replaced.
  useEffect(() => {
    const subject = SEED_PIECES[0]?.subject;
    if (!subject) return undefined;
    let alive = true;
    getBacklinkCount(subject, RATIOED_SOURCE).then((r) => {
      if (alive && r) setBacklinks(r.total ?? r.count ?? 0);
    });
    return () => {
      alive = false;
    };
  }, [live]);

  const publishedCount = Object.keys(live).length;

  /**
   * Every piece the panel knows about, take 1 first.
   *
   * The bundle used to be the whole project, so this list was built from it
   * alone and the PDS was consulted only for a "published" flag. That made a
   * piece measured by this panel invisible in it — the record exists only on
   * the PDS, so there was nothing in the bundle to hang a row on, and the list
   * stayed at eleven no matter what the count above it said.
   */
  // `piece` is the display shape; `record` is what publishing writes. For a
  // bundled piece that's the bundle; for one that only lives on the PDS it's
  // its own record, kept raw — the display shape carries defaults (a null
  // announceLagMs, an empty statedTally, an event log decoded to seconds) that
  // were never in it and mustn't be written back.
  const roster = useMemo(() => {
    const byKey = new Map();
    for (const piece of SEED_PIECES) {
      const { rkey, ...record } = piece;
      byKey.set(rkey, { rkey, piece, record });
    }
    for (const [rkey, record] of Object.entries(live)) {
      if (byKey.has(rkey)) continue;
      const piece = normalizePiece(rkey, record);
      if (piece) byKey.set(rkey, { rkey, piece, record, pdsOnly: true });
    }
    return Array.from(byKey.values()).sort((a, b) => a.piece.take - b.piece.take);
  }, [live]);

  // Pieces whose recorded event log is missing, or predates the DID being
  // recorded alongside each handle — without it the build can't fold those
  // people into the roster, since the roster is keyed by DID. The first eleven
  // are drawn from the bundled log and aren't counted as missing.
  const missingLogs = Object.entries(live)
    .filter(([rkey]) => !SEEDED.has(rkey))
    // A piece that is still up has no seal to measure against and nothing
    // missing — it simply hasn't happened yet. Re-measuring one would parse an
    // absent sealedAt and write NaN into its figures.
    .filter(([, v]) => v?.sealedAt)
    .filter(([, v]) => !v?.events?.length || !v.events.some((e) => e.did))
    .map(([rkey, v]) => ({ rkey, value: v }));

  // How many pieces a repair would run over, and how many of those it would
  // actually write to. Every sealed piece is worth re-reading for what has
  // landed since; `worthRepairing` is the narrower question of whether the
  // record is missing something it should already have.
  const sealedCount = Object.values(live).filter((v) => v?.sealedAt).length;
  const incomplete = Object.values(live).filter((v) => worthRepairing(v)).length;

  /** Write every piece with putRecord — deterministic rkeys, so re-running
   *  updates in place instead of duplicating. */
  async function publishAll() {
    if (
      !window.confirm(
        `Write ${roster.length} ${NSID} records to your PDS?\n\n` +
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
      for (const { rkey, piece, record } of roster) {
        const fresh = measured?.[rkey];
        await agent.com.atproto.repo.putRecord({
          repo: did,
          collection: NSID,
          rkey,
          record: {
            $type: NSID,
            ...record,
            ...(fresh ? { postSeal: fresh, measuredAt: new Date().toISOString() } : {}),
          },
        });
        n += 1;
        setProgress(`${n}/${roster.length} — take ${piece.take}`);
      }
      setProgress('');
      await refresh();
      // One call for the whole run, not one per record: each invalidation bumps
      // the shell's data revision and re-reads every counted collection.
      invalidate([NSID]);
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
      // The roster, not the bundle: a piece that only exists on the PDS accrues
      // an afterlife like any other, and used to be skipped here.
      for (const { piece } of roster) {
        const flat = flattenSources(await getBacklinkSources(piece.subject));
        n += 1;
        setProgress(`${n}/${roster.length} — take ${piece.take}`);
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
    setTruncated(false);
    try {
      setProgress('Reading posts and threadgates…');
      const read = { posts: 0, gates: 0 };
      const tick = () => setProgress(`Read ${read.posts} posts, ${read.gates} threadgates…`);
      // The template rides along because it is what the scan matches posts
      // against: reading it here is what lets the copy be reworded in the
      // studio without this scan needing to be taught the new wording.
      const [postPage, gatePage, template] = await Promise.all([
        listPaged(agent, did, 'app.bsky.feed.post', (n) => {
          read.posts = n;
          tick();
        }),
        listPaged(agent, did, 'app.bsky.feed.threadgate', (n) => {
          read.gates = n;
          tick();
        }),
        loadTemplate(agent, did),
      ]);
      const posts = postPage.records;
      const gates = gatePage.records;
      setTruncated(postPage.truncated || gatePage.truncated);
      // Only a SEALED record counts as known. The studio writes a record when
      // the post goes up, so a piece sealed by hand in the app afterwards
      // already has one — and treating that as "measured" would make the scan
      // skip the very piece it exists to catch.
      const known = new Set(
        Object.entries(live)
          .filter(([, v]) => v?.sealedAt)
          .map(([rkey]) => rkey),
      );
      const candidates = findPieces(posts, gates, known, anchorsFromTemplate(template)).filter(
        (p) => !p.known,
      );
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
        // Profiles are resolved now, while the accounts still exist — the same
        // reason the counts are recorded rather than re-queried. The follower
        // counts that ride along are the most perishable part of it: they are
        // already drifting, and this is the earliest anyone can read them.
        setProgress(`Resolving profiles ${n}/${candidates.length} — ${piece.rkey}`);
        const profiles = await resolveProfiles(records.map((r) => r.did));
        const events = buildEventLog(records, {
          postedAtMs: Date.parse(piece.postedAt),
          sealedAtMs: Date.parse(piece.sealedAt),
          selfDid: did,
          profiles,
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
      invalidate([NSID]);
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
        const profiles = await resolveProfiles(records.map((r) => r.did));
        const events = buildEventLog(records, {
          postedAtMs: Date.parse(value.postedAt),
          sealedAtMs: sealedMs,
          selfDid: did,
          profiles,
        });
        const likeSurvives = Boolean(windows.breakingLike);
        const remeasuredAt = new Date().toISOString();
        const hasAudience = events.some((e) => typeof e.fr === 'number');
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
            measuredAt: remeasuredAt,
            ...(hasAudience ? { audienceAt: remeasuredAt } : {}),
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

  /**
   * Repair every piece that has something missing.
   *
   * This replaced two loops in this file and two buttons in the studio, each
   * written the day its own defect turned up: audiences that were never read,
   * names a failed profile call lost, a reaction time nothing had recovered, an
   * afterlife nobody had gone back for. They were separate because they were
   * discovered separately, not because they are different kinds of work, and
   * between them they made the artist diagnose a record before fixing it.
   *
   * One pass now, shared with the studio's per-piece button, and the rule it
   * holds to is in lib/ratioedRepair.js: fill gaps, re-read only the window
   * after the seal, never re-derive a figure measured while a piece was alive.
   * Nothing here can make a record worse, which is what lets it run over the
   * whole catalogue at once.
   */
  async function repairAll() {
    const targets = Object.entries(live)
      .filter(([, v]) => v?.sealedAt)
      .map(([rkey, value]) => ({ rkey, value }));
    if (!targets.length) return;
    if (
      !window.confirm(
        `Repair ${targets.length} sealed piece(s)?\n\n` +
          'Fills in whatever each record is missing — the breaker\'s name and DID, ' +
          'a reaction time the log still holds, handles and audiences on the log, ' +
          'and everything that has landed since the seal. Figures measured while a ' +
          'piece was alive are never re-read.',
      )
    ) {
      return;
    }
    setBusy('repair-all');
    setError(null);
    try {
      let n = 0;
      let written = 0;
      const done = [];
      for (const { rkey, value } of targets) {
        n += 1;
        const { changes, written: didWrite } = await repairPiece({
          agent,
          did,
          collection: NSID,
          rkey,
          value,
          onProgress: (m) => setProgress(`Take ${value.take} (${n}/${targets.length}) — ${m}…`),
        });
        if (didWrite) {
          written += 1;
          done.push(`take ${value.take}: ${changes.join(', ')}`);
        }
      }
      // What changed, piece by piece. A repair that reports only a count is a
      // repair nobody can check.
      setProgress(
        written
          ? `Repaired ${written} of ${targets.length}. ${done.join(' · ')}.`
          : `Nothing missing on any of the ${targets.length}.`,
      );
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
      invalidate([NSID]);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
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
        {sealedCount > 0 && (
          <button
            type="button"
            className="admin-gate-button"
            onClick={repairAll}
            disabled={!!busy}
            title="Fill in whatever each record is missing: the breaker's name and DID, a reaction time the log or the replay still holds, handles and audiences on the log, and everything that has landed since the seal. Figures measured while a piece was alive are never re-read."
          >
            <Wrench size={14} aria-hidden="true" />
            {busy === 'repair-all'
              ? 'Repairing…'
              : `Repair all (${sealedCount})${incomplete ? ` · ${incomplete} incomplete` : ''}`}
          </button>
        )}
        {publishedCount > 0 && (
          <button
            type="button"
            // `admin-gate-button-danger` was defined in no stylesheet, so the
            // one irreversible button on this panel rendered identically to the
            // four beside it. `.admin-danger` (Admin.css:85) is the real
            // modifier: outlined in --tan, filling on hover.
            className="admin-gate-button admin-danger"
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
          {truncated && (
            <p className="admin-field-hint">
              The scan stopped at {SCAN_LIMIT} records per collection, so anything sealed before
              that wasn&rsquo;t looked at.
            </p>
          )}
          {!found.length ? (
            <p className="admin-field-hint">
              Every sealed piece in the records read already has a measurement record.
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
                  <Measurements collapse={stacked}>
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
                    {/* "pre-seal", not a second "alive": the <dl> named two
                        different quantities with the same term four rows apart
                        — a duration and an engagement count — which is
                        unreadable and is also an invalid description list. Its
                        pair below is already "afterlife", so pre-seal/afterlife
                        reads as the opposition it always was. */}
                    <dt>pre-seal</dt>
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
                  </Measurements>
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
          {roster.map(({ rkey, piece, pdsOnly }) => {
            const onPds = live[rkey];
            const published = normalizePiece(rkey, onPds);
            const fresh = measured?.[rkey];
            const b = piece.breaker || {};
            return (
              <article className="ratioed-panel-row" key={rkey}>
                <header>
                  <span className="ratioed-panel-take">{String(piece.take).padStart(2, '0')}</span>
                  <span className={`ratioed-panel-state${onPds ? ' live' : ''}`}>
                    {onPds ? 'published' : 'not published'}
                  </span>
                  {/* A piece measured in the app, with no counterpart in the
                      bundle — so its record is the only copy there is. */}
                  {pdsOnly && <span className="ratioed-panel-state">pds only</span>}
                  {onPds && (
                    <Link
                      className="ratioed-panel-edit"
                      to={`/admin?c=${encodeURIComponent(NSID)}&r=${rkey}`}
                    >
                      edit record
                    </Link>
                  )}
                </header>
                <Measurements collapse={stacked}>
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
                  {/* See the discovered card above: this row is the pre-seal
                      engagement, not a second lifespan. */}
                  <dt>pre-seal</dt>
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
                </Measurements>
                <p className="ratioed-panel-uri">
                  <a
                    href={`https://bsky.app/profile/${ME_DID}/post/${rkey}`}
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
    </>
  );
}

/**
 * The measurement table — a four-row `<dl>` of durations and engagement counts.
 *
 * Open on desktop, behind a disclosure on a phone (§6 of the mobile design).
 * Eight visually identical panels of transposed four-column measurements is
 * 5,566px of scroll at 390 with no way to skim past a card you are not looking
 * for; collapsed, a card is its take number, its state and one tap. Not a hard
 * gate — the numbers are the point of this surface and they stay reachable —
 * which is why it is a `<details>` and not a width check that drops them.
 *
 * @param {{collapse: boolean, children: React.ReactNode}} props
 */
function Measurements({ collapse, children }) {
  if (!collapse) return <dl className="ratioed-panel-kv">{children}</dl>;
  return (
    <details className="ratioed-panel-measure">
      <summary>Measurements</summary>
      <dl className="ratioed-panel-kv">{children}</dl>
    </details>
  );
}
