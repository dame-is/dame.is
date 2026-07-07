import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ExternalLink, X } from 'lucide-react';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { useActionDock } from '../hooks/useActionDock.jsx';
import RecordEditor from './RecordEditor.jsx';
import { lexiconFor } from '../lib/lexicons.js';
import { ME_DID } from '../config.js';
import './EditSheet.css';

function parseAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/);
  if (!m) return null;
  return { repo: m[1], collection: m[2], rkey: m[3] };
}

/**
 * Quick-edit sheet for owner edit mode. Like the nav dock, it expands UPWARD
 * out of the bottom chrome (from on top of the edit action bar) and lets the
 * owner edit the contents / metadata of a record inline — either the actively
 * selected record or the current page's own record — without leaving the page.
 * A footer link hands off to the full editor in the admin panel.
 */
export default function EditSheet() {
  const { editSheet, closeEditSheet, markRemoved, clearSelection, exit, setSheetEditor } =
    useEditMode();
  const { agent, did } = useAtprotoSession();
  const { open: dockOpen } = useActionDock();
  const reduce = useReducedMotion();
  // Imperative handle into the editor + its live status, so the edit action
  // bar can host the Save / Delete controls instead of the sheet itself.
  const editorRef = useRef(null);
  const [editorStatus, setEditorStatus] = useState({
    saving: false,
    deleting: false,
    loading: true,
    isNew: false,
  });
  const handleStatus = useCallback((s) => setEditorStatus(s), []);

  // The nav dock and this sheet share the same slot above the chrome; if the
  // menu opens, fold the sheet away so they never stack.
  useEffect(() => {
    if (dockOpen && editSheet) closeEditSheet();
  }, [dockOpen, editSheet, closeEditSheet]);

  // Esc closes the sheet.
  useEffect(() => {
    if (!editSheet) return undefined;
    function onKey(e) {
      if (e.key === 'Escape') closeEditSheet();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editSheet, closeEditSheet]);

  const parts = editSheet ? parseAtUri(editSheet.atUri) : null;
  // Only the owner's own records are quick-editable here.
  const editable = parts && parts.repo === ME_DID && agent && did === ME_DID;
  const lex = parts ? lexiconFor(parts.collection) : null;
  const adminHref =
    parts && `/admin?c=${encodeURIComponent(parts.collection)}&r=${encodeURIComponent(parts.rkey)}`;

  // Publish the editor controller (save/delete + status) to the action bar
  // while an editable sheet is open; clear it otherwise and on unmount.
  useEffect(() => {
    if (!editSheet || !editable) {
      setSheetEditor(null);
      return undefined;
    }
    setSheetEditor({
      save: () => editorRef.current?.save(),
      remove: () => editorRef.current?.remove(),
      saving: editorStatus.saving,
      deleting: editorStatus.deleting,
      loading: editorStatus.loading,
      canDelete: !editorStatus.isNew,
    });
    return () => setSheetEditor(null);
  }, [editSheet, editable, editorStatus, setSheetEditor]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <AnimatePresence>
        {editSheet && (
          <motion.div
            key="edit-sheet-backdrop"
            className="edit-sheet-backdrop"
            onClick={closeEditSheet}
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {editSheet && (
          <motion.div
            key="edit-sheet"
            className="edit-sheet-wrap"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: reduce ? 0 : 0.34, ease: [0.32, 0.72, 0, 1] }}
          >
            <div className="edit-sheet-panel" role="dialog" aria-label="Quick edit record">
              <div className="edit-sheet-head">
                <div className="edit-sheet-titles">
                  <span className="edit-sheet-title">{lex?.label || 'Record'}</span>
                  {parts && <code className="edit-sheet-rkey">{parts.rkey}</code>}
                </div>
                <button
                  type="button"
                  className="edit-sheet-close"
                  onClick={closeEditSheet}
                  aria-label="Close quick edit"
                >
                  <X size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>

              <div className="edit-sheet-body">
                {editable ? (
                  <RecordEditor
                    key={editSheet.atUri}
                    ref={editorRef}
                    agent={agent}
                    did={did}
                    collection={parts.collection}
                    rkey={parts.rkey}
                    compact
                    hideActions
                    onStatus={handleStatus}
                    onDeleted={() => {
                      markRemoved(editSheet.atUri);
                      clearSelection();
                      closeEditSheet();
                    }}
                  />
                ) : (
                  <p className="placeholder-card">
                    {agent
                      ? 'This record lives in another repo and can’t be edited here.'
                      : 'Sign in as the owner to edit this record.'}
                  </p>
                )}
              </div>

              {adminHref && (
                <div className="edit-sheet-foot">
                  <Link
                    to={adminHref}
                    className="edit-sheet-admin-link"
                    onClick={() => {
                      // Leaving for the full editor ends edit mode so we don't
                      // land on the admin page still in a selection state.
                      // (The Link handles the navigation itself.)
                      exit();
                    }}
                  >
                    Open in full editor
                    <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
                  </Link>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
