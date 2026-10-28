// A browser that refuses this site storage doesn't hand back an empty
// Storage: merely *reading* `window.localStorage` throws a SecurityError
// (Chrome's "Don't allow sites to save data", a Firefox cookie exception,
// Safari's "Block all cookies"), and some embedded webviews hand back null.
// `typeof localStorage` doesn't help either — it still calls the getter.
// Several providers read their stored preference in a useState initialiser
// that sits outside the ErrorBoundary, so that one throw unmounted the whole
// app and left the visitor on a blank page.
//
// Rather than trusting every present and future call site (ours and the
// libraries') to wrap its own access, main.jsx imports this module first and
// it swaps an unusable storage for an in-memory stand-in before anything else
// evaluates. Preferences then last for the visit rather than across visits —
// the most a visitor who blocked storage can expect — and nothing throws.
//
// The stand-in forgets everything on reload, which matters to exactly one
// caller: the auto-updater's reload loop guard has to survive the reload it
// triggers. `isStorageVolatile('sessionStorage')` lets it tell.

const volatile = new Set();

function memoryStorage() {
  const items = new Map();
  return {
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => (items.has(String(k)) ? items.get(String(k)) : null),
    setItem: (k, v) => {
      items.set(String(k), String(v));
    },
    removeItem: (k) => {
      items.delete(String(k));
    },
    clear: () => items.clear(),
  };
}

/**
 * Make `target[name]` ('localStorage' | 'sessionStorage') safe to touch:
 * left alone when it works, replaced with an in-memory Storage when reading
 * it throws or yields nothing. Returns true when it had to step in.
 */
export function guardStorage(target, name) {
  try {
    const store = target[name];
    if (store) {
      store.getItem('dame.storage.probe');
      return false;
    }
  } catch {
    /* blocked — fall through to the stand-in */
  }
  volatile.add(name);
  try {
    Object.defineProperty(target, name, {
      value: memoryStorage(),
      configurable: true,
      enumerable: true,
    });
  } catch {
    // The property couldn't be redefined. Nothing more to do here — the
    // reads below still fail soft, and callers that asked know the storage
    // is volatile.
  }
  return true;
}

/** Did this storage have to be replaced by the in-memory stand-in? */
export function isStorageVolatile(name) {
  return volatile.has(name);
}

/** `getItem` that answers null instead of throwing, whatever the storage. */
export function readStorage(key, name = 'localStorage') {
  try {
    return window[name].getItem(key);
  } catch {
    return null;
  }
}

if (typeof window !== 'undefined') {
  guardStorage(window, 'localStorage');
  guardStorage(window, 'sessionStorage');
}
