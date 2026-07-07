import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import './SearchSheet.css';

// Routes whose page component reads `?q=` and filters its own list. On
// any other route, submitting the search instead jumps to `/?q=…` so the
// query lands somewhere it'll actually do work.
const SEARCHABLE_ROUTES = new Set(['/', '/posting', '/logging', '/blogging', '/creating']);

/**
 * Global search, expanded up out of the bottom chrome bar's search button
 * (see useChromePanel). Rather than a centered modal, the field unfurls from
 * the bar itself — the same motion as the nav dock and the other chrome
 * panels — so every bottom-chrome affordance behaves alike.
 *
 * The field keeps a 16px/1rem font so iOS Safari doesn't auto-zoom on focus.
 * Query is committed to the URL on submit (not on every keystroke) so the
 * page behind the panel isn't churning while the user types.
 */
export default function SearchSheet() {
  const { panel, closePanel } = useChromePanel();
  const open = panel === 'search';
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const currentQ = params.get('q') || '';
  const [draft, setDraft] = useState(currentQ);
  const inputRef = useRef(null);

  // Re-sync draft whenever the panel opens so the field reflects any ?q=
  // changes that happened while it was closed (e.g. cleared via back/forward).
  useEffect(() => {
    if (open) setDraft(currentQ);
  }, [open, currentQ]);

  // Auto-focus the input on open. Slight delay so the panel's expand
  // animation can settle before the keyboard slides up on mobile.
  useEffect(() => {
    if (!open) return undefined;
    const id = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(id);
  }, [open]);

  function commit(value) {
    const trimmed = value.trim();
    const searchable = SEARCHABLE_ROUTES.has(location.pathname);
    if (!searchable) {
      // Non-searchable route → jump to home and bring the query with us.
      const target = trimmed ? `/?q=${encodeURIComponent(trimmed)}` : '/';
      navigate(target);
    } else {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (trimmed) out.set('q', trimmed);
          else out.delete('q');
          return out;
        },
        { replace: true },
      );
    }
    closePanel();
  }

  function handleSubmit(e) {
    e.preventDefault();
    commit(draft);
  }

  function handleClear() {
    setDraft('');
    inputRef.current?.focus();
  }

  return (
    <BottomSheet open={open} onClose={closePanel} label="Search" id="chrome-search-sheet" className="search-sheet-panel">
      <form className="search-sheet-form" onSubmit={handleSubmit} role="search">
        <div className="search-sheet-field">
          <Search size={18} aria-hidden="true" className="search-sheet-icon" />
          <input
            ref={inputRef}
            type="search"
            name="q"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search everything"
            aria-label="Search the site"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {draft && (
            <button
              type="button"
              className="search-sheet-clear"
              onClick={handleClear}
              aria-label="Clear search"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="search-sheet-hint gutter">
          Press <kbd>Enter</kbd> to search · <kbd>Esc</kbd> to close
        </p>
      </form>
    </BottomSheet>
  );
}
