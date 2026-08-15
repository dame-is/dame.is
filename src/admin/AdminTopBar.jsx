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
// itself, so it is not reproduced. The hour chip stays because the admin is
// painted in the hour's palette like every other page and it is genuinely
// useful to see which hour you are looking at while tuning one.

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
  const { surface, rkey, isNew } = useAdminShell();
  const group = SURFACE_GROUPS.find((g) => g.key === surface.group);
  const isDashboard = surface.kind === 'dashboard';
  const hour = hourLabel();

  return (
    <header className="wb-top">
      <Link to="/admin" className="wb-top-mark">
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
              <Link to="/admin">Front desk</Link>
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
              {rkey || isNew ? (
                <Link to={surface.href}>{surface.label}</Link>
              ) : (
                <span aria-current="page">{surface.label}</span>
              )}
            </li>
          )}
          {(rkey || isNew) && (
            <li>
              <span className="wb-crumb-sep" aria-hidden="true">
                /
              </span>
              <code aria-current="page">{isNew ? 'new' : rkey}</code>
            </li>
          )}
        </ol>
      </nav>

      <div className="wb-top-end">
        {hour && (
          <span className="wb-top-hour" title="The hour the site's palette is tracking">
            {hour}
          </span>
        )}
        <a href="/" className="wb-top-out">
          View site
          <ArrowUpRight className="wb-top-out-glyph" aria-hidden="true" strokeWidth={1.75} />
        </a>
      </div>
    </header>
  );
}
