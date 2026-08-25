// The admin directory's body — the lazy half of AdminDirectorySheet, and the
// one public-route module allowed to read the admin surface registry (it IS
// the reason this file is a separate lazy chunk; see the wrapper's header).
//
// Rows are real <Link>s into `/admin?view=…` / `/admin?c=…`, borrowing the
// Surfaces sheet's own row vocabulary (`.wb-sheet-*`, adminChrome.css) so the
// two directories read as the same furniture. What this one deliberately
// lacks: counts (they need the authed agent), recents (shell session state),
// and the NSID escape hatch (its navigation runs through the shell's guard) —
// all of which live one tap away once a row lands you in the admin.

import { Link } from 'react-router-dom';
import { SurfaceIcon } from '../admin/AdminRail.jsx';
import { DASHBOARD_SURFACE, SURFACE_GROUPS, allSurfaces } from '../admin/surfaces.js';
import '../admin/adminChrome.css';

function DirectoryRow({ surf, onNavigate }) {
  return (
    <li>
      <Link className="wb-sheet-row" to={surf.href} onClick={onNavigate}>
        <SurfaceIcon name={surf.icon} size={17} />
        <span className="wb-sheet-row-label">{surf.label}</span>
      </Link>
    </li>
  );
}

/**
 * @param {object} props
 * @param {() => void} props.onNavigate  Close the sheet — the Link does the rest.
 */
export default function AdminDirectoryBody({ onNavigate }) {
  // Same filter the rail applies: a surface that is meaningless without an
  // `&r=` (the resume tailor) would be a link to nowhere from here.
  const surfaces = allSurfaces().filter((surf) => !surf.requiresRkey);
  const groups = SURFACE_GROUPS.map((group) => ({
    ...group,
    items: surfaces.filter((surf) => surf.group === group.key),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="wb-sheet-body chrome-admin-directory-body">
      <ul className="wb-sheet-list">
        <DirectoryRow surf={DASHBOARD_SURFACE} onNavigate={onNavigate} />
      </ul>
      {groups.map((group) => (
        <div key={group.key}>
          <p className="wb-sheet-heading">{group.heading}</p>
          <ul className="wb-sheet-list">
            {group.items.map((surf) => (
              <DirectoryRow key={surf.key} surf={surf} onNavigate={onNavigate} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
