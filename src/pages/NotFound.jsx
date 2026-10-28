import { Link, useLocation } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import RouteList from '../components/RouteList.jsx';
import { useNavRoutes } from '../hooks/useNavRoutes.js';

// Addresses people guess that aren't pages here, and the page they mean.
// The redirects in vercel.json catch the common ones on a hard load (/about,
// /resume, /guestbook); these are the near misses that reach the app.
const NEAR_MISSES = {
  projects: { to: '/creating', label: 'creating', note: 'which the home page calls Projects' },
  work: { to: '/creating', label: 'creating' },
  portfolio: { to: '/creating', label: 'creating' },
  blog: { to: '/blogging', label: 'blogging', note: 'which the home page calls Blog' },
  posts: { to: '/posting', label: 'posting' },
  music: { to: '/listening', label: 'listening' },
  moths: { to: '/mothing', label: 'mothing' },
  status: { to: '/logging', label: 'logging' },
  hire: { to: '/available', label: 'available for hire' },
};

function nearMiss(pathname, routes) {
  const first = (pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
  if (!first) return null;
  if (NEAR_MISSES[first]) return NEAR_MISSES[first];
  // A typo'd gerund: "/bloging", "/mothin". Four shared letters is enough to
  // offer it, never enough to redirect.
  const stem = first.slice(0, 4);
  const hit = stem.length === 4 && routes.find((r) => r.to.slice(1).startsWith(stem));
  return hit ? { to: hit.to, label: hit.label } : null;
}

/**
 * Not found, in the site's grammar: "dame is nowhere to be found", the
 * address that was asked for, the likeliest page when it's a near miss, and
 * then the contents (the compass menu's own rows, in the same order), so a
 * wrong turn lands on the whole site rather than one link home.
 */
export default function NotFound() {
  const { pathname } = useLocation();
  const routes = useNavRoutes();
  const near = nearMiss(pathname, routes);
  return (
    <PageShell
      title={
        <>
          dame is <span className="gerund">nowhere to be found</span>
        </>
      }
      headTitle="Not found — dame.is"
    >
      <p className="page-intro notfound-intro">
        No record exists at <code className="notfound-path">dame.is{pathname}</code>.
        {near && (
          <>
            {' '}
            You may want <Link to={near.to}>{near.label}&nbsp;&rarr;</Link>
            {near.note ? `, ${near.note}` : ''}.
          </>
        )}
      </p>
      <p className="empty-note notfound-blank">This page intentionally left blank</p>
      <section className="notfound-contents" aria-labelledby="notfound-contents-h">
        <h2 id="notfound-contents-h" className="notfound-contents-h">
          Dame is&hellip;
        </h2>
        <RouteList routes={routes} />
      </section>
    </PageShell>
  );
}
