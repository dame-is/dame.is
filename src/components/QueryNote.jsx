import { useSearchParams } from 'react-router-dom';
import './QueryNote.css';

/**
 * "Showing plays matching “Charm” · clear" — the visible half of a `?q=`
 * filter.
 *
 * The search button is switched off in the chrome for now, but `?q=` still
 * filters: the listening stats link their rows to it, and an album page sends
 * readers to `/listening?q=<title>`. Without this the feed simply arrived
 * shorter than usual, with nothing saying why and no way back short of editing
 * the URL. Renders nothing when there's no query.
 */
export default function QueryNote({ noun = 'entries' }) {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') || '').trim();
  if (!q) return null;

  function clear() {
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.delete('q');
        return out;
      },
      { replace: true },
    );
  }

  return (
    <p className="query-note gutter" role="status">
      Showing {noun} matching &ldquo;{q}&rdquo; ·{' '}
      <button type="button" className="query-note-clear" onClick={clear}>
        clear
      </button>
    </p>
  );
}
