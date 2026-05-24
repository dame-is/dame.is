import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import Modal from './Modal.jsx';
import './SearchModal.css';

// Routes whose page component reads `?q=` and filters its own list. On
// any other route, submitting the search instead jumps to `/?q=…` so the
// query lands somewhere it'll actually do work.
const SEARCHABLE_ROUTES = new Set(['/', '/posting', '/logging', '/blogging', '/creating']);

/**
 * Search palette opened from the bottom chrome bar's search button.
 *
 * The input sits inside a modal (rather than directly in the bar) for
 * two reasons:
 *   1. Tapping a tiny input in a fixed bottom bar triggers iOS's
 *      focus-zoom whenever the field is below 16px, and the bar's
 *      typography otherwise wants to stay smaller than that.
 *   2. A modal gives the input the space + scale of a real search
 *      surface, matching how the filter modal works.
 *
 * Query is committed to the URL on submit (not on every keystroke) so
 * the page behind the scrim isn't churning while the user types.
 */
export default function SearchModal({ open, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const currentQ = params.get('q') || '';
  const [draft, setDraft] = useState(currentQ);
  const inputRef = useRef(null);

  // Re-sync draft whenever the modal opens so the field reflects any
  // ?q= changes that happened while it was closed (e.g. user cleared
  // search via the back/forward buttons).
  useEffect(() => {
    if (open) setDraft(currentQ);
  }, [open, currentQ]);

  // Auto-focus the input on open. Slight delay so the panel's mount
  // animation can complete before the keyboard slides up on mobile.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 80);
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
    onClose?.();
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
    <Modal
      open={open}
      onClose={onClose}
      label="Search"
      className="search-modal-panel"
      scrimLabel="Close search"
    >
      <form className="search-modal-form" onSubmit={handleSubmit} role="search">
        <div className="search-modal-field">
          <Search size={18} aria-hidden="true" className="search-modal-icon" />
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
              className="search-modal-clear"
              onClick={handleClear}
              aria-label="Clear search"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="search-modal-hint gutter">
          Press <kbd>Enter</kbd> to search · <kbd>Esc</kbd> to close
        </p>
      </form>
    </Modal>
  );
}
