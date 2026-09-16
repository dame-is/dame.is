// Let the admin panel call a protected endpoint, without inventing a secret.
//
// The browser already holds an atproto OAuth session. Rather than adding a
// password, a cookie or a session table, it asks the PDS for a short-lived
// token signed by dame's own signing key (com.atproto.server.getServiceAuth)
// and sends that. This endpoint verifies the signature against the key
// published in the DID document.
//
// What that buys: nothing to leak. There is no shared secret that can end up in
// a client bundle, a screenshot or a git history, and a stolen token is useless
// within a minute. What it costs: a secp256k1 verification, which is why
// @atproto/crypto is a dependency — dame's key is `zQ3s...`, and secp256k1 is
// the one curve Node's WebCrypto does not implement.
//
// Single-user by construction. `iss` must be ME_DID, full stop. This is not an
// authorization framework and should not grow into one: if a second person ever
// needs access, that is a real access-control design, not another DID in a
// comparison.

import { verifySignature, parseDidKey } from '@atproto/crypto';
import { ME_DID, PLC_DIRECTORY } from '../../src/config.js';

/** Tokens older than this are refused outright, whatever `exp` claims. */
const MAX_LIFETIME_MS = 10 * 60 * 1000;

const b64urlToBytes = (s) =>
  new Uint8Array(
    Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
  );

/**
 * The signing key from the DID document, as a did:key string.
 *
 * Read fresh rather than cached. A cached key is a key that keeps working after
 * it has been rotated, and rotation is exactly what you do when a key has been
 * compromised — the one moment the cache would be actively harmful.
 */
async function signingKeyFor(did, fetchImpl) {
  if (!did.startsWith('did:plc:')) {
    throw new Error(`unsupported DID method for ${did}`);
  }
  const res = await fetchImpl(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`could not resolve ${did}`);
  const doc = await res.json();
  const vm = (doc.verificationMethod || []).find(
    (m) => m.id === `${did}#atproto` || m.id?.endsWith('#atproto'),
  );
  if (!vm?.publicKeyMultibase) {
    throw new Error(`no atproto signing key published for ${did}`);
  }
  return `did:key:${vm.publicKeyMultibase}`;
}

/**
 * Verify an atproto service-auth JWT.
 *
 * Checks, in order: shape, issuer, audience, expiry, lifetime ceiling, declared
 * method, then the signature. The signature is checked LAST because it is the
 * expensive step and every cheap rejection above it is free.
 *
 * @param {string} token   the raw JWT
 * @param {object} [opts]
 * @param {string} [opts.lxm] required NSID the token must be scoped to
 * @returns {Promise<{ iss: string, aud: string, exp: number, lxm?: string }>}
 */
export async function verifyServiceAuth(
  token,
  { lxm, fetchImpl = fetch } = {},
) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

  if (payload.iss !== ME_DID) throw new Error('issuer is not the site owner');
  // Self-audienced: this site has no service DID of its own, so a token minted
  // for dame, by dame, is the whole claim being made. Requiring the field to be
  // present and correct still stops a token minted for some OTHER service from
  // being replayed here.
  if (payload.aud !== ME_DID)
    throw new Error('token was not minted for this service');
  if (lxm && payload.lxm !== lxm) {
    throw new Error(
      `token is scoped to ${payload.lxm || 'nothing'}, not ${lxm}`,
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('token has expired');
  }
  if (payload.exp * 1000 - Date.now() > MAX_LIFETIME_MS) {
    throw new Error('token lifetime is longer than this endpoint accepts');
  }

  const didKey = await signingKeyFor(payload.iss, fetchImpl);
  const { jwtAlg } = parseDidKey(didKey);
  if (header.alg !== jwtAlg) {
    throw new Error(`token alg ${header.alg} does not match the published key`);
  }

  const ok = await verifySignature(
    didKey,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    b64urlToBytes(sigB64),
    // atproto signatures are non-malleable (low-S); accepting high-S would let
    // a captured token be reshaped into a second valid one.
    { allowMalleableSig: false },
  );
  if (!ok) throw new Error('bad signature');

  return payload;
}

/**
 * Gate a handler on either the cron secret or a service-auth token.
 *
 * Returns the caller kind on success, or null after writing a 401 — so a
 * handler reads `if (!(await authorize(req, res))) return;` and cannot forget
 * to stop.
 */
export async function authorize(req, res, { lxm } = {}) {
  const auth = req.headers?.authorization || '';
  const secret = process.env.CRON_SECRET;

  if (secret && auth === `Bearer ${secret}`) return 'cron';

  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (token) {
    try {
      await verifyServiceAuth(token, { lxm });
      return 'owner';
    } catch (err) {
      res.status(401).json({ error: `Unauthorized: ${err.message}` });
      return null;
    }
  }

  // Fail closed. An unset CRON_SECRET must not mean "open to everyone" — that
  // is how a misconfigured preview deployment becomes a public moderation log.
  res.status(401).json({ error: 'Unauthorized' });
  return null;
}
