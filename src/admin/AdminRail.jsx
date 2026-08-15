// The workbench's spine: one square button per surface, grouped, with the Front
// Desk at the top and an "open any NSID" escape hatch at the bottom. Below the
// stacked breakpoint the same markup becomes a horizontal chip row pinned under
// the top chrome — same buttons, labels revealed, laid out by CSS alone.
//
// The button vocabulary is borrowed from the public chrome's `.chrome-nav`
// (ChromeBar.css): 1.75rem square, a `--rule` hairline, zero radius, `--ink-soft`
// glyphs, an accent-mixed `is-open` state, and the coarse-pointer `::before`
// that grows the 28px chip to the 44px platform minimum without changing what is
// painted. The CLASS is new — `.chrome-nav` belongs to the public chrome and
// must stay reachable only from there — but the geometry is deliberately the
// same, so the admin reads as part of the same site rather than a second design.
//
// Icons arrive from surfaces.js as NAMES, not components, so that registry stays
// importable from the node test environment. The name → component map lives here
// because this is the only file that needs it.

import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  Archive,
  BriefcaseBusiness,
  ChartNoAxesColumn,
  CloudSun,
  Database,
  FileText,
  Files,
  Fingerprint,
  Images,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Music,
  Newspaper,
  PackageOpen,
  Radio,
  Scissors,
  Shapes,
  Sparkles,
  User,
} from 'lucide-react';
import { DASHBOARD_SURFACE, SURFACE_GROUPS, allSurfaces } from './surfaces.js';
import { useAdminData } from './useAdminData.js';
import { useAdminShell } from './useAdminShell.jsx';

const ICONS = {
  Activity,
  Archive,
  BriefcaseBusiness,
  ChartNoAxesColumn,
  CloudSun,
  Database,
  FileText,
  Files,
  Fingerprint,
  Images,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Music,
  Newspaper,
  PackageOpen,
  Radio,
  Scissors,
  Shapes,
  Sparkles,
  User,
};

/**
 * Lucide's stroke-width is overridden globally to 1.5 (app.css), so a rail glyph
 * only needs its size. 17px reads a hair lighter than the chrome's 18px, which
 * suits a column of twenty of them.
 */
const GLYPH = 17;

/**
 * One rail button. It is a real `<Link>` so middle-click and cmd-click open a new
 * tab the way the owner expects, but its onClick goes through `go()` — which
 * runs the unsaved-changes guard — and preventDefault()s the link's own
 * navigation.
 */
function RailButton({ surface, active, absent, onGo, buttonRef }) {
  const Icon = ICONS[surface.icon] || Database;
  return (
    <Link
      to={surface.href}
      ref={buttonRef}
      className={`wb-rail-btn${active ? ' is-open' : ''}`}
      data-absent={absent ? '' : undefined}
      title={surface.label}
      aria-label={surface.label}
      aria-current={active ? 'page' : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onGo(surface);
      }}
    >
      <Icon size={GLYPH} aria-hidden="true" />
      <span className="wb-rail-label">{surface.label}</span>
    </Link>
  );
}

/** Narrow icon rail of surfaces. Reads everything from useAdminShell(). No props. */
export default function AdminRail() {
  const { agent, did, surface: current, go, dataRev, stacked } = useAdminShell();
  // Counts are shared: useAdminData de-duplicates in-flight requests by NSID, so
  // the rail asking the same question as the Front Desk costs nothing extra.
  // Here they answer exactly one question — is this collection empty? — which
  // dims the button without disabling it.
  const { isAbsent } = useAdminData({ agent, did, dataRev });

  // Every rail click passes EXPLICIT NULLS. `go` is merge-only, so moving from
  // `?c=is.dame.now&r=abc` to `?view=sky` with `go({ view: 'sky' })` would leave
  // a stale `c` and `r` that reappear the moment `view` is dropped. One history
  // entry per click, and nothing stale left behind.
  const goHome = () => go({ view: null, c: null, r: null, mode: null, for: null });
  const goSurface = (surf) =>
    surf.urlByView
      ? go({ view: surf.key, c: null, r: null, mode: null, for: null })
      : go({ view: null, c: surf.nsid, r: null, mode: null, for: null });

  /**
   * Browse an arbitrary, unenumerated collection — the rail's half of what the
   * Front Desk offers as a proper input. `window.prompt` rather than a popover:
   * the rail is 3.25rem wide and its own scroll container, so an in-flow form
   * has nowhere to go, and the resume studio already asks for a version name
   * exactly this way.
   */
  const openAny = () => {
    const nsid = window.prompt('Collection NSID to browse', '')?.trim();
    if (!nsid) return;
    go({ view: null, c: nsid, r: null, mode: null, for: null });
  };

  // Bring the active chip into view when the rail is a horizontal scroller —
  // `scroll-margin-inline` in the stylesheet gives it breathing room at the
  // edges. `block: 'nearest'` keeps this from scrolling the page vertically.
  const activeRef = useRef(null);
  useEffect(() => {
    if (!stacked) return;
    activeRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [stacked, current.key]);

  const surfaces = allSurfaces();
  const homeActive = current.kind === 'dashboard';

  return (
    <nav className="wb-rail" aria-label="Admin surfaces">
      {/* Only the SURFACES scroll. Twenty-one chips do not fit a laptop
          viewport, and if the whole rail were one scroller the "open any
          collection" control at its foot would simply be gone, with nothing on
          screen to suggest anything was below. Keeping it outside the scroller
          pins the escape hatch and turns the overflow into a visible seam. */}
      <div className="wb-rail-scroll">
        <div className="wb-rail-group">
          <Link
            to="/admin"
            className={`wb-rail-btn${homeActive ? ' is-open' : ''}`}
            title={DASHBOARD_SURFACE.label}
            aria-label={DASHBOARD_SURFACE.label}
            aria-current={homeActive ? 'page' : undefined}
            ref={homeActive ? activeRef : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              goHome();
            }}
          >
            <LayoutDashboard size={GLYPH} aria-hidden="true" />
            <span className="wb-rail-label">{DASHBOARD_SURFACE.label}</span>
          </Link>
        </div>

        {SURFACE_GROUPS.map((group) => {
          const items = surfaces.filter(
            (surf) =>
              surf.group === group.key &&
              // A surface that is meaningless without `&r=` (the resume tailor)
              // would offer a link to nowhere. Show it only while you are on it,
              // so the rail still marks where you are.
              (!surf.requiresRkey || surf.key === current.key),
          );
          if (items.length === 0) return null;
          return (
            <div className="wb-rail-group" key={group.key}>
              {/* Visible now that the rail carries labels. Presentational: the
                  group is already conveyed to assistive tech by the surface
                  order and each button's own accessible name, and announcing
                  "Content" as a heading before every jump would be noise. */}
              <span className="wb-rail-heading" aria-hidden="true">
                {group.heading}
              </span>
              {items.map((surf) => {
                const active = surf.key === current.key;
                return (
                  <RailButton
                    key={surf.key}
                    surface={surf}
                    active={active}
                    absent={isAbsent(surf)}
                    onGo={goSurface}
                    buttonRef={active ? activeRef : undefined}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="wb-rail-group wb-rail-group-end">
        <button
          type="button"
          className="wb-rail-btn"
          onClick={openAny}
          title="Open any collection"
          aria-label="Open any collection"
        >
          <Database size={GLYPH} aria-hidden="true" />
          <span className="wb-rail-label">Any collection</span>
        </button>
      </div>
    </nav>
  );
}
