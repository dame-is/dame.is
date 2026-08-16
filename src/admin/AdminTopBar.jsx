// The admin's own top bar. /admin is the one route that does not render the
// site's ChromeBar (App.jsx withholds it), so this replaces the two things the
// public chrome was carrying that the owner still needs here:
//
//   - where am I  → the breadcrumb, which in the admin is always
//                   Admin / <group> / <surface> [/ <rkey>]
//   - how do I leave → "View site", the only way back out to the public pages
//
// Everything else the bottom bar offered (x-ray, the sky hour sheet, the font
// and paper toggles) is either meaningless here or lives in the sky studio
// itself, so it is not reproduced.
//
// EVERY LINK IN HERE RUNS THE UNSAVED-CHANGES GUARD. They are still real
// `<Link>`s, so cmd-click and middle-click open a tab the way the owner expects,
// but a plain click asks `confirmLeave()` first and cancels the navigation if the
// answer is no. Before this, the rail asked and the top bar did not: clicking a
// breadcrumb with an edit in the field discarded it silently, and "View site" was
// a raw `<a href="/">` that hard-reloaded the whole SPA — the only nav control in
// the shell that was not a Link at all.

import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { SURFACE_GROUPS } from './surfaces.js';
import { useAdminShell } from './useAdminShell.jsx';

/** Eastern hour, formatted the way the chrome bar's chip formats it. */
function hourLabel() {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      timeZone: 'America/New_York',
    })
      .format(new Date())
      .replace(/\s/g, '');
  } catch {
    return null;
  }
}

export default function AdminTopBar() {
  const { surface, rkey, isNew, stacked, confirmLeave } = useAdminShell();
  const group = SURFACE_GROUPS.find((g) => g.key === surface.group);
  const isDashboard = surface.kind === 'dashboard';
  const hour = hourLabel();
  // A `new` crumb is a claim about a creation flow. Only a records surface has
  // one: `?view=sky&mode=new` used to draw "… / Sky theme studio / new" for a
  // studio that has no concept of creating a record.
  const creating = isNew && surface.kind === 'records-list';

  /**
   * Cancel a link click when there is unsaved work the owner wants to keep.
   * Modified clicks are left alone — they open a new tab and change nothing
   * here, so there is nothing to lose and nothing to ask about.
   */
  const guard = (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    if (!confirmLeave()) event.preventDefault();
  };

  return (
    <header className="wb-top">
      <Link to="/admin" className="wb-top-mark wb-hit" onClick={guard}>
        <span className="wb-top-mark-dot" aria-hidden="true" />
        <b>dame.is</b>
        <span className="wb-top-mark-tag">admin</span>
      </Link>

      <nav className="wb-crumbs" aria-label="Breadcrumb">
        <ol>
          <li>
            {isDashboard ? (
              <span aria-current="page">Front desk</span>
            ) : (
              <Link to="/admin" onClick={guard}>
                Front desk
              </Link>
            )}
          </li>
          {!isDashboard && group && (
            <li>
              <span className="wb-crumb-sep" aria-hidden="true">
                /
              </span>
              <span className="wb-crumb-group">{group.heading}</span>
            </li>
          )}
          {!isDashboard && (
            <li>
              <span className="wb-crumb-sep" aria-hidden="true">
                /
              </span>
              {rkey || creating ? (
                <Link to={surface.href} onClick={guard}>
                  {surface.label}
                </Link>
              ) : (
                <span aria-current="page">{surface.label}</span>
              )}
            </li>
          )}
          {(rkey || creating) && (
            <li>
              <span className="wb-crumb-sep" aria-hidden="true">
                /
              </span>
              <code aria-current="page">{creating ? 'new' : rkey}</code>
            </li>
          )}
        </ol>
      </nav>

      <div className="wb-top-end">
        {/* The hour the site's palette is tracking. Desk only: on a phone it is
            an inert 11px chip duplicating what the sky studio says properly, and
            the bar below needs the room more. */}
        {hour && !stacked && (
          <span className="wb-top-hour" title="The hour the site's palette is tracking">
            {hour}
          </span>
        )}
        <Link to="/" className="wb-top-out wb-hit" onClick={guard}>
          View site
          <ArrowUpRight className="wb-top-out-glyph" aria-hidden="true" strokeWidth={1.75} />
        </Link>
      </div>
    </header>
  );
}
