import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { ME_DID } from '../config.js';
import { getProfile, resolvePds } from '../lib/atproto.js';
import { Skeleton } from './Skeleton.jsx';
import './SignInPanel.css';

/**
 * Sign-in surface that lives inside the ActionDock's Account view.
 *
 *   - Signed out → a tiny handle / DID / PDS-URL field that kicks off the
 *     OAuth flow.
 *   - Signed in → an identity card: avatar, name/handle, a follower /
 *     following / posts stat row, a did / pds ledger, and the account
 *     actions (Admin for the owner, Sign out). The profile and PDS are
 *     fetched lazily, so each block fades from a skeleton into the real
 *     value as it resolves.
 */
export default function SignInPanel({ onAction }) {
  const { session, did, loading, signIn, signOut } = useAtprotoSession();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [pdsHost, setPdsHost] = useState(null);

  useEffect(() => {
    setProfile(null);
    setPdsHost(null);
    if (!did) return undefined;
    let cancelled = false;
    setProfileLoading(true);
    getProfile(did)
      .then((p) => {
        if (!cancelled && p) setProfile(p);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });
    resolvePds(did)
      .then((pds) => {
        if (!cancelled && pds) setPdsHost(prettyHost(pds));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [did]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(input.trim());
      // Redirected away; if we somehow keep running, clear state.
    } catch (err) {
      setBusy(false);
      setError(err?.message || String(err));
    }
  }

  async function handleSignOut() {
    await signOut();
    onAction?.();
  }

  if (loading) {
    return (
      <div className="signin-panel">
        <div className="signin-status">Restoring session…</div>
      </div>
    );
  }

  if (session) {
    const isOwner = did === ME_DID;
    const handle =
      profile?.handle && profile.handle !== 'handle.invalid' ? profile.handle : null;
    const displayName = profile?.displayName?.trim() || null;

    return (
      <div className="account-panel">
        <div className="account-identity">
          <span className="account-avatar">
            {profile?.avatar ? (
              <img src={profile.avatar} alt="" className="account-avatar-img" />
            ) : profileLoading ? (
              <Skeleton style={{ width: '100%', height: '100%' }} />
            ) : (
              <span className="account-avatar-empty" aria-hidden="true">@</span>
            )}
          </span>
          <span className="account-identity-text">
            <span className="small-caps account-eyebrow">signed in</span>
            {displayName && <span className="account-name reveal">{displayName}</span>}
            {handle ? (
              <span className="account-handle reveal" title={did || ''}>
                @{handle}
              </span>
            ) : profileLoading ? (
              <Skeleton width="9rem" height="1.05em" />
            ) : (
              <code className="account-handle account-handle-did" title={did || ''}>
                {shortDid(did)}
              </code>
            )}
          </span>
        </div>

        <dl className="account-stats">
          <AccountStat label="followers" value={profile?.followersCount} loading={profileLoading} />
          <AccountStat label="following" value={profile?.followsCount} loading={profileLoading} />
          <AccountStat label="posts" value={profile?.postsCount} loading={profileLoading} />
        </dl>

        <dl className="account-meta">
          <div className="account-meta-row">
            <dt className="small-caps">did</dt>
            <dd>
              <code>{did}</code>
            </dd>
          </div>
          <div className="account-meta-row">
            <dt className="small-caps">pds</dt>
            <dd>
              {pdsHost ? (
                <code className="reveal">{pdsHost}</code>
              ) : (
                <Skeleton width="7rem" height="0.8em" />
              )}
            </dd>
          </div>
        </dl>

        <nav className="account-actions">
          {isOwner && (
            <Link to="/admin" className="account-action" onClick={onAction}>
              <span className="account-action-label">Admin</span>
              <span className="account-action-glyph" aria-hidden="true">
                &rsaquo;
              </span>
            </Link>
          )}
          <button type="button" className="account-action" onClick={handleSignOut}>
            <span className="account-action-label">Sign out</span>
            <span className="account-action-glyph" aria-hidden="true">
              ×
            </span>
          </button>
        </nav>
      </div>
    );
  }

  return (
    <form className="signin-panel" onSubmit={handleSubmit}>
      <label className="signin-label" htmlFor="signin-input">
        <span className="small-caps">Sign in with ATProto</span>
      </label>
      <input
        id="signin-input"
        className="signin-input"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="handle, DID, or PDS URL"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={busy}
      />
      <button type="submit" className="signin-button" disabled={busy || !input.trim()}>
        {busy ? 'Redirecting…' : 'Sign in'}
      </button>
      {error && <p className="signin-error">{error}</p>}
    </form>
  );
}

/**
 * One stat in the account identity row — a large serif count above a
 * small-caps label, or a skeleton while the profile is still loading.
 */
function AccountStat({ label, value, loading }) {
  const hasValue = typeof value === 'number';
  return (
    <div className="account-stat">
      <dt className="account-stat-label small-caps">{label}</dt>
      <dd className="account-stat-value">
        {hasValue ? (
          <span className="reveal">{value.toLocaleString()}</span>
        ) : loading ? (
          <Skeleton width="2.5rem" height="1.1em" />
        ) : (
          '—'
        )}
      </dd>
    </div>
  );
}

function prettyHost(url) {
  return String(url || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

function shortDid(did) {
  if (!did) return '';
  if (did.length <= 24) return did;
  return `${did.slice(0, 12)}…${did.slice(-8)}`;
}
