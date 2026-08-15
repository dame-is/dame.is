// Admin editor for is.dame.nav/self — the optional PDS override for the site
// nav menu (the dock sheet). Toggle the override on/off, and select / reorder /
// relabel / hide the entries. With the override off (or no record), the site
// uses the hardcoded routes in src/lib/navRoutes.js. Nothing is written until
// Save.
//
// As a studio it is a BODY, not a page: StudioPane draws the title, the blurb
// and the NSID, the rail is the way back, and the workbench's status strip owns
// Save — so this file renders no PageShell, no "← All collections" link and no
// save bar of its own. What it owes the shell instead is an honest answer to
// "is anything unsaved?", which is `baseline` below.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Trash2, Plus, RotateCcw, Eye, EyeOff } from 'lucide-react';
import { AdminRecordListSkeleton } from './Skeleton.jsx';
import { NAV_NSID } from '../config.js';
import { useAdminShell } from '../admin/useAdminShell.jsx';
import { DEFAULT_ROUTES } from '../lib/navRoutes.js';
import './NavMenuPanel.css';

const toItem = (r) => ({ to: r.to, label: r.label, hidden: false });
const normalizeItem = (it) => ({
  to: typeof it?.to === 'string' ? it.to : '',
  label: typeof it?.label === 'string' ? it.label : '',
  hidden: Boolean(it?.hidden),
});

/**
 * Value equality for the entry list. Order is part of the record — reordering
 * two entries changes what the menu looks like — so this compares position by
 * position rather than as a set.
 */
function sameItems(a, b) {
  if (a.length !== b.length) return false;
  return a.every(
    (it, i) => it.to === b[i].to && it.label === b[i].label && it.hidden === b[i].hidden,
  );
}

export default function NavMenuPanel({ agent, did }) {
  const { registerActions, reportDirty, invalidate } = useAdminShell();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [items, setItems] = useState([]);
  const [createdAt, setCreatedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(false);
  // What was last read from (or written to) the PDS. `null` until the load
  // settles, which is what keeps the strip quiet while the editor is still empty.
  const [baseline, setBaseline] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Both the "no record yet" and the "record exists" paths land here, so the
      // baseline is taken from exactly what the editor was seeded with — a
      // normalization can never read as an unsaved edit.
      let next = { enabled: false, items: DEFAULT_ROUTES.map(toItem), createdAt: null };
      try {
        const res = await agent.com.atproto.repo.getRecord({
          repo: did,
          collection: NAV_NSID,
          rkey: 'self',
        });
        const v = res?.data?.value;
        if (v) {
          next = {
            enabled: Boolean(v.enabled),
            items:
              Array.isArray(v.items) && v.items.length
                ? v.items.map(normalizeItem)
                : DEFAULT_ROUTES.map(toItem),
            createdAt: v.createdAt || null,
          };
        }
      } catch {
        // No record yet — seed the editor from the site defaults.
      }
      if (cancelled) return;
      setEnabled(next.enabled);
      setItems(next.items);
      setCreatedAt(next.createdAt);
      setBaseline({ enabled: next.enabled, items: next.items });
      setLoading(false);
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
    // One click used to silently destroy every edit in the list, with no undo
    // anywhere in this studio.
    if (
      !window.confirm(
        'Replace this list with the site’s built-in routes? Any edits here are lost.',
      )
    ) {
      return;
    }
    setItems(DEFAULT_ROUTES.map(toItem));
  }

  // The 2400ms "Saved ✓" flash outlives a fast surface flip, so it gets a handle
  // and a teardown rather than a fire-and-forget timeout.
  const flashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const handleSave = useCallback(async () => {
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
      const saved = cleanItems.map(normalizeItem);
      setCreatedAt(record.createdAt);
      setItems(saved);
      // The post-save baseline is what was WRITTEN, not what was on screen when
      // Save was pressed: saving drops the incomplete rows, so a baseline taken
      // from the pre-save `items` would leave the strip claiming unsaved changes
      // immediately after a successful save.
      setBaseline({ enabled, items: saved });
      setFlash(true);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(false), 2400);
      // The first save CREATES is.dame.nav/self, which flips this surface from
      // "absent" (dimmed in the rail, zero on the Front Desk) to present. The
      // counts cache holds for a minute, so say so rather than waiting it out.
      invalidate([NAV_NSID]);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [agent, did, items, enabled, createdAt, invalidate]);

  /* --- what the shell needs to know ------------------------------------- */

  // `handleSave` closes over the entry list, so it changes identity on every
  // keystroke. Registering it directly would republish the shell context — and
  // re-render every consumer of it — per character typed, so what gets
  // registered is this one stable wrapper around a latest-value ref.
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  const save = useCallback(() => saveRef.current(), []);

  useEffect(() => {
    registerActions({
      save,
      remove: null,
      saving,
      deleting: false,
      loading,
      // The nav override is a singleton the site falls back off gracefully; it
      // is turned OFF rather than deleted, so the strip offers no Delete.
      canDelete: false,
      isNew: false,
    });
  }, [registerActions, save, saving, loading]);

  const dirtyState = useMemo(() => {
    if (!baseline) return null;
    const fields = [];
    if (baseline.enabled !== enabled) fields.push('Use this override');
    if (!sameItems(baseline.items, items)) fields.push('Menu entries');
    return fields.length ? { dirty: true, fields, records: 0, note: null } : null;
  }, [baseline, enabled, items]);

  useEffect(() => {
    reportDirty(dirtyState);
  }, [reportDirty, dirtyState]);

  // Teardown, separately from the two publishing effects above: leaving this
  // surface must not strand a Save button or an "unsaved changes" sentence on
  // whatever opens next.
  useEffect(
    () => () => {
      registerActions(null);
      reportDirty(null);
    },
    [registerActions, reportDirty],
  );

  return (
    <>
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
            {/* Save lives on the shell's status strip now, so the confirmation
                it used to give inside its own button label needs somewhere to
                land — an empty row otherwise, not a layout shift. */}
            <span className="nav-flash" aria-live="polite">
              {flash ? <span className="admin-success">Saved ✓</span> : null}
            </span>
          </div>
        </>
      )}
    </>
  );
}
