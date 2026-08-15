import { useState } from 'react';
import PageShell from '../components/PageShell.jsx';
import AdminShell from '../admin/AdminShell.jsx';
import WorkbenchSkeleton from '../admin/WorkbenchSkeleton.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { ME_DID } from '../config.js';
import './Admin.css';

/**
 * Admin. One route, one component, three gates, one shell.
 *
 * Everything that used to live here — the collection picker, the record list,
 * the record editor page, the site-pages / listening / legacy-blog managers —
 * moved into `src/admin/` and `src/components/`. What is left is the gate stack
 * and a single `<AdminShell/>`, and that is the point: this function used to
 * return THIRTEEN different component types from a flat `if` ladder, so React
 * unmounted one subtree and mounted another every time a query param changed.
 * Selecting a record threw away the list column, its scroll position and its
 * filter. Now the params are read inside the shell and every navigation
 * reconciles.
 *
 * The route is still `/admin` and all state is still query params:
 *
 *   /admin                                  → front desk
 *   /admin?view=<key>                       → a studio or a filtered records surface
 *   /admin?c=<nsid>                         → records surface
 *   /admin?c=<nsid>&r=<rkey>                → edit existing record
 *   /admin?c=<nsid>&mode=new[&for=creating] → create new record
 *
 * Query params rather than path segments is not a style choice: Vercel treats a
 * path segment containing dots (`app.bsky.feed.post`) as a static file, and the
 * admin can browse an arbitrary, unenumerated NSID that no rewrite list could
 * ever cover.
 *
 * HOOKS RULE: `useAtprotoSession()` runs above every gate and the gates only
 * early-return. Any new hook belongs either above them or inside `AdminShell` —
 * adding one below a gate changes hook order across the loading → signed-in
 * transition and crashes.
 */
export default function Admin() {
  const { session, agent, did, loading, signIn } = useAtprotoSession();

  if (loading) {
    return (
      <PageShell headTitle="Admin — dame.is">
        {/* Shell-shaped, so the admin resolves into the columns it is about to
            occupy instead of growing them out of a single-column list. */}
        <WorkbenchSkeleton />
      </PageShell>
    );
  }

  if (!session) {
    return (
      <PageShell title="Admin" headTitle="Admin — dame.is">
        <SignInGate signIn={signIn} />
      </PageShell>
    );
  }

  if (did !== ME_DID) {
    return (
      <PageShell title="Admin" headTitle="Admin — dame.is">
        <p className="placeholder-card">
          Signed in as <code>{did}</code>, but this editor is restricted to{' '}
          <code>{ME_DID}</code>.
        </p>
      </PageShell>
    );
  }

  return <AdminShell agent={agent} did={did} />;
}

/* ------------------------------------------------------------------ */
/* Gates                                                                */
/* ------------------------------------------------------------------ */

function SignInGate({ signIn }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(event) {
    event.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(input.trim());
    } catch (err) {
      setBusy(false);
      setError(err?.message || String(err));
    }
  }

  return (
    <form className="admin-gate" onSubmit={onSubmit}>
      <p className="admin-gate-intro">
        Sign in with your ATProto handle to edit records on your PDS.
      </p>
      <input
        className="admin-gate-input"
        placeholder="handle, DID, or PDS URL"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={busy}
        autoFocus
        spellCheck={false}
      />
      <button type="submit" className="admin-gate-button" disabled={busy || !input.trim()}>
        {busy ? 'Redirecting…' : 'Sign in'}
      </button>
      {error && <p className="admin-error">{error}</p>}
    </form>
  );
}
