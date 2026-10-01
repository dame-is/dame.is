// Shared pieces for the moderation hub: a small data cache, and the handful of
// components every view draws -- avatars, band badges, empty and error states,
// skeletons, toasts.
//
// THE CACHE IS WHY TABS STOP FLASHING. Every panel used to fetch on mount and
// render nothing until the answer came back, so switching tabs meant a blank
// screen, then a jump. Now a view reads whatever it last saw at once and
// refreshes behind it; the network decides how fresh the numbers are, not
// whether there is anything on screen.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

/* ----------------------------------------------------------------- cache */

const store = new Map(); // key -> { data, error, at, promise }
const listeners = new Map(); // key -> Set<fn>

function emit(key) {
  for (const fn of listeners.get(key) || []) fn(store.get(key));
}

/** Replace or update a cached value, and tell everyone showing it. */
export function setCached(key, updater) {
  const prev = store.get(key) || {};
  const data = typeof updater === 'function' ? updater(prev.data) : updater;
  store.set(key, { ...prev, data, at: prev.at || Date.now() });
  emit(key);
}

/** Mark every key starting with `prefix` stale, so the next view refetches. */
export function invalidate(prefix) {
  for (const [key, entry] of store) {
    if (key.startsWith(prefix)) store.set(key, { ...entry, at: 0 });
  }
}

/**
 * Read `key` through the cache.
 *
 * Returns what was last seen immediately, and fetches when that is missing or
 * older than `staleMs`. `loading` is true only when there is nothing to show
 * yet; `refreshing` is true whenever a fetch is in flight.
 */
export function useCached(key, fetcher, { staleMs = 30_000 } = {}) {
  const [entry, setEntry] = useState(() => (key ? store.get(key) : null) || {});
  const [refreshing, setRefreshing] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(
    async ({ force = false } = {}) => {
      if (!key) return;
      const current = store.get(key);
      if (!force && current?.promise) return current.promise;
      setRefreshing(true);
      const promise = Promise.resolve()
        .then(() => fetcherRef.current())
        .then((data) => {
          store.set(key, { data, error: null, at: Date.now() });
          emit(key);
          return data;
        })
        .catch((error) => {
          const prev = store.get(key) || {};
          store.set(key, { ...prev, error, promise: null, at: prev.at || 0 });
          emit(key);
        })
        .finally(() => setRefreshing(false));
      store.set(key, { ...(current || {}), promise });
      return promise;
    },
    [key],
  );

  useEffect(() => {
    if (!key) return undefined;
    const fn = (next) => setEntry(next || {});
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    const current = store.get(key);
    setEntry(current || {});
    if (!current?.data || Date.now() - (current.at || 0) > staleMs) load();
    return () => listeners.get(key)?.delete(fn);
  }, [key, staleMs, load]);

  return {
    data: entry.data,
    error: entry.data ? null : entry.error,
    staleError: entry.data ? entry.error : null,
    loading: !entry.data && !entry.error,
    refreshing,
    reload: () => load({ force: true }),
  };
}

/* --------------------------------------------------------------- formats */

import { fmt } from './format.js';

export {
  age,
  compact,
  day,
  fmt,
  profileUrl,
  timeAgo,
  usd,
  viaTag,
  viaText,
} from './format.js';

/* ------------------------------------------------------------ components */

/** Square, like every other mark on the site. Initials when there is no image. */
export function Avatar({ src, name, size = 44 }) {
  const [broken, setBroken] = useState(false);
  const initials = String(name || '?')
    .replace(/^@/, '')
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <span
      className="mh-avatar"
      style={{ '--mh-avatar': `${size}px` }}
      aria-hidden="true"
    >
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className="mh-avatar-initials">{initials || '?'}</span>
      )}
    </span>
  );
}

export const BAND_LABEL = {
  PROTECTED: 'Protected',
  CONNECTED: 'Connected',
  PERIPHERAL: 'Peripheral',
  NOTABLE: 'Notable',
  UNKNOWN: 'Stranger',
};

/** The band, coloured by how much it should stop you. */
export function BandBadge({ band }) {
  if (!band) return null;
  return (
    <span className={`mh-badge mh-badge--${band.toLowerCase()}`}>
      {BAND_LABEL[band] || band}
    </span>
  );
}

/** A plain tag: how someone was added, a triage label, a plan code. */
export function Tag({ children, tone = 'plain', title }) {
  return (
    <span className={`mh-tag mh-tag--${tone}`} title={title}>
      {children}
    </span>
  );
}

/** A chip row that filters. `options`: [{ key, label, count }] */
export function Chips({ options, value, onChange, label }) {
  return (
    <div className="mh-chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          className={`mh-chip${value === o.key ? ' is-on' : ''}`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
          {typeof o.count === 'number' && (
            <span className="mh-chip-count">{fmt(o.count)}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Rows of grey bars where content is about to be. */
export function Skeleton({ rows = 4, avatar = true }) {
  return (
    <div className="mh-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="mh-skeleton-row">
          {avatar && <span className="mh-skeleton-avatar" />}
          <span className="mh-skeleton-lines">
            <span style={{ width: `${55 + ((i * 17) % 35)}%` }} />
            <span style={{ width: `${30 + ((i * 23) % 40)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="mh-empty">
      <p className="mh-empty-title">{title}</p>
      {children && <p className="mh-empty-body">{children}</p>}
    </div>
  );
}

/** An error you can do something about. */
export function ErrorNote({ error, onRetry, compact: small = false }) {
  if (!error) return null;
  return (
    <div className={`mh-error${small ? ' mh-error--small' : ''}`} role="alert">
      <span>{String(error?.message || error)}</span>
      {onRetry && (
        <button type="button" className="mh-link" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Watch an element and call `onVisible` when it scrolls near the viewport. */
export function useNearEnd(onVisible, enabled = true) {
  const ref = useRef(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) cb.current?.();
      },
      { rootMargin: '400px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled]);
  return ref;
}

/* ---------------------------------------------------------------- toasts */

const ToastCtx = createContext(() => {});

/** `const toast = useToast(); toast('Kept @x', { action: { label: 'Undo', run } })` */
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }) {
  const [items, setItems] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback(
    (id) => setItems((xs) => xs.filter((t) => t.id !== id)),
    [],
  );

  const push = useCallback(
    (text, { action = null, tone = 'plain', ms = 6000 } = {}) => {
      idRef.current += 1;
      const id = idRef.current;
      setItems((xs) => [...xs.slice(-2), { id, text, action, tone }]);
      if (ms) setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="mh-toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`mh-toast mh-toast--${t.tone}`}>
            <span className="mh-toast-text">{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="mh-toast-action"
                onClick={() => {
                  dismiss(t.id);
                  t.action.run();
                }}
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              className="mh-toast-close"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
