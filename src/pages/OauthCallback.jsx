import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { callbackErrorMessage } from '../lib/oauthClient.js';
import { ME_DID, OAUTH_CALLBACK_PATH } from '../config.js';

const RETURN_KEY = 'dame.oauth.return';
const AUTOSIGN_KEY = 'dame.guestbook.autosign';

/**
 * The OAuth redirect lands here. The session provider's `client.init()`
 * detects and consumes the URL response — by the time we render with
 * `loading === false`, the session is already in place (or it failed).
 *
 * Every way out of the page goes somewhere. A session goes back to where the
 * flow started. A failure — the visitor declined at the consent screen, or the
 * callback couldn't be matched to its request — says so and links back there.
 * And a visit that carries no response at all (a reload after the library has
 * consumed the params, or the URL typed in) is simply sent on: without that, it
 * sat on "Completing the OAuth handshake…" forever.
 */
export default function OauthCallback() {
  const navigate = useNavigate();
  const { session, loading, did, error } = useAtprotoSession();
  // Where a failed sign-in's "go back" link points, once the outcome is known.
  const [failedReturn, setFailedReturn] = useState(null);
  // The outcome is acted on once. Reading it consumes the stored return path
  // and flag, so a second pass (StrictMode's double effect, or any dependency
  // changing after) would find them gone and point the link at `/` instead.
  const settled = useRef(false);

  useEffect(() => {
    if (loading || settled.current) return;
    settled.current = true;
    const returnTo = safeReturnPath(readStored(RETURN_KEY));
    removeStored(RETURN_KEY);
    if (session) {
      // Visitors go back to wherever they started the flow (the guestbook,
      // usually). The owner lands on the admin desk — unless they signed in
      // from a record in the explorer to edit it, which is where they want to
      // be. (The guestbook's one-shot autosign flag is left for /welcoming to
      // read and clear.)
      const dest =
        did === ME_DID
          ? returnTo?.startsWith('/exploring')
            ? returnTo
            : '/admin'
          : returnTo || '/';
      navigate(dest, { replace: true });
      return;
    }
    // No session: the flag would otherwise reopen the sign sheet on some later
    // visit to /welcoming, for a sign-in that never happened.
    const wasSigning = readStored(AUTOSIGN_KEY) === '1';
    removeStored(AUTOSIGN_KEY);
    const back = returnTo || (wasSigning ? '/welcoming' : '/');
    if (error) setFailedReturn(back);
    else navigate(back, { replace: true });
  }, [loading, session, did, error, navigate]);

  if (error && !session) {
    return (
      <PageShell
        title="Sign-in didn’t complete"
        headTitle="Sign-in didn’t complete — dame.is"
      >
        <p>
          {callbackErrorMessage(error)}
          {failedReturn && (
            <>
              {' '}
              <Link to={failedReturn}>
                {failedReturn === '/welcoming'
                  ? 'Back to the guestbook.'
                  : 'Back to where you were.'}
              </Link>
            </>
          )}
        </p>
        <details className="oauth-callback-details">
          <summary className="small-caps">details</summary>
          <code>{String(error?.message || error)}</code>
        </details>
      </PageShell>
    );
  }

  return (
    <PageShell title="Signing in…" headTitle="Signing in — dame.is">
      <p className="placeholder-card">Completing the OAuth handshake…</p>
    </PageShell>
  );
}

function readStored(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function removeStored(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Unavailable storage holds nothing to clear.
  }
}

/**
 * A stored return path, if it's one this site should navigate to: same-origin
 * (a single leading slash, not `//host` — nor `/\host`, which a URL parser
 * reads the same way), and not this page — returning here would loop straight
 * back into the redirect above.
 */
function safeReturnPath(path) {
  if (typeof path !== 'string' || !/^\/(?![/\\])/.test(path)) return null;
  if (path.startsWith(OAUTH_CALLBACK_PATH)) return null;
  return path;
}
