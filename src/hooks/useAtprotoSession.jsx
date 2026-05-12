import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Agent } from '@atproto/api';
import { getOauthClient, OAUTH_SCOPE } from '../lib/oauthClient.js';

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

    const onDeleted = (event) => {
      const sub = event?.detail?.sub;
      setSession((current) => (current && current.sub === sub ? null : current));
    };
    client.addEventListener('deleted', onDeleted);
    return () => {
      cancelled = true;
      client.removeEventListener('deleted', onDeleted);
    };
  }, []);

  const agent = useMemo(() => (session ? new Agent(session) : null), [session]);

  const signIn = useCallback(async (input) => {
    const client = getOauthClient();
    // Resolves to a redirect — promise typically never resolves.
    await client.signIn(input, { scope: OAUTH_SCOPE });
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
      loading,
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
