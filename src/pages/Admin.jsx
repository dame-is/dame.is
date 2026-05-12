import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import RecordEditor, { rkeyFromUri } from '../components/RecordEditor.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { ME_DID } from '../config.js';
import { LEXICONS, lexiconFor, knownCollections } from '../lib/lexicons.js';
import './Admin.css';

/**
 * Admin / CRUD editor. Single route — internal mode is driven by query params:
 *
 *   /admin                                  → collection picker
 *   /admin?c=<nsid>                         → record list for that collection
 *   /admin?c=<nsid>&r=<rkey>                → edit existing record
 *   /admin?c=<nsid>&mode=new                → create new record
 *
 * Using query params (not path segments) sidesteps the dot-in-path issue
 * with the SPA rewrite rule and keeps NSIDs like `app.bsky.feed.post` clean.
 */
export default function Admin() {
  const { session, agent, did, loading, signIn } = useAtprotoSession();
  const [params] = useSearchParams();
  const collection = params.get('c');
  const rkey = params.get('r');
  const mode = params.get('mode');

  if (loading) {
    return (
      <PageShell title="Admin" headTitle="Admin — Dame is…">
        <p className="placeholder-card">Restoring session…</p>
      </PageShell>
    );
  }

  if (!session) {
    return (
      <PageShell title="Admin" headTitle="Admin — Dame is…">
        <SignInGate signIn={signIn} />
      </PageShell>
    );
  }

  if (did !== ME_DID) {
    return (
      <PageShell title="Admin" headTitle="Admin — Dame is…">
        <p className="placeholder-card">
          Signed in as <code>{did}</code>, but this editor is restricted to{' '}
          <code>{ME_DID}</code>.
        </p>
      </PageShell>
    );
  }

  if (!collection) {
    return <CollectionPicker />;
  }
  if (mode === 'new') {
    return <RecordEditorPage agent={agent} did={did} collection={collection} rkey={null} />;
  }
  if (rkey) {
    return <RecordEditorPage agent={agent} did={did} collection={collection} rkey={rkey} />;
  }
  return <RecordList agent={agent} did={did} collection={collection} />;
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

/* ------------------------------------------------------------------ */
/* Collection picker                                                    */
/* ------------------------------------------------------------------ */

function CollectionPicker() {
  return (
    <PageShell
      title="Collections"
      intro="Pick a collection to browse and edit records on your PDS."
      headTitle="Admin — Dame is…"
    >
      <ul className="admin-collection-list">
        {knownCollections().map((nsid) => {
          const lex = LEXICONS[nsid];
          return (
            <li key={nsid} className="admin-collection-row">
              <Link to={`/admin?c=${encodeURIComponent(nsid)}`} className="admin-collection-link">
                <span className="admin-collection-label">{lex.label}</span>
                <code className="admin-collection-nsid">{nsid}</code>
              </Link>
              {lex.summary && <p className="admin-collection-summary">{lex.summary}</p>}
            </li>
          );
        })}
        <li className="admin-collection-row admin-collection-row-custom">
          <CustomCollectionInput />
        </li>
      </ul>
    </PageShell>
  );
}

function CustomCollectionInput() {
  const [value, setValue] = useState('');
  return (
    <form
      className="admin-custom-row"
      onSubmit={(e) => {
        e.preventDefault();
        const nsid = value.trim();
        if (!nsid) return;
        window.location.assign(`/admin?c=${encodeURIComponent(nsid)}`);
      }}
    >
      <label className="admin-collection-label">Other collection</label>
      <input
        className="admin-gate-input"
        placeholder="e.g. fm.teal.alpha.feed.play"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="admin-gate-button">Browse</button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Record list                                                          */
/* ------------------------------------------------------------------ */

function RecordList({ agent, did, collection }) {
  const [records, setRecords] = useState([]);
  const [cursor, setCursor] = useState(undefined);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lex = lexiconFor(collection);

  const loadPage = useCallback(
    async (after) => {
      setLoading(true);
      setError(null);
      try {
        const res = await agent.com.atproto.repo.listRecords({
          repo: did,
          collection,
          limit: 50,
          cursor: after || undefined,
        });
        const next = res?.data || res;
        const batch = next?.records || [];
        setRecords((prev) => (after ? [...prev, ...batch] : batch));
        setCursor(next?.cursor);
        if (!next?.cursor || batch.length === 0) setDone(true);
      } catch (err) {
        setError(err?.message || String(err));
      } finally {
        setLoading(false);
      }
    },
    [agent, did, collection],
  );

  useEffect(() => {
    setRecords([]);
    setCursor(undefined);
    setDone(false);
    loadPage(undefined);
  }, [loadPage]);

  return (
    <PageShell
      title={lex?.label || collection}
      headTitle={`${lex?.label || collection} — Admin — Dame is…`}
    >
      <div className="admin-toolbar">
        <Link to="/admin" className="admin-link-subtle">← All collections</Link>
        <code className="admin-collection-nsid">{collection}</code>
        <Link
          to={`/admin?c=${encodeURIComponent(collection)}&mode=new`}
          className="admin-gate-button admin-gate-button-tight"
        >
          New record
        </Link>
      </div>

      {error && <p className="admin-error">{error}</p>}

      {records.length === 0 && !loading && !error && (
        <p className="placeholder-card">No records yet in this collection.</p>
      )}

      <ul className="admin-record-list">
        {records.map((rec) => {
          const r = rkeyFromUri(rec.uri);
          return (
            <li key={rec.uri} className="admin-record-row">
              <Link
                to={`/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(r)}`}
                className="admin-record-link"
              >
                <code className="admin-record-rkey">{r}</code>
                <span className="admin-record-preview">{previewFor(rec.value, lex)}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {!done && records.length > 0 && (
        <button
          type="button"
          className="admin-gate-button admin-gate-button-tight"
          disabled={loading}
          onClick={() => loadPage(cursor)}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
      {loading && records.length === 0 && <p className="placeholder-card">Loading records…</p>}
    </PageShell>
  );
}

function previewFor(value, lex) {
  if (!value || typeof value !== 'object') return '';
  if (lex?.fields) {
    for (const f of lex.fields) {
      const v = value[f.key];
      if (typeof v === 'string' && v.trim()) {
        return f.key === 'createdAt' || f.key === 'updatedAt' ? '' : truncate(v, 120);
      }
    }
  }
  for (const k of ['title', 'status', 'text', 'name']) {
    if (typeof value[k] === 'string' && value[k].trim()) return truncate(value[k], 120);
  }
  return '';
}

function truncate(s, n) {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

/* ------------------------------------------------------------------ */
/* Record editor page wrapper                                           */
/* ------------------------------------------------------------------ */

function RecordEditorPage({ agent, did, collection, rkey }) {
  const lex = lexiconFor(collection);
  const isNew = !rkey;
  const title = isNew
    ? `New ${lex?.label || collection}`
    : `${lex?.label || collection}`;
  const headTitle = `${title} — Admin — Dame is…`;

  return (
    <PageShell title={title} headTitle={headTitle}>
      <div className="admin-toolbar">
        <Link to={`/admin?c=${encodeURIComponent(collection)}`} className="admin-link-subtle">
          ← Back to list
        </Link>
        <code className="admin-collection-nsid">{collection}</code>
        {!isNew && <code className="admin-record-rkey">{rkey}</code>}
      </div>
      <RecordEditor
        agent={agent}
        did={did}
        collection={collection}
        rkey={rkey}
        onCreated={({ rkey: newRkey }) => {
          window.location.assign(
            `/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(newRkey)}`,
          );
        }}
        onDeleted={() => {
          window.location.assign(`/admin?c=${encodeURIComponent(collection)}`);
        }}
      />
    </PageShell>
  );
}

