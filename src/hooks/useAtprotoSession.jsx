import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  OWNER_SCOPE,
  getOauthClient,
  getOauthEvents,
  scopeForAccount,
} from '../lib/oauthClient.js';
import {
  clearSessionHint as clearStoredHint,
  readSessionHint,
  restoresAtStartup,
  writeSessionHint,
} from '../lib/sessionHint.js';
import { ME_DID, OAUTH_CALLBACK_PATH } from '../config.js';

const Ctx = createContext(null);

// Cheap, durable "a session may exist" hint (src/lib/sessionHint.js). The
// OAuth stack is the single heaviest thing in the bundle and only the owner +
// guestbook signers ever need it, so anonymous visitors must not load or run
// it at startup. We set the hint the moment a sign-in is initiated (before the
// redirect) and confirm it once `init()` returns a real session; we clear it
// whenever the session is deleted or `init()` finds none. The hint also says
// whose session it is: the owner's is restored at startup, a guestbook
// signer's only once a surface that can use it calls `restore()`.

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function setSessionHint(kind) {
  writeSessionHint(storage(), kind);
}

function clearSessionHint() {
  clearStoredHint(storage());
}

function onCallbackPath() {
  return (
    typeof window !== 'undefined' &&
    window.location.pathname.startsWith(OAUTH_CALLBACK_PATH)
  );
}

/**
 * Provides ATProto OAuth session state.
 *
 *   const { session, agent, did, signIn, signOut, restore, loading, error } =
 *     useAtprotoSession();
 *
 * `session` is an `OAuthSession` (or `null`). `agent` is an `@atproto/api` Agent
 * bound to that session, ready to use against the user's PDS.
 *
 * `restore()` asks for a guestbook signer's session, which (unlike the
 * owner's) isn't restored at startup. Surfaces that act on it call it when
 * they mount; it does nothing for a visitor with no session to restore, and
 * nothing once a restore has run.
 */
export function AtprotoSessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  // Whether to load the OAuth client and restore now. Starts true only where
  // the session is needed from the first render (see restoresAtStartup) and
  // flips true, once, when a surface calls restore().
  const [restoreWanted, setRestoreWanted] = useState(() =>
    restoresAtStartup({
      hint: readSessionHint(storage()),
      onCallback: onCallbackPath(),
    }),
  );
  const [loading, setLoading] = useState(restoreWanted);
  const restoreRequested = useRef(restoreWanted);

  const restore = useCallback(() => {
    if (restoreRequested.current || !readSessionHint(storage())) return;
    restoreRequested.current = true;
    // `loading` flips in the same render as the request, so a surface that
    // asks doesn't first draw its signed-out state for a frame.
    setLoading(true);
    setRestoreWanted(true);
  }, []);

  useEffect(() => {
    // Anonymous visitors, and guest signers until a surface asks: never load
    // the OAuth stack. This is the site's biggest bundle win.
    if (!restoreWanted) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let detachEvents = null;
    setLoading(true);

    (async () => {
      let client;
      try {
        client = await getOauthClient();
      } catch (err) {
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;

      const events = getOauthEvents();
      const onDeleted = (event) => {
        const sub = event?.detail?.sub;
        clearSessionHint();
        setSession((current) => (current && current.sub === sub ? null : current));
      };
      events.addEventListener('deleted', onDeleted);
      detachEvents = () => events.removeEventListener('deleted', onDeleted);

      try {
        const result = await client.init();
        if (cancelled) return;
        if (result?.session) {
          setSessionHint(result.session.sub === ME_DID ? 'owner' : 'guest');
          setSession(result.session);
        } else {
          // No live session (never signed in, or it was revoked/expired) —
          // drop the hint so the next visit skips the OAuth load entirely.
          clearSessionHint();
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (detachEvents) detachEvents();
    };
  }, [restoreWanted]);

  const [agent, setAgent] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setAgent(null);
      return undefined;
    }
    import('@atproto/api').then(({ Agent }) => {
      if (cancelled) return;
      setAgent(new Agent(session));
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const signIn = useCallback(async (input, opts = {}) => {
    const client = await getOauthClient();
    const { returnTo, intent, scope } = opts;
    const grant = scope || scopeForAccount(input);
    // Optimistically mark that a session may exist so the post-redirect load
    // (and future visits, once init confirms it) runs the OAuth stack. init()
    // clears this again if the flow doesn't actually yield a session, and
    // corrects the kind once it knows whose session it is.
    setSessionHint(grant === OWNER_SCOPE ? 'owner' : 'guest');
    // Remember where the visitor was so the callback can send them back — e.g.
    // signing in from the guestbook sheet returns them to /welcoming. When the
    // sign-in was kicked off to sign the book, leave a one-shot flag so the
    // guestbook page can reopen the sign sheet on return. Session-scoped so a
    // stale path/flag never leaks into a later, unrelated sign-in.
    try {
      sessionStorage.setItem('dame.oauth.return', returnTo || window.location.pathname);
      if (intent === 'guestbook-sign') sessionStorage.setItem('dame.guestbook.autosign', '1');
    } catch {}
    // The owner gets the broad admin scope; everyone else gets a scope that can
    // only write their guestbook signature. Resolves to a redirect — the
    // promise typically never resolves.
    await client.signIn(input, { scope: grant });
  }, []);

  const signOut = useCallback(async () => {
    if (!session) return;
    try {
      await session.signOut();
    } catch {
      // ignore network errors on revoke; we still drop local state
    }
    clearSessionHint();
    setSession(null);
  }, [session]);

  const value = useMemo(
    () => ({
      session,
      agent,
      did: session?.sub || null,
      // True until init() resolves *and* (if signed in) the Agent module has loaded.
      loading: loading || (session && !agent),
      error,
      signIn,
      signOut,
      restore,
    }),
    [session, agent, loading, error, signIn, signOut, restore],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAtprotoSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAtprotoSession must be used inside <AtprotoSessionProvider>');
  return v;
}
