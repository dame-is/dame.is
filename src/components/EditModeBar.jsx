import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { FileEdit, PencilLine, Save, Trash2, X, XCircle } from 'lucide-react';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { ME_DID } from '../config.js';
import './EditModeBar.css';

/**
 * Parse an `at://<repo>/<collection>/<rkey>` URI into its parts. Returns
 * null for anything that isn't a full three-segment record URI.
 */
function parseAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  return { repo: m[1], collection: m[2], rkey: m[3] };
}

/**
 * A selected feed item may stand in for several underlying records — a
 * collapsed listening session carries its `plays`. Expand those so a bulk
 * delete removes every play in the batch, not just the representative row.
 * Only records living in the owner's own repo are eligible for deletion.
 */
function deleteTargetsForItem(item) {
  const uris =
    Array.isArray(item?.plays) && item.plays.length
      ? item.plays.map((p) => p?.atUri).filter(Boolean)
      : item?.atUri
        ? [item.atUri]
        : [];
  return uris
    .map(parseAtUri)
    .filter((t) => t && t.repo === ME_DID);
}

/**
 * Floating action bar for owner edit mode. It rides just above the bottom
 * chrome bar whenever edit mode is on, showing what's selected and the bulk
 * actions available:
 *   - Delete   — removes every selected record (batches expand to their
 *                underlying plays) from the PDS, then filters them out of the
 *                feed optimistically via `markRemoved`.
 *   - Edit     — with exactly one row selected, jumps into the admin record
 *                editor for that record.
 */
export default function EditModeBar() {
  const {
    active,
    selectedItems,
    selectedCount,
    clearSelection,
    markRemoved,
    openEditSheet,
    pageRecord,
    editSheet,
    sheetEditor,
    closeEditSheet,
    pageEditor,
  } = useEditMode();
  const { agent, did } = useAtprotoSession();
  const { closeDock } = useActionDock();
  const location = useLocation();
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const innerRef = useRef(null);

  const isOwner = did === ME_DID;

  // The single selected record, if exactly one is chosen and it lives in the
  // owner's repo (only those are quick-editable here).
  const selectedUri = selectedCount === 1 ? selectedItems[0]?.atUri : null;
  const selectedEditable = selectedUri && parseAtUri(selectedUri)?.repo === ME_DID;
  // The current page's own record — offered when nothing is selected so the
  // owner can quick-edit "this page" (blog post, home page record, …). Guard
  // on the stamped path so a stale value can't leak across a route change.
  const pageUri =
    pageRecord && pageRecord.path === location.pathname && parseAtUri(pageRecord.atUri)?.repo === ME_DID
      ? pageRecord.atUri
      : null;

  function openSheet(atUri) {
    if (!atUri) return;
    closeDock();
    openEditSheet(atUri);
  }

  // The bar hosts a record editor's Save / Delete / Close controls (the
  // editor's own buttons are hidden) whenever one publishes a controller: the
  // quick-edit sheet (`sheetEditor`) or the full admin editor page
  // (`pageEditor`). The sheet wins if both are somehow present.
  const onSheet = !!editSheet;
  const ctl = onSheet ? sheetEditor : pageEditor;
  const editing = onSheet || !!pageEditor;
  const busyEditor = ctl?.saving || ctl?.deleting;

  function closeEditor() {
    if (onSheet) closeEditSheet();
    else pageEditor?.close?.();
  }

  // Publish the bar's live height on <html> as `--edit-bar-h`. The nav dock
  // reads it to lift its sheet so it expands from on top of this bar rather
  // than straight off the bottom chrome. Measured from the inner surface
  // (full height regardless of the wrap's height-clip animation); reset to 0
  // whenever edit mode is off so the dock falls back to the bar.
  useEffect(() => {
    const root = document.documentElement;
    if (!active && !editing) {
      root.style.setProperty('--edit-bar-h', '0px');
      return undefined;
    }
    const el = innerRef.current;
    const apply = () => {
      const h = el ? el.getBoundingClientRect().height : 0;
      root.style.setProperty('--edit-bar-h', `${Math.max(0, Math.ceil(h))}px`);
    };
    apply();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    if (ro && el) ro.observe(el);
    window.addEventListener('resize', apply);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', apply);
      root.style.setProperty('--edit-bar-h', '0px');
    };
  }, [active, editing]);

  async function handleDelete() {
    if (!agent || !isOwner || selectedCount === 0) return;
    const targets = selectedItems.flatMap(deleteTargetsForItem);
    if (targets.length === 0) return;
    const noun = targets.length === 1 ? 'record' : 'records';
    if (!window.confirm(`Delete ${targets.length} ${noun}? This cannot be undone.`)) return;

    setBusy(true);
    setError(null);
    const removed = [];
    try {
      for (const t of targets) {
        // Sequential keeps the PDS write load gentle and lets a mid-batch
        // failure surface without leaving the rest in limbo.
        // eslint-disable-next-line no-await-in-loop
        await agent.com.atproto.repo.deleteRecord({
          repo: t.repo,
          collection: t.collection,
          rkey: t.rkey,
        });
        removed.push(`at://${t.repo}/${t.collection}/${t.rkey}`);
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      // Filter out whatever DID get deleted, even on a partial failure, and
      // also drop the selected rows' representative URIs so collapsed
      // batches vanish from the feed too.
      if (removed.length) {
        markRemoved(removed);
        markRemoved(selectedItems.map((i) => i.atUri).filter(Boolean));
      }
      clearSelection();
      setBusy(false);
    }
  }

  return (
    <AnimatePresence initial={false}>
      {(active || editing) && (
        <motion.div
          className="edit-mode-bar-wrap"
          initial={{ height: 0 }}
          animate={{ height: 'auto' }}
          exit={{ height: 0 }}
          transition={{ duration: reduce ? 0 : 0.34, ease: [0.32, 0.72, 0, 1] }}
        >
          <div
            className="edit-mode-bar-inner"
            ref={innerRef}
            role="toolbar"
            aria-label="Edit mode actions"
          >
            <div className="edit-mode-bar-status">
              {editing ? (
                <span className="edit-mode-bar-count">Editing record</span>
              ) : selectedCount > 0 ? (
                <span className="edit-mode-bar-count">
                  <strong>{selectedCount}</strong> selected
                </span>
              ) : (
                <span className="edit-mode-bar-hint">Tap items to select</span>
              )}
              {error && <span className="edit-mode-bar-error">{error}</span>}
            </div>
            <div className="edit-mode-bar-actions">
              {editing ? (
                <>
                  <button
                    type="button"
                    className="edit-mode-bar-btn edit-mode-bar-clear"
                    onClick={closeEditor}
                    disabled={busyEditor}
                  >
                    <X size={15} strokeWidth={1.75} aria-hidden="true" />
                    <span>Close</span>
                  </button>
                  {ctl?.canDelete && (
                    <button
                      type="button"
                      className="edit-mode-bar-btn edit-mode-bar-delete"
                      onClick={() => ctl.remove()}
                      disabled={busyEditor || ctl.loading}
                    >
                      <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                      <span>{ctl.deleting ? 'Deleting…' : 'Delete'}</span>
                    </button>
                  )}
                  {ctl && (
                    <button
                      type="button"
                      className="edit-mode-bar-btn edit-mode-bar-save"
                      onClick={() => ctl.save()}
                      disabled={busyEditor || ctl.loading}
                    >
                      <Save size={15} strokeWidth={1.75} aria-hidden="true" />
                      <span>
                        {ctl.saving
                          ? ctl.isNew
                            ? 'Creating…'
                            : 'Saving…'
                          : ctl.isNew
                            ? 'Create'
                            : 'Save'}
                      </span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  {selectedCount > 0 && (
                    <button
                      type="button"
                      className="edit-mode-bar-btn edit-mode-bar-clear"
                      onClick={clearSelection}
                      disabled={busy}
                    >
                      <XCircle size={15} strokeWidth={1.75} aria-hidden="true" />
                      <span>Clear</span>
                    </button>
                  )}
                  {/* Quick-edit: the single selected record, or — with nothing
                      selected — the current page's own record. */}
                  {selectedCount === 1 && selectedEditable && (
                    <button
                      type="button"
                      className="edit-mode-bar-btn"
                      onClick={() => openSheet(selectedUri)}
                      disabled={busy}
                    >
                      <PencilLine size={15} strokeWidth={1.75} aria-hidden="true" />
                      <span>Edit</span>
                    </button>
                  )}
                  {selectedCount === 0 && pageUri && (
                    <button
                      type="button"
                      className="edit-mode-bar-btn"
                      onClick={() => openSheet(pageUri)}
                    >
                      <FileEdit size={15} strokeWidth={1.75} aria-hidden="true" />
                      <span>Edit page</span>
                    </button>
                  )}
                  {selectedCount > 0 && (
                    <button
                      type="button"
                      className="edit-mode-bar-btn edit-mode-bar-delete"
                      onClick={handleDelete}
                      disabled={busy}
                    >
                      <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                      <span>{busy ? 'Deleting…' : 'Delete'}</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
