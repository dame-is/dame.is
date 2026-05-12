import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { ME_DID } from '../config.js';
import { LEXICONS, lexiconFor, knownCollections, blankRecordFor } from '../lib/lexicons.js';
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
    return <RecordEditor agent={agent} did={did} collection={collection} rkey={null} />;
  }
  if (rkey) {
    return <RecordEditor agent={agent} did={did} collection={collection} rkey={rkey} />;
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

function rkeyFromUri(uri) {
  const m = String(uri || '').match(/\/([^/]+)$/);
  return m ? m[1] : uri;
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
/* Record editor                                                        */
/* ------------------------------------------------------------------ */

function RecordEditor({ agent, did, collection, rkey }) {
  const lex = lexiconFor(collection);
  const isNew = !rkey;

  const [original, setOriginal] = useState(null); // raw record value as fetched
  const [value, setValue] = useState(null); // working draft
  const [rkeyDraft, setRkeyDraft] = useState(
    lex?.rkeyMode === 'fixed' ? lex.rkeyDefault || '' : '',
  );
  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Initial load.
  useEffect(() => {
    let cancelled = false;
    if (isNew) {
      const draft = blankRecordFor(collection);
      setValue(draft);
      setOriginal(draft);
      setRawText(JSON.stringify(draft, null, 2));
      // Unknown collection w/ no template → start in raw mode.
      if (!lex) setRawMode(true);
      return undefined;
    }

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await agent.com.atproto.repo.getRecord({
          repo: did,
          collection,
          rkey,
        });
        const fetched = (res?.data || res)?.value || {};
        if (cancelled) return;
        setOriginal(fetched);
        setValue(structuredClone(fetched));
        setRawText(JSON.stringify(fetched, null, 2));
        if (!lex) setRawMode(true);
      } catch (err) {
        if (!cancelled) setError(err?.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [agent, did, collection, rkey, isNew, lex]);

  const updateField = useCallback((key, next) => {
    setValue((prev) => ({ ...(prev || {}), [key]: next }));
  }, []);

  const buildRecordPayload = useCallback(() => {
    if (rawMode) {
      const parsed = JSON.parse(rawText);
      if (lex?.typeFieldValue && !parsed.$type) parsed.$type = lex.typeFieldValue;
      return parsed;
    }
    const next = { ...(value || {}) };
    if (lex?.typeFieldValue) next.$type = lex.typeFieldValue;
    // Bump auto-updated fields.
    if (lex?.fields) {
      for (const f of lex.fields) {
        if (f.autoOnEdit && !isNew) {
          next[f.key] = new Date().toISOString();
        }
      }
    }
    // Strip empty optional string fields so we don't write empty strings.
    if (lex?.fields) {
      for (const f of lex.fields) {
        if (!f.required && (next[f.key] === '' || next[f.key] === undefined || next[f.key] === null)) {
          delete next[f.key];
        }
        if (f.type === 'tags' && Array.isArray(next[f.key]) && next[f.key].length === 0 && !f.required) {
          delete next[f.key];
        }
      }
    }
    return next;
  }, [value, lex, rawMode, rawText, isNew]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    try {
      const record = buildRecordPayload();
      if (isNew) {
        if (lex?.rkeyMode === 'fixed') {
          const chosen = rkeyDraft.trim();
          if (!chosen) throw new Error('Pick an rkey for this record.');
          await agent.com.atproto.repo.putRecord({
            repo: did,
            collection,
            rkey: chosen,
            record,
          });
          // Navigate to the new edit URL.
          window.location.assign(
            `/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(chosen)}`,
          );
          return;
        }
        const res = await agent.com.atproto.repo.createRecord({
          repo: did,
          collection,
          record,
        });
        const data = res?.data || res;
        const newRkey = rkeyFromUri(data?.uri || '');
        window.location.assign(
          `/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(newRkey)}`,
        );
        return;
      }
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection,
        rkey,
        record,
      });
      setOriginal(record);
      setValue(record);
      setRawText(JSON.stringify(record, null, 2));
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2400);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (isNew) return;
    if (!window.confirm(`Delete ${collection}/${rkey}? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
      window.location.assign(`/admin?c=${encodeURIComponent(collection)}`);
    } catch (err) {
      setError(err?.message || String(err));
      setDeleting(false);
    }
  }

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
        {lex && (
          <button
            type="button"
            className="admin-link-subtle"
            onClick={() => {
              if (!rawMode) {
                setRawText(JSON.stringify(buildRecordPayload(), null, 2));
              } else {
                try {
                  const parsed = JSON.parse(rawText);
                  setValue(parsed);
                } catch {
                  // Stay in raw mode if parse fails.
                  return;
                }
              }
              setRawMode((m) => !m);
            }}
          >
            {rawMode ? 'Use form' : 'Edit JSON'}
          </button>
        )}
      </div>

      {loading && <p className="placeholder-card">Loading record…</p>}

      {!loading && (
        <>
          {isNew && lex?.rkeyMode === 'fixed' && (
            <div className="admin-field">
              <label className="admin-field-label" htmlFor="admin-rkey">
                Record key (rkey)
              </label>
              <input
                id="admin-rkey"
                className="admin-input"
                value={rkeyDraft}
                onChange={(e) => setRkeyDraft(e.target.value)}
                placeholder={lex.rkeyPlaceholder || 'rkey'}
              />
              {lex.rkeyPlaceholder && (
                <p className="admin-field-hint">
                  Typical values: <code>{lex.rkeyPlaceholder}</code>
                </p>
              )}
            </div>
          )}

          {rawMode || !lex ? (
            <RawJsonEditor value={rawText} onChange={setRawText} />
          ) : (
            <FormEditor lex={lex} value={value || {}} onChange={updateField} />
          )}

          {error && <p className="admin-error">{error}</p>}
          {savedFlash && <p className="admin-success">Saved.</p>}

          <div className="admin-actions">
            <button
              type="button"
              className="admin-gate-button"
              onClick={handleSave}
              disabled={saving || deleting}
            >
              {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
            </button>
            {!isNew && (
              <button
                type="button"
                className="admin-gate-button admin-danger"
                onClick={handleDelete}
                disabled={saving || deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
          </div>
        </>
      )}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Field renderers                                                      */
/* ------------------------------------------------------------------ */

function FormEditor({ lex, value, onChange }) {
  return (
    <div className="admin-form">
      {lex.fields.map((f) => (
        <Field key={f.key} field={f} value={value[f.key]} onChange={(v) => onChange(f.key, v)} />
      ))}
    </div>
  );
}

function Field({ field, value, onChange }) {
  const id = `admin-field-${field.key}`;
  let control;
  switch (field.type) {
    case 'text':
      control = (
        <input
          id={id}
          className="admin-input"
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ''}
          maxLength={field.maxLength || undefined}
        />
      );
      break;
    case 'textarea':
      control = (
        <textarea
          id={id}
          className="admin-input admin-textarea"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder || ''}
          maxLength={field.maxLength || undefined}
          rows={4}
        />
      );
      break;
    case 'markdown':
      control = (
        <textarea
          id={id}
          className="admin-input admin-textarea admin-textarea-tall admin-mono"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={16}
        />
      );
      break;
    case 'datetime':
      control = <DatetimeField id={id} value={value} onChange={onChange} />;
      break;
    case 'tags':
      control = (
        <input
          id={id}
          className="admin-input"
          type="text"
          value={Array.isArray(value) ? value.join(', ') : ''}
          onChange={(e) => {
            const parts = e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            onChange(parts);
          }}
          placeholder="comma, separated"
        />
      );
      break;
    case 'number':
      control = (
        <input
          id={id}
          className="admin-input"
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
      break;
    case 'boolean':
      control = (
        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );
      break;
    case 'json':
      control = <JsonField id={id} value={value} onChange={onChange} />;
      break;
    default:
      control = (
        <input
          id={id}
          className="admin-input"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }

  return (
    <div className="admin-field">
      {field.type !== 'boolean' && (
        <label className="admin-field-label" htmlFor={id}>
          {field.label}
          {field.required && <span className="admin-field-required"> *</span>}
        </label>
      )}
      {control}
      {field.hint && <p className="admin-field-hint">{field.hint}</p>}
      {field.maxLength && typeof value === 'string' && (
        <p className="admin-field-hint">
          {value.length} / {field.maxLength}
        </p>
      )}
    </div>
  );
}

function DatetimeField({ id, value, onChange }) {
  const local = isoToLocalInput(value);
  return (
    <div className="admin-datetime">
      <input
        id={id}
        className="admin-input"
        type="datetime-local"
        step="1"
        value={local}
        onChange={(e) => {
          const next = localInputToIso(e.target.value);
          onChange(next);
        }}
      />
      <button type="button" className="admin-link-subtle" onClick={() => onChange(new Date().toISOString())}>
        now
      </button>
    </div>
  );
}

function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function localInputToIso(local) {
  if (!local) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function JsonField({ id, value, onChange }) {
  const [text, setText] = useState(() => stringifyJson(value));
  const [parseError, setParseError] = useState(null);

  useEffect(() => {
    setText(stringifyJson(value));
  }, [value]);

  return (
    <div>
      <textarea
        id={id}
        className="admin-input admin-textarea admin-mono"
        rows={6}
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          if (!next.trim()) {
            setParseError(null);
            onChange(undefined);
            return;
          }
          try {
            const parsed = JSON.parse(next);
            setParseError(null);
            onChange(parsed);
          } catch (err) {
            setParseError(err.message);
          }
        }}
      />
      {parseError && <p className="admin-field-hint admin-error-inline">JSON error: {parseError}</p>}
    </div>
  );
}

function stringifyJson(v) {
  if (v === undefined || v === null) return '';
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return '';
  }
}

function RawJsonEditor({ value, onChange }) {
  const [parseError, setParseError] = useState(null);
  return (
    <div className="admin-field">
      <label className="admin-field-label">Raw record JSON</label>
      <textarea
        className="admin-input admin-textarea admin-textarea-tall admin-mono"
        value={value}
        rows={20}
        onChange={(e) => {
          onChange(e.target.value);
          try {
            JSON.parse(e.target.value);
            setParseError(null);
          } catch (err) {
            setParseError(err.message);
          }
        }}
      />
      {parseError && <p className="admin-field-hint admin-error-inline">JSON error: {parseError}</p>}
    </div>
  );
}
