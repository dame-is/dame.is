import { useCallback, useEffect, useState } from 'react';
import { lexiconFor, blankRecordFor } from '../lib/lexicons.js';
import '../pages/Admin.css';

/**
 * Reusable record editor (form + raw JSON + save/delete) shared by the admin
 * page and the atmosphere debug overlay.
 *
 * Renders the editor controls only — callers are responsible for wrapping it
 * in any page chrome (titles, breadcrumbs, etc).
 *
 * Props:
 *   - agent:       an atproto Agent bound to the signed-in user's PDS
 *   - did:         repo DID to write to (typically the signed-in user's DID)
 *   - collection:  lexicon NSID, e.g. "app.bsky.feed.post"
 *   - rkey:        record key for editing existing records, or null/undefined
 *                  when creating a new one
 *   - compact:     when true, hides the rkey input for fixed-rkey new-record
 *                  flows (the debug overlay doesn't need it) and tightens
 *                  spacing.
 *   - onSaved:     called with the updated record after a successful save
 *   - onDeleted:   called after a successful delete
 *   - onCreated:   called with `{ rkey }` after a successful create
 *   - initialMode: 'form' (default) or 'raw' — useful when callers want to
 *                  drop the user straight into JSON editing.
 */
export default function RecordEditor({
  agent,
  did,
  collection,
  rkey,
  compact = false,
  onSaved,
  onDeleted,
  onCreated,
  initialMode = 'form',
}) {
  const lex = lexiconFor(collection);
  const isNew = !rkey;

  const [original, setOriginal] = useState(null);
  const [value, setValue] = useState(null);
  const [rkeyDraft, setRkeyDraft] = useState(
    lex?.rkeyMode === 'fixed' ? lex.rkeyDefault || '' : '',
  );
  const [rawMode, setRawMode] = useState(initialMode === 'raw' || !lex);
  const [rawText, setRawText] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (isNew) {
      const draft = blankRecordFor(collection);
      setValue(draft);
      setOriginal(draft);
      setRawText(JSON.stringify(draft, null, 2));
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
    if (lex?.fields) {
      for (const f of lex.fields) {
        if (f.autoOnEdit && !isNew) {
          next[f.key] = new Date().toISOString();
        }
      }
    }
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
          onCreated?.({ rkey: chosen, record });
          return;
        }
        const res = await agent.com.atproto.repo.createRecord({
          repo: did,
          collection,
          record,
        });
        const data = res?.data || res;
        const newRkey = rkeyFromUri(data?.uri || '');
        onCreated?.({ rkey: newRkey, record, uri: data?.uri });
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
      onSaved?.(record);
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
      onDeleted?.();
    } catch (err) {
      setError(err?.message || String(err));
      setDeleting(false);
    }
  }

  function toggleRawMode() {
    if (!lex) return; // raw is forced for unknown lexicons
    if (!rawMode) {
      setRawText(JSON.stringify(buildRecordPayload(), null, 2));
    } else {
      try {
        const parsed = JSON.parse(rawText);
        setValue(parsed);
      } catch {
        return; // stay in raw mode if parse fails
      }
    }
    setRawMode((m) => !m);
  }

  if (loading) {
    return <p className="placeholder-card">Loading record…</p>;
  }

  return (
    <div className={`record-editor${compact ? ' record-editor-compact' : ''}`}>
      <div className="admin-toolbar admin-toolbar-inline">
        {lex && (
          <button
            type="button"
            className="admin-link-subtle"
            onClick={toggleRawMode}
          >
            {rawMode ? 'Use form' : 'Edit JSON'}
          </button>
        )}
      </div>

      {isNew && lex?.rkeyMode === 'fixed' && !compact && (
        <div className="admin-field">
          <label className="admin-field-label" htmlFor="record-editor-rkey">
            Record key (rkey)
          </label>
          <input
            id="record-editor-rkey"
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
    </div>
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
  const id = `record-editor-field-${field.key}`;
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
    case 'select':
      control = (
        <select
          id={id}
          className="admin-input"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {!field.required && <option value="">—</option>}
          {(field.options || []).map((opt) => {
            const val = typeof opt === 'string' ? opt : opt.value;
            const lbl = typeof opt === 'string' ? opt : opt.label ?? opt.value;
            return (
              <option key={val} value={val}>
                {lbl}
              </option>
            );
          })}
        </select>
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

export function rkeyFromUri(uri) {
  const m = String(uri || '').match(/\/([^/]+)$/);
  return m ? m[1] : uri;
}
