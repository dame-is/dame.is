import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getOauthClient, getOauthEvents, scopeForAccount } from '../lib/oauthClient.js';

const Ctx = createContext(null);

// Cheap, durable "a session may exist" hint. The OAuth stack is the single
// heaviest thing in the bundle and only the owner + guestbook signers ever
// need it, so anonymous visitors must not load or run it at startup. We set
// this flag the moment a sign-in is initiated (before the redirect) and
// confirm it once `init()` returns a real session; we clear it whenever the
// session is deleted or `init()` finds none. On startup we only load the
// client + call `init()` when this hint is set or we've landed on the OAuth
// callback route — otherwise the whole tree stays unloaded.
const SESSION_HINT_KEY = 'dame.oauth.session';

function hasSessionHint() {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function setSessionHint() {
  try {
    localStorage.setItem(SESSION_HINT_KEY, '1');
  } catch {}
}

function clearSessionHint() {
  try {
    localStorage.removeItem(SESSION_HINT_KEY);
  } catch {}
}

/**
 * Provides ATProto OAuth session state.
 *
 *   const { session, agent, did, signIn, signOut, loading, error } = useAtprotoSession();
 *
 * `session` is an `OAuthSession` (or `null`). `agent` is an `@atproto/api` Agent
 * bound to that session, ready to use against the user's PDS.
 */
export function AtprotoSessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onOauthCallback =
      typeof window !== 'undefined' &&
      window.location.pathname.startsWith('/oauth/callback');

    // Anonymous visitors: no known session and not completing a callback, so
    // never load the OAuth stack. This is the site's biggest bundle win.
    if (!onOauthCallback && !hasSessionHint()) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let detachEvents = null;

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
          setSessionHint();
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
  }, []);

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
    // Optimistically mark that a session may exist so the post-redirect load
    // (and future visits, once init confirms it) runs the OAuth stack. init()
    // clears this again if the flow doesn't actually yield a session.
    setSessionHint();
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
    await client.signIn(input, { scope: scope || scopeForAccount(input) });
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
    }),
    [session, agent, loading, error, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAtprotoSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAtprotoSession must be used inside <AtprotoSessionProvider>');
  return v;
}
