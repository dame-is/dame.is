// The admin's own top bar. /admin is the one route that does not render the
// site's ChromeBar (App.jsx withholds it), so this replaces the two things the
// public chrome was carrying that the owner still needs here:
//
//   - where am I  → the running head, which in the admin is always
//                   / admin / <surface> [/ <rkey>], with the collection's
//                   NSID at the right, as a public record page sets it
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
import Button from '../components/Button.jsx';
import { useTheme } from '../hooks/useTheme.jsx';
import { skyMarkUrl } from '../lib/skyAvatars.js';
import { skyHourLabel } from '../lib/skyTheme.js';
import { useAdminShell } from './useAdminShell.jsx';

/** A crumb's words: the surface's label in the trail's lower case, as the
 *  site's running head prints its sections ("/ logging / 3mz22ky5jbu25"). */
function crumbLabel(label) {
  return String(label || '').toLowerCase();
}

export default function AdminTopBar() {
  const { surface, collection, rkey, isNew, confirmLeave } = useAdminShell();
  const { skyDisplayHour, showSkyMark } = useTheme();
  const isDashboard = surface.kind === 'dashboard';
  // A `new` crumb is a claim about a creation flow. Only a records surface has
  // one: `?view=sky&mode=new` used to draw "… / Sky theme studio / new" for a
  // studio that has no concept of creating a record.
  const creating = isNew && surface.kind === 'records-list';
  // The collection in view, at the right of the trail where a public record
  // page prints its own. The open collection when there is one (an NSID typed
  // into the escape hatch has no registry entry of its own), else the surface's.
  const nsid = isDashboard ? null : collection || surface.nsid || null;
  const mark = showSkyMark ? skyMarkUrl(skyDisplayHour) : null;

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
      {/* The site's own mark and wordmark (ChromeBar.css), so the admin's bar
          reads as the bar every other page wears. It goes to the front desk,
          the admin's home, as the public one goes to the site's. */}
      <Link to="/admin" className="chrome-title wb-top-mark" onClick={guard} aria-label="dame.is admin, front desk">
        {mark && (
          <span className="chrome-mark chrome-mark-avatar" aria-hidden="true">
            <img className="chrome-mark-img" src={mark} alt="" />
          </span>
        )}
        <span className="chrome-name">dame.is</span>
      </Link>

      {/* The running head, in the public trail's own classes: a leading slash,
          the sections in ink-soft, the page in ink. The group ("Content") is
          left out because the rail already says it. */}
      <nav className="chrome-breadcrumb wb-crumbs" aria-label="Breadcrumb">
        <ol className="chrome-crumbs">
          <li className="chrome-crumb">
            <span className="chrome-crumb-sep" aria-hidden="true">
              /
            </span>
            {isDashboard ? (
              <span className="chrome-crumb-current" aria-current="page">
                admin
              </span>
            ) : (
              <Link className="chrome-crumb-link" to="/admin" onClick={guard}>
                admin
              </Link>
            )}
          </li>
          {!isDashboard && (
            <li className="chrome-crumb">
              <span className="chrome-crumb-sep" aria-hidden="true">
                /
              </span>
              {rkey || creating ? (
                <Link className="chrome-crumb-link" to={surface.href} onClick={guard}>
                  {crumbLabel(surface.label)}
                </Link>
              ) : (
                <span className="chrome-crumb-current" aria-current="page">
                  {crumbLabel(surface.label)}
                </span>
              )}
            </li>
          )}
          {(rkey || creating) && (
            <li className="chrome-crumb">
              <span className="chrome-crumb-sep" aria-hidden="true">
                /
              </span>
              <span className="chrome-crumb-current" aria-current="page">
                {creating ? 'new' : rkey}
              </span>
            </li>
          )}
        </ol>
      </nav>

      <div className="wb-top-end">
        {nsid && <span className="chrome-crumb-nsid wb-top-nsid">{nsid}</span>}
        {/* The hour the palette is showing, as the bottom bar's chip prints it
            ("1 pm"), and the way into the studio that tunes it. */}
        <Button
          as={Link}
          to="/admin?view=sky"
          size="sm"
          className="wb-top-hour"
          onClick={guard}
          title="The hour the site's palette is showing. Open the sky theme studio."
        >
          {skyHourLabel(skyDisplayHour)}
        </Button>
        <Button as={Link} to="/" size="sm" className="wb-top-out" onClick={guard}>
          View site
          <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </div>
    </header>
  );
}
