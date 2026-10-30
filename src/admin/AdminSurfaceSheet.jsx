// The Surfaces sheet: the phone's whole surface directory, summoned from the
// site's bottom bar.
//
// It replaces a 3034px horizontal chip row — 7.78 viewport widths at 390, with
// its four group headings `clip-path`-hidden so the row was twenty-one
// undifferentiated chips, and with the "open any collection" escape hatch that
// the rail's own source comment says "must never scroll out of reach" sitting at
// x=2832. Everything that ribbon could not do, a sheet does for free: it groups,
// it counts, it labels, it puts the escape hatch on screen, and it is one tap
// from every surface to every other surface.
//
// Two things keep it short enough to use with a thumb:
//
//  - RECENT, the last three distinct surfaces this session. The owner who lives
//    in two or three surfaces never scrolls this sheet at all.
//  - LEGACY collapsed. Four derived record lists and a one-time migration,
//    visited about once a year; collapsing them takes the sheet from ~1010px of
//    rows to ~810px in a ~684px panel — one short flick instead of two.
//
// "Open any collection" is the LAST ROW, not a sticky foot. It was a foot, for
// the reason the rail keeps it out of its own scroller: an escape hatch that
// scrolls away is an escape hatch you cannot reach. But a foot is a bar, and a
// bar directly above the site's bar is two bars — an opaque, bordered strip that
// read as the end of the directory and made the twenty surfaces below the fold
// look like everything there was. The scroll cue on the body is what answers
// that need now (adminChrome.css), and it answers it for the whole list rather
// than for one row of it.
//
// Counts come from `useAdminData`, the same de-duplicated cache the rail and the
// Front Desk already read, so drawing them costs no extra request.

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import BottomSheet from '../components/BottomSheet.jsx';
import AdminSheet from './AdminSheet.jsx';
import { NsidForm, railCount, useSurfaceList } from './AdminRail.jsx';
import { useAdminData } from './useAdminData.js';
import { useAdminShell } from './useAdminShell.jsx';
import { surfaceByKey } from './surfaces.js';


/**
 * One destination row, as the compass lists a page: `[label] ……… [count]`,
 * full-bleed so the whole width is the tap target. Padding rather than a grown `::before` — these
 * are stacked, and pseudo-boxes on stacked siblings overlap, which is exactly
 * how the old chip row let 14 of 19 adjacent pairs steal each other's taps.
 */
function SurfaceRow({ surf, active, count, onGo }) {
  return (
    <li>
      <button
        type="button"
        className="wb-sheet-row"
        data-open={active ? '' : undefined}
        aria-current={active ? 'page' : undefined}
        onClick={() => onGo(surf)}
      >
        <span className="wb-sheet-row-label">{surf.label}</span>
        {count != null && <span className="wb-sheet-row-count">{count}</span>}
      </button>
    </li>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {string} [props.id]
 * @param {boolean} [props.asPanel]  Draw as a panel of the SITE's bottom chrome
 *   (`BottomSheet`) rather than as a sheet of the admin's own bar (`AdminSheet`).
 *   Below the stacked breakpoint the admin has no bar of its own to rest on —
 *   ChromeBar is the furniture there — and BottomSheet is positioned in exactly
 *   the public chrome constants that are then the true ones. See the header of
 *   AdminSheet.jsx for why the DESK sheet cannot use BottomSheet: it is the same
 *   argument, read the other way round. The body is identical either way; only
 *   the box it unfurls out of changes.
 */
export default function AdminSurfaceSheet({ open, onClose, id, asPanel = false }) {
  const { agent, did, dataRev, surface: current, go, confirmLeave, recents } = useAdminShell();
  const { home, groups } = useSurfaceList();
  const { countFor } = useAdminData({ agent, did, dataRev });
  const [showLegacy, setShowLegacy] = useState(false);
  const [askingNsid, setAskingNsid] = useState(false);

  // Recents are stored as KEYS, so a surface that has since stopped existing —
  // a lexicon that lost its `legacy` flag, a key renamed between deploys —
  // simply drops out rather than rendering a row that goes nowhere.
  //
  // The Front Desk drops out too, and never because it is not recent — it is the
  // most recent thing there is, since every session starts there. It has a
  // permanent row of its own three lines below, and a directory that lists the
  // same destination twice, once under a heading claiming to be a shortcut,
  // spends a row saying nothing. The shell already applies the same rule to the
  // CURRENT surface for the same reason.
  const recentSurfaces = useMemo(
    () => recents.map((key) => surfaceByKey(key)).filter((s) => s && s.key !== home.key),
    [recents, home],
  );

  // Every navigation from this sheet passes EXPLICIT NULLS, exactly as a rail
  // click does, so `go`'s merge-only patch cannot leave a stale `c`, `r` or
  // `mode` behind.
  //
  // The guard is asked HERE rather than inside `go` (which is then forced) for
  // one reason: if the owner decides to keep their unsaved work, the sheet must
  // still be open behind the dialog — closing it would answer a question they
  // just declined to answer.
  const leave = (patch) => {
    if (!confirmLeave()) return;
    go(patch, { force: true });
    onClose();
  };

  const goSurface = (surf) => {
    if (surf.kind === 'dashboard') leave({ view: null, c: null, r: null, mode: null, for: null });
    else if (surf.urlByView) leave({ view: surf.key, c: null, r: null, mode: null, for: null });
    else leave({ view: null, c: surf.nsid, r: null, mode: null, for: null });
  };

  const rowFor = (surf) => (
    <SurfaceRow
      key={surf.key}
      surf={surf}
      active={surf.key === current.key}
      count={railCount(surf, countFor(surf))}
      onGo={goSurface}
    />
  );

  const legacy = groups.find((group) => group.key === 'legacy');
  const mainGroups = groups.filter((group) => group.key !== 'legacy');

  // The escape hatch, as the directory's last row. It swaps in place for the
  // form when asked, rather than opening anything: `autoFocus` scrolls it into
  // view, so a row at the end of a list is as reachable as a row anywhere else.
  const hatch = askingNsid ? (
    <NsidForm
      autoFocus
      onCancel={() => setAskingNsid(false)}
      onOpen={(nsid) => {
        setAskingNsid(false);
        leave({ view: null, c: nsid, r: null, mode: null, for: null });
      }}
    />
  ) : (
    <button type="button" className="wb-sheet-row" onClick={() => setAskingNsid(true)}>
      <span className="wb-sheet-row-label">Open any collection…</span>
    </button>
  );

  const body = (
    <>
      {recentSurfaces.length > 0 && (
        <>
          <p className="wb-sheet-heading">Recent</p>
          <ul className="wb-sheet-list">{recentSurfaces.map(rowFor)}</ul>
          <hr className="wb-sheet-rule" />
        </>
      )}

      <ul className="wb-sheet-list">{rowFor(home)}</ul>

      {mainGroups.map((group) => (
        <div key={group.key}>
          <p className="wb-sheet-heading">{group.heading}</p>
          <ul className="wb-sheet-list">{group.items.map(rowFor)}</ul>
        </div>
      ))}

      {legacy && (
        <div className="wb-sheet-legacy">
          <button
            type="button"
            className="wb-sheet-row wb-sheet-disclosure"
            aria-expanded={showLegacy}
            onClick={() => setShowLegacy((v) => !v)}
          >
            <ChevronRight
              className="wb-sheet-disclosure-caret"
              size={16}
              aria-hidden="true"
              data-open={showLegacy ? '' : undefined}
            />
            <span className="wb-sheet-row-label">Legacy</span>
            <span className="wb-sheet-row-count">{legacy.items.length}</span>
          </button>
          {showLegacy && <ul className="wb-sheet-list">{legacy.items.map(rowFor)}</ul>}
        </div>
      )}

      <hr className="wb-sheet-rule" />
      {hatch}
    </>
  );

  // Panel mode wraps the body in a scroller of its own rather than letting
  // BottomSheet's `fill` panel be the scrollport, so the padding, the scroll cue
  // and the row rules are the same ones the desk sheet uses — one directory,
  // drawn twice. `.wb-panel` is what turns that panel back into a flex column
  // (adminChrome.css).
  if (asPanel) {
    return (
      <BottomSheet
        id={id}
        open={open}
        onClose={onClose}
        label="Admin surfaces"
        size="fill"
        className="wb-panel wb-panel-surfaces"
      >
        <div className="wb-sheet-body">{body}</div>
      </BottomSheet>
    );
  }

  return (
    <AdminSheet id={id} open={open} onClose={onClose} label="Admin surfaces" className="wb-sheet-surfaces">
      {body}
    </AdminSheet>
  );
}
