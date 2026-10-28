import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Microscope } from 'lucide-react';
import { useXray } from '../hooks/useXray.jsx';
import { useAtUri } from '../hooks/useAtUri.js';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { useWaypointsModal } from '../hooks/useWaypointsModal.jsx';
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
  const { open: waypointsOpen } = useWaypointsModal();

  // The HUD shares the bottom edge with the nav dock, the search/filter/info
  // panels and the "Open in…" sheet. When one of those opens, yield the space
  // (hide the HUD) rather than exiting the mode — closing them brings it back.
  const suppressed = dockOpen || Boolean(panel) || waypointsOpen;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>{active && !suppressed && <XrayHud key="xray-hud" />}</AnimatePresence>,
    document.body,
  );
}

function XrayHud() {
  const reduce = useReducedMotion();
  const panelRef = useRef(null);
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

  // The HUD stays up for as long as the mode is on, in the band directly over
  // the bottom bar, which is where the footer strip reveals and where the end
  // of the page comes to rest. So while it's mounted, publish its height as
  // `--xray-hud-h` and mark <html> with `data-xray-hud`: Xray.css reserves the
  // room at the bottom of the page, and hides the footer strip the HUD would
  // otherwise paint over. Measured off the panel, which is its full height
  // from the first frame of the unfurl (the wrap is what animates).
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return undefined;
    const root = document.documentElement;
    const apply = () =>
      root.style.setProperty('--xray-hud-h', `${Math.ceil(el.offsetHeight)}px`);
    apply();
    root.setAttribute('data-xray-hud', '');
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
    if (ro) ro.observe(el);
    return () => {
      if (ro) ro.disconnect();
      root.removeAttribute('data-xray-hud');
      root.style.removeProperty('--xray-hud-h');
    };
  }, []);

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
        ref={panelRef}
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
        <button
          type="button"
          className="xray-hud-inspect"
          onClick={openDetails}
          aria-label="Open atmosphere details"
        >
          <span className="xray-hud-inspect-label">details</span>
          <ArrowUpRight aria-hidden strokeWidth={1.75} />
        </button>
      </div>
    </motion.div>
  );
}
