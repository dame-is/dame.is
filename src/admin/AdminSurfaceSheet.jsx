// The Surfaces sheet: the phone's whole surface directory, summoned from slot 1
// of the action bar.
//
// It replaces a 3034px horizontal chip row — 7.78 viewport widths at 390, with
// its four group headings `clip-path`-hidden so the row was twenty-one
// undifferentiated chips, and with the "open any collection" escape hatch that
// the rail's own source comment says "must never scroll out of reach" sitting at
// x=2832. Everything that ribbon could not do, a sheet does for free: it groups,
// it counts, it labels, it puts the escape hatch on screen, and it is one tap
// from every surface to every other surface.
//
// Three things keep it short enough to use with a thumb:
//
//  - RECENT, the last three distinct surfaces this session. The owner who lives
//    in two or three surfaces never scrolls this sheet at all.
//  - LEGACY collapsed. Four derived record lists and a one-time migration,
//    visited about once a year; collapsing them takes the sheet from ~1010px of
//    rows to ~810px in a ~684px panel — one short flick instead of two.
//  - "Open any collection" as a STICKY FOOT rather than the twenty-second row.
//
// Counts come from `useAdminData`, the same de-duplicated cache the rail and the
// Front Desk already read, so drawing them costs no extra request.

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import AdminSheet from './AdminSheet.jsx';
import { NsidForm, SurfaceIcon, useSurfaceList } from './AdminRail.jsx';
import { useAdminData } from './useAdminData.js';
import { useAdminShell } from './useAdminShell.jsx';
import { surfaceByKey } from './surfaces.js';

/**
 * The number a row shows, or null for a row that has none — a surface that is
 * not countable, one whose count has not landed yet (there is no entry until it
 * has), or one whose request failed. `count+` rather than a bare number when the
 * page came back full, because a capped page cannot say how many there are and
 * an invented number is worse than no number.
 */
function countLabel(entry, surf) {
  if (!surf.countable || !entry || entry.error) return null;
  if (!Number.isFinite(entry.count)) return null;
  // A surface that is a client-side SLICE of a collection must be counted as
  // that slice. Blogging and Creating are one `site.standard.document` split on
  // `value.site`, so the raw entry count says 28 for both — a number that
  // disagrees with the twenty rows the list then draws, which is worse than no
  // number at all. The filter is the surface's own, applied to the same cached
  // page, so it costs no request.
  const count = surf.recordFilter
    ? entry.records.filter((r) => surf.recordFilter(r.value)).length
    : entry.count;
  return entry.complete === false ? `${count}+` : String(count);
}

/**
 * One 48px destination row: `[icon] [label] ……… [count]`, full-bleed so the
 * whole width is the tap target. Padding rather than a grown `::before` — these
 * are stacked, and pseudo-boxes on stacked siblings overlap, which is exactly
 * how the old chip row let 14 of 19 adjacent pairs steal each other's taps.
 */
function SurfaceRow({ surf, active, absent, count, onGo }) {
  return (
    <li>
      <button
        type="button"
        className="wb-sheet-row"
        data-open={active ? '' : undefined}
        data-absent={absent ? '' : undefined}
        aria-current={active ? 'page' : undefined}
        onClick={() => onGo(surf)}
      >
        <SurfaceIcon name={surf.icon} size={17} />
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
 */
export default function AdminSurfaceSheet({ open, onClose, id }) {
  const { agent, did, dataRev, surface: current, go, confirmLeave, recents } = useAdminShell();
  const { home, groups } = useSurfaceList();
  const { countFor, isAbsent } = useAdminData({ agent, did, dataRev });
  const [showLegacy, setShowLegacy] = useState(false);
  const [askingNsid, setAskingNsid] = useState(false);

  // Recents are stored as KEYS, so a surface that has since stopped existing —
  // a lexicon that lost its `legacy` flag, a key renamed between deploys —
  // simply drops out rather than rendering a row that goes nowhere.
  const recentSurfaces = useMemo(
    () => recents.map((key) => surfaceByKey(key)).filter(Boolean),
    [recents],
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
      absent={isAbsent(surf)}
      count={countLabel(countFor(surf), surf)}
      onGo={goSurface}
    />
  );

  const legacy = groups.find((group) => group.key === 'legacy');
  const mainGroups = groups.filter((group) => group.key !== 'legacy');

  return (
    <AdminSheet
      id={id}
      open={open}
      onClose={onClose}
      label="Admin surfaces"
      className="wb-sheet-surfaces"
      foot={
        askingNsid ? (
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
            <SurfaceIcon name="Database" size={17} />
            <span className="wb-sheet-row-label">Open any collection</span>
          </button>
        )
      }
    >
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
    </AdminSheet>
  );
}
