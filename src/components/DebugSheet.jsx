import { memo, useEffect } from 'react';
import BottomSheet from './BottomSheet.jsx';
import DebugPane from './DebugPane.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { shortcutBlocked } from '../lib/shortcuts.js';
import './DebugSheet.css';

// Where focus lands when the sheet closes and its opener is gone. The usual
// opener is the inspect HUD's "details" button, and the HUD stands aside while
// a sheet is up, so that button is unmounted by the time the sheet closes; the
// HUD comes back in the same commit, so its new button is there to take it.
// Failing that (opened with `?`, x-ray off), the bar's inspect toggle.
function detailsTrigger() {
  return (
    document.querySelector('.xray-hud-inspect') ||
    document.querySelector('.chrome-xray')
  );
}

/**
 * The atmosphere readout for the current route — at-uri, cid, lexicon, pds,
 * the raw record, and (for the owner) an inline editor. Once a sub-view of the
 * nav dock, it's now its own sheet: the marquee way in is the inspect HUD's
 * "details" affordance, so the data view belongs to the inspect experience,
 * not the site menu. Expands up out of the bottom chrome on the shared
 * BottomSheet, coordinated with the other panels + the dock by useChromePanel.
 *
 * Owns the `?` shortcut, which toggles this sheet from anywhere in the app
 * (ignoring typing, chords, auto-repeat, and keys pressed under a modal — see
 * shortcutBlocked).
 *
 * Memoised: it takes no props, and the bottom bar that renders it re-renders
 * as the page scrolls.
 */
function DebugSheet() {
  const { panel, togglePanel, closePanel } = useChromePanel();
  const open = panel === 'debug';

  useEffect(() => {
    function onKey(e) {
      if (e.key !== '?') return;
      if (shortcutBlocked(e)) return;
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
      title="atmosphere · this page"
      id="chrome-debug-sheet"
      size="fill"
      className="debug-sheet-panel"
      bodyClassName="debug-sheet-content"
      restoreFocusTo={detailsTrigger}
    >
      <DebugPane onClose={closePanel} />
    </BottomSheet>
  );
}

export default memo(DebugSheet);
