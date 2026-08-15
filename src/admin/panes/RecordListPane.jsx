// The list column: every record in the open surface, filterable, sortable, and
// selectable in bulk. Descendant of the old `RecordList` in src/pages/Admin.jsx,
// whose fetch and whose two bulk writes are carried over unchanged — including
// the JSON round-trip that flattens BlobRef instances before a re-put, and both
// `no-await-in-loop` disable comments, which are two of the tree's 67 baseline
// warnings and had to travel with the code they annotate.
//
// What is genuinely different, and why:
//
//  1. **The pane is persistent.** It is a sibling of the detail pane rather than
//     a page that gets replaced by one, so opening a record no longer throws the
//     list away. Everything that used to be free — scroll position, filter text,
//     selection — is now state on a component that stays mounted, and that is the
//     whole reason the filter and the multiselect can exist at all.
//  2. **`limit: 50` → `limit: 100`.** Same request count, twice the rows; 100 is
//     the API maximum (`limit=101` answers `InvalidRequest … maximum 100`).
//  3. **Exhaustion is a SHORT PAGE, not a missing cursor.** The old test was
//     `!next?.cursor || batch.length === 0`, and the PDS hands back a live cursor
//     on a final short page — which is why a 27-record collection has been
//     offering a "Load more" that loads nothing. `batch.length < PAGE_LIMIT` is
//     the real answer; the cursor check stays as a secondary guard.
//  4. **No Select / Done mode.** Multiselect is always on: checkboxes fade in on
//     hover or focus and stay up while anything is ticked. A mode toggle made
//     sense on a page you left to edit a record; in a column that is always on
//     screen beside the editor it is one click of ceremony for nothing.
//  5. **Filter and sort are component state, never URL state.** They are a way of
//     looking at the surface, not a place — putting them in the query string
//     would push a history entry per keystroke and make every list link
//     unshareable in a different way.
//
// The filter is client-side over the records that are LOADED, which is a real
// limitation rather than an implementation detail, so the pane says so on screen
// as soon as a filter is narrowing an incomplete list. Paging, correspondingly,
// is driven by the raw record count and never by the filtered one — the old
// shape where a filtered view looks empty while three more pages exist.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import PageContentPanel from '../../components/PageContentPanel.jsx';
import { rkeyFromUri } from '../../components/RecordEditor.jsx';
import { AdminRecordListSkeleton } from '../../components/Skeleton.jsx';
import { VARIANTS_A, VARIANTS_B } from '../../components/HeroSentence.jsx';
import { COLLECTIONS } from '../../config.js';
import { lexiconFor } from '../../lib/lexicons.js';
import { visibilityModelFor } from '../../lib/recordVisibility.js';
import { relativeTime } from '../../lib/time.js';
import { latestInstant, rowLabel, stampAutoTimestamps } from '../recordFields.js';
import { rowHrefFor } from '../surfaces.js';
import { useAdminShell } from '../useAdminShell.jsx';
import './recordListPane.css';

/**
 * The API maximum, verified against the live PDS: `limit=101` is rejected with
 * `InvalidRequest … maximum 100`. Also the page size `useAdminData` counts with,
 * so a countable collection is exhausted here in exactly as many requests.
 */
const PAGE_LIMIT = 100;

/** Shared empty array, so an unfetched list never changes identity per render. */
const NO_RECORDS = Object.freeze([]);

/**
 * Sort orders. `newest` and `oldest` both read `latestInstant` — the same
 * accessor the Front Desk orders by — which answers "when was this last
 * touched?" rather than "when was it published?", and returns null for a record
 * with no trustworthy timestamp instead of dating it from a borrowed TID.
 */
const SORTS = Object.freeze([
  Object.freeze({ key: 'newest', label: 'Newest' }),
  Object.freeze({ key: 'oldest', label: 'Oldest' }),
  Object.freeze({ key: 'key', label: 'Key A→Z' }),
]);

/** The visibility segment. Only rendered for the four collections that have one. */
const VISIBILITIES = Object.freeze([
  Object.freeze({ key: 'all', label: 'All' }),
  Object.freeze({ key: 'visible', label: 'Visible' }),
  Object.freeze({ key: 'hidden', label: 'Hidden' }),
]);

/**
 * Where "New record" goes, and it must NOT change surface.
 *
 * The registry's own `newHref` is written in the `?c=`-only vocabulary the admin
 * had before the shell, so on Blogging it reads `?c=site.standard.document&mode=new`
 * — which resolves to the synthetic all-documents surface, dropping you out of
 * Blogging and leaving the created record there too. So the surface's own address
 * is kept and only `mode` (and the `for` preset the registry declares) is added.
 *
 * @param {import('../surfaces.js').AdminSurface} surface
 * @returns {string}
 */
function newRecordHref(surface) {
  // `for=creating` is what tells the editor to stamp the portfolio publication
  // onto a new document. It is stated once, in the registry, and read back here.
  const preset = new URLSearchParams(surface.newHref?.split('?')[1] || '').get('for');
  const tail = `&mode=new${preset ? `&for=${encodeURIComponent(preset)}` : ''}`;
  return surface.urlByView
    ? `/admin?view=${surface.key}${tail}`
    : `/admin?c=${encodeURIComponent(surface.nsid)}${tail}`;
}

/**
 * Turn one of this pane's own hrefs into a `go` patch. `go` is merge-only — a key
 * it is not told about keeps whatever the URL already has — so every one of the
 * five params has to be named, the absent ones as explicit nulls.
 *
 * @param {string} href
 * @returns {Record<string, string|null>}
 */
function patchFromHref(href) {
  const params = new URLSearchParams(href.slice(href.indexOf('?') + 1));
  const patch = {};
  for (const key of ['view', 'c', 'r', 'mode', 'for']) patch[key] = params.get(key);
  return patch;
}

/* ------------------------------------------------------------------ */
/* Hero phrase seeding                                                  */
/* ------------------------------------------------------------------ */

/**
 * Publish the built-in hero phrases as records. Lifted verbatim from the old
 * Admin.jsx, down to both confirm strings — it is the one-time bootstrap for
 * `is.dame.hero.phrase`, and the duplicate warning is the only thing standing
 * between a second click and fourteen extra records.
 *
 * The sequential create loop is deliberate throttling and carries no
 * `no-await-in-loop` directive, because that rule is not enabled here: adding one
 * would report as an unused-directive warning.
 */
function HeroSeedButton({ agent, did, existingCount, onSeeded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function seed() {
    if (existingCount > 0) {
      if (
        !window.confirm(
          `This collection already has ${existingCount} record(s). Seed the built-in defaults anyway? This may create duplicates.`,
        )
      ) {
        return;
      }
    } else if (!window.confirm('Create the built-in hero phrases as records on your PDS?')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const seedPart = async (part, list) => {
        for (const text of list) {
          await agent.com.atproto.repo.createRecord({
            repo: did,
            collection: COLLECTIONS.heroPhrase,
            record: {
              $type: COLLECTIONS.heroPhrase,
              part,
              text,
              enabled: true,
              createdAt: new Date().toISOString(),
            },
          });
        }
      };
      await seedPart('role', VARIANTS_A);
      await seedPart('clause', VARIANTS_B);
      onSeeded?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="admin-gate-button admin-gate-button-tight"
        onClick={seed}
        disabled={busy}
      >
        {busy ? 'Seeding…' : 'Seed defaults'}
      </button>
      {error && <p className="admin-error">{error}</p>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Rows                                                                 */
/* ------------------------------------------------------------------ */

/**
 * One record row: a checkbox that does not navigate, and a link that does.
 *
 * Two lines rather than the old single line, because this column is 22rem wide
 * and the old row spent 14ch of it on the rkey before the title started. Line one
 * is what the record IS; line two is how it is addressed and when it was last
 * touched.
 *
 * No `data-nsid` attribute and no `.feed-item` class anywhere in here: ChromeBar
 * sweeps `[data-nsid]` on every scroll frame to drive the public breadcrumb's
 * NSID chip, and counts `.feed-item`s to decide the same bar's density.
 */
function RecordRow({
  rkey,
  label,
  chip,
  hidden,
  hasState,
  instant,
  href,
  open,
  checked,
  onOpen,
  onToggle,
  rowRef,
}) {
  const className = [
    'admin-record-row',
    'wb-list-row',
    open ? 'is-open' : '',
    checked ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={className} ref={rowRef}>
      <input
        type="checkbox"
        className="wb-list-check"
        checked={checked}
        onChange={() => onToggle(rkey)}
        aria-label={`Select ${rkey}`}
      />
      <Link
        to={href}
        className="wb-list-link"
        aria-current={open ? 'true' : undefined}
        onClick={(event) => {
          // Let the browser have modified and non-primary clicks, so cmd-click
          // still opens a record in a new tab. Everything else goes through
          // `go`, which runs the unsaved-changes guard.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          onOpen(rkey);
        }}
      >
        <span className="wb-list-line">
          {hasState && (
            <span
              className="wb-list-dot"
              data-hidden={hidden ? '' : undefined}
              aria-hidden="true"
            />
          )}
          <span className="wb-list-label">{label || '(untitled)'}</span>
        </span>
        <span className="wb-list-meta">
          <code className="wb-list-rkey">{rkey}</code>
          {chip && <span className="admin-record-chip small-caps">{chip}</span>}
          {instant && (
            <time className="wb-list-time" dateTime={instant} title={instant}>
              {relativeTime(instant)}
            </time>
          )}
        </span>
      </Link>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* The pane                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {object} props
 * @param {import('../surfaces.js').AdminSurface} props.surface
 * @param {object} props.agent
 * @param {string} props.did
 */
export default function RecordListPane({ surface, agent, did }) {
  const { rkey, isNew, go, invalidate, dataRev } = useAdminShell();
  // `mode=new` beats `r`, exactly as the old param ladder did, so no row is
  // marked open while a new record is being drafted.
  const openRkey = isNew ? null : rkey;

  const collection = surface.nsid;
  const lex = lexiconFor(collection);
  const visModel = visibilityModelFor(collection);
  const isHero = collection === COLLECTIONS.heroPhrase;

  const [records, setRecords] = useState(NO_RECORDS);
  const [cursor, setCursor] = useState(undefined);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(() => new Set()); // rkeys
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [visibility, setVisibility] = useState('all');
  const [sort, setSort] = useState('newest');

  /* --- fetching ---------------------------------------------------- */

  // Which fetch is allowed to write to state. The pane now refreshes itself
  // (after a bulk write, or when the detail pane invalidates) while a "Load
  // more" may still be in the air, and the loser of that race would otherwise
  // append a stale page onto a fresh one.
  const runRef = useRef(0);

  const loadPage = useCallback(
    async (after) => {
      if (!collection) return;
      const run = (runRef.current += 1);
      setLoading(true);
      setError(null);
      try {
        const res = await agent.com.atproto.repo.listRecords({
          repo: did,
          collection,
          limit: PAGE_LIMIT,
          cursor: after || undefined,
        });
        if (runRef.current !== run) return;
        const next = res?.data || res;
        const batch = next?.records || [];
        setRecords((prev) => (after ? [...prev, ...batch] : batch));
        setCursor(next?.cursor);
        // A SHORT page is the end of the collection. The cursor is kept as a
        // secondary guard only — on this PDS it comes back non-null on the final
        // page, which is what put a dead "Load more" under every short list.
        setDone(batch.length < PAGE_LIMIT || !next?.cursor);
      } catch (err) {
        if (runRef.current !== run) return;
        setError(err?.message || String(err));
      } finally {
        if (runRef.current === run) setLoading(false);
      }
    },
    [agent, did, collection],
  );

  // A different collection: the rows on screen belong to the old one, so they go
  // immediately rather than lingering through the request.
  useEffect(() => {
    setRecords(NO_RECORDS);
    setCursor(undefined);
    setDone(false);
    setSelected(new Set());
    loadPage(undefined);
  }, [loadPage]);

  // This pane's OWN writes are already applied to `records` — the bulk actions
  // below patch or drop the rows they touched — so the `dataRev` bump they cause
  // must not also refetch. Page one is all a refetch can restore, and on a list
  // paged out to 240 rows that would silently throw the other 140 away to
  // re-learn a change we made correctly.
  const selfWrote = useRef(false);
  const invalidateAfterOwnWrite = useCallback(
    (scope) => {
      selfWrote.current = true;
      invalidate(scope);
    },
    [invalidate],
  );

  // A data revision from anywhere else — a save or a delete in the detail pane,
  // the manual refresh, the hero seeder. Refetch the first page WITHOUT clearing,
  // so the column keeps its scroll position and does not flash a skeleton over a
  // list that is about to look almost identical. `seenRev` is what keeps this
  // from firing a second, redundant fetch on mount.
  const seenRev = useRef(dataRev);
  useEffect(() => {
    if (seenRev.current === dataRev) return;
    seenRev.current = dataRev;
    if (selfWrote.current) {
      selfWrote.current = false;
      return;
    }
    setCursor(undefined);
    setDone(false);
    loadPage(undefined);
  }, [dataRev, loadPage]);

  /* --- filtering, sorting ------------------------------------------ */

  // The surface's own filter (Blogging and Creating are one collection split on
  // `value.site`), applied exactly where the old list applied it: after fetching,
  // before anything else. Selection and bulk actions are scoped to THIS array, so
  // a bulk delete can never reach a record the open surface does not show.
  const surfaceRecords = useMemo(
    () => (surface.recordFilter ? records.filter((rec) => surface.recordFilter(rec.value)) : records),
    [records, surface],
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let out = surfaceRecords;

    if (visModel && visibility !== 'all') {
      const wantHidden = visibility === 'hidden';
      out = out.filter((rec) => visModel.isHidden(rec.value) === wantHidden);
    }

    if (needle) {
      out = out.filter((rec) => {
        const key = String(rkeyFromUri(rec.uri) || '');
        return (
          key.toLowerCase().includes(needle) ||
          rowLabel(rec.value, collection, lex).toLowerCase().includes(needle)
        );
      });
    }

    if (sort === 'key') {
      return [...out].sort((a, b) =>
        String(rkeyFromUri(a.uri) || '').localeCompare(String(rkeyFromUri(b.uri) || '')),
      );
    }

    // One instant per record, resolved once. `latestInstant` reads the lexicon
    // and can fall back to decoding a TID, which is far too much work to repeat
    // inside an O(n log n) comparator. Milliseconds rather than the ISO string,
    // because an offset like `+02:00` does not compare lexicographically.
    const at = new Map(
      out.map((rec) => {
        const iso = latestInstant(rec.value, rec.uri, collection);
        const ms = iso ? Date.parse(iso) : Number.NaN;
        return [rec.uri, Number.isNaN(ms) ? null : ms];
      }),
    );
    return [...out].sort((a, b) => {
      const av = at.get(a.uri);
      const bv = at.get(b.uri);
      // A record with no trustworthy instant sinks to the bottom of either
      // order rather than claiming the top of a newest-first list.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sort === 'oldest' ? av - bv : bv - av;
    });
  }, [surfaceRecords, query, visibility, sort, visModel, collection, lex]);

  const filtering = query.trim() !== '' || visibility !== 'all';

  /* --- selection ---------------------------------------------------- */

  // Filter text and sort order are a way of LOOKING at a surface, so they follow
  // you from record to record; a selection made on Blogging would be a live set
  // of rkeys pointed at rows Creating does not show, so it does not. Adjusting
  // state during render (rather than in an effect) is the same pattern the shell
  // uses for its own per-record reset: it lands before the children render, so
  // nothing paints against the previous surface's selection.
  const [lastSurfaceKey, setLastSurfaceKey] = useState(surface.key);
  if (lastSurfaceKey !== surface.key) {
    setLastSurfaceKey(surface.key);
    setSelected(new Set());
    setQuery('');
    setVisibility('all');
  }

  const toggle = useCallback((key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const shownRkeys = useMemo(() => shown.map((rec) => rkeyFromUri(rec.uri)), [shown]);
  const allSelected = shownRkeys.length > 0 && shownRkeys.every((k) => selected.has(k));

  function toggleAll() {
    setSelected((prev) => {
      if (shownRkeys.length > 0 && shownRkeys.every((k) => prev.has(k))) return new Set();
      return new Set(shownRkeys);
    });
  }

  const selectedRecords = surfaceRecords.filter((rec) => selected.has(rkeyFromUri(rec.uri)));

  /* --- bulk writes -------------------------------------------------- */

  async function bulkSetHidden(hidden) {
    if (!visModel) return;
    const targets = selectedRecords.filter((rec) => visModel.isHidden(rec.value) !== hidden);
    if (targets.length === 0) return;
    setBusy(true);
    setError(null);
    const updated = new Map(); // rkey -> new value
    try {
      for (const rec of targets) {
        const r = rkeyFromUri(rec.uri);
        // JSON round-trip first so any BlobRef instances (e.g. a document's
        // coverImage) collapse to their plain wire form before we re-put them.
        const plain = JSON.parse(JSON.stringify(rec.value ?? {}));
        const next = stampAutoTimestamps(lex, visModel.setHidden(plain, hidden));
        // eslint-disable-next-line no-await-in-loop
        await agent.com.atproto.repo.putRecord({ repo: did, collection, rkey: r, record: next });
        updated.set(r, next);
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      if (updated.size) {
        setRecords((prev) =>
          prev.map((rec) => {
            const r = rkeyFromUri(rec.uri);
            return updated.has(r) ? { ...rec, value: updated.get(r) } : rec;
          }),
        );
        // Hiding is what the Front Desk's Drafts and "Hidden elsewhere" tiles
        // count, so the numbers are wrong until this lands. Scoped to this
        // surface's own NSIDs — never the whole batch.
        invalidateAfterOwnWrite(surface.nsids);
      }
      setBusy(false);
    }
  }

  async function bulkDelete() {
    const rkeys = selectedRecords.map((rec) => rkeyFromUri(rec.uri));
    if (rkeys.length === 0) return;
    const noun = rkeys.length === 1 ? 'record' : 'records';
    if (!window.confirm(`Delete ${rkeys.length} ${noun}? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    const deleted = new Set();
    try {
      for (const rkey of rkeys) {
        // eslint-disable-next-line no-await-in-loop
        await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
        deleted.add(rkey);
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setRecords((prev) => prev.filter((rec) => !deleted.has(rkeyFromUri(rec.uri))));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const k of deleted) next.delete(k);
        return next;
      });
      if (deleted.size) invalidateAfterOwnWrite(surface.nsids);
      // The detail pane cannot go on editing a record that no longer exists.
      // Forced, because "discard unsaved changes?" is not a question worth
      // asking about a record you have just deleted.
      if (openRkey && deleted.has(openRkey)) go({ r: null, mode: null }, { force: true });
      setBusy(false);
    }
  }

  /* --- navigation --------------------------------------------------- */

  // The surface keys in the URL are already correct — `rowHrefFor` preserves
  // them — so selecting a record only sets `r` and clears any `mode=new`.
  const openRow = useCallback((key) => go({ r: key, mode: null }), [go]);

  const newHref = collection ? newRecordHref(surface) : '/admin';

  // Bring the open record into view after a back/forward or a deep link.
  // `block: 'nearest'` is a no-op when the row is already visible, which is the
  // common case — you just clicked it — so the column never yanks itself.
  const openRowRef = useRef(null);
  useEffect(() => {
    if (!openRkey) return;
    openRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [openRkey]);

  /* --- render -------------------------------------------------------- */

  if (!collection) return null;

  const countLine = selected.size
    ? `${selected.size} selected`
    : filtering
      ? `${shown.length} of ${surfaceRecords.length}`
      : `${surfaceRecords.length}${done ? '' : '+'} loaded`;

  return (
    <div className="wb-list" data-selecting={selected.size ? '' : undefined}>
      {/* Sticky inside the column's own scroller, so the filter and the bulk
          actions stay reachable however far down the list you are. */}
      <div className="wb-list-head">
        <div className="wb-list-titlerow">
          {/* The rail is icons only and the detail pane titles the RECORD, so
              this is the one place a records surface says its own name. */}
          <h1 className="wb-pane-title wb-list-title">{surface.label}</h1>
          <button
            type="button"
            className="admin-link-subtle wb-list-refresh"
            onClick={() => invalidate(surface.nsids)}
            disabled={loading || busy}
            title="Refresh this list"
            aria-label="Refresh this list"
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <Link
            to={newHref}
            className="admin-gate-button admin-gate-button-tight wb-list-new"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              go(patchFromHref(newHref));
            }}
          >
            New
          </Link>
        </div>

        <code className="admin-collection-nsid wb-list-nsid">{collection}</code>

        <div className="wb-list-controls">
          <input
            type="search"
            className="admin-input wb-list-filter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter loaded"
            aria-label={`Filter ${surface.label}`}
          />
          <select
            className="admin-input wb-list-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort records"
          >
            {SORTS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Only four collections express "hidden from the site" at all, so this
            segment appears only where it can mean something. */}
        {visModel && (
          <div className="wb-list-seg" role="group" aria-label="Visibility">
            {VISIBILITIES.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`wb-list-seg-btn${visibility === option.key ? ' is-on' : ''}`}
                aria-pressed={visibility === option.key}
                onClick={() => setVisibility(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        <div className="admin-multiselect-toolbar wb-list-bulk">
          <label className="admin-checkbox wb-list-all">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={shown.length === 0}
            />
            <span>{allSelected ? 'Select none' : 'Select all'}</span>
          </label>
          <span className="admin-multiselect-count">{countLine}</span>
          {/* The destructive cluster appears when there is something to act on.
              That is not a mode — the checkboxes are live either way — it is a
              22rem column declining to spend a permanent row on three disabled
              buttons. */}
          {selected.size > 0 && (
            <div className="admin-multiselect-actions">
              {visModel && (
                <>
                  <button
                    type="button"
                    className="admin-gate-button admin-gate-button-tight"
                    onClick={() => bulkSetHidden(true)}
                    disabled={busy}
                  >
                    Hide
                  </button>
                  <button
                    type="button"
                    className="admin-gate-button admin-gate-button-tight"
                    onClick={() => bulkSetHidden(false)}
                    disabled={busy}
                  >
                    Unhide
                  </button>
                </>
              )}
              <button
                type="button"
                className="admin-gate-button admin-gate-button-tight admin-danger"
                onClick={bulkDelete}
                disabled={busy}
              >
                {busy ? 'Working…' : `Delete (${selected.size})`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* The filter only ever sees what has been fetched. Say so, and only while
          it is actually misleading — a filter narrowing a list that still has
          pages behind it. */}
      {filtering && !done && (
        <p className="wb-list-note">
          Filtering the {surfaceRecords.length} loaded records only — load more to search the rest.
        </p>
      )}

      {isHero && (
        <HeroSeedButton
          agent={agent}
          did={did}
          existingCount={records.length}
          // The seeded records land through the shell's invalidation, which
          // refreshes this list and the rail's counts in one pass.
          onSeeded={() => invalidate(surface.nsids)}
        />
      )}

      {surface.pageSlug && <PageContentPanel agent={agent} did={did} slug={surface.pageSlug} />}

      {error && <p className="admin-error">{error}</p>}

      {loading && records.length === 0 ? (
        // `marker` from the same `visModel` the real rows read, so the
        // placeholder titles start on the pixel the loaded titles will.
        <AdminRecordListSkeleton rows={8} variant="workbench" marker={!!visModel} />
      ) : shown.length === 0 && !error ? (
        <p className="placeholder-card wb-list-empty">
          {surfaceRecords.length === 0
            ? 'No records yet in this collection.'
            : 'No loaded record matches this filter.'}
        </p>
      ) : (
        // `.reveal`, not `.reveal-stagger`: the stagger animates each child and
        // would re-fire every row on every keystroke as the filter reorders them.
        <ul className="admin-record-list wb-list-rows reveal">
          {shown.map((rec) => {
            const key = rkeyFromUri(rec.uri);
            const hidden = visModel ? visModel.isHidden(rec.value) : false;
            const open = key === openRkey;
            return (
              <RecordRow
                key={rec.uri}
                rkey={key}
                label={rowLabel(rec.value, collection, lex)}
                chip={hidden ? visModel.chipLabel(rec.value) || 'hidden' : null}
                hidden={hidden}
                hasState={!!visModel}
                instant={latestInstant(rec.value, rec.uri, collection)}
                href={rowHrefFor(surface, key)}
                open={open}
                checked={selected.has(key)}
                onOpen={openRow}
                onToggle={toggle}
                rowRef={open ? openRowRef : undefined}
              />
            );
          })}
        </ul>
      )}

      {/* Paging is driven by the RAW record count, never the filtered one: a
          filter that hides every loaded row must not also hide the button that
          would load the rows it is looking for. */}
      {!done && records.length > 0 && (
        <button
          type="button"
          className="admin-gate-button admin-gate-button-tight wb-list-more"
          disabled={loading}
          onClick={() => loadPage(cursor)}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
