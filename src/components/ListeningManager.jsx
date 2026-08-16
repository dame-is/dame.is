// Listening studio: every teal.fm play on the PDS, with always-on multiselect
// for bulk deletion and a per-row link into the generic record editor.
//
// Lifted out of src/pages/Admin.jsx. The paging, selection and delete logic is
// verbatim; what changed is only its frame — see the studio note below.
//
// It stays bespoke rather than becoming a generic record list for two reasons
// the generic list cannot express:
//
//  - **Dual-namespace paging.** The archive spans teal.fm's alpha → production
//    namespace move, so there is one cursor PER NSID and "Load more" only stops
//    offering itself when both are exhausted.
//  - **Per-row NSID resolution on delete.** A row's lexicon comes from its own
//    at-uri, because the selected rkeys can span both namespaces and deleting
//    from the wrong one is a silent no-op that reads as a successful delete.
//
// As a studio it is a BODY, not a page: StudioPane draws the title, the blurb
// and the surface's NSID, and the rail is the way back — so there is no
// PageShell, no "← All collections" link and no second `<h1>` here. It registers
// nothing with the status strip: its Delete acts on a SELECTION, not on the
// record the pane is editing, which is what the strip's Delete means.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { rkeyFromUri } from './RecordEditor.jsx';
import { AdminRecordListSkeleton } from './Skeleton.jsx';
import { useAdminShell } from '../admin/useAdminShell.jsx';
import { nsidFromAtUri } from '../lib/verbRegistry.js';
import {
  TEAL_PLAY_NSIDS,
  comparePlaysDesc,
  dedupePlaysByRkey,
  playArtistLine,
  playedAtOf,
  playTrackName,
} from '../lib/teal.js';

/** Short human label for a play record value: "Track · Artist". */
function playLabel(value) {
  if (!value || typeof value !== 'object') return '';
  return (
    [playTrackName(value), playArtistLine(value)].filter(Boolean).join(' · ') ||
    '(untitled play)'
  );
}

/**
 * When the play happened, short enough for a gutter column: "14 Aug, 18:22".
 *
 * Without it 240 rows are eight repeating strings — the fixture's Grouper /
 * Duster / Low cycle over and over, with nothing to tell row 3 from row 91,
 * which is precisely the information a bulk-delete list has to carry. The time
 * is on every record (`playedTime`) and was the only field never shown.
 *
 * 24-hour, no year, no seconds: the column has to stay narrower than the track
 * name beside it, and a play archive is read by "which evening", not by year.
 */
function playedAtLabel(value) {
  const iso = playedAtOf(value);
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** A fresh "start from the top of every teal play lexicon" cursor map. */
function initialTealCursors() {
  return Object.fromEntries(TEAL_PLAY_NSIDS.map((nsid) => [nsid, undefined]));
}

export default function ListeningManager({ agent, did }) {
  const { invalidate, stacked, registerBar } = useAdminShell();
  const [records, setRecords] = useState([]);
  // One cursor per teal.fm play lexicon: the archive spans the alpha →
  // production namespace move, and each collection paginates on its own. A
  // collection drops out of the map once it's exhausted, so "Load more" stops
  // offering itself only when BOTH are done.
  const [cursors, setCursors] = useState(() => initialTealCursors());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Set of selected rkeys.
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);
  // How far a bulk delete has got: { done, total }. A serial delete of 100 rows
  // takes ~12s at the harness default and ~24s for 200, and the only feedback
  // used to be a static "Deleting…" on a button that may itself have scrolled
  // off — nothing on the screen moved for the whole run.
  const [progress, setProgress] = useState(null);
  // Read between calls so a run can be stopped without abandoning the rows
  // already deleted. A ref, not state: the loop needs the value as of NOW, and
  // a state read inside an async loop is the value as of the render that
  // started it.
  const cancelRef = useRef(false);
  const done = Object.keys(cursors).length === 0;

  // The two long-running controls both used to drop keyboard focus on the
  // floor: `disabled` on a focused element blurs it, activeElement falls back
  // to <body>, and getting back to "Load more" meant tabbing past 200
  // checkboxes and 200 edit links. Each button flags itself here when it is the
  // one that started the work, and takes focus back when the work ends.
  const loadMoreRef = useRef(null);
  const deleteRef = useRef(null);
  const selectAllRef = useRef(null);
  const refocusRef = useRef(null);
  const takeFocusBack = useCallback((ref) => {
    refocusRef.current = ref;
  }, []);
  useEffect(() => {
    if (loading || deleting) return;
    const wanted = refocusRef.current;
    if (!wanted) return;
    refocusRef.current = null;
    // Only if focus really is nowhere: an owner who has moved on since pressing
    // the button should not have the page snatch the caret back.
    if (document.activeElement && document.activeElement !== document.body) return;
    // The button that started the work is the first choice, but it is often
    // gone or disabled by the time the work ends — Delete disables itself the
    // moment its selection empties, and `focus()` on a disabled control is a
    // no-op that leaves the caret on <body>. Select-all is the fallback:
    // still enabled, in the same toolbar, one Tab from everything else.
    for (const ref of [wanted, selectAllRef]) {
      const el = ref?.current;
      if (el && !el.disabled) {
        el.focus();
        return;
      }
    }
  }, [loading, deleting]);

  // "Load more" appends a whole page ABOVE itself — the list is sorted newest
  // first and a page is older — so the button moved 3,939px down the pane and
  // out from under the pointer that had just pressed it, while the scroll
  // offset stayed where it was. Measuring the button before and after the
  // append and adding the difference to the scrollport keeps it exactly where
  // it was on screen, which is what makes three round trips through 240 records
  // bearable.
  const anchorRef = useRef(null);
  useEffect(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    const btn = loadMoreRef.current;
    if (anchor == null || !btn) return;
    const pane = btn.closest('.wb-pane-detail');
    if (!pane) return;
    const delta = btn.getBoundingClientRect().top - anchor;
    if (delta) pane.scrollTop += delta;
  }, [records]);

  const loadPage = useCallback(
    async (pending, append) => {
      setLoading(true);
      setError(null);
      try {
        const pages = await Promise.all(
          Object.entries(pending).map(async ([collection, cursor]) => {
            const res = await agent.com.atproto.repo.listRecords({
              repo: did,
              collection,
              limit: 100,
              cursor: cursor || undefined,
            });
            const next = res?.data || res;
            return { collection, records: next?.records || [], cursor: next?.cursor || null };
          }),
        );
        const batch = pages.flatMap((page) => page.records);
        setRecords((prev) =>
          dedupePlaysByRkey([...(append ? prev : []), ...batch]).sort(comparePlaysDesc),
        );
        setCursors(
          Object.fromEntries(
            pages
              .filter((page) => page.cursor && page.records.length > 0)
              .map((page) => [page.collection, page.cursor]),
          ),
        );
      } catch (err) {
        setError(err?.message || String(err));
      } finally {
        setLoading(false);
      }
    },
    [agent, did],
  );

  useEffect(() => {
    setRecords([]);
    setCursors(initialTealCursors());
    setSelected(new Set());
    loadPage(initialTealCursors(), false);
  }, [loadPage]);

  const toggle = useCallback((rkey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rkey)) next.delete(rkey);
      else next.add(rkey);
      return next;
    });
  }, []);

  const allRkeys = useMemo(() => records.map((r) => rkeyFromUri(r.uri)), [records]);
  const allSelected = allRkeys.length > 0 && allRkeys.every((k) => selected.has(k));

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (allRkeys.length > 0 && allRkeys.every((k) => prev.has(k))) return new Set();
      return new Set(allRkeys);
    });
  }, [allRkeys]);

  const bulkDelete = useCallback(
    async ({ confirmed = false } = {}) => {
      const rkeys = Array.from(selected);
      if (rkeys.length === 0) return;
      const noun = rkeys.length === 1 ? 'play' : 'plays';
      // `confirmed` is how the action bar hands this the answer it already
      // asked for (BarAction.confirm), so a phone is not asked twice.
      if (!confirmed && !window.confirm(`Delete ${rkeys.length} ${noun}? This cannot be undone.`))
        return;
      setDeleting(true);
      setError(null);
      cancelRef.current = false;
      setProgress({ done: 0, total: rkeys.length });
      const deleted = new Set();
      // A row's lexicon comes from its own URI — the selected rkeys can span
      // both teal namespaces, and deleting from the wrong one is a no-op that
      // reads as a successful delete.
      const collectionOf = new Map(
        records.map((rec) => [rkeyFromUri(rec.uri), nsidFromAtUri(rec.uri)]),
      );
      // Whether this run empties the visible list is decided against the list
      // as it stood when the run began; `records` inside the loop is a stale
      // closure by design, and this is the one number that has to be right.
      const startedWith = records.length;
      try {
        for (const rkey of rkeys) {
          if (cancelRef.current) break;
          const collection = collectionOf.get(rkey);
          if (!collection) continue;
          // Serial on purpose: image-free but write-heavy, and a parallel burst
          // of 200 deletes is how a PDS starts refusing them.
          await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
          deleted.add(rkey);
          // Row by row rather than in one setRecords at the end: a list that
          // shrinks IS the progress bar, and a 24-second run where nothing
          // moves reads as a hang.
          setRecords((prev) => prev.filter((r) => rkeyFromUri(r.uri) !== rkey));
          setSelected((prev) => {
            const next = new Set(prev);
            next.delete(rkey);
            return next;
          });
          setProgress({ done: deleted.size, total: rkeys.length });
        }
      } catch (err) {
        setError(err?.message || String(err));
      } finally {
        setDeleting(false);
        setProgress(null);
        cancelRef.current = false;
        // A bulk delete is the one action here that moves a number the rest of the
        // admin caches — the rail's presence dot and the Front Desk's play count
        // hold for a minute, and "I just deleted 200 plays" is precisely when a
        // stale count is noticed.
        if (deleted.size > 0) invalidate(TEAL_PLAY_NSIDS);
        // Deleting every LOADED play is not deleting every play. With 240 on
        // the PDS and 100 loaded, emptying the list used to leave "0 loaded",
        // "No plays yet." and no pager — 140 records still there and no way
        // back to them short of a page reload, because the pager was gated on
        // `records.length > 0`. The gate is gone (below) and the next page is
        // fetched straight away, so the list refills instead of lying.
        if (deleted.size === startedWith && Object.keys(cursors).length > 0) {
          loadPage(cursors, true);
        }
      }
    },
    [agent, did, selected, records, cursors, invalidate, loadPage],
  );

  const loadMore = useCallback(() => {
    const btn = loadMoreRef.current;
    anchorRef.current = btn ? btn.getBoundingClientRect().top : null;
    takeFocusBack(loadMoreRef);
    loadPage(cursors, true);
  }, [cursors, loadPage, takeFocusBack]);

  // Slot 3 of the frame's action bar, so the phone's Delete is not a control
  // that has scrolled two screens up the list (§6 of the mobile design). Both
  // handlers reach the live function through a ref: `bulkDelete` closes over
  // `records`, which changes once per deleted row, and a fresh function in this
  // effect's deps would re-register the bar a hundred times mid-run for no
  // change in what it draws. Registered at every width — the bar is only
  // rendered below 60rem.
  const bulkRef = useRef(bulkDelete);
  bulkRef.current = bulkDelete;
  const onBulkDelete = useCallback(() => {
    takeFocusBack(deleteRef);
    bulkRef.current({ confirmed: true });
  }, [takeFocusBack]);
  const selectedCount = selected.size;
  const loadedCount = records.length;
  const status = deleting
    ? `Deleting ${progress?.done ?? 0} of ${progress?.total ?? selectedCount}…`
    : selectedCount > 0
      ? `${selectedCount} selected`
      : `${loadedCount} loaded${done ? '' : ' · more to fetch'}`;
  useEffect(() => {
    const noun = selectedCount === 1 ? 'play' : 'plays';
    registerBar({
      status,
      actions:
        selectedCount > 0
          ? [
              {
                id: 'bulk-delete',
                label: `Delete (${selectedCount})`,
                tone: 'danger',
                onPress: onBulkDelete,
                busy: deleting,
                busyLabel: 'Deleting…',
                confirm: `Delete ${selectedCount} ${noun}? This cannot be undone.`,
              },
            ]
          : done
            ? []
            : [
                {
                  id: 'load-more',
                  label: 'Load more',
                  onPress: loadMore,
                  busy: loading,
                  busyLabel: 'Loading…',
                },
              ],
    });
    return () => registerBar(null);
  }, [registerBar, status, selectedCount, done, deleting, loading, onBulkDelete, loadMore]);

  return (
    <>
      {/* The pane head names this surface's primary NSID. The archive spans two
          of them — teal.fm's alpha → production move — and every row is deleted
          from its own, so the second namespace is a fact about this studio
          rather than a detail to leave invisible.

          A div rather than a p: it sits directly after the pane's blurb
          paragraph, and typography.css indents `p + p` by 1.5em — correct for
          running prose, wrong for a labelled row of NSIDs that has to line up
          with the toolbar under it. */}
      <div className="admin-field-hint">
        Two lexicons, one archive:{' '}
        {TEAL_PLAY_NSIDS.map((nsid, i) => (
          <Fragment key={nsid}>
            {i > 0 && ' · '}
            <code className="admin-collection-nsid">{nsid}</code>
          </Fragment>
        ))}
      </div>

      {error && <p className="admin-error">{error}</p>}

      {/* Below 60rem the count and the Delete are slots 2 and 3 of the frame's
          action bar, so the toolbar keeps only the one control the bar has no
          room for. Drawing them here as well would state the same number twice
          on a 390px screen and put a destructive button two screens above the
          bar that already carries it. */}
      <div className="admin-multiselect-toolbar">
        <label className="admin-checkbox">
          <input
            type="checkbox"
            ref={selectAllRef}
            checked={allSelected}
            onChange={toggleAll}
            disabled={records.length === 0}
          />
          <span>{allSelected ? 'Deselect all' : 'Select all loaded'}</span>
        </label>
        {/* aria-live, because a bulk delete moves this number a hundred times
            and a screen reader had no other way to know the work had happened. */}
        {stacked ? null : (
          <span className="admin-multiselect-count" aria-live="polite">
            {status}
          </span>
        )}
        {stacked ? null : (
          <button
            type="button"
            className="admin-gate-button admin-gate-button-tight admin-danger"
            ref={deleteRef}
            onClick={() => {
              takeFocusBack(deleteRef);
              bulkDelete();
            }}
            disabled={deleting || selected.size === 0}
          >
            {deleting
              ? `Deleting ${progress?.done ?? 0} of ${progress?.total ?? selected.size}…`
              : `Delete${selected.size ? ` (${selected.size})` : ''}`}
          </button>
        )}
        {/* A serial delete of 200 records is a minute of work with no way out
            of it. Cancel stops the loop between calls; everything already
            deleted stays deleted, which is the only honest offer. */}
        {deleting && (
          <button
            type="button"
            className="admin-link-subtle"
            onClick={() => {
              cancelRef.current = true;
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {loading && records.length === 0 ? (
        <AdminRecordListSkeleton rows={8} label="Loading plays" />
      ) : records.length === 0 && !error ? (
        // Two different empty lists, and they used to read the same. "No plays
        // yet." is only true when both lexicons are exhausted; with a live
        // cursor still in hand it means "none LOADED", which is what an
        // owner sees for a moment after deleting every row on screen.
        <p className="placeholder-card">
          {done
            ? 'No plays yet.'
            : 'Nothing loaded from this page. There are more plays on the PDS — load them below.'}
        </p>
      ) : (
        <ul className="admin-record-list reveal-stagger">
          {records.map((rec) => {
            const rkey = rkeyFromUri(rec.uri);
            const collection = nsidFromAtUri(rec.uri);
            const checked = selected.has(rkey);
            return (
              <li
                key={rec.uri}
                className={`admin-record-row admin-multiselect-row${checked ? ' is-selected' : ''}`}
              >
                <label
                  className="admin-checkbox admin-multiselect-check"
                  // The one inline style in this file. It belongs to THIS row
                  // rather than to `.admin-multiselect-check`, which the public
                  // quick-edit sheet also renders, and this studio has no
                  // stylesheet of its own to scope it in.
                  //
                  // WHY: below 60rem the shell centres a clamped studio with
                  // `margin-inline: auto`, and an auto inline margin disables
                  // flex `stretch` — so `.wb-studio` takes its own MIN-CONTENT
                  // size and anything wider than the pane scrolls the whole
                  // pane sideways instead of truncating. `flex: 1` sets a
                  // flex-basis of 0 but leaves `width: auto`, so this label's
                  // min-content contribution was the full un-truncated track
                  // name: the row's min-content was already 357.8px against a
                  // 358px pane at 390, and the played-at column plus the
                  // release name took it to 460.2. A definite `width` is what
                  // makes that contribution 0; `flex: 1` still grows the label
                  // back to fill the row. Measured: pane scrollWidth 492 → 390
                  // at 390 and 369 → 320 at 320, row height unchanged at 60px.
                  style={{ width: 0 }}
                >
                  <input type="checkbox" checked={checked} onChange={() => toggle(rkey)} />
                  <span className="admin-record-preview">
                    {playLabel(rec.value)}
                    {rec.value?.releaseName ? (
                      <span className="admin-field-hint"> · {rec.value.releaseName}</span>
                    ) : null}
                  </span>
                </label>
                {/* `.admin-record-time` is the record list's own right-hand
                    timestamp column — mono, faint, nowrap, flush against the
                    action link — which is exactly the column this list was
                    missing. */}
                <span className="admin-record-time">{playedAtLabel(rec.value)}</span>
                <Link
                  to={`/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(rkey)}`}
                  className="admin-link-subtle admin-multiselect-edit"
                >
                  Edit →
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Gated on `!done` ALONE. With `&& records.length > 0` the pager was
          hidden precisely when it was needed most — an emptied list with a live
          cursor still in `cursors` — and 140 unloaded records became
          unreachable without a page reload. */}
      {!done && (
        <button
          type="button"
          className="admin-gate-button admin-gate-button-tight"
          ref={loadMoreRef}
          disabled={loading}
          onClick={loadMore}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </>
  );
}
