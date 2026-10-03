// Getting the moderator session back when it dies.
//
// On 2026-10-03 at 07:06 UTC a token refresh was refused. @atproto/api answers
// a refused refresh by dropping the session, and every call after that goes out
// with no credentials at all. The process stayed up and looked healthy while
// every DM poll for eight hours failed with "Authentication Required", because
// nothing here ever logged in again.
//
// So a dead session is now noticed two ways -- the library's 'expired' event,
// and an authentication error out of any job -- and replaced: botAgent() resumes
// from the stored session if another process refreshed it, and logs in with
// the app password if not. Retries back off from 30 seconds to 15 minutes,
// because createSession is capped at 30 per 5 minutes and 300 a day, and a
// revoked app password must not burn through that.

const AUTH_ERROR =
  /Authentication Required|AuthMissing|ExpiredToken|InvalidToken|Token has expired|Token could not be verified|Bad token/i;

/** Did this fail because the session is gone, rather than for any other reason? */
export function isAuthError(err) {
  if (!err) return false;
  if (err.status === 401) return true;
  return AUTH_ERROR.test(`${err.error || ''} ${err.message || err}`);
}

/**
 * One reconnect at a time, backed off after failures.
 *
 * @param {object} opts
 * @param {() => Promise<{ via: string }>} opts.connect  re-establishes the
 *   session and swaps it in; resolves with how (resume or login)
 * @param {Function} [opts.log]
 * @returns {{ reconnect: (reason: string) => Promise<void>|null, failures: () => number }}
 */
export function createReconnector({
  connect,
  log = () => {},
  now = () => Date.now(),
  firstWaitMs = 30_000,
  maxWaitMs = 15 * 60_000,
}) {
  let running = null;
  let failures = 0;
  let notBefore = 0;
  let downSince = null;

  function reconnect(reason) {
    if (running) return running;
    if (downSince === null) downSince = now();
    if (now() < notBefore) return null;
    running = (async () => {
      try {
        const out = await connect();
        log('info', 'Re-established the moderator session', {
          via: out?.via ?? 'unknown',
          reason,
          downForS: Math.round((now() - downSince) / 1000),
        });
        failures = 0;
        notBefore = 0;
        downSince = null;
      } catch (err) {
        failures += 1;
        const waitMs = Math.min(maxWaitMs, firstWaitMs * 2 ** (failures - 1));
        notBefore = now() + waitMs;
        log('error', 'Could not re-establish the moderator session', {
          reason,
          err: String(err?.message || err),
          retryInS: Math.round(waitMs / 1000),
        });
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return { reconnect, failures: () => failures };
}
