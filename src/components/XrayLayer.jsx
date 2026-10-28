import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Microscope } from 'lucide-react';
import { useXray } from '../hooks/useXray.jsx';
import { useAtUri } from '../hooks/useAtUri.js';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { usePageCensus, useHoveredRecord } from '../hooks/usePageRecords.js';
import { useWaypointsModal } from '../hooks/useWaypointsModal.jsx';
import { explorerPathFromAtUri } from '../lib/atproto.js';
import { censusLine } from '../lib/xray.js';
import { AtUriMono, XraySubstratePanel } from './XraySubstrate.jsx';
import { SHEET_SLIDE } from './BottomSheet.jsx';
import './BottomSheet.css';

/**
 * Global x-ray furniture, portaled to <body> so no transformed route ancestor
 * traps its fixed positioning: the page HUD — a status strip naming the record
 * backing the whole page — which expands up out of the bottom chrome while the
 * mode is on. Split into its own component so useAtUri's PDS/record work never
 * runs when x-ray is off.
 */
export default function XrayLayer() {
  const { active, focusUri, toggleFocus } = useXray();
  const { open: dockOpen } = useActionDock();
  const { panel } = useChromePanel();
  const [inlineUri, setInlineUri] = useState(null);
  const { open: waypointsOpen } = useWaypointsModal();

  // The HUD shares the bottom edge with the nav dock, the search/filter/info
  // panels and the "Open in…" sheet. When one of those opens, yield the space
  // (hide the HUD) rather than exiting the mode — closing them brings it back.
  const suppressed = dockOpen || Boolean(panel) || waypointsOpen;

  // Inline records (the bar's live signals, the hero's phrases) have no row to
  // open a tree under, so a tap on one opens its tree in the HUD instead.
  // Captured on the document, ahead of React's own handlers, so the signal's
  // usual action (a sheet, a link, the hero's hold) waits until x-ray is off.
  useEffect(() => {
    if (!active) return undefined;
    function onClick(e) {
      const el = e.target?.closest?.('[data-xray-nsid][data-at-uri]');
      if (!el || el.closest('.xray-hud-wrap')) return;
      e.preventDefault();
      e.stopPropagation();
      const uri = el.getAttribute('data-at-uri');
      setInlineUri(uri);
      toggleFocus(uri);
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [active, toggleFocus]);

  const inlineFocus = active && inlineUri && inlineUri === focusUri ? inlineUri : null;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {active && !suppressed && <XrayHud key="xray-hud" inlineFocus={inlineFocus} />}
    </AnimatePresence>,
    document.body,
  );
}

function XrayHud({ inlineFocus }) {
  const reduce = useReducedMotion();
  const panelRef = useRef(null);
  const derived = useAtUri();
  const { pageRecord } = useEditMode();
  const { openPanel } = useChromePanel();
  const { focusUri } = useXray();
  const hovered = useHoveredRecord(true);

  // Prefer the route-derived record; else fall back to whatever backing record
  // the current page registered through PageShell (e.g. the resume version at
  // /available, which useAtUri doesn't derive on its own).
  const fallback = !derived.atUri && pageRecord?.path === derived.route ? pageRecord : null;
  const pageUri = derived.atUri || fallback?.atUri || null;
  // An aggregate page (home, a section index) is many records, not one, so
  // the HUD counts them instead.
  const census = usePageCensus(!pageUri);
  // What the HUD names: the record you tapped, else the one you're over, else
  // the page's own.
  const atUri = focusUri || hovered || pageUri;
  const passing = !focusUri && Boolean(hovered);
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
  // from the first frame of its slide (a transform, which doesn't change it).
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

  // Rise up out of the bottom chrome on the shared BottomSheet mechanism
  // (fixed clip pinned on the bar, the panel sliding up out of it) so it reads
  // as one system with the search/filter/info panels — minus the
  // click-catching backdrop, since in x-ray you keep tapping page rows to
  // inspect them.
  return (
    <motion.div className="bottom-sheet-wrap xray-hud-wrap">
      <motion.div
        ref={panelRef}
        className="bottom-sheet-panel bottom-sheet-panel-compact xray-hud"
        role="status"
        aria-live="polite"
        {...SHEET_SLIDE}
        transition={{ ...SHEET_SLIDE.transition, duration: reduce ? 0 : SHEET_SLIDE.transition.duration }}
      >
        {inlineFocus && (
          <div className="xray-hud-tree">
            <XraySubstratePanel atUri={inlineFocus} />
          </div>
        )}
        <span className="xray-hud-mark">
          <Microscope aria-hidden="true" strokeWidth={1.75} /> inspecting
        </span>
        {atUri ? (
          // A record passed over on the way somewhere isn't news: shown, not
          // announced.
          <span className="xray-hud-uri" aria-live={passing ? 'off' : undefined}>
            {explorerPath ? (
              <Link to={explorerPath} className="xray-hud-uri-link">
                <AtUriMono atUri={atUri} />
              </Link>
            ) : (
              <AtUriMono atUri={atUri} />
            )}
          </span>
        ) : (
          <span className="xray-hud-aggregate">
            <span className="xray-hud-count">{censusLine(census)}</span>
            {census.total > 0 && (
              <span className="xray-hud-hint">
                {' '}
                · tap a row<span className="xray-hud-hint-more"> to open its record</span>
              </span>
            )}
          </span>
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
      </motion.div>
    </motion.div>
  );
}
