import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { PencilLine, Trash2, XCircle } from 'lucide-react';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
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
  const { active, selectedItems, selectedCount, clearSelection, markRemoved, exit } = useEditMode();
  const { agent, did } = useAtprotoSession();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isOwner = did === ME_DID;

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

  function handleEditSingle() {
    if (selectedCount !== 1) return;
    const parts = parseAtUri(selectedItems[0]?.atUri);
    if (!parts) return;
    exit();
    navigate(
      `/admin?c=${encodeURIComponent(parts.collection)}&r=${encodeURIComponent(parts.rkey)}`,
    );
  }

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          className="edit-mode-bar"
          role="toolbar"
          aria-label="Edit mode actions"
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
          transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <div className="edit-mode-bar-inner">
            <div className="edit-mode-bar-status">
              {selectedCount > 0 ? (
                <span className="edit-mode-bar-count">
                  <strong>{selectedCount}</strong> selected
                </span>
              ) : (
                <span className="edit-mode-bar-hint">Tap items to select</span>
              )}
              {error && <span className="edit-mode-bar-error">{error}</span>}
            </div>
            <div className="edit-mode-bar-actions">
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
              {selectedCount === 1 && (
                <button
                  type="button"
                  className="edit-mode-bar-btn"
                  onClick={handleEditSingle}
                  disabled={busy}
                >
                  <PencilLine size={15} strokeWidth={1.75} aria-hidden="true" />
                  <span>Edit</span>
                </button>
              )}
              <button
                type="button"
                className="edit-mode-bar-btn edit-mode-bar-delete"
                onClick={handleDelete}
                disabled={busy || selectedCount === 0}
              >
                <Trash2 size={15} strokeWidth={1.75} aria-hidden="true" />
                <span>{busy ? 'Deleting…' : 'Delete'}</span>
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
