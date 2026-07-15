import { useEffect } from 'react';
import { X } from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import DebugPane from './DebugPane.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import './DebugSheet.css';

/**
 * The atmosphere readout for the current route — at-uri, cid, lexicon, pds,
 * the raw record, and (for the owner) an inline editor. Once a sub-view of the
 * nav dock, it's now its own sheet: the marquee way in is the inspect HUD's
 * "details" affordance, so the data view belongs to the inspect experience,
 * not the site menu. Expands up out of the bottom chrome on the shared
 * BottomSheet, coordinated with the other panels + the dock by useChromePanel.
 *
 * Owns the `?` shortcut, which toggles this sheet from anywhere in the app
 * (ignoring keystrokes inside text inputs).
 */
export default function DebugSheet() {
  const { panel, togglePanel, closePanel } = useChromePanel();
  const open = panel === 'debug';

  useEffect(() => {
    function onKey(e) {
      if (e.key !== '?') return;
      const tag = e.target?.tagName;
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable;
      if (editing) return;
      e.preventDefault();
      togglePanel('debug');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePanel]);

  return (
    <BottomSheet
      open={open}
      onClose={closePanel}
      label="atmosphere · this page"
      id="chrome-debug-sheet"
      size="fill"
      className="debug-sheet-panel"
    >
      <div className="debug-sheet-header">
        <span className="small-caps">atmosphere · this page</span>
        <button
          type="button"
          className="debug-sheet-close"
          onClick={closePanel}
          aria-label="Close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <DebugPane onClose={closePanel} />
    </BottomSheet>
  );
}
