// The cheap, durable "a session may exist" hint the session provider reads at
// startup (see src/hooks/useAtprotoSession.jsx), and the decision it feeds.
//
// The OAuth stack is the heaviest thing the site can load — the client with
// its jose/zod tree, then @atproto/api for the Agent — so nobody pays for it
// unless a session might exist. The hint says whose session it would be,
// because the two kinds of signer need it at very different times:
//
//   - 'owner' — Dame. Edit mode, the admin and the chrome's pencil all hang
//     off the session on every page, so it's restored at startup.
//   - 'guest' — a visitor who signed the guestbook. Their session is good for
//     exactly one thing, writing (or removing) a signature, so restoring it on
//     every page of every later visit cost them a second entry bundle for
//     nothing. It's restored when a surface that can use it asks: the
//     guestbook page, the sign sheet, the account panel.
//
// Storage access fails soft everywhere: with no storage there's no hint, and
// the site behaves as it does for any anonymous visitor.

export const SESSION_HINT_KEY = 'dame.oauth.session';

const KINDS = new Set(['owner', 'guest']);

/**
 * 'owner' | 'guest' | null. A bare '1' is the hint as it was written before
 * the two were told apart; it reads as the owner's, so it keeps the eager
 * restore it always had until the next restore rewrites it with its kind.
 */
export function readSessionHint(storage) {
  let raw = null;
  try {
    raw = storage?.getItem(SESSION_HINT_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === '1') return 'owner';
  return KINDS.has(raw) ? raw : null;
}

export function writeSessionHint(storage, kind) {
  if (!KINDS.has(kind)) return;
  try {
    storage?.setItem(SESSION_HINT_KEY, kind);
  } catch {
    // Unwritable storage just means the next visit starts anonymous.
  }
}

export function clearSessionHint(storage) {
  try {
    storage?.removeItem(SESSION_HINT_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/**
 * Should the provider restore the session as soon as the app starts, rather
 * than waiting for a surface to ask? Always on the OAuth callback (that load
 * exists to finish a sign-in), always for the owner, never otherwise.
 */
export function restoresAtStartup({ hint, onCallback }) {
  return Boolean(onCallback) || hint === 'owner';
}
