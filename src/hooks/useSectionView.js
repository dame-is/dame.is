import { useCallback, useState } from 'react';

/**
 * A collection page's own view, remembered per section (dame.view.creating,
 * dame.view.curating, …): 'plates' (its pictures) or 'index' (the text
 * ledger). It stores only an explicit choice, so a section's default can
 * change for everyone who hasn't picked. The feeds themselves (home,
 * /posting, /logging, /listening, /blogging) are the ledger only; there is
 * no feed-wide layout to borrow, which is what once made the portfolio and
 * the galleries open as bare lists.
 */
export const SECTION_VIEWS = ['plates', 'index'];

export function useSectionView(section, fallback = 'plates') {
  const key = `dame.view.${section}`;
  const [view, setViewState] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      if (SECTION_VIEWS.includes(stored)) return stored;
    } catch {
      /* storage blocked: the section's default stands */
    }
    return fallback;
  });
  const setView = useCallback(
    (next) => {
      if (!SECTION_VIEWS.includes(next)) return;
      setViewState(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* storage blocked: the choice lasts for this visit */
      }
    },
    [key],
  );
  return [view, setView];
}
