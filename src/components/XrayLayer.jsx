import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Scan } from 'lucide-react';
import { useXray } from '../hooks/useXray.jsx';
import { useAtUri } from '../hooks/useAtUri.js';
import { useActionDock } from '../hooks/useActionDock.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { explorerPathFromAtUri } from '../lib/atproto.js';
import { nsidFromAtUri } from '../lib/verbRegistry.js';
import { AtUriMono } from './XraySubstrate.jsx';
import XrayReticule from './XrayReticule.jsx';

/**
 * Global x-ray furniture, portaled to <body> so no transformed route
 * ancestor traps its fixed positioning:
 *   - the page HUD (a status strip naming the record backing the whole page)
 *   - the desktop reticule cursor (gated to fine pointers + wider viewports)
 *
 * Both only exist while the mode is on. The HUD is split into its own
 * component so useAtUri's PDS/record work never runs when x-ray is off.
 */
export default function XrayLayer() {
  const { active } = useXray();
  const { open: dockOpen } = useActionDock();
  const { panel } = useChromePanel();
  const canReticule = useFinePointer();

  // The HUD + reticule share the bottom edge with the nav dock and the
  // search/filter/info panels. When one of those opens, yield the space (hide
  // the furniture) rather than exiting the mode — closing them brings it back.
  const suppressed = dockOpen || Boolean(panel);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <AnimatePresence>{active && !suppressed && <XrayHud key="xray-hud" />}</AnimatePresence>
      {active && !suppressed && canReticule && <XrayReticule />}
    </>,
    document.body,
  );
}

function XrayHud() {
  const reduce = useReducedMotion();
  const derived = useAtUri();
  const { pageRecord } = useEditMode();
  const { openDock, setView } = useActionDock();

  // Prefer the route-derived record; else fall back to whatever backing record
  // the current page registered through PageShell (e.g. the resume version at
  // /available, which useAtUri doesn't derive on its own).
  const route = derived.route;
  const fallback = !derived.atUri && pageRecord?.path === route ? pageRecord : null;
  const atUri = derived.atUri || fallback?.atUri || null;
  const lexicon = derived.lexicon || (atUri ? nsidFromAtUri(atUri) : null);
  const pds = derived.pds;
  const explorerPath = atUri ? explorerPathFromAtUri(atUri) : null;

  function inspect() {
    setView('debug');
    openDock();
  }

  return (
    <motion.div
      className="xray-hud"
      role="status"
      aria-live="polite"
      initial={reduce ? { opacity: 0 } : { y: '100%', opacity: 0 }}
      animate={reduce ? { opacity: 1 } : { y: '0%', opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { y: '100%', opacity: 0 }}
      transition={{ duration: reduce ? 0.12 : 0.32, ease: [0.32, 0.72, 0, 1] }}
    >
      <span className="xray-hud-mark">
        <Scan aria-hidden="true" strokeWidth={1.75} /> x-ray
      </span>
      <span className="xray-hud-field">
        <b>route</b> {route || '/'}
      </span>
      {atUri ? (
        <span className="xray-hud-field">
          <b>record</b>{' '}
          {explorerPath ? (
            <Link to={explorerPath} className="xray-hud-uri-link">
              <AtUriMono atUri={atUri} />
            </Link>
          ) : (
            <AtUriMono atUri={atUri} />
          )}
        </span>
      ) : (
        <span className="xray-hud-field">
          <b>view</b> aggregate — this page is a join over many records
        </span>
      )}
      {lexicon && (
        <span className="xray-hud-field is-optional">
          <b>lexicon</b> {lexicon}
        </span>
      )}
      {pds && (
        <span className="xray-hud-field is-optional">
          <b>pds</b> {String(pds).replace(/^https?:\/\//, '')}
        </span>
      )}
      <span className="xray-hud-spacer" />
      <button type="button" className="xray-hud-inspect" onClick={inspect}>
        inspect ↗
      </button>
    </motion.div>
  );
}

/** True on devices with a fine pointer and enough width for the reticule to
 *  make sense. Re-evaluated on resize so a window narrowing drops it. */
function useFinePointer() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const check = () => {
      const fine = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;
      setOk(fine && window.innerWidth >= 900);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return ok;
}
