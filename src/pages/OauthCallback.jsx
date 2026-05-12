import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { ME_DID } from '../config.js';

/**
 * The OAuth redirect lands here. The session provider's `client.init()`
 * detects and consumes the URL response — by the time we render with
 * `loading === false`, the session is already in place (or it failed).
 */
export default function OauthCallback() {
  const navigate = useNavigate();
  const { session, loading, did, error } = useAtprotoSession();

  useEffect(() => {
    if (loading) return;
    if (session) {
      const dest = did === ME_DID ? '/admin' : '/';
      navigate(dest, { replace: true });
    }
  }, [loading, session, did, navigate]);

  return (
    <PageShell title="Signing in…" headTitle="Signing in — Dame is…">
      {error ? (
        <p className="placeholder-card">
          Sign-in failed: <code>{String(error?.message || error)}</code>
        </p>
      ) : (
        <p className="placeholder-card">Completing the OAuth handshake…</p>
      )}
    </PageShell>
  );
}
