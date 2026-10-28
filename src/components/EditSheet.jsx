import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { ExternalLink, X } from 'lucide-react';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { usePreventScrollChain } from '../hooks/usePreventScrollChain.js';
import { useEscapeLayer } from '../hooks/useEscapeLayer.js';
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
  const {
    editSheet,
    closeEditSheet,
    discardEditSheet,
    confirmSheetDiscard,
    setSheetDirty,
    markRemoved,
    clearSelection,
    exit,
    setSheetEditor,
  } = useEditMode();
  const { agent, did } = useAtprotoSession();
  const reduce = useReducedMotion();
  // Imperative handle into the editor + its live status, so the edit action
  // bar can host the Save / Delete controls instead of the sheet itself.
  const editorRef = useRef(null);
  // The sheet panel — focus trap target on open.
  const panelRef = useRef(null);
  // Keep a touch-drag inside the sheet body from scrolling the page behind
  // it when the form fits without overflowing.
  const bodyRef = useRef(null);
  usePreventScrollChain(bodyRef, !!editSheet);
  // Focus into the sheet on open, trap Tab within it, restore focus on close.
  // Deliberately NOT focus-trapped: this is a non-modal dialog (role="dialog"
  // without aria-modal). Its primary Save / Delete controls live in the
  // separate edit action bar OUTSIDE this panel, so trapping Tab inside the
  // panel would make those actions keyboard-unreachable. The genuine modals
  // (BottomSheet / Modal / ActionDock) keep the trap.
  const [editorStatus, setEditorStatus] = useState({
    saving: false,
    deleting: false,
    loading: true,
    isNew: false,
  });
  const handleStatus = useCallback((s) => setEditorStatus(s), []);
  // Straight into the context's ref, so every way of closing the sheet can ask
  // before it throws the edits away (useEditMode's `closeEditSheet`).
  const handleDirty = useCallback(
    (d) => setSheetDirty(d?.dirty),
    [setSheetDirty],
  );

  // The nav dock and this sheet share the same slot above the chrome, so the
  // menu opening folds the sheet away. That is the provider's to do, not this
  // effect's: it leaves edit mode for the same reason, and it asks first when
  // the sheet holds unsaved edits (useEditMode.jsx).

  // Esc closes the sheet — unless something inside it already used the key. The
  // blocks editor spends Esc on closing its insert palette, and the same press
  // used to carry on up to here and close the whole sheet behind it. Through the
  // shared Escape stack rather than a listener of its own, so a sheet opened over
  // this one takes the press first, and one press closes one overlay.
  useEscapeLayer(!!editSheet, (e) => {
    if (!e.defaultPrevented) closeEditSheet();
  });

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
            <div
              ref={panelRef}
              className="edit-sheet-panel"
              role="dialog"
              aria-label="Quick edit record"
            >
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

              <div ref={bodyRef} className="edit-sheet-body">
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
                    onDirtyChange={handleDirty}
                    onDeleted={() => {
                      markRemoved(editSheet.atUri);
                      clearSelection();
                      discardEditSheet();
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
                    onClick={(e) => {
                      // The full editor loads the record afresh, so anything
                      // typed here does not travel with it.
                      if (!confirmSheetDiscard()) {
                        e.preventDefault();
                        return;
                      }
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
