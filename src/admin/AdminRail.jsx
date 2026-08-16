// The workbench's spine: one square button per surface, grouped, with the Front
// Desk at the top and an "open any NSID" escape hatch at the bottom.
//
// **The rail is a DESKTOP control.** Below the stacked breakpoint it renders
// nothing at all: the same twenty-one buttons laid out as a horizontal chip row
// measured 3034px — 7.78 viewport widths of swiping, with the escape hatch that
// "must never scroll out of reach" sitting at x=2832 — so the phone reaches its
// surfaces through `AdminActionBar`'s sheet instead (docs/admin-mobile-design.md
// §2.2). Everything the sheet needs to draw that directory is exported from
// here, so there is one grouped, filtered, icon-mapped surface list in the
// codebase rather than one per consumer.
//
// The button vocabulary is borrowed from the public chrome's `.chrome-nav`
// (ChromeBar.css): a `--rule` hairline, zero radius, `--ink-soft` glyphs and an
// accent-mixed `is-open` state. The CLASS is new — `.chrome-nav` belongs to the
// public chrome and must stay reachable only from there — but the geometry is
// deliberately the same, so the admin reads as part of the same site rather than
// a second design.
//
// Icons arrive from surfaces.js as NAMES, not components, so that registry stays
// importable from the node test environment. The name → component map lives here
// because this is the module that owns "how a surface is drawn".

import { useEffect, useMemo, useRef, useState } from 'react';
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
  RefreshCw,
  Scissors,
  Shapes,
  Sparkles,
  User,
} from 'lucide-react';
import { DASHBOARD_SURFACE, SURFACE_GROUPS, allSurfaces } from './surfaces.js';
import { useAdminData } from './useAdminData.js';
import { useAdminShell } from './useAdminShell.jsx';

/**
 * Surface icon NAME → component. Exported so the sheet and the action bar draw a
 * surface with the same glyph the rail does; `Database` is the fallback for a
 * synthetic surface and for any name a future registry entry gets wrong.
 *
 * It is a glyph registry rather than strictly a SURFACE registry: the action
 * bar resolves its own `BarAction.icon` through the same table, so an action's
 * glyph and a surface's glyph can never come from two different maps. That is
 * why `RefreshCw` is here with no surface using it — the Front Desk's bar action
 * needs it, and adding it here is a one-word change at the call site.
 */
export const SURFACE_ICONS = {
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
  RefreshCw,
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
 * One surface's glyph, by icon NAME. A component rather than a lookup at each
 * call site so "unknown icon" has one answer.
 *
 * @param {{name?: string|null, size?: number}} props
 */
export function SurfaceIcon({ name, size = GLYPH }) {
  const Icon = SURFACE_ICONS[name] || Database;
  return <Icon size={size} aria-hidden="true" />;
}

/**
 * NSID shape, as the escape hatch needs to know it: dot-separated segments, at
 * least three of them, each starting with a letter. Deliberately a SHAPE check
 * and not a registry check — the whole point of the hatch is to open a
 * collection nothing here has heard of — but a typo like `is.dame.now.` or a
 * pasted at-uri should be refused before it becomes a URL and a failed request
 * that reads as an empty collection.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isNsidShape(value) {
  const s = String(value || '').trim();
  if (!s || s.length > 317) return false;
  const segments = s.split('.');
  if (segments.length < 3) return false;
  return segments.every((seg) => /^[a-zA-Z](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(seg));
}

/** The refusal, worded once — it is shown by the rail and by the sheet. */
export const NSID_REFUSAL = 'That is not an NSID — try app.bsky.graph.follow';

/**
 * The escape hatch's form: type a collection, go to it. It replaces
 * `window.prompt`, which is OS chrome in a system that draws every one of its
 * own controls — and which could not say why it refused a value, because a
 * prompt has no room for an error.
 *
 * Shared by the rail's footer and the Surfaces sheet's sticky foot so both
 * validate identically and refuse in the same words.
 *
 * @param {object} props
 * @param {(nsid: string) => void} props.onOpen
 * @param {() => void} [props.onCancel]
 * @param {boolean} [props.autoFocus]
 * @param {string} [props.className]
 */
export function NsidForm({ onOpen, onCancel, autoFocus = false, className = '' }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);

  return (
    <form
      className={`wb-nsid-form ${className}`.trim()}
      onSubmit={(event) => {
        event.preventDefault();
        const nsid = value.trim();
        if (!isNsidShape(nsid)) {
          setError(NSID_REFUSAL);
          return;
        }
        onOpen(nsid);
      }}
    >
      <label className="wb-nsid-label" htmlFor="wb-nsid-input">
        Collection NSID
      </label>
      <div className="wb-nsid-row">
        <input
          id="wb-nsid-input"
          className="admin-input wb-nsid-input"
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          // Autofocus is safe here and nowhere else in the admin: this input
          // only exists because the owner just tapped "Open any collection",
          // and it is the only control in its container.
          autoFocus={autoFocus}
          placeholder="app.bsky.graph.follow"
          value={value}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'wb-nsid-error' : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
        />
        <button type="submit" className="admin-gate-button admin-gate-button-tight">
          Go
        </button>
        {onCancel && (
          <button
            type="button"
            className="wb-nsid-cancel"
            onClick={() => {
              setValue('');
              setError(null);
              onCancel();
            }}
          >
            Cancel
          </button>
        )}
      </div>
      {error && (
        <p className="wb-nsid-error" id="wb-nsid-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * The surface directory, grouped and filtered, exactly once.
 *
 * A surface that is meaningless without `&r=` (the resume tailor) would offer a
 * link to nowhere, so it appears only while you are on it — which still lets the
 * directory mark where you are. Groups with nothing left in them are dropped
 * rather than rendered empty.
 *
 * Read by the rail, by the Surfaces sheet, and available to the Front Desk.
 *
 * @returns {{home: import('./surfaces.js').AdminSurface,
 *            groups: {key: string, heading: string, note: string,
 *                     items: import('./surfaces.js').AdminSurface[]}[]}}
 */
export function useSurfaceList() {
  const { surface: current } = useAdminShell();
  return useMemo(() => {
    const surfaces = allSurfaces();
    const groups = SURFACE_GROUPS.map((group) => ({
      key: group.key,
      heading: group.heading,
      note: group.note,
      items: surfaces.filter(
        (surf) =>
          surf.group === group.key && (!surf.requiresRkey || surf.key === current.key),
      ),
    })).filter((group) => group.items.length > 0);
    return { home: DASHBOARD_SURFACE, groups };
  }, [current.key]);
}

/**
 * One rail button. It is a real `<Link>` so middle-click and cmd-click open a new
 * tab the way the owner expects, but its onClick goes through `go()` — which
 * runs the unsaved-changes guard — and preventDefault()s the link's own
 * navigation.
 */
function RailButton({ surface, active, absent, onGo, buttonRef }) {
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
      <SurfaceIcon name={surface.icon} />
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
  const { home, groups } = useSurfaceList();
  const [askingNsid, setAskingNsid] = useState(false);

  // Every rail click passes EXPLICIT NULLS. `go` is merge-only, so moving from
  // `?c=is.dame.now&r=abc` to `?view=sky` with `go({ view: 'sky' })` would leave
  // a stale `c` and `r` that reappear the moment `view` is dropped. One history
  // entry per click, and nothing stale left behind.
  const goHome = () => go({ view: null, c: null, r: null, mode: null, for: null });
  const goSurface = (surf) =>
    surf.urlByView
      ? go({ view: surf.key, c: null, r: null, mode: null, for: null })
      : go({ view: null, c: surf.nsid, r: null, mode: null, for: null });

  // Bring the active button into view — in BOTH orientations. The guard that
  // used to sit here (`if (!stacked) return`) meant the vertical rail never
  // scrolled at all: at 1024×800 its scroller overflows by 186px, so arriving on
  // any of the last five surfaces showed a rail with nothing selected on it.
  // `block: 'nearest'` keeps this from scrolling the page.
  //
  // Run three times, and that is not belt-and-braces: at mount the rail has not
  // been laid out against its final row heights, so the scroller measures itself
  // as fitting and `scrollIntoView` is a no-op — measured `scrollTop: 0` with the
  // open button 27px below the scrollport. The next frame has the layout, and
  // `fonts.ready` catches the swap to Crimson Pro, which grows every one of
  // twenty-one rows and is what turns a rail that fits into a rail that does not.
  const activeRef = useRef(null);
  useEffect(() => {
    if (stacked) return undefined;
    let cancelled = false;
    const bring = () => {
      if (!cancelled) activeRef.current?.scrollIntoView({ block: 'nearest' });
    };
    bring();
    const frame = requestAnimationFrame(bring);
    document.fonts?.ready?.then(bring);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [stacked, current.key]);

  // Nothing at all below 60rem — the bottom bar and its sheet are the phone's
  // navigation. Rendered after the hooks, never before them.
  if (stacked) return null;

  const homeActive = current.kind === 'dashboard';

  return (
    <nav className="wb-rail" aria-label="Admin surfaces">
      {/* Only the SURFACES scroll. Twenty-one buttons do not fit a laptop
          viewport, and if the whole rail were one scroller the "open any
          collection" control at its foot would simply be gone, with nothing on
          screen to suggest anything was below. Keeping it outside the scroller
          pins the escape hatch; the fade at the scroller's foot (adminShell.css)
          is what says there is more above it. */}
      <div className="wb-rail-scroll">
        <div className="wb-rail-group">
          <Link
            to="/admin"
            className={`wb-rail-btn${homeActive ? ' is-open' : ''}`}
            title={home.label}
            aria-label={home.label}
            aria-current={homeActive ? 'page' : undefined}
            ref={homeActive ? activeRef : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              goHome();
            }}
          >
            <LayoutDashboard size={GLYPH} aria-hidden="true" />
            <span className="wb-rail-label">{home.label}</span>
          </Link>
        </div>

        {groups.map((group) => (
          <div className="wb-rail-group" key={group.key}>
            {/* Visible now that the rail carries labels. Presentational: the
                group is already conveyed to assistive tech by the surface
                order and each button's own accessible name, and announcing
                "Content" as a heading before every jump would be noise. */}
            <span className="wb-rail-heading" aria-hidden="true">
              {group.heading}
            </span>
            {group.items.map((surf) => {
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
        ))}
      </div>

      <div className="wb-rail-group wb-rail-group-end">
        {askingNsid ? (
          <NsidForm
            autoFocus
            className="wb-nsid-form-rail"
            onCancel={() => setAskingNsid(false)}
            onOpen={(nsid) => {
              setAskingNsid(false);
              go({ view: null, c: nsid, r: null, mode: null, for: null });
            }}
          />
        ) : (
          <button
            type="button"
            className="wb-rail-btn"
            onClick={() => setAskingNsid(true)}
            title="Open any collection"
            aria-label="Open any collection"
            aria-expanded={false}
          >
            <Database size={GLYPH} aria-hidden="true" />
            <span className="wb-rail-label">Any collection</span>
          </button>
        )}
      </div>
    </nav>
  );
}
