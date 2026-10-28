import { NavLink } from 'react-router-dom';
import './ActionDock.css';

/**
 * The site's contents as the compass menu draws them: one ruled row per
 * page, its label on the left and its path on the right. The menu and the
 * not-found page share it, so a wrong turn lands on the same list the menu
 * would have offered (in the owner's is.dame.nav order).
 */
export default function RouteList({ routes, onNavigate }) {
  return (
    <nav className="dock-routes">
      {routes.map((r) => (
        <NavLink
          key={r.to}
          to={r.to}
          end={r.to === '/'}
          className={({ isActive }) => `dock-route ${isActive ? 'is-active' : ''}`}
          onClick={onNavigate}
        >
          <span className="dock-route-label">{r.label}</span>
          <span className="dock-route-path">{r.to}</span>
        </NavLink>
      ))}
    </nav>
  );
}
