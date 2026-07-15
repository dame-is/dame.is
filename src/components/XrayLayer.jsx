import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Microscope } from 'lucide-react';
import { useXray } from '../hooks/useXray.jsx';
import { useAtUri } from '../hooks/useAtUri.js';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { explorerPathFromAtUri } from '../lib/atproto.js';
import { AtUriMono } from './XraySubstrate.jsx';
import './BottomSheet.css';

/**
 * Global x-ray furniture, portaled to <body> so no transformed route ancestor
 * traps its fixed positioning: the page HUD — a status strip naming the record
 * backing the whole page — which expands up out of the bottom chrome while the
 * mode is on. Split into its own component so useAtUri's PDS/record work never
 * runs when x-ray is off.
 */
export default function XrayLayer() {
  const { active } = useXray();
  const { open: dockOpen } = useActionDock();
  const { panel } = useChromePanel();

  // The HUD shares the bottom edge with the nav dock and the search/filter/info
  // panels. When one of those opens, yield the space (hide the HUD) rather than
  // exiting the mode — closing them brings it back.
  const suppressed = dockOpen || Boolean(panel);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>{active && !suppressed && <XrayHud key="xray-hud" />}</AnimatePresence>,
    document.body,
  );
}

function XrayHud() {
  const reduce = useReducedMotion();
  const derived = useAtUri();
  const { pageRecord } = useEditMode();
  const { openPanel } = useChromePanel();

  // Prefer the route-derived record; else fall back to whatever backing record
  // the current page registered through PageShell (e.g. the resume version at
  // /available, which useAtUri doesn't derive on its own).
  const fallback = !derived.atUri && pageRecord?.path === derived.route ? pageRecord : null;
  const atUri = derived.atUri || fallback?.atUri || null;
  const explorerPath = atUri ? explorerPathFromAtUri(atUri) : null;

  // The atmosphere readout is its own sheet now (DebugSheet, a chrome panel);
  // opening it folds the dock away and suppresses this HUD until it closes.
  function openDetails() {
    openPanel('debug');
  }

  // Expand up out of the bottom chrome on the shared BottomSheet mechanism
  // (fixed clip pinned on the bar, height 0 ↔ auto) so it reads as one system
  // with the search/filter/info panels — minus the click-catching backdrop,
  // since in x-ray you keep tapping page rows to inspect them.
  return (
    <motion.div
      className="bottom-sheet-wrap xray-hud-wrap"
      initial={{ height: 0 }}
      animate={{ height: 'auto' }}
      exit={{ height: 0 }}
      transition={{ duration: reduce ? 0 : 0.34, ease: [0.32, 0.72, 0, 1] }}
    >
      <div
        className="bottom-sheet-panel bottom-sheet-panel-compact xray-hud"
        role="status"
        aria-live="polite"
      >
        <span className="xray-hud-mark">
          <Microscope aria-hidden="true" strokeWidth={1.75} /> inspecting
        </span>
        {atUri ? (
          explorerPath ? (
            <Link to={explorerPath} className="xray-hud-uri-link">
              <AtUriMono atUri={atUri} />
            </Link>
          ) : (
            <AtUriMono atUri={atUri} />
          )
        ) : (
          <span className="xray-hud-aggregate">the protocol data</span>
        )}
        <span className="xray-hud-spacer" />
        <button type="button" className="xray-hud-inspect" onClick={openDetails}>
          details ↗
        </button>
      </div>
    </motion.div>
  );
}
