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
// a statement about what this panel is rather than an oversight. `found` is the
// result of a scan that takes minutes over Constellation and is deliberately
// not written until the artist says so. Reporting it as "unsaved changes" would
// turn a finished reading into a nagging to-do. So: never reportDirty, never
// registerActions.
//
// "Re-measure afterlife" used to sit in the row of buttons above it: it counted
// the fresh figures, printed them beside the recorded ones, and wrote nothing
// until you also pressed Republish all. Nobody could tell from the button that
// it was a preview, so it read as a repair that did nothing — which is exactly
// what it did. Repair does the real thing now, per piece and in bulk, and this
// is gone.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Upload,
  Trash2,
  ExternalLink,
  ListPlus,
  Search,
  Wrench,
} from 'lucide-react';
import { AdminRecordListSkeleton } from './Skeleton.jsx';
import Button from './Button.jsx';
import Figures from './Figures.jsx';
import SectionHead from './SectionHead.jsx';
import Tag from './Tag.jsx';
import Time from './Time.jsx';
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
import { repairPiece, gapSummary, onlyOnPds, takeRuns } from '../lib/ratioedRepair.js';
import { resolveBreaker, witnessFromRecord } from '../lib/ratioedLive.js';
import { loadTemplate } from '../lib/ratioedStudio.js';
import { resolveProfiles } from '../lib/atproto.js';
import { getBacklinkCount } from '../lib/constellation.js';
// The bundled event harvest, read here only for which pieces it covers. This
// panel is in the admin's own chunk, so nobody else downloads it for this.
import BUNDLED_EVENTS from '../data/ratioedEvents.json';
import './RatioedPanel.css';

const NSID = COLLECTIONS.ratioedPiece;
// Which pieces the bundled seed has the FIGURES of. The build regenerates it
// from every sealed piece, with the logs stripped out — so this is most of the
// series, and it says nothing about whether a piece's evidence is anywhere
// but the PDS. See `onlyOnPds`.
const SEED_KEYS = new Set(SEED_PIECES.map((p) => p.rkey));
const STANDARD_DOC = 'site.standard.document';

// The pieces the bundled event LOG covers: the first eleven, measured before
// records carried their own log. The site still draws them from the bundle,
// so they don't need one written. This was built from the seed once, which
// was right while the seed was those same eleven pieces and stopped being
// right when the build started regenerating it — it called takes 12 to 35
// covered by a log that has never held them.
const SEEDED = new Set(Object.keys(BUNDLED_EVENTS));
const BUNDLE = { figures: SEED_KEYS, logs: SEEDED };

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
  // `piece` is the display shape; `record` is what publishing writes. Both come
  // from the PDS wherever the PDS has an answer, and from the bundle only where
  // it does not. `record` stays the RAW record value either way — the display
  // shape carries defaults (a null announceLagMs, an empty statedTally, an event
  // log decoded to seconds) that were never in it and mustn't be written back.
  //
  // The bundle used to win. It is a frozen seed of the first eleven pieces as
  // they were measured in July, and every one of them has since been repaired:
  // event logs written onto them, afterlife counts corrected, a breaker's DID
  // recovered. Letting it win meant the cards below showed those eleven pieces
  // as they were rather than as they are — and, far worse, that `record` was
  // the stale bundle, so the whole-value putRecord in `publishAll` would have
  // written the July value back over the repaired one. One press, 126 recorded
  // event rows gone.
  // Everything on the PDS that the bundle could not put back.
  const unbacked = useMemo(() => onlyOnPds(live, BUNDLE), [live]);
  const roster = useMemo(() => {
    const alone = new Set(unbacked.map((u) => u.rkey));
    const byKey = new Map();
    for (const piece of SEED_PIECES) {
      const { rkey, ...record } = piece;
      byKey.set(rkey, { rkey, piece, record });
    }
    for (const [rkey, record] of Object.entries(live)) {
      const piece = normalizePiece(rkey, record);
      if (!piece) continue;
      byKey.set(rkey, { rkey, piece, record, pdsOnly: alone.has(rkey) });
    }
    return Array.from(byKey.values()).sort((a, b) => a.piece.take - b.piece.take);
  }, [live, unbacked]);

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
  // landed since; `gapSummary`'s `fixable` is the narrower question of whether
  // a record is missing something it should already have, and it asks
  // `worthRepairing` rather than keeping its own copy of that question — the
  // two had drifted apart by exactly one term.
  const sealedCount = Object.values(live).filter((v) => v?.sealedAt).length;
  const gaps = gapSummary(Object.values(live));

  /**
   * Put the bundled pieces onto the PDS. Deterministic rkeys, so re-running is
   * safe rather than duplicating.
   *
   * Only the ones that aren't there yet. This writes whole record values, and a
   * record already on the PDS is by definition the newer of the two — it has
   * been measured, repaired, or hand-edited since the bundle froze. Rewriting
   * it could only ever take something away, so it isn't offered: the button
   * seeds, it does not sync.
   */
  async function publishAll() {
    const missing = roster.filter(({ rkey }) => !live[rkey]);
    if (!missing.length) {
      setError('Every piece is already on the PDS. Nothing to write.');
      return;
    }
    // The seed has figures and no logs, so a piece outside the first eleven
    // goes back up as its numbers alone: the charts draw it with no marks, and
    // its page has no replay. Said before, rather than found afterwards.
    const bare = missing.filter(({ rkey }) => !SEEDED.has(rkey)).map((m) => m.piece.take);
    if (
      !window.confirm(
        `Write ${missing.length} ${NSID} record${missing.length === 1 ? '' : 's'} to your PDS?\n\n` +
          `Takes ${takeRuns(missing.map((m) => m.piece.take))} — the ones not there yet. ` +
          `The ${roster.length - missing.length} already published are left alone.\n\n` +
          (bare.length
            ? `Take${bare.length === 1 ? '' : 's'} ${takeRuns(bare)} will have ${
                bare.length === 1 ? 'its' : 'their'
              } figures and no event log: the bundle never held one for ${
                bare.length === 1 ? 'it' : 'them'
              }.\n\n`
            : '') +
          'Publishing makes each record a backlink on the post it measures.',
      )
    ) {
      return;
    }
    setBusy('publish');
    setError(null);
    try {
      let n = 0;
      for (const { rkey, piece, record } of missing) {
        await agent.com.atproto.repo.putRecord({
          repo: did,
          collection: NSID,
          rkey,
          record: { $type: NSID, ...record },
        });
        n += 1;
        setProgress(`${n}/${missing.length} — take ${piece.take}`);
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
    // A piece whose post has no readable take line passes `isPiecePost` on the
    // historical markers alone, and `buildPieceRecord` copies the null straight
    // into a field the lexicon declares required, integer, minimum 1. Written,
    // it maps to take 0 and every chart filters it out — while the scan's own
    // known-set keys on sealedAt and never offers it again. So it is a piece
    // that exists, is invisible everywhere, and cannot be rediscovered.
    const nameless = found.filter(({ record }) => !(record.take >= 1));
    if (nameless.length) {
      setError(
        `${nameless.length} of these has no readable take number. Give it one on its own record ` +
          `(admin → ${NSID}) before publishing, or the piece will be written and then vanish from ` +
          'every chart.',
      );
      return;
    }
    if (!window.confirm(`Write ${found.length} newly discovered piece(s) to your PDS?`)) return;
    setBusy('publish-found');
    setError(null);
    try {
      for (const { piece, record } of found) {
        // Merged over whatever is already there, not written in place of it.
        // The scan looks for pieces with no `sealedAt` — which is exactly the
        // shape of a piece the studio has been watching, writing `witnessed`
        // rows onto the record as they arrive. `buildPieceRecord` has no
        // `witnessed`, no `witnessFromMs`, no `lede` and no `statedTally`, so a
        // replacement would delete the live log of the piece it is measuring:
        // post take 18 from the studio, seal it by hand in the app, scan, and
        // the only evidence of a like that was cast and taken back is gone.
        await agent.com.atproto.repo.putRecord({
          repo: did,
          collection: NSID,
          rkey: piece.rkey,
          record: { $type: NSID, ...(live[piece.rkey] || {}), ...record },
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
        //
        // Except that a witnessed log times a like the index cannot show, and
        // this never looked at one — unlike `healPiece`, which does. A piece
        // sealed while the index lagged is sealed, witnessed and event-less,
        // which is exactly this button's eligibility test, so it landed here
        // and had its recovered reaction time deleted; `reactionRecovered` was
        // not deleted with it, leaving a breaker flagged as recovered with
        // nothing to have recovered. The public page then read "like deleted"
        // and the piece dropped out of the project's mean reaction.
        const breaker = { ...(value.breaker || {}) };
        const witnessed = resolveBreaker({
          indexLike: windows.breakingLike,
          rows: witnessFromRecord(value.witnessed) || [],
          postedMs: Date.parse(value.postedAt),
          sealedMs,
        });
        delete breaker.reactionMs;
        delete breaker.reactionRecovered;
        await agent.com.atproto.repo.putRecord({
          repo: did,
          collection: NSID,
          rkey,
          record: {
            $type: NSID,
            ...value,
            breaker: {
              ...breaker,
              likeSurvives: likeSurvives || Boolean(witnessed?.likeSurvives),
              // The index first, then the log — the same order `resolveBreaker`
              // itself uses, and the same order the studio's measurement does.
              ...(likeSurvives
                ? { reactionMs: sealedMs - windows.breakingLike.at }
                : witnessed
                  ? {
                      reactionMs: Math.round(sealedMs - witnessed.at),
                      ...(witnessed.recovered ? { reactionRecovered: true } : {}),
                    }
                  : {}),
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
    // Name the part that cannot be undone. The bundle can re-seed the figures
    // of most of the series and the event logs of the first eleven; nothing can
    // re-seed the rest — the logs of every later take, every witnessed log, and
    // the figures of anything sealed since the seed was written exist on the
    // PDS and nowhere else, and public/data/ratioed.json is not a backup, it is
    // regenerated FROM the PDS on the next build. A dialog that says only
    // "delete 17 records" is not asking the question it is actually asking —
    // and this one used to say the seed covered takes 1–35, about pieces whose
    // logs it has never held.
    const takesOf = (pick) => {
      const takes = unbacked.filter(pick).map((u) => u.take);
      return takes.length ? `take${takes.length === 1 ? '' : 's'} ${takeRuns(takes)}` : '';
    };
    const noFigures = takesOf((u) => u.figures);
    const noLogs = takesOf((u) => u.events || u.witnessed);
    const lost = [
      noFigures && `${noFigures}: everything, figures included — the seed never held them`,
      noLogs && `${noLogs}: the event logs, and everything the studio witnessed while they ran`,
    ].filter(Boolean);
    const seedTakes = takeRuns(SEED_PIECES.map((p) => p.take));
    const logTakes = takeRuns(SEED_PIECES.filter((p) => SEEDED.has(p.rkey)).map((p) => p.take));
    if (
      !window.confirm(
        `Delete all ${keys.length} ${NSID} records from your PDS?\n\n` +
          (lost.length
            ? `${unbacked.length} of them hold something that exists nowhere else, and it ` +
              `cannot be recovered:\n\n${lost.map((l) => `• ${l}`).join('\n')}\n\n` +
              `The bundle can put back the figures for takes ${seedTakes} and the event ` +
              `logs for takes ${logTakes}, and nothing else.`
            : 'Everything in them is in the bundle and can be re-published.'),
      )
    ) {
      return;
    }
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
      {/* The catalogue in figures: the kit's ruled band, as /logging and the
          front desk set theirs, in place of three hand-set 2rem numerals. */}
      <Figures
        label="The catalogue in figures"
        className="ratioed-panel-figures"
        columns={3}
        items={[
          { key: 'pds', value: publishedCount, label: 'On your PDS' },
          {
            key: 'bundle',
            value: SEED_PIECES.length,
            label: 'In the bundle',
            note: 'the bundled measurement',
          },
          {
            key: 'backlinks',
            value: backlinks == null ? '—' : backlinks,
            label: 'Backlinks on take 01',
          },
        ]}
      />

      {/* One filled button at most. The first publish is this panel's commit;
          once the pieces are on the PDS, republishing is upkeep like the rest
          of the row. While a scan's findings are open, their "Publish these"
          is the commit instead, so the two are never filled at once. */}
      <div className="ratioed-panel-actions">
        <Button
          variant={!publishedCount && !found?.length ? 'primary' : 'quiet'}
          onClick={publishAll}
          disabled={!!busy}
        >
          <Upload size={14} aria-hidden="true" />
          {busy === 'publish' ? 'Publishing…' : publishedCount ? 'Republish all' : 'Publish all to PDS'}
        </Button>
        <Button onClick={scan} disabled={!!busy}>
          <Search size={14} aria-hidden="true" />
          {busy === 'scan' ? 'Scanning…' : 'Scan for new pieces'}
        </Button>
        {missingLogs.length > 0 && (
          <Button
            onClick={repairScanned}
            disabled={!!busy}
            title="These were scanned while the backlink reader was broken and recorded as posts nobody touched. Reads their records again and overwrites the engagement figures, the reaction time and the event log."
          >
            <ListPlus size={14} aria-hidden="true" />
            {busy === 'repair' ? 'Re-measuring…' : `Re-measure scanned (${missingLogs.length})`}
          </Button>
        )}
        {sealedCount > 0 && (
          <Button
            onClick={repairAll}
            disabled={!!busy}
            title="Fill in whatever each record is missing: the breaker's name and DID, a reaction time the log or the replay still holds, handles and audiences on the log, and everything that has landed since the seal. Figures measured while a piece was alive are never re-read."
          >
            <Wrench size={14} aria-hidden="true" />
            {busy === 'repair-all'
              ? 'Repairing…'
              : `Repair all (${sealedCount})${gaps.fixable ? ` · ${gaps.fixable} to fill` : ''}`}
          </Button>
        )}
        {publishedCount > 0 && (
          // The one irreversible button on this panel, so it takes the kit's
          // danger tier: quiet, in --danger, which keeps its hue at every hour
          // where --tan (what `.admin-danger` painted it in) turns with the sky.
          <Button variant="danger" onClick={deleteAll} disabled={!!busy}>
            <Trash2 size={14} aria-hidden="true" />
            Delete all
          </Button>
        )}
        <Button as={Link} to={`/admin?c=${encodeURIComponent(STANDARD_DOC)}&r=${RATIOED_DOC_RKEY}`}>
          <ExternalLink size={14} aria-hidden="true" />
          Edit the essay
        </Button>
      </div>

      {progress && <p className="ratioed-panel-note">{progress}</p>}
      {error && (
        <p className="ratioed-panel-error" role="alert">
          {error}
        </p>
      )}
      {/* What a repair will not close, said plainly, because the alternative is
          a count that goes on reading "4 incomplete" after four repairs. Every
          one of those four is a suspended or deleted account: the row names a
          DID, `getProfiles` answers nothing, and the log says so. */}
      {(gaps.stuckRows > 0 || gaps.needAName > 0) && (
        <p className="ratioed-panel-note">
          {gaps.stuckRows > 0 && (
            <>
              {gaps.stuckRows} log row{gaps.stuckRows === 1 ? '' : 's'} across {gaps.stuckPieces}{' '}
              piece{gaps.stuckPieces === 1 ? '' : 's'} name an account that no longer resolves.
              Repairing again will not name them: the account is suspended or deleted, and
              &ldquo;{'(unresolvable)'}&rdquo; is the record saying so.{' '}
            </>
          )}
          {gaps.needAName > 0 && (
            <>
              {gaps.needAName} piece{gaps.needAName === 1 ? '' : 's'} lost the breaker with nothing
              watching, so only you can say who it was — name them in the studio.
            </>
          )}
        </p>
      )}

      {found && (
        <section className="ratioed-panel-found">
          <SectionHead
            title={found.length ? 'Unrecorded pieces' : 'Nothing new'}
            meta={found.length || null}
          />
          {truncated && (
            <p className="ratioed-panel-note">
              The scan stopped at {SCAN_LIMIT} records per collection, so anything sealed before
              that wasn&rsquo;t looked at.
            </p>
          )}
          {!found.length ? (
            <p className="ratioed-panel-note">
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
                    <Tag>discovered</Tag>
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
                <Button variant="primary" onClick={publishFound} disabled={!!busy}>
                  <Upload size={14} aria-hidden="true" />
                  {busy === 'publish-found' ? 'Publishing…' : 'Publish these'}
                </Button>
                <Button variant="text" onClick={() => setFound(null)}>
                  Dismiss
                </Button>
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
            const b = piece.breaker || {};
            return (
              <article className="ratioed-panel-row" key={rkey}>
                <header>
                  <span className="ratioed-panel-take">{String(piece.take).padStart(2, '0')}</span>
                  <Tag on={Boolean(onPds)}>{onPds ? 'published' : 'not published'}</Tag>
                  {/* Something this record holds — its figures, its event log,
                      what the studio witnessed — is in no bundle, so the record
                      is the only copy of it there is. */}
                  {pdsOnly && <Tag>pds only</Tag>}
                  {onPds && (
                    <Button
                      as={Link}
                      variant="text"
                      size="sm"
                      className="ratioed-panel-edit"
                      to={`/admin?c=${encodeURIComponent(NSID)}&r=${rkey}`}
                    >
                      Edit record
                    </Button>
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
                  </dd>
                  {published && published.measuredAt !== piece.measuredAt && (
                    <>
                      <dt>on pds</dt>
                      <dd>
                        measured <Time value={published.measuredAt} variant="dateShort" />
                      </dd>
                    </>
                  )}
                </Measurements>
                <p className="ratioed-panel-uri">
                  <Button
                    as="a"
                    variant="text"
                    size="sm"
                    href={`https://bsky.app/profile/${ME_DID}/post/${rkey}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    View the piece
                    <ExternalLink size={12} aria-hidden="true" />
                  </Button>
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
