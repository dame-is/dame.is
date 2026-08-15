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

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
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

/** A fresh "start from the top of every teal play lexicon" cursor map. */
function initialTealCursors() {
  return Object.fromEntries(TEAL_PLAY_NSIDS.map((nsid) => [nsid, undefined]));
}

export default function ListeningManager({ agent, did }) {
  const { invalidate } = useAdminShell();
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
  const done = Object.keys(cursors).length === 0;

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

  async function bulkDelete() {
    const rkeys = Array.from(selected);
    if (rkeys.length === 0) return;
    const noun = rkeys.length === 1 ? 'play' : 'plays';
    if (!window.confirm(`Delete ${rkeys.length} ${noun}? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    const deleted = new Set();
    // A row's lexicon comes from its own URI — the selected rkeys can span
    // both teal namespaces, and deleting from the wrong one is a no-op that
    // reads as a successful delete.
    const collectionOf = new Map(
      records.map((rec) => [rkeyFromUri(rec.uri), nsidFromAtUri(rec.uri)]),
    );
    try {
      for (const rkey of rkeys) {
        const collection = collectionOf.get(rkey);
        if (!collection) continue;
        // eslint-disable-next-line no-await-in-loop
        await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
        deleted.add(rkey);
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setRecords((prev) => prev.filter((r) => !deleted.has(rkeyFromUri(r.uri))));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const k of deleted) next.delete(k);
        return next;
      });
      setDeleting(false);
      // A bulk delete is the one action here that moves a number the rest of the
      // admin caches — the rail's presence dot and the Front Desk's play count
      // hold for a minute, and "I just deleted 200 plays" is precisely when a
      // stale count is noticed.
      if (deleted.size > 0) invalidate(TEAL_PLAY_NSIDS);
    }
  }

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

      <div className="admin-multiselect-toolbar">
        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={records.length === 0}
          />
          <span>{allSelected ? 'Deselect all' : 'Select all loaded'}</span>
        </label>
        <span className="admin-multiselect-count">
          {selected.size > 0 ? `${selected.size} selected` : `${records.length} loaded`}
        </span>
        <button
          type="button"
          className="admin-gate-button admin-gate-button-tight admin-danger"
          onClick={bulkDelete}
          disabled={deleting || selected.size === 0}
        >
          {deleting ? 'Deleting…' : `Delete${selected.size ? ` (${selected.size})` : ''}`}
        </button>
      </div>

      {loading && records.length === 0 ? (
        <AdminRecordListSkeleton rows={8} label="Loading plays" />
      ) : records.length === 0 && !error ? (
        <p className="placeholder-card">No plays yet.</p>
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
                <label className="admin-checkbox admin-multiselect-check">
                  <input type="checkbox" checked={checked} onChange={() => toggle(rkey)} />
                  <span className="admin-record-preview">{playLabel(rec.value)}</span>
                </label>
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

      {!done && records.length > 0 && (
        <button
          type="button"
          className="admin-gate-button admin-gate-button-tight"
          disabled={loading}
          onClick={() => loadPage(cursors, true)}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </>
  );
}
