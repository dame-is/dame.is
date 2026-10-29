import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * A page's sort, kept in the address as `?sort=` so a sorted gallery can be
 * linked to and the back button doesn't undo it. Only a choice other than the
 * page's default is written; picking the default takes the parameter away, so
 * the plain address stays the plain page.
 *
 * @param {string} fallback          the page's own order when the address names none
 * @param {(v: string|null) => string} resolve  maps a raw value to a known order
 */
export function useSortParam(fallback, resolve) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('sort');
  const sort = raw ? resolve(raw) : fallback;
  const setSort = useCallback(
    (next) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (next === fallback) out.delete('sort');
          else out.set('sort', next);
          return out;
        },
        { replace: true },
      );
    },
    [fallback, setParams],
  );
  return [sort, setSort];
}
