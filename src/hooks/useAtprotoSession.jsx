import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getOauthClient, getOauthEvents, scopeForAccount } from '../lib/oauthClient.js';

const Ctx = createContext(null);

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
    let cancelled = false;
    let client;
    try {
      client = getOauthClient();
    } catch (err) {
      setError(err);
      setLoading(false);
      return undefined;
    }

    client
      .init()
      .then((result) => {
        if (cancelled) return;
        if (result?.session) setSession(result.session);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const events = getOauthEvents();
    const onDeleted = (event) => {
      const sub = event?.detail?.sub;
      setSession((current) => (current && current.sub === sub ? null : current));
    };
    events.addEventListener('deleted', onDeleted);
    return () => {
      cancelled = true;
      events.removeEventListener('deleted', onDeleted);
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
    const client = getOauthClient();
    const { returnTo, intent, scope } = opts;
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
