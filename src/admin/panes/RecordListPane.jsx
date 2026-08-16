// The list column: every record in the open surface, filterable, sortable, and
// selectable in bulk. Descendant of the old `RecordList` in src/pages/Admin.jsx,
// whose fetch and whose two bulk writes are carried over unchanged — including
// the JSON round-trip that flattens BlobRef instances before a re-put, and both
// `no-await-in-loop` disable comments, which are two of the tree's 67 baseline
// warnings and had to travel with the code they annotate.
//
// What is genuinely different, and why:
//
//  1. **The pane is persistent — above 60rem.** It is a sibling of the detail
//     pane rather than a page that gets replaced by one, so opening a record no
//     longer throws the list away. BELOW 60rem it is not: the frame gives the
//     whole viewport to one column, so drilling into a record unmounts this one.
//     That is why the view state below no longer lives here (see 6).
//  2. **`limit: 50` → `limit: 100`.** Same request count, twice the rows; 100 is
//     the API maximum (`limit=101` answers `InvalidRequest … maximum 100`).
//  3. **Exhaustion is a SHORT PAGE, not a missing cursor.** The old test was
//     `!next?.cursor || batch.length === 0`, and the PDS hands back a live cursor
//     on a final short page — which is why a 27-record collection has been
//     offering a "Load more" that loads nothing. `batch.length < PAGE_LIMIT` is
//     the real answer; the cursor check stays as a secondary guard.
//  4. **Multiselect is always on above 60rem** — checkboxes fade in on hover or
//     focus and stay up while anything is ticked — and is a MODE below it,
//     entered from the action bar's `⋯`. A mode is ceremony in a column that sits
//     beside the editor all day; on a phone a permanent 13px checkbox on every
//     row is a target nobody can hit and 24px of a 390px row spent on it.
//  5. **Filter and sort are never URL state.** They are a way of looking at the
//     surface, not a place — putting them in the query string would push a
//     history entry per keystroke and make every list link unshareable in a
//     different way.
//  6. **The view state lives in the shell** (`listView` / `setListView`, keyed by
//     surface). Query, sort, visibility, selection, the scroll offset and the row
//     you last opened all survive this pane being unmounted, which is what makes
//     "open a record, come back, carry on down the list" work on a phone. It is
//     also why there is no reset-on-surface-change block any more: the shell
//     keys the state by surface, so Blogging's filter simply is not Creating's.
//  7. **Two heads, one list.** Above 60rem the head is the full instrument panel
//     — title, nsid, filter, sort, visibility segment, bulk toolbar. Below it the
//     head is two 44px rows (title + refresh, then filter toggle + one options
//     chip) and everything else moves into the action bar and the options sheet,
//     per docs/admin-mobile-design.md §3.2. The head is `position: sticky` at
//     BOTH widths: the pane is its own scrollport at every width, so the filter
//     and the destructive cluster cannot scroll away.
//  8. **Nothing sits between the toolbar and the rows.** The page-content panel,
//     the hero seeder and the "filtering loaded records only" caption all used
//     to; a bulk Delete 350px from the row it deletes, with an unrelated card
//     between them, is not a control surface.
//
// The filter is client-side over the records that are LOADED, which is a real
// limitation rather than an implementation detail, so the pane says so on screen
// as soon as a filter is narrowing an incomplete list. Paging, correspondingly,
// is driven by the raw record count and never by the filtered one — the old
// shape where a filtered view looks empty while three more pages exist.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, ChevronUp, RefreshCw, Search, X } from 'lucide-react';
import AdminSheet from '../AdminSheet.jsx';
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

/** Ditto for "nothing is ticked" — `listView.selected` is compared by identity. */
const NO_SELECTION = Object.freeze([]);

/**
 * This pane's own sheet id. The shell owns `'surfaces'` and `'overflow'` and
 * allows one sheet open at a time, so naming it here is the whole registration.
 */
const OPTIONS_SHEET = 'list-options';

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

/**
 * Each collection's own visibility vocabulary, keyed by the hidden word its
 * visibility model already publishes for the row chip: the word for the opposite
 * state, and the two verbs for the buttons that switch between them.
 *
 * This exists because one state was going by three names: the segment offered
 * All / Visible / Hidden, the row chip beneath it read DISABLED, and the detail
 * pane's field called it "Enabled (shown in rotation)". `visibilityModelFor()`
 * knows the hidden word — "draft" on a document, "disabled" on a hero phrase —
 * and the rest of the vocabulary is the only part it does not carry, so it is
 * stated once here rather than being guessed at three call sites.
 */
const WORDS = Object.freeze({
  draft: Object.freeze({ shown: 'Published', hide: 'Draft', show: 'Publish' }),
  disabled: Object.freeze({ shown: 'Enabled', hide: 'Disable', show: 'Enable' }),
  hidden: Object.freeze({ shown: 'Visible', hide: 'Hide', show: 'Show' }),
  private: Object.freeze({ shown: 'Public', hide: 'Hide', show: 'Publish' }),
  unlisted: Object.freeze({ shown: 'Public', hide: 'Hide', show: 'Publish' }),
});

const FALLBACK_WORDS = Object.freeze({ shown: 'Visible', hide: 'Hide', show: 'Show' });

/**
 * How the OPEN COLLECTION talks about visibility: the segment's three options,
 * and the two verbs the bulk buttons need. Null for the four collections that
 * have no visibility concept at all.
 *
 * `chipLabel` takes a record value; called with an empty one it answers the
 * model's default word, which is exactly the noun this is keyed by. The bulk
 * buttons take VERBS rather than the segment's adjectives for two reasons: a
 * button should say what it does, and three adjectives ("Disabled" "Enabled"
 * "Delete (12)") wrap onto a second line in a 22rem column while three verbs
 * do not — and a cluster that can wrap cannot have its space reserved.
 *
 * @param {ReturnType<typeof visibilityModelFor>} visModel
 */
function visibilityWords(visModel) {
  if (!visModel) return null;
  const hiddenWord = String(visModel.chipLabel({}) || 'hidden');
  const words = WORDS[hiddenWord] || FALLBACK_WORDS;
  return Object.freeze({
    hide: words.hide,
    show: words.show,
    options: Object.freeze([
      Object.freeze({ key: 'all', label: 'All' }),
      Object.freeze({ key: 'visible', label: words.shown }),
      Object.freeze({ key: 'hidden', label: hiddenWord.charAt(0).toUpperCase() + hiddenWord.slice(1) }),
    ]),
  });
}

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
 * It is now rendered INSIDE the empty state and in the subtle voice rather than
 * as a permanently filled button between the toolbar and the first row: a
 * one-time bootstrap that has already been run cannot go on being as loud as
 * "New" on every visit forever, and the only place it ever explained itself was
 * inside its own confirm() dialog.
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
        className="admin-link-subtle wb-list-empty-action"
        onClick={seed}
        disabled={busy}
      >
        {busy ? 'Seeding…' : 'Seed the built-in hero phrases'}
      </button>
      {error && <p className="admin-error">{error}</p>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Rows                                                                 */
/* ------------------------------------------------------------------ */

/**
 * What a row SAYS, without deciding what tapping it does. Two lines rather than
 * the old single line, because this column is 22rem wide and the old row spent
 * 14ch of it on the rkey before the title started. Line one is what the record
 * IS; line two is how it is addressed and when it was last touched.
 *
 * The status square is absolutely positioned (see `.wb-list-dot`) so that a
 * row's title and its rkey share one left edge on the four surfaces that draw
 * one, exactly as they already do on the four that do not.
 */
function RowBody({ label, chip, hidden, hasState, rkey, instant }) {
  return (
    <>
      <span className="wb-list-line">
        {hasState && (
          <span className="wb-list-dot" data-hidden={hidden ? '' : undefined} aria-hidden="true" />
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
    </>
  );
}

/**
 * One record row, in one of its two shapes.
 *
 *  - NORMALLY: a checkbox that does not navigate, and a link that does.
 *  - IN SELECTION MODE (touch only): the whole row is a `<label>` for its own
 *    checkbox, so the tap target is the full 65px row rather than a 24px box —
 *    no `::before` halo, no invisible target overlapping the row's link, and the
 *    accessible name is the record's title rather than its rkey.
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
  selecting,
  showCheck,
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

  const body = (
    <RowBody
      label={label}
      chip={chip}
      hidden={hidden}
      hasState={hasState}
      rkey={rkey}
      instant={instant}
    />
  );

  // The record's own title, not its rkey. A screen-reader user ticking rows for
  // a bulk delete was hearing twelve characters of base32.
  const pickLabel = `Select ${label || rkey}`;

  return (
    <li className={className} ref={rowRef}>
      {selecting ? (
        <label className="wb-list-pick">
          <input
            type="checkbox"
            className="wb-list-check"
            checked={checked}
            onChange={() => onToggle(rkey)}
            aria-label={pickLabel}
          />
          <span className="wb-list-link">{body}</span>
        </label>
      ) : (
        <>
          {showCheck && (
            <input
              type="checkbox"
              className="wb-list-check"
              checked={checked}
              onChange={() => onToggle(rkey)}
              aria-label={pickLabel}
            />
          )}
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
            {body}
          </Link>
        </>
      )}
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
  const {
    rkey,
    isNew,
    go,
    invalidate,
    dataRev,
    stacked,
    listView,
    setListView,
    registerBar,
    sheet,
    setSheet,
  } = useAdminShell();
  // `mode=new` beats `r`, exactly as the old param ladder did, so no row is
  // marked open while a new record is being drafted.
  const openRkey = isNew ? null : rkey;

  const collection = surface.nsid;
  const lex = lexiconFor(collection);
  const visModel = visibilityModelFor(collection);
  const vis = useMemo(() => visibilityWords(visModel), [visModel]);
  const visOptions = vis?.options || null;
  const isHero = collection === COLLECTIONS.heroPhrase;
  // A legacy collection is one nothing writes to any more (the lexicon says so
  // itself). Offering "New" on it is an invitation to write a record into a
  // shape the site has already migrated away from.
  const isLegacy = lex?.legacy === true;

  const [records, setRecords] = useState(NO_RECORDS);
  const [cursor, setCursor] = useState(undefined);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Whether the filter INPUT is on screen, which is a property of this mount and
  // not of the surface: the query itself is view state and survives, the row the
  // owner typed it in does not need to.
  const [filterOpen, setFilterOpen] = useState(false);

  /* --- view state, which lives in the shell -------------------------- */

  // Keyed by surface, ref-backed, and deliberately NOT local state: below 60rem
  // this pane unmounts the moment a record opens, and every one of these is
  // something the owner would have to redo on the way back.
  const surfaceKey = surface.key;
  const { query, sort, visibility, selecting } = listView;
  const selectedKeys = listView.selected;
  const setView = useCallback(
    (patch) => setListView(surfaceKey, patch),
    [setListView, surfaceKey],
  );
  const selected = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  // The shell writes `scrollTop` and `lastOpenRkey` through a silent path (a ref
  // write, no re-render), so the restore effect below reads them from here
  // rather than taking a dependency on a value that is deliberately not state.
  const viewRef = useRef(listView);
  viewRef.current = listView;

  // The surface heading, declared up here because two things far apart in this
  // file need it: the bulk delete, which loses focus when its own button goes
  // away, and the return-from-a-record restore. It carries `tabIndex={-1}` so it
  // can take focus without taking a tab stop.
  const headingRef = useRef(null);

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
  // Before the first response there is no list, so there is nothing to filter,
  // sort, count or select — and "0+ loaded" is a measurement of nothing.
  const firstLoad = loading && records.length === 0;

  // Publish how many records this surface actually has, for the DETAIL column —
  // which is mounted beside this one on a desktop, does no fetching of its own,
  // and used to answer an empty collection with "Nothing selected — pick a
  // record from the list" while the list next to it said there were none. `-1`
  // means "not known yet", so the pane can tell an empty collection from one
  // that has not answered. Written after the fetch settles, never during it:
  // mid-flight the count is zero for a reason that has nothing to do with the
  // collection. `setListView` bails when the value has not moved, so this is one
  // shell render per load, not one per render.
  useEffect(() => {
    if (firstLoad) return;
    setView({ loadedCount: error ? -1 : surfaceRecords.length });
  }, [firstLoad, error, surfaceRecords.length, setView]);

  // The visible order, as rkeys, for the two places that need a POSITION rather
  // than a record: `openRow` records where the row it is leaving sat, and the
  // restore effect reads it back when that row no longer exists. A ref, because
  // both are event/effect callers that must see the latest order without taking
  // a dependency on an array that changes identity on every keystroke.
  const shownKeysRef = useRef([]);
  shownKeysRef.current = useMemo(() => shown.map((rec) => rkeyFromUri(rec.uri)), [shown]);

  /* --- selection ---------------------------------------------------- */

  const toggle = useCallback(
    (key) => {
      const next = selectedKeys.includes(key)
        ? selectedKeys.filter((k) => k !== key)
        : [...selectedKeys, key];
      setView({ selected: Object.freeze(next) });
    },
    [selectedKeys, setView],
  );

  const shownRkeys = useMemo(() => shown.map((rec) => rkeyFromUri(rec.uri)), [shown]);
  const selectedShown = useMemo(
    () => shownRkeys.filter((k) => selected.has(k)).length,
    [shownRkeys, selected],
  );
  const allSelected = shownRkeys.length > 0 && selectedShown === shownRkeys.length;
  // Ticked, but not on screen — because the filter, the visibility segment or a
  // surface slice is hiding it. A count the list cannot corroborate is what let
  // a live "Delete (6)" sit over the words "No loaded record matches this
  // filter", so the number says so itself.
  const selectedUnshown = selected.size - selectedShown;

  // Never disabled while anything is ticked: the master checkbox is the only
  // control that can clear a selection, and disabling it under a filter that
  // matches nothing left the owner with an armed Delete and no way to disarm it.
  const toggleAll = useCallback(() => {
    if (selected.size > 0) setView({ selected: NO_SELECTION });
    else setView({ selected: Object.freeze([...shownRkeys]) });
  }, [selected, shownRkeys, setView]);

  const selectedRecords = useMemo(
    () => surfaceRecords.filter((rec) => selected.has(rkeyFromUri(rec.uri))),
    [surfaceRecords, selected],
  );

  // Selection is a MODE below 60rem and a permanent capability above it, so the
  // one flag the row and the CSS read is derived rather than asked for twice.
  const selectionOn = stacked ? selecting : selected.size > 0;

  const endSelecting = useCallback(
    () => setView({ selecting: false, selected: NO_SELECTION }),
    [setView],
  );

  // A mode that only exists on a phone must not survive the viewport growing
  // back — the desktop head has no Cancel to leave it with.
  useEffect(() => {
    if (!stacked && selecting) setView({ selecting: false });
  }, [stacked, selecting, setView]);

  /* --- bulk writes -------------------------------------------------- */

  const bulkSetHidden = useCallback(
    async (hidden) => {
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
    },
    [agent, collection, did, invalidateAfterOwnWrite, lex, selectedRecords, surface.nsids, visModel],
  );

  // What the confirm question says. Naming the record when there is one to name
  // is the difference between "Delete 1 record?" and a sentence the owner can
  // check against the row they think they ticked.
  const deleteQuestion = useMemo(() => {
    if (selectedRecords.length === 1) {
      const rec = selectedRecords[0];
      const name = rowLabel(rec.value, collection, lex) || rkeyFromUri(rec.uri);
      return `Delete “${name}”? This cannot be undone.`;
    }
    const unshown = selectedUnshown > 0 ? ` (${selectedUnshown} of them not on screen)` : '';
    return `Delete ${selectedRecords.length} records${unshown}? This cannot be undone.`;
  }, [selectedRecords, collection, lex, selectedUnshown]);

  // The write itself, with no question attached: the action bar asks its own
  // (`BarAction.confirm`), and asking twice for one delete is worse than not
  // asking at all.
  const runDelete = useCallback(async () => {
    const rkeys = selectedRecords.map((rec) => rkeyFromUri(rec.uri));
    if (rkeys.length === 0) return;
    setBusy(true);
    setError(null);
    const deleted = new Set();
    try {
      for (const key of rkeys) {
        // eslint-disable-next-line no-await-in-loop
        await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey: key });
        deleted.add(key);
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setRecords((prev) => prev.filter((rec) => !deleted.has(rkeyFromUri(rec.uri))));
      // Selection mode ends with the records it was about. Leaving it armed over
      // an empty selection keeps `[Cancel] [0 selected] [Delete (0)]` under the
      // thumb after the job is done, and the owner has to dismiss a mode they
      // already finished with.
      setView({ selected: NO_SELECTION, selecting: false });
      if (deleted.size) invalidateAfterOwnWrite(surface.nsids);
      // The detail pane cannot go on editing a record that no longer exists.
      // Forced, because "discard unsaved changes?" is not a question worth
      // asking about a record you have just deleted.
      if (openRkey && deleted.has(openRkey)) go({ r: null, mode: null }, { force: true });
      setBusy(false);
      // Where focus goes when the control that was holding it has just gone.
      // The Delete that ran this is in the selection cluster, and that cluster
      // is hidden (desktop) or swapped out of the bar (stacked) the moment the
      // selection empties — measured `activeElement` was BODY on both routes.
      // The heading is the one element on the surface guaranteed to still be
      // there, it names where the owner is, and the count beside it is already
      // `aria-live`, so the new total is announced without a second region
      // saying the same thing. One frame late, to land after `RouteTransition`
      // if the delete also closed an open record.
      requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    }
  }, [
    agent,
    collection,
    did,
    go,
    invalidateAfterOwnWrite,
    openRkey,
    selectedRecords,
    setView,
    surface.nsids,
  ]);

  const bulkDelete = useCallback(() => {
    if (!window.confirm(deleteQuestion)) return;
    runDelete();
  }, [deleteQuestion, runDelete]);

  /* --- navigation --------------------------------------------------- */

  const newHref = collection ? newRecordHref(surface) : '/admin';
  const canCreate = !!collection && !isLegacy;
  const openNew = useCallback(() => go(patchFromHref(newHref)), [go, newHref]);

  // The surface keys in the URL are already correct — `rowHrefFor` preserves
  // them — so selecting a record only sets `r` and clears any `mode=new`. The
  // rkey is recorded first: below 60rem this pane is about to unmount, and it is
  // what focus comes back to.
  //
  // Its POSITION is recorded with it, because the rkey is not always still there
  // to come back to. Delete the record from the detail pane on a phone and this
  // list mounts in its place with the row gone; the position is what lets focus
  // land on whatever took it rather than on <main>.
  const openRow = useCallback(
    (key) => {
      setView({ lastOpenRkey: key, lastOpenIndex: shownKeysRef.current.indexOf(key) });
      go({ r: key, mode: null });
    },
    [go, setView],
  );

  /* --- the filter row ------------------------------------------------ */

  // Opening the filter has to put the caret in it — the toggle exists so the
  // input is not permanently on screen, and a control you have to tap twice
  // would be a worse trade than the row it replaced. A ref rather than
  // `autoFocus`, which fires on mount rather than on the owner's tap.
  const filterRef = useRef(null);
  useEffect(() => {
    if (filterOpen) filterRef.current?.focus();
  }, [filterOpen]);

  /* --- the scrollport, which is the PANE and not the document -------- */

  const rootRef = useRef(null);
  const portRef = useRef(null);
  // Which surface's offset has already been put back. A ref, not state: it must
  // not cause a render, and it must survive one.
  const restoredKey = useRef(null);

  // Record where the column is, continuously and silently — `scrollTop` patches
  // are a ref write in the shell with no re-render, which is what makes it safe
  // to call from a scroll handler. One rAF per frame at most.
  useEffect(() => {
    const port = rootRef.current?.closest('.wb-pane-list');
    portRef.current = port || null;
    if (!port) return undefined;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // Between a surface change and its restore the offset on screen still
        // belongs to the surface we left; writing it under the new key would
        // hand the next list somebody else's place.
        if (restoredKey.current !== surfaceKey) return;
        setListView(surfaceKey, { scrollTop: port.scrollTop });
      });
    };
    port.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      port.removeEventListener('scroll', onScroll);
    };
  }, [surfaceKey, setListView]);

  // The row the owner drilled into, when we have come back to a list that is no
  // longer showing it in a detail pane beside it. Focus lands here rather than
  // on <body>, which is where the back button used to drop it.
  const returnRkey = stacked && !openRkey ? listView.lastOpenRkey : null;
  const openRowRef = useRef(null);
  const returnRowRef = useRef(null);

  // Put the column back where it was, once there is something to scroll. The
  // wait for rows is the whole trick: at mount `records` is empty and `loading`
  // is still false (the fetch starts in an effect, after this render), so an
  // "on mount" restore sets `scrollTop` on a list with no height — which is a
  // silent no-op and exactly what coming back from a record used to be. An error
  // releases it too, because then there will never be rows.
  useEffect(() => {
    if (restoredKey.current === surfaceKey) return undefined;
    if (records.length === 0 && !error) return undefined;
    restoredKey.current = surfaceKey;
    const { scrollTop, lastOpenRkey, lastOpenIndex } = viewRef.current;
    const port = portRef.current;
    if (port) port.scrollTop = scrollTop || 0;

    // Focus only moves when we have COME BACK from a record — `lastOpenRkey` is
    // the record we left. Arriving at a list any other way (a deep link, a
    // surface change, a reload) leaves focus alone, because there is nothing to
    // restore and the shell has its own answer for where a new route starts.
    if (!lastOpenRkey) return undefined;

    // Where focus goes, in the order of how much it knows.
    //
    // 1. The row we drilled into, if it is still here. This is the ordinary
    //    back-out, and `preventScroll` matters: the offset restored above is the
    //    answer, and letting the browser scroll the focused row into view would
    //    overrule it.
    // 2. The row that took its place. Reached when the record was DELETED from
    //    the detail pane on a phone — that pane unmounts, this column mounts,
    //    and nothing in the pane's own slot is alive to receive focus, so the
    //    measured `activeElement` was MAIN.layout. The position was recorded on
    //    the way in for exactly this case; if the deleted row was last, the new
    //    last row is the nearest thing to where the owner was standing.
    // 3. The heading. Reached when the delete emptied the list. It carries
    //    `tabIndex={-1}` for this, and it names the surface, which is the one
    //    fact worth announcing when there is no longer a row to stand on.
    //
    // Deferred one frame. `RouteTransition`'s effect focuses `#main-content` on
    // `[pathname, navType]`, and `go()` flips navType POP→PUSH on the first
    // in-admin navigation of a session — it is an ancestor, so its effect runs
    // AFTER this one in the same commit and takes focus straight back off
    // whatever we put it on. A frame later is after that, and still before any
    // input the owner could have produced.
    const frame = requestAnimationFrame(() => {
      let target = null;
      if (returnRowRef.current) {
        target = returnRowRef.current.querySelector('.wb-list-link, .wb-list-check');
      } else if (lastOpenIndex >= 0 && shownKeysRef.current.length) {
        const rows = rootRef.current?.querySelectorAll('.wb-list-rows > li') || [];
        const at = Math.min(lastOpenIndex, rows.length - 1);
        target = rows[at]?.querySelector('.wb-list-link, .wb-list-check') || null;
      }
      (target || headingRef.current)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [surfaceKey, records.length, error]);

  // Bring the open record into view after a back/forward or a deep link.
  // `block: 'nearest'` is a no-op when the row is already visible, which is the
  // common case — you just clicked it — so the column never yanks itself.
  useEffect(() => {
    if (!openRkey) return;
    openRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [openRkey]);

  /* --- paging -------------------------------------------------------- */

  const moreRef = useRef(null);
  // "Load more" used to hand focus to <body>: the button stays mounted, so the
  // next Tab restarted from the top of the document rather than from the hundred
  // rows that had just arrived. When the page that lands is the last one the
  // button unmounts, and then the end of the list is the honest place to be.
  const loadMore = useCallback(async () => {
    await loadPage(cursor);
    const fallback = rootRef.current?.querySelector('.wb-list-rows li:last-child .wb-list-link');
    (moreRef.current || fallback)?.focus({ preventScroll: true });
  }, [loadPage, cursor]);

  /* --- what the head and the bar both say ---------------------------- */

  const sortLabel = SORTS.find((option) => option.key === sort)?.label || SORTS[0].label;
  const visLabel = visOptions?.find((option) => option.key === visibility)?.label || 'All';

  const countLine = firstLoad
    ? 'Loading…'
    : selected.size
      ? `${selected.size} selected${selectedUnshown > 0 ? ` · ${selectedUnshown} not shown` : ''}`
      : filtering
        ? `${shown.length} of ${surfaceRecords.length}`
        : `${surfaceRecords.length}${done ? '' : '+'} loaded`;

  /* --- the action bar, below 60rem ----------------------------------- */

  // Registered unconditionally: the bar is only rendered below 60rem, so
  // branching on `stacked` here would buy nothing and give the pane two code
  // paths to keep in step. The shell clears the slots on any subject change, and
  // the cleanup covers the rest.
  useEffect(() => {
    if (selectionOn && stacked) {
      const actions = [];
      if (visModel) {
        actions.push({
          id: 'hide',
          label: vis.hide,
          disabled: busy || selected.size === 0,
          busy,
          busyLabel: 'Working…',
          onPress: () => bulkSetHidden(true),
        });
      }
      actions.push({
        id: 'delete',
        label: `Delete (${selected.size})`,
        // Never the painted primary, whatever slot it lands in: nothing in a
        // selection is a primary action, and the irreversible member of the
        // cluster is the last one that should look like the obvious tap.
        tone: 'danger',
        disabled: busy || selected.size === 0,
        confirm: deleteQuestion,
        onPress: runDelete,
      });
      registerBar({
        left: { id: 'cancel', label: 'Cancel', onPress: endSelecting },
        status: countLine,
        actions,
        overflow: visModel
          ? [
              {
                id: 'unhide',
                label: vis.show,
                icon: 'PackageOpen',
                disabled: busy || selected.size === 0,
                onPress: () => bulkSetHidden(false),
              },
            ]
          : [],
      });
    } else {
      registerBar({
        status: countLine,
        actions: canCreate
          ? [{ id: 'new', label: 'New', icon: 'FileText', onPress: openNew }]
          : [],
        overflow: [
          {
            id: 'select',
            label: 'Select records',
            icon: 'Files',
            disabled: surfaceRecords.length === 0,
            onPress: () => setView({ selecting: true }),
          },
        ],
      });
    }
    return () => registerBar(null);
  }, [
    registerBar,
    stacked,
    selectionOn,
    selected.size,
    countLine,
    busy,
    visModel,
    vis,
    bulkSetHidden,
    runDelete,
    deleteQuestion,
    endSelecting,
    canCreate,
    openNew,
    setView,
    surfaceRecords.length,
  ]);

  /* --- render -------------------------------------------------------- */

  if (!collection) return null;

  // Filter, sort, segment and select-all are controls over a list. With no list
  // they are dead furniture — at 390 they used to eat the top third of the
  // screen above the sentence explaining that there is nothing there.
  const showControls = !firstLoad && surfaceRecords.length > 0;

  const clearFilter = () => setView({ query: '', visibility: 'all' });

  const emptyState = () => {
    if (surfaceRecords.length > 0) {
      // Loaded records, none of them matching. The way out is the filter itself,
      // and Chrome draws no clear × on an unfocused type="search".
      return (
        <>
          <p className="wb-list-empty-line">
            {query.trim()
              ? `No loaded record matches “${query.trim()}”.`
              : 'No loaded record matches this filter.'}
          </p>
          <button type="button" className="admin-link-subtle wb-list-empty-action" onClick={clearFilter}>
            Clear the filter
          </button>
        </>
      );
    }
    if (surface.synthetic) {
      // A collection nobody registered: absent and empty look identical over
      // XRPC, so the copy must not claim to know which one this is.
      return (
        <p className="wb-list-empty-line">
          Nothing here — this collection has no records, or does not exist yet.
        </p>
      );
    }
    if (isLegacy) {
      return (
        <p className="wb-list-empty-line">
          Nothing in <code className="wb-list-empty-nsid">{collection}</code>. This collection is
          legacy — new records are written elsewhere.
        </p>
      );
    }
    return (
      <>
        <p className="wb-list-empty-line">No records yet in this collection.</p>
        {isHero ? (
          <HeroSeedButton
            agent={agent}
            did={did}
            existingCount={records.length}
            // The seeded records land through the shell's invalidation, which
            // refreshes this list and the rail's counts in one pass.
            onSeeded={() => invalidate(surface.nsids)}
          />
        ) : (
          <button type="button" className="admin-link-subtle wb-list-empty-action" onClick={openNew}>
            Write the first one
          </button>
        )}
      </>
    );
  };

  return (
    <div
      className="wb-list"
      ref={rootRef}
      data-selecting={selectionOn ? '' : undefined}
      data-stacked={stacked ? '' : undefined}
      data-marker={visModel ? '' : undefined}
    >
      {/* Sticky inside the column's own scroller — which is what `.wb-pane-list`
          is at EVERY width — so the filter and the bulk actions stay reachable
          however far down the list you are. */}
      <div className="wb-list-head">
        <div className="wb-list-titlerow">
          {/* The rail is icons only and the detail pane titles the RECORD, so
              this is the one place a records surface says its own name.

              `tabIndex={-1}` makes it programmatically focusable without adding
              a stop to the tab order. It is the last resort of the restore
              effect above and the landing place after a bulk delete: when the
              rows a delete acted on are gone, the surface's name is the honest
              thing to announce. */}
          <h1 className="wb-pane-title wb-list-title" ref={headingRef} tabIndex={-1}>
            {surface.label}
          </h1>
          <button
            type="button"
            className="admin-link-subtle wb-list-refresh"
            onClick={() => invalidate(surface.nsids)}
            disabled={loading || busy}
            title="Refresh this list"
            aria-label="Refresh this list"
          >
            <RefreshCw size={stacked ? 20 : 14} aria-hidden="true" />
          </button>
          {/* Below 60rem "New" is the bar's right slot: it is the surface's
              primary action and belongs under the thumb, not in the corner
              furthest from it. */}
          {!stacked && canCreate && (
            <Link
              to={newHref}
              className="admin-gate-button admin-gate-button-tight wb-list-new"
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                event.preventDefault();
                openNew();
              }}
            >
              New
            </Link>
          )}
        </div>

        {/* Developer orientation, and one line of it. On the synthetic surface the
            <h1> IS the nsid, so printing it twice says nothing twice. */}
        {!stacked && !surface.synthetic && (
          <code className="admin-collection-nsid wb-list-nsid">{collection}</code>
        )}

        {showControls &&
          (stacked ? (
            /* Two 44px controls on one 358px row. A permanent input plus a
               three-button segment plus a sort select could not fit, and the
               input was eating the first screen on a list you opened to read. */
            <div className="wb-list-controls">
              {filterOpen ? (
                <>
                  <input
                    type="search"
                    className="admin-input wb-list-filter"
                    ref={filterRef}
                    value={query}
                    onChange={(event) => setView({ query: event.target.value })}
                    placeholder="Filter loaded"
                    aria-label={`Filter ${surface.label}`}
                  />
                  <button
                    type="button"
                    className="wb-list-ctl"
                    onClick={() => setFilterOpen(false)}
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="wb-list-ctl wb-list-ctl-grow"
                    aria-expanded="false"
                    onClick={() => setFilterOpen(true)}
                  >
                    <Search size={16} aria-hidden="true" />
                    <span className="wb-list-ctl-label">
                      {query.trim() ? `“${query.trim()}”` : 'Filter'}
                    </span>
                  </button>
                  {query.trim() && (
                    <button
                      type="button"
                      className="wb-list-ctl wb-list-ctl-icon"
                      aria-label="Clear the filter"
                      onClick={() => setView({ query: '' })}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="wb-list-ctl"
                    aria-expanded={sheet === OPTIONS_SHEET}
                    aria-controls="wb-list-options"
                    onClick={() => setSheet(sheet === OPTIONS_SHEET ? null : OPTIONS_SHEET)}
                  >
                    <span className="wb-list-ctl-label">
                      {sortLabel}
                      {visOptions ? ` · ${visLabel}` : ''}
                    </span>
                    <ChevronUp size={14} aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="wb-list-controls">
                <input
                  type="search"
                  className="admin-input wb-list-filter"
                  value={query}
                  onChange={(event) => setView({ query: event.target.value })}
                  placeholder="Filter loaded"
                  aria-label={`Filter ${surface.label}`}
                />
                <select
                  className="admin-input wb-list-sort"
                  value={sort}
                  onChange={(event) => setView({ sort: event.target.value })}
                  aria-label="Sort records"
                >
                  {SORTS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Only four collections express "hidden from the site" at all, so
                  this segment appears only where it can mean something — and it
                  says it in that collection's own words. */}
              {visOptions && (
                <div className="wb-list-seg" role="group" aria-label="Visibility">
                  {visOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`wb-list-seg-btn${visibility === option.key ? ' is-on' : ''}`}
                      aria-pressed={visibility === option.key}
                      onClick={() => setView({ visibility: option.key })}
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
                    disabled={shownRkeys.length === 0 && selected.size === 0}
                    ref={(el) => {
                      // Ticked rows that this view is not showing are neither
                      // "all" nor "none"; the platform has a state for that.
                      if (el) el.indeterminate = selected.size > 0 && !allSelected;
                    }}
                  />
                  <span>{selected.size > 0 ? 'Select none' : 'Select all'}</span>
                </label>
                {/* aria-live so a count that changes without the owner asking —
                    a hundred more rows landing, a bulk delete completing — is
                    announced. Below 60rem the bar's status slot does this job. */}
                <span className="admin-multiselect-count" aria-live="polite">
                  {countLine}
                </span>
                {/* The destructive cluster keeps its line whether or not anything
                    is ticked. `visibility: hidden` rather than a conditional
                    render: it costs no tab stop and makes no announcement, and
                    the reserved box is what stops the whole list jumping 41px
                    down — under the pointer — the moment you tick one row. */}
                <div className="admin-multiselect-actions wb-list-actions" data-armed={selected.size ? '' : undefined}>
                  {visModel && (
                    <>
                      <button
                        type="button"
                        className="admin-gate-button admin-gate-button-tight wb-list-toggle-btn"
                        onClick={() => bulkSetHidden(true)}
                        disabled={busy || selected.size === 0}
                        title={`Mark the selected records ${visOptions[2].label.toLowerCase()}`}
                      >
                        {vis.hide}
                      </button>
                      <button
                        type="button"
                        className="admin-gate-button admin-gate-button-tight wb-list-toggle-btn"
                        onClick={() => bulkSetHidden(false)}
                        disabled={busy || selected.size === 0}
                        title={`Mark the selected records ${visOptions[1].label.toLowerCase()}`}
                      >
                        {vis.show}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="admin-gate-button admin-gate-button-tight wb-list-danger"
                    onClick={bulkDelete}
                    disabled={busy || selected.size === 0}
                    aria-label={`Delete ${selected.size} selected records`}
                  >
                    {busy ? 'Working…' : 'Delete'}
                  </button>
                </div>
              </div>
            </>
          ))}
      </div>

      {error && <p className="admin-error">{error}</p>}

      {firstLoad ? (
        // `marker` from the same `visModel` the real rows read, so the
        // placeholder titles start on the pixel the loaded titles will.
        <AdminRecordListSkeleton rows={8} variant="workbench" marker={!!visModel} />
      ) : shown.length === 0 && !error ? (
        <div className="placeholder-card wb-list-empty">{emptyState()}</div>
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
                selecting={stacked && selecting}
                showCheck={!stacked}
                onOpen={openRow}
                onToggle={toggle}
                rowRef={open ? openRowRef : key === returnRkey ? returnRowRef : undefined}
              />
            );
          })}
        </ul>
      )}

      {/* The filter only ever sees what has been fetched. Say so, and only while
          it is actually misleading — a filter narrowing a list that still has
          pages behind it. Next to the button that loads them, which is the
          answer to the sentence. */}
      {filtering && !done && !firstLoad && (
        <p className="wb-list-note">
          Filtering the {surfaceRecords.length} loaded records only — load more to search the rest.
        </p>
      )}

      {/* Paging is driven by the RAW record count, never the filtered one: a
          filter that hides every loaded row must not also hide the button that
          would load the rows it is looking for. */}
      {!done && records.length > 0 && (
        <button
          type="button"
          ref={moreRef}
          className="admin-gate-button admin-gate-button-tight wb-list-more"
          disabled={loading}
          onClick={loadMore}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}

      {/* Below the rows, and below the fold, because it is a once-a-year
          administrative chore about the PAGE this collection backs — not about
          any record in it. It used to sit between the bulk toolbar and the first
          row, 200px of card between a live Delete and the record it deletes, and
          a stop in the keyboard walk between "Select all" and row one. */}
      {surface.pageSlug &&
        (stacked ? (
          <details className="wb-list-page">
            <summary className="wb-list-page-sum">
              {surface.label} — page content
              <ChevronRight className="wb-list-page-caret" size={14} aria-hidden="true" />
            </summary>
            <PageContentPanel agent={agent} did={did} slug={surface.pageSlug} />
          </details>
        ) : (
          <PageContentPanel agent={agent} did={did} slug={surface.pageSlug} />
        ))}

      {/* Sort and visibility are set-once-then-forget controls, which is what
          lets them share one chip and one sheet and give the row back to the
          filter. Rendered only where the chip that opens it is. */}
      {stacked && (
        <AdminSheet
          id="wb-list-options"
          open={sheet === OPTIONS_SHEET}
          onClose={() => setSheet(null)}
          label="Sort and filter"
          foot={
            <button type="button" className="wb-sheet-row" onClick={() => setSheet(null)}>
              <span className="wb-sheet-row-label">Done</span>
            </button>
          }
        >
          <p className="wb-sheet-heading">Sort</p>
          <ul className="wb-sheet-list">
            {SORTS.map((option) => (
              <li key={option.key}>
                <button
                  type="button"
                  className="wb-sheet-row"
                  data-open={sort === option.key ? '' : undefined}
                  aria-pressed={sort === option.key}
                  onClick={() => setView({ sort: option.key })}
                >
                  <span className="wb-sheet-row-label">{option.label}</span>
                </button>
              </li>
            ))}
          </ul>
          {visOptions && (
            <>
              <hr className="wb-sheet-rule" />
              <p className="wb-sheet-heading">Show</p>
              <ul className="wb-sheet-list">
                {visOptions.map((option) => (
                  <li key={option.key}>
                    <button
                      type="button"
                      className="wb-sheet-row"
                      data-open={visibility === option.key ? '' : undefined}
                      aria-pressed={visibility === option.key}
                      onClick={() => setView({ visibility: option.key })}
                    >
                      <span className="wb-sheet-row-label">{option.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </AdminSheet>
      )}
    </div>
  );
}
