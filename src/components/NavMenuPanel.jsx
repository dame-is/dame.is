// Admin editor for is.dame.nav/self — the optional PDS override for the site
// nav menu (the dock sheet). Toggle the override on/off, and select / reorder /
// relabel / hide the entries. With the override off (or no record), the site
// uses the hardcoded routes in src/lib/navRoutes.js. Nothing is written until
// Save.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronUp, ChevronDown, Trash2, Plus, RotateCcw, Eye, EyeOff } from 'lucide-react';
import PageShell from './PageShell.jsx';
import { AdminRecordListSkeleton } from './Skeleton.jsx';
import { NAV_NSID } from '../config.js';
import { DEFAULT_ROUTES } from '../lib/navRoutes.js';
import './NavMenuPanel.css';

const toItem = (r) => ({ to: r.to, label: r.label, hidden: false });
const normalizeItem = (it) => ({
  to: typeof it?.to === 'string' ? it.to : '',
  label: typeof it?.label === 'string' ? it.label : '',
  hidden: Boolean(it?.hidden),
});

export default function NavMenuPanel({ agent, did }) {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [items, setItems] = useState([]);
  const [createdAt, setCreatedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await agent.com.atproto.repo.getRecord({
          repo: did,
          collection: NAV_NSID,
          rkey: 'self',
        });
        const v = res?.data?.value;
        if (cancelled) return;
        if (v) {
          setEnabled(Boolean(v.enabled));
          setItems(
            Array.isArray(v.items) && v.items.length
              ? v.items.map(normalizeItem)
              : DEFAULT_ROUTES.map(toItem),
          );
          setCreatedAt(v.createdAt || null);
        } else {
          setItems(DEFAULT_ROUTES.map(toItem));
        }
      } catch {
        // No record yet — seed the editor from the site defaults.
        if (!cancelled) setItems(DEFAULT_ROUTES.map(toItem));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, did]);

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    setItems((prev) => {
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function patchItem(i, fields) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...fields } : it)));
  }
  function removeItem(i) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }
  function addItem() {
    setItems((prev) => [...prev, { to: '', label: '', hidden: false }]);
  }
  function resetDefaults() {
    setItems(DEFAULT_ROUTES.map(toItem));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setFlash(false);
    try {
      const cleanItems = items
        .map((it) => {
          const to = (it.to || '').trim();
          const label = (it.label || '').trim();
          const out = { to, label };
          if (it.hidden) out.hidden = true;
          return out;
        })
        .filter((it) => it.to && it.label);
      const now = new Date().toISOString();
      const record = {
        $type: NAV_NSID,
        enabled,
        items: cleanItems,
        createdAt: createdAt || now,
        updatedAt: now,
      };
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: NAV_NSID,
        rkey: 'self',
        record,
      });
      setCreatedAt(record.createdAt);
      setItems(cleanItems.map(normalizeItem));
      setFlash(true);
      setTimeout(() => setFlash(false), 2400);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell
      title="Nav menu"
      intro="Override the site's nav-menu route list. When the override is on, these entries replace the built-in menu — reorder, relabel, or hide them. Turn it off to fall back to the hardcoded routes. Nothing is written until you press Save."
      headTitle="Nav menu — Admin — dame.is"
    >
      <div className="admin-toolbar">
        <Link to="/admin" className="admin-link-subtle">← All collections</Link>
        <code className="admin-collection-nsid">{NAV_NSID}/self</code>
      </div>

      {error && <p className="admin-error">{error}</p>}

      {loading ? (
        <AdminRecordListSkeleton rows={4} />
      ) : (
        <>
          <label className="nav-enable">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>
              <strong>Use this override</strong>
              <span className="nav-enable-hint">
                {enabled
                  ? 'The menu below is live on the site.'
                  : 'Off — the site is using its built-in routes. Your edits are saved but dormant.'}
              </span>
            </span>
          </label>

          <ul className={`nav-items ${enabled ? '' : 'is-dormant'}`}>
            {items.map((it, i) => (
              <li key={i} className={`nav-item ${it.hidden ? 'is-hidden' : ''}`}>
                <div className="nav-item-reorder">
                  <button
                    type="button"
                    className="nav-item-btn"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label="Move up"
                    title="Move up"
                  >
                    <ChevronUp size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="nav-item-btn"
                    onClick={() => move(i, 1)}
                    disabled={i === items.length - 1}
                    aria-label="Move down"
                    title="Move down"
                  >
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                </div>

                <div className="nav-item-fields">
                  <input
                    className="admin-input nav-item-label"
                    type="text"
                    value={it.label}
                    placeholder="label"
                    onChange={(e) => patchItem(i, { label: e.target.value })}
                  />
                  <input
                    className="admin-input nav-item-path"
                    type="text"
                    value={it.to}
                    placeholder="/path"
                    spellCheck={false}
                    onChange={(e) => patchItem(i, { to: e.target.value })}
                  />
                </div>

                <div className="nav-item-actions">
                  <button
                    type="button"
                    className={`nav-item-btn ${it.hidden ? 'is-on' : ''}`}
                    onClick={() => patchItem(i, { hidden: !it.hidden })}
                    aria-pressed={it.hidden}
                    aria-label={it.hidden ? 'Show in menu' : 'Hide from menu'}
                    title={it.hidden ? 'Hidden — click to show' : 'Visible — click to hide'}
                  >
                    {it.hidden ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                  </button>
                  <button
                    type="button"
                    className="nav-item-btn nav-item-remove"
                    onClick={() => removeItem(i)}
                    aria-label="Remove entry"
                    title="Remove"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="nav-list-actions">
            <button type="button" className="admin-link-subtle nav-add" onClick={addItem}>
              <Plus size={14} aria-hidden="true" /> Add entry
            </button>
            <button type="button" className="admin-link-subtle" onClick={resetDefaults}>
              <RotateCcw size={13} aria-hidden="true" /> Reset to site defaults
            </button>
          </div>

          <div className="nav-save">
            <button
              type="button"
              className="admin-gate-button"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : flash ? 'Saved ✓' : 'Save'}
            </button>
          </div>
        </>
      )}
    </PageShell>
  );
}
