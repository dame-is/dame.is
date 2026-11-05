// The admin's Overlays studio (`/admin?view=overlays`): stream overlays and
// scenes for OBS, one is.dame.overlay record each, on the site's grid and in
// the hour's sky. See src/lib/overlay.js for the model and
// src/pages/Overlay.jsx for the page OBS loads.
//
// Three states, all in the URL so Back works:
//
//   ?view=overlays               every overlay, as small previews
//   ?view=overlays&mode=new      the presets to start a new one from
//   ?view=overlays&r=<id>        one overlay open: a live preview to place
//                                widgets on, and a column of settings
//
// The preview IS the overlay: the same OverlayCanvas the public page draws,
// scaled, with a layer over it for picking a widget, dragging it to another
// cell and pulling its corner to resize it, all snapped to the grid. Arrow
// keys move the picked widget a cell; with Shift they resize it.
//
// As a studio it is a BODY, not a page (StudioPane.jsx): the strip owns Save
// and Delete, and nothing is written until Save. A new overlay's id comes from
// its name when it is first saved, and is its address from then on.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, ExternalLink, Plus, Redo2, RotateCw, Trash2, Undo2 } from 'lucide-react';
import Button from './Button.jsx';
import Segmented from './Segmented.jsx';
import SectionHead from './SectionHead.jsx';
import { AdminRecordListSkeleton } from './Skeleton.jsx';
import OverlayCanvas from '../overlay/OverlayCanvas.jsx';
import { useAdminShell } from '../admin/useAdminShell.jsx';
import { isSwapConflict } from '../lib/recordWrites.js';
import { canRedo, canUndo, createHistory, keyAction, record as recordStep, redo, replacePresent, undo } from '../lib/editHistory.js';
import { skyHourLabel } from '../lib/skyTheme.js';
import { easternHour } from '../lib/time.js';
import {
  CANVAS_H,
  CANVAS_W,
  CELL,
  COLS,
  MARGIN_X,
  MARGIN_Y,
  MAX_WIDGETS,
  NAME_MAX,
  MIN_SCALE,
  MAX_SCALE,
  OVERLAY_NSID,
  PITCH,
  PRESETS,
  ROWS,
  WIDGETS,
  CATALOG,
  NO_SURFACE,
  STYLES,
  VOICES,
  arrangeFrames,
  arrangementsFor,
  catalogEntry,
  frameTransforms,
  rotateFrames,
  boxOf,
  clampInt,
  fromRecord,
  moveWidget,
  newOverlayId,
  newWidget,
  overlayPath,
  resizeWidget,
  sameOverlay,
  toRecord,
} from '../lib/overlay.js';
import './siteStudios.css';
import './OverlayStudio.css';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * A draft handed from one overlay to the "new" screen (Duplicate), read once.
 * Module-level because the hand-off crosses a navigation, which remounts the
 * editor; nothing else needs it, so it is not worth a URL parameter.
 */
let pendingSeed = null;

/** The Eastern hour, kept current. */
function useHourNow() {
  const [hour, setHour] = useState(() => easternHour());
  useEffect(() => {
    const id = window.setInterval(() => setHour(easternHour()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return hour;
}

/** The width of an element, as it changes. */
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    setWidth(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setWidth(node.clientWidth));
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/* --- the list ---------------------------------------------------------------- */

function useOverlays(agent, did) {
  const [state, setState] = useState({ status: 'loading', items: [], error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = [];
        let cursor;
        do {
          const res = await agent.com.atproto.repo.listRecords({
            repo: did,
            collection: OVERLAY_NSID,
            limit: 100,
            cursor,
          });
          for (const r of res.data.records || []) {
            const id = r.uri.slice(r.uri.lastIndexOf('/') + 1);
            items.push({
              id,
              config: fromRecord(r.value),
              createdAt: typeof r.value?.createdAt === 'string' ? r.value.createdAt : null,
              cid: r.cid,
            });
          }
          cursor = res.data.cursor;
          if (!res.data.records?.length) break;
        } while (cursor && items.length < 500);
        items.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        if (!cancelled) setState({ status: 'ready', items, error: null });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', items: [], error: err?.message || String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, did, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  /** Put one in (or take it out) straight away, ahead of the next read. */
  const patch = useCallback((id, item) => {
    setState((s) => ({
      ...s,
      items: item
        ? s.items.some((i) => i.id === id)
          ? s.items.map((i) => (i.id === id ? item : i))
          : [...s.items, item]
        : s.items.filter((i) => i.id !== id),
    }));
  }, []);
  return { ...state, reload, patch };
}

/* --- a small preview ---------------------------------------------------------- */

function Thumb({ config, hour }) {
  const [ref, width] = useWidth();
  const scale = width / CANVAS_W;
  return (
    <div ref={ref} className="os-thumb" data-backdrop={config.backdrop} style={{ height: CANVAS_H * scale || undefined }}>
      {width > 0 ? (
        <div className="os-scaled" style={{ transform: `scale(${scale})` }}>
          <OverlayCanvas config={config} hour={config.hour ?? hour} demo />
        </div>
      ) : null}
    </div>
  );
}

/* --- the studio --------------------------------------------------------------- */

export default function OverlayStudio({ agent, did, rkey = null, isNew = false, onPaneMeta }) {
  const { go, invalidate } = useAdminShell();
  const list = useOverlays(agent, did);
  const hourNow = useHourNow();
  const [seed, setSeed] = useState(null);

  // A fresh "new" screen starts on the presets, unless Duplicate sent a draft.
  useEffect(() => {
    if (!isNew) {
      setSeed(null);
      return;
    }
    if (pendingSeed) {
      setSeed(pendingSeed);
      pendingSeed = null;
    } else setSeed(null);
  }, [isNew]);

  const taken = useMemo(() => list.items.map((i) => i.id), [list.items]);

  const onSaved = useCallback(
    (id, item, wasNew) => {
      list.patch(id, item);
      invalidate([OVERLAY_NSID]);
      if (wasNew) go({ r: id, mode: null }, { replace: true, force: true });
    },
    [list, go, invalidate],
  );
  const onDeleted = useCallback(
    (id) => {
      list.patch(id, null);
      invalidate([OVERLAY_NSID]);
      go({ r: null, mode: null }, { force: true });
    },
    [list, go, invalidate],
  );
  const onDuplicate = useCallback(
    (config) => {
      pendingSeed = { ...config, name: config.name ? `${config.name} copy` : 'copy' };
      go({ r: null, mode: 'new' });
    },
    [go],
  );

  // The head names the overlay while one is open.
  const open = rkey ? list.items.find((i) => i.id === rkey) : null;
  useEffect(() => {
    if (!onPaneMeta) return undefined;
    if (isNew) onPaneMeta({ title: 'New overlay', blurb: seed ? 'Saved under an address made from its name.' : 'Start from one of these, then make it yours.' });
    else if (rkey) onPaneMeta({ title: open?.config.name || rkey, blurb: `dame.is${overlayPath(rkey)}` });
    else onPaneMeta(null);
    return () => onPaneMeta(null);
  }, [onPaneMeta, isNew, seed, rkey, open]);

  if (list.status === 'loading') return <AdminRecordListSkeleton rows={3} />;
  if (list.status === 'error') {
    return (
      <div className="ss-section">
        <p className="ss-empty">The overlays could not be read, so the studio stays closed rather than opening empty.</p>
        <p className="ss-hint">{list.error}</p>
        <div className="ss-actions">
          <Button onClick={list.reload}>Try again</Button>
        </div>
      </div>
    );
  }

  if (isNew && !seed) {
    return <PresetPicker hour={hourNow} onPick={(config) => setSeed(config)} onCancel={() => go({ mode: null })} />;
  }
  if (isNew && seed) {
    return (
      <OverlayEditor
        key="new"
        agent={agent}
        did={did}
        id={null}
        saved={null}
        seed={seed}
        taken={taken}
        hourNow={hourNow}
        onSaved={onSaved}
        onDeleted={onDeleted}
        onDuplicate={onDuplicate}
      />
    );
  }
  if (rkey) {
    if (!open) {
      return (
        <div className="ss-section">
          <p className="ss-empty">There is no overlay called “{rkey}” on your PDS.</p>
          <div className="ss-actions">
            <Button onClick={() => go({ r: null })}>All overlays</Button>
          </div>
        </div>
      );
    }
    return (
      <OverlayEditor
        key={rkey}
        agent={agent}
        did={did}
        id={rkey}
        saved={open}
        seed={null}
        taken={taken}
        hourNow={hourNow}
        onSaved={onSaved}
        onDeleted={onDeleted}
        onDuplicate={onDuplicate}
      />
    );
  }
  return <OverlayIndex items={list.items} hour={hourNow} onOpen={(id) => go({ r: id, mode: null })} onNew={() => go({ r: null, mode: 'new' })} />;
}

/* --- every overlay ------------------------------------------------------------ */

function OverlayIndex({ items, hour, onOpen, onNew }) {
  return (
    <div className="ss-section">
      <SectionHead
        title="Overlays"
        meta={
          <Button size="sm" onClick={onNew}>
            <Plus size={14} aria-hidden="true" /> New overlay
          </Button>
        }
      />
      {items.length === 0 ? (
        <p className="ss-empty">
          No overlays yet. Start one from a preset: a live overlay to sit over a capture, or a starting, be-right-back,
          ending or screen-share scene.
        </p>
      ) : (
        <ul className="os-cards">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="os-card" onClick={() => onOpen(item.id)}>
                <Thumb config={item.config} hour={hour} />
                <span className="os-card-name">{item.config.name || item.id}</span>
                <span className="os-card-meta">
                  {overlayPath(item.id)} · {item.config.widgets.length} widget{item.config.widgets.length === 1 ? '' : 's'}
                  {item.config.backdrop === 'page' ? ' · scene' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="ss-hint">
        Each overlay is a browser source: in OBS add a <em>Browser</em> source at 1920 × 1080 and paste its address.
        stream.place takes whatever OBS sends it, so that is how an overlay reaches a stream there too.
      </p>
    </div>
  );
}

function PresetPicker({ hour, onPick, onCancel }) {
  return (
    <div className="ss-section">
      <SectionHead
        title="Start from"
        meta={
          <Button size="sm" variant="text" onClick={onCancel}>
            Cancel
          </Button>
        }
      />
      <ul className="os-cards">
        {PRESETS.map((p) => (
          <li key={p.key}>
            <button type="button" className="os-card" onClick={() => onPick(fromRecord(p.config))}>
              <Thumb config={fromRecord(p.config)} hour={hour} />
              <span className="os-card-name">{p.name}</span>
              <span className="os-card-meta">{p.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --- one overlay -------------------------------------------------------------- */

function OverlayEditor({ agent, did, id, saved, seed, taken, hourNow, onSaved, onDeleted, onDuplicate }) {
  const { registerActions, reportDirty } = useAdminShell();
  const initial = useMemo(() => fromRecord(saved ? saved.config : seed), [saved, seed]);
  // The draft, with its undo history (lib/editHistory.js). Every change goes
  // through setDraft; a `group` folds a gesture's changes into one step.
  const [hist, setHist] = useState(() => createHistory(initial));
  const draft = hist.present;
  const setDraft = useCallback((next, { group = null } = {}) => {
    setHist((h) => recordStep(h, typeof next === 'function' ? next(h.present) : next, { group }));
  }, []);
  const [baseline, setBaseline] = useState(saved ? initial : null);
  const [selected, setSelected] = useState(initial.widgets.length ? 0 : -1);
  const [previewHour, setPreviewHour] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const newId = useMemo(() => (id ? id : newOverlayId(draft.name, taken)), [id, draft.name, taken]);
  const hour = draft.hour ?? previewHour ?? hourNow;

  /* editing */

  const patch = (fields) => setDraft((d) => ({ ...d, ...fields }), { group: `canvas:${Object.keys(fields).sort().join(',')}` });
  // Words are kept as typed while editing (a trailing space is the start of
  // the next word, an empty line in Links the start of the next line) and
  // cleaned on the way to the PDS by toRecord. Geometry is clamped as it moves.
  const setWidget = useCallback(
    (i, next, group = null) => {
      setDraft((d) => ({ ...d, widgets: d.widgets.map((w, j) => (j === i ? next : w)) }), { group });
    },
    [setDraft],
  );
  const addWidget = (id) => {
    const entry = catalogEntry(id);
    if (!entry || draft.widgets.length >= MAX_WIDGETS) return;
    const w = newWidget(entry.kind, draft.widgets, entry.extra || {});
    setDraft((d) => ({ ...d, widgets: [...d.widgets, w] }));
    setSelected(draft.widgets.length);
  };
  const removeWidget = (i) => {
    setDraft((d) => ({ ...d, widgets: d.widgets.filter((_, j) => j !== i) }));
    setSelected((s) => (s === i ? -1 : s > i ? s - 1 : s));
  };
  const duplicateWidget = (i) => {
    if (draft.widgets.length >= MAX_WIDGETS) return;
    const w = draft.widgets[i];
    const copy = moveWidget(w, w.col + 1, w.row + 1);
    setDraft((d) => ({ ...d, widgets: [...d.widgets, copy] }));
    setSelected(draft.widgets.length);
  };
  const reorder = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= draft.widgets.length) return;
    setDraft((d) => {
      const widgets = d.widgets.slice();
      [widgets[i], widgets[j]] = [widgets[j], widgets[i]];
      return { ...d, widgets };
    });
    setSelected(j);
  };

  /* undo, redo, and the keys for them */

  const doUndo = useCallback(() => setHist(undo), []);
  const doRedo = useCallback(() => setHist(redo), []);
  // Read through refs, so the key listener is added once and always sees
  // the present draft and selection.
  const keysRef = useRef(null);
  keysRef.current = { selected, count: draft.widgets.length, removeWidget, doUndo, doRedo };
  useEffect(() => {
    const onKey = (e) => {
      const action = keyAction(e);
      if (!action) return;
      const k = keysRef.current;
      if (action === 'delete') {
        if (k.selected < 0 || k.selected >= k.count) return;
        e.preventDefault();
        k.removeWidget(k.selected);
        return;
      }
      e.preventDefault();
      if (action === 'undo') k.doUndo();
      else k.doRedo();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* saving */

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setFlash(false);
    try {
      const rkeyToWrite = id || newId;
      const record = toRecord({ ...draft, name: draft.name || rkeyToWrite }, { createdAt: saved?.createdAt });
      const res = await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: OVERLAY_NSID,
        rkey: rkeyToWrite,
        record,
        // A new overlay is create-only: an overlay already at that address is
        // not this draft's to replace.
        ...(id ? {} : { swapRecord: null }),
      });
      const written = fromRecord(record);
      // What was written becomes the present without a step of its own, so
      // an undo after saving goes back to the edit before it.
      setHist((h) => replacePresent(h, written));
      setBaseline(written);
      setFlash(true);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(false), 2400);
      onSaved(rkeyToWrite, { id: rkeyToWrite, config: written, createdAt: record.createdAt, cid: res?.data?.cid }, !id);
    } catch (err) {
      setError(
        isSwapConflict(err) && !id
          ? `There is already an overlay at ${overlayPath(newId)}. Give this one another name.`
          : err?.message || String(err),
      );
    } finally {
      setSaving(false);
    }
  }, [agent, did, id, newId, draft, saved, onSaved]);

  const handleRemove = useCallback(async () => {
    if (!id) return;
    if (!window.confirm(`Delete the overlay at ${overlayPath(id)}? A browser source pointed at it will go blank.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await agent.com.atproto.repo.deleteRecord({ repo: did, collection: OVERLAY_NSID, rkey: id });
      onDeleted(id);
    } catch (err) {
      setError(err?.message || String(err));
      setDeleting(false);
    }
  }, [agent, did, id, onDeleted]);

  // Registered once, through refs: the handlers close over the draft and change
  // identity on every edit, and re-registering would re-render the shell each time.
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  const removeRef = useRef(handleRemove);
  removeRef.current = handleRemove;
  const save = useCallback(() => saveRef.current(), []);
  const remove = useCallback(() => removeRef.current(), []);

  useEffect(() => {
    registerActions({
      save,
      remove: id ? remove : null,
      saving,
      deleting,
      loading: false,
      canDelete: Boolean(id),
      isNew: !id,
    });
  }, [registerActions, save, remove, saving, deleting, id]);

  const dirtyState = useMemo(() => {
    if (!baseline) return { dirty: true, fields: ['New overlay'], records: 0, note: null, error };
    if (sameOverlay(baseline, draft)) return error ? { dirty: false, fields: [], records: 0, note: null, error } : null;
    const fields = [];
    if (baseline.name !== draft.name) fields.push('Name');
    if (baseline.backdrop !== draft.backdrop || baseline.hour !== draft.hour || baseline.grid !== draft.grid) fields.push('Canvas');
    if (JSON.stringify(baseline.widgets) !== JSON.stringify(draft.widgets)) fields.push('Widgets');
    return { dirty: true, fields, records: 0, note: null, error };
  }, [baseline, draft, error]);

  useEffect(() => {
    reportDirty(dirtyState);
  }, [reportDirty, dirtyState]);

  useEffect(
    () => () => {
      registerActions(null);
      reportDirty(null);
    },
    [registerActions, reportDirty],
  );

  const sel = selected >= 0 && selected < draft.widgets.length ? draft.widgets[selected] : null;
  const frameCount = draft.widgets.filter((w) => w.kind === 'frame').length;
  const address = typeof window !== 'undefined' ? `${window.location.origin}${overlayPath(newId)}` : overlayPath(newId);

  return (
    <div className="os-editor">
      {error && <p className="ss-error">{error}</p>}
      <div className="os-main">
        <div className="os-stage-col">
          <div className="os-toolbar">
            <Button size="sm" onClick={doUndo} disabled={!canUndo(hist)} title="Undo (⌘Z / Ctrl+Z)">
              <Undo2 size={13} aria-hidden="true" /> Undo
            </Button>
            <Button size="sm" onClick={doRedo} disabled={!canRedo(hist)} title="Redo (⇧⌘Z / Ctrl+Y)">
              <Redo2 size={13} aria-hidden="true" /> Redo
            </Button>
            <span className="ss-hint">
              {sel ? `Delete or Backspace removes ${widgetName(sel).toLowerCase()}. ` : ''}Arrow keys move the picked widget a cell; with Shift they resize it.
            </span>
          </div>
          <OverlayPreview
            config={draft}
            hour={hour}
            selected={selected}
            onSelect={setSelected}
            onChange={setWidget}
          />
          <div className="os-under">
            <div className="os-hourline">
              <span className="eyebrow">
                {draft.hour === null ? 'previewing' : 'painted at'} {skyHourLabel(hour)}
              </span>
              {draft.hour === null ? (
                <>
                  <input
                    type="range"
                    min={0}
                    max={23}
                    step={1}
                    value={hour}
                    aria-label="Preview the overlay at another hour"
                    onChange={(e) => setPreviewHour(Number(e.target.value))}
                  />
                  <Button size="sm" variant="text" onClick={() => setPreviewHour(null)} disabled={previewHour === null}>
                    Now
                  </Button>
                </>
              ) : null}
            </div>
            <AddressRow address={address} saved={Boolean(id)} />
          </div>
        </div>

        <div className="os-side">
          <section className="ss-section">
            <SectionHead title="Canvas" />
            <label className="os-field">
              <span className="eyebrow">Name</span>
              <input
                className="admin-input"
                value={draft.name}
                maxLength={60}
                placeholder="starting soon"
                onChange={(e) => patch({ name: e.target.value.slice(0, NAME_MAX) })}
              />
              {!id ? <span className="ss-hint">Its address will be {overlayPath(newId)}.</span> : null}
            </label>
            <div className="os-field">
              <span className="eyebrow">Backdrop</span>
              <Segmented
                label="Backdrop"
                value={draft.backdrop}
                onChange={(v) => patch({ backdrop: v })}
                options={[
                  { value: 'transparent', label: 'Transparent', title: 'Nothing behind the widgets, to sit over a capture' },
                  { value: 'page', label: 'Page', title: 'The hour’s page fills the canvas: a full-screen scene' },
                ]}
              />
            </div>
            <div className="os-field">
              <span className="eyebrow">Sky</span>
              <div className="os-inline">
                <Segmented
                  label="Sky"
                  value={draft.hour === null ? 'live' : 'fixed'}
                  onChange={(v) => patch({ hour: v === 'live' ? null : hour })}
                  options={[
                    { value: 'live', label: 'Follow the clock', title: 'Drift through the day with the site' },
                    { value: 'fixed', label: 'One hour', title: 'Always this hour’s palette' },
                  ]}
                />
                {draft.hour !== null ? (
                  <select
                    className="admin-input os-select"
                    value={draft.hour}
                    aria-label="Hour"
                    onChange={(e) => patch({ hour: Number(e.target.value) })}
                  >
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {skyHourLabel(h)}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
            <label className="os-check">
              <input type="checkbox" checked={draft.grid} onChange={(e) => patch({ grid: e.target.checked })} />
              <span>Draw the grid on stream</span>
            </label>
          </section>

          <section className="ss-section">
            <SectionHead
              title="Widgets"
              meta={
                <select
                  className="admin-input os-select"
                  value=""
                  aria-label="Add a widget"
                  disabled={draft.widgets.length >= MAX_WIDGETS}
                  onChange={(e) => e.target.value && addWidget(e.target.value)}
                >
                  <option value="">Add…</option>
                  {CATALOG.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              }
            />
            {draft.widgets.length === 0 ? (
              <p className="ss-empty">Nothing on the canvas yet. Add a widget, then drag it into place.</p>
            ) : (
              <ol className="ss-rows os-widgets">
                {draft.widgets.map((w, i) => (
                  <li key={i} className="ss-row">
                    <button
                      type="button"
                      className={`os-widget-row${i === selected ? ' is-on' : ''}`}
                      aria-pressed={i === selected}
                      onClick={() => setSelected(i === selected ? -1 : i)}
                    >
                      <span>{widgetName(w)}</span>
                      <span className="os-widget-where">
                        {w.cols}×{w.rows} at {w.col},{w.row}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {frameCount ? (
            <FramesPanel
              widgets={draft.widgets}
              onArrange={(key) => setDraft((d) => ({ ...d, widgets: arrangeFrames(d.widgets, key) }))}
              onRotate={() => setDraft((d) => ({ ...d, widgets: rotateFrames(d.widgets) }))}
            />
          ) : null}

          {sel ? (
            <WidgetEditor
              key={selected}
              widget={sel}
              index={selected}
              count={draft.widgets.length}
              onChange={(next, group) => setWidget(selected, next, group ? `${selected}:${group}` : null)}
              onRemove={() => removeWidget(selected)}
              onDuplicate={() => duplicateWidget(selected)}
              onReorder={(dir) => reorder(selected, dir)}
            />
          ) : null}

          <div className="ss-actions">
            <Button size="sm" variant="text" onClick={() => onDuplicate(draft)}>
              <Copy size={13} aria-hidden="true" /> Duplicate overlay
            </Button>
            <span aria-live="polite">{flash ? <span className="ss-saved">Saved</span> : null}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- the address for OBS -------------------------------------------------------- */

function AddressRow({ address, saved }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the address is on screen to copy by hand */
    }
  };
  return (
    <div className="os-address">
      <span className="eyebrow">Browser source · 1920 × 1080</span>
      <div className="os-inline">
        <code className="os-url">{address}</code>
        <Button size="sm" onClick={copy} disabled={!saved}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" variant="text" as="a" href={saved ? address : undefined} target="_blank" rel="noreferrer" aria-disabled={!saved}>
          <ExternalLink size={13} aria-hidden="true" /> Open
        </Button>
        <Button size="sm" variant="text" as="a" href={saved ? `${address}?demo` : undefined} target="_blank" rel="noreferrer" aria-disabled={!saved}>
          With examples
        </Button>
      </div>
      <p className="ss-hint">
        {saved
          ? 'Saves reach a running source within a few seconds. Turn on “Refresh browser when scene becomes active” in OBS to restart a countdown each time its scene comes up.'
          : 'Save to give it an address.'}
      </p>
    </div>
  );
}

/* --- the preview, and placing on it ----------------------------------------------- */

function OverlayPreview({ config, hour, selected, onSelect, onChange }) {
  const [ref, width] = useWidth();
  const scale = width / CANVAS_W;
  const drag = useRef(null);
  const dragSeq = useRef(0);
  // The guides come up while something is being dragged, and stay faint over
  // the widgets otherwise.
  const [dragging, setDragging] = useState(false);

  const start = (e, i, mode) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(i);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // One drag is one undo step, however many cells it crosses.
    dragSeq.current += 1;
    drag.current = { i, mode, x: e.clientX, y: e.clientY, w: config.widgets[i], group: `drag:${dragSeq.current}` };
    setDragging(true);
  };
  const moveTo = (e) => {
    const d = drag.current;
    if (!d || !scale) return;
    const dc = Math.round((e.clientX - d.x) / scale / PITCH);
    const dr = Math.round((e.clientY - d.y) / scale / PITCH);
    const next =
      d.mode === 'move'
        ? moveWidget(d.w, d.w.col + dc, d.w.row + dr)
        : resizeWidget(d.w, d.w.col + d.w.cols - 1 + dc, d.w.row + d.w.rows - 1 + dr);
    const cur = config.widgets[d.i];
    if (cur && (cur.col !== next.col || cur.row !== next.row || cur.cols !== next.cols || cur.rows !== next.rows)) {
      onChange(d.i, next, d.group);
    }
  };
  const end = () => {
    drag.current = null;
    setDragging(false);
  };
  const onKey = (e, i) => {
    const w = config.widgets[i];
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!step || !w) return;
    e.preventDefault();
    onChange(
      i,
      e.shiftKey
        ? resizeWidget(w, w.col + w.cols - 1 + step[0], w.row + w.rows - 1 + step[1])
        : moveWidget(w, w.col + step[0], w.row + step[1]),
    );
  };

  return (
    <div
      ref={ref}
      className="os-stage"
      data-backdrop={config.backdrop}
      data-dragging={dragging ? '' : undefined}
      style={{ height: CANVAS_H * scale || undefined }}
      onPointerDown={() => onSelect(-1)}
    >
      {width > 0 ? (
        <>
          <div className="os-scaled" style={{ transform: `scale(${scale})` }}>
            <OverlayCanvas config={config} hour={hour} demo />
          </div>
          <div
            className="os-guides"
            aria-hidden="true"
            style={{
              '--os-cell': `${CELL * scale}px`,
              '--os-pitch': `${PITCH * scale}px`,
              '--os-mx': `${MARGIN_X * scale}px`,
              '--os-my': `${MARGIN_Y * scale}px`,
            }}
          />
          <div className="os-layer" role="group" aria-label={`Widgets on a ${COLS} by ${ROWS} grid`}>
            {config.widgets.map((w, i) => {
              const b = boxOf(w);
              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  className={`os-box${i === selected ? ' is-on' : ''}`}
                  aria-pressed={i === selected}
                  aria-label={`${widgetName(w)}, ${w.cols} by ${w.rows} at column ${w.col}, row ${w.row}. Arrow keys move it; Shift and arrows resize it.`}
                  style={{ left: b.left * scale, top: b.top * scale, width: b.width * scale, height: b.height * scale }}
                  onPointerDown={(e) => start(e, i, 'move')}
                  onPointerMove={moveTo}
                  onPointerUp={end}
                  onPointerCancel={end}
                  onFocus={() => onSelect(i)}
                  onKeyDown={(e) => onKey(e, i)}
                >
                  <span className="os-box-tag">{widgetName(w)}</span>
                  <span
                    className="os-box-handle"
                    onPointerDown={(e) => start(e, i, 'resize')}
                    onPointerMove={moveTo}
                    onPointerUp={end}
                    onPointerCancel={end}
                  />
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* --- one widget's settings ------------------------------------------------------- */

const SURFACE_NAMES = {
  none: 'Nothing',
  page: 'Page',
  raised: 'Raised',
  veil: 'Veil',
  accent: 'Accent',
  ink: 'Ink',
  sky: 'Sky',
};

const VOICE_NAMES = {
  display: 'Display: the biggest',
  heading: 'Heading',
  reading: 'Reading: body text',
  italic: 'Italic',
  label: 'Label: small caps',
  mono: 'Mono: the code face',
};

const ATMOSPHERE_HINTS = {
  card: 'Records a second, the condition in words, and where the records came from.',
  strip: 'All of it along one line, for the top or bottom edge.',
  badge: 'The condition and the figure, small.',
  apps: 'The five busiest apps outside Bluesky, each with a bar.',
  forecast: 'The next six hours, an hour a column, and the forecast in words when there is room.',
  pulse: 'The station’s last minute as a line, a second a point.',
};

/** A widget's name in the studio: a frame by its own name, a styled kind by its style. */
function widgetName(w) {
  if (w.kind === 'frame' && w.text) return `Frame: ${w.text}`;
  if (w.kind === 'atmosphere') return `Atmosphere: ${STYLES.atmosphere[w.style]?.toLowerCase() || 'card'}`;
  if (w.kind === 'text') return `Text: ${(w.lines?.[0] || '').slice(0, 24) || 'empty'}`;
  return WIDGETS[w.kind].name;
}

/**
 * The capture frames, together: arrange them in one go, pass the windows
 * round (who is main), and where each sits on the canvas for OBS.
 */
function FramesPanel({ widgets, onArrange, onRotate }) {
  const arrangements = arrangementsFor(widgets);
  const frames = frameTransforms(widgets);
  return (
    <section className="ss-section">
      <SectionHead
        title="Frames"
        meta={
          frames.length > 1 ? (
            <Button size="sm" onClick={onRotate} title="Each frame takes the next one’s window: rotate to put another source in the main one">
              <RotateCw size={13} aria-hidden="true" /> Rotate sources
            </Button>
          ) : null
        }
      />
      <div className="os-arrangements" role="group" aria-label="Arrange the frames">
        {arrangements.map((a) => (
          <button key={a.key} type="button" className="os-arrangement" onClick={() => onArrange(a.key)} title={a.name}>
            <svg viewBox="0 0 16 9" aria-hidden="true">
              {a.boxes.map((b, i) => (
                <rect key={i} x={b.col - 1 + 0.15} y={b.row - 1 + 0.15} width={b.cols - 0.3} height={b.rows - 0.3} data-main={i === 0 ? '' : undefined} />
              ))}
            </svg>
            <span>{a.name}</span>
          </button>
        ))}
      </div>
      {frames.length > 4 ? <p className="ss-hint">The arrangements place the first four frames; the rest stay where they are.</p> : null}
      <table className="os-transforms">
        <caption className="ss-hint">Where each source goes in OBS (Edit Transform, on a 1920 × 1080 canvas):</caption>
        <thead>
          <tr>
            <th scope="col">Frame</th>
            <th scope="col">x</th>
            <th scope="col">y</th>
            <th scope="col">width</th>
            <th scope="col">height</th>
          </tr>
        </thead>
        <tbody>
          {frames.map((f, i) => (
            <tr key={i}>
              <th scope="row">
                {f.name}
                {f.shape === 'circle' ? ' (circle)' : ''}
              </th>
              <td>{f.x}</td>
              <td>{f.y}</td>
              <td>{f.width}</td>
              <td>{f.height}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function NumberField({ label, value, min, max, onChange }) {
  return (
    <label className="os-num">
      <span className="eyebrow">{label}</span>
      <input
        className="admin-input"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}

/** A datetime-local value (the machine's own zone) from an ISO string, and back. */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function WidgetEditor({ widget: w, index, count, onChange, onRemove, onDuplicate, onReorder }) {
  const def = WIDGETS[w.kind];
  // A field's edits fold into one undo step while it is being typed in.
  const set = (fields) => onChange({ ...w, ...fields }, Object.keys(fields).sort().join(','));
  const ownLabel = typeof w.label === 'string';
  const showLabel = !ownLabel || w.label !== '';

  return (
    <section className="ss-section os-widget-editor">
      <SectionHead
        title={def.name}
        meta={
          <span className="os-inline">
            <Button size="sm" variant="icon" onClick={() => onReorder(-1)} disabled={index === 0} aria-label="Paint earlier (under the others)" title="Paint earlier">
              <ArrowUp size={14} aria-hidden="true" />
            </Button>
            <Button size="sm" variant="icon" onClick={() => onReorder(1)} disabled={index === count - 1} aria-label="Paint later (over the others)" title="Paint later">
              <ArrowDown size={14} aria-hidden="true" />
            </Button>
            <Button size="sm" variant="icon" onClick={onDuplicate} aria-label="Duplicate widget" title="Duplicate">
              <Copy size={14} aria-hidden="true" />
            </Button>
            <Button size="sm" variant="icon" className="btn--danger" onClick={onRemove} aria-label="Remove widget" title="Remove">
              <Trash2 size={14} aria-hidden="true" />
            </Button>
          </span>
        }
      />
      <p className="ss-hint">{def.hint}</p>

      <div className="os-grid4">
        <NumberField label="Column" value={w.col} min={1} max={COLS} onChange={(n) => set(moveWidget(w, n, w.row))} />
        <NumberField label="Row" value={w.row} min={1} max={ROWS} onChange={(n) => set(moveWidget(w, w.col, n))} />
        <NumberField label="Wide" value={w.cols} min={1} max={COLS} onChange={(n) => set(resizeWidget(w, w.col + n - 1, w.row + w.rows - 1))} />
        <NumberField label="Tall" value={w.rows} min={1} max={ROWS} onChange={(n) => set(resizeWidget(w, w.col + w.cols - 1, w.row + n - 1))} />
      </div>

      {!NO_SURFACE.has(w.kind) ? (
        <div className="os-field">
          <span className="eyebrow">Drawn on</span>
          <div className="os-swatches" role="group" aria-label="Drawn on">
            {Object.entries(SURFACE_NAMES).map(([value, name]) => (
              <button
                key={value}
                type="button"
                className={`os-swatch${w.surface === value ? ' is-on' : ''}`}
                data-surface={value}
                aria-pressed={w.surface === value}
                title={name}
                onClick={() => set({ surface: value })}
              >
                <span className="os-swatch-chip" aria-hidden="true" />
                {name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {w.kind !== 'frame' && w.kind !== 'poe' ? (
        <>
          <div className="os-field">
            <span className="eyebrow">Align</span>
            <Segmented
              label="Align"
              value={w.align}
              onChange={(v) => set({ align: v })}
              options={[
                { value: 'start', label: 'Left' },
                { value: 'center', label: 'Centre' },
                { value: 'end', label: 'Right' },
              ]}
            />
          </div>
          <label className="os-field">
            <span className="eyebrow">Type size · {w.scale}%</span>
            <input type="range" min={MIN_SCALE} max={MAX_SCALE} step={5} value={w.scale} onChange={(e) => set({ scale: Number(e.target.value) })} />
          </label>
          <div className="os-field">
            <label className="os-check">
              <input
                type="checkbox"
                checked={showLabel}
                onChange={(e) => {
                  if (e.target.checked) {
                    const next = { ...w };
                    delete next.label;
                    onChange(next, 'label');
                  } else set({ label: '' });
                }}
              />
              <span>Label</span>
            </label>
            {showLabel ? (
              <input
                className="admin-input"
                value={ownLabel ? w.label : ''}
                placeholder={def.label || 'a small-caps line over it'}
                maxLength={60}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) set({ label: v.slice(0, 60) });
                  else {
                    const next = { ...w };
                    delete next.label;
                    onChange(next, 'label');
                  }
                }}
                aria-label="Label text"
              />
            ) : null}
          </div>
        </>
      ) : null}

      {w.kind === 'text' ? (
        <>
          <label className="os-field">
            <span className="eyebrow">Words, a line each</span>
            <textarea
              className="admin-input admin-textarea"
              rows={3}
              value={(w.lines || []).join('\n')}
              onChange={(e) => set({ lines: e.target.value.split('\n').slice(0, 6) })}
            />
            <span className="ss-hint">
              {w.ticker ? 'As a ticker, the lines run along one line, a fleuron between them.' : 'The first line is set in the voice; any after it sit under it, as a lower third reads.'}
            </span>
          </label>
          <label className="os-field">
            <span className="eyebrow">Voice</span>
            <select className="admin-input" value={w.voice} onChange={(e) => set({ voice: e.target.value })}>
              {VOICES.map((v) => (
                <option key={v} value={v}>
                  {VOICE_NAMES[v]}
                </option>
              ))}
            </select>
          </label>
          <label className="os-check">
            <input type="checkbox" checked={Boolean(w.ticker)} onChange={(e) => set({ ticker: e.target.checked })} />
            <span>Run as a ticker</span>
          </label>
        </>
      ) : null}

      {w.kind === 'atmosphere' ? (
        <div className="os-field">
          <span className="eyebrow">Style</span>
          <select className="admin-input" value={w.style} onChange={(e) => set({ style: e.target.value })}>
            {Object.entries(STYLES.atmosphere).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
          <span className="ss-hint">{ATMOSPHERE_HINTS[w.style]}</span>
        </div>
      ) : null}

      {w.kind === 'tid' ? (
        <>
          <div className="os-field">
            <span className="eyebrow">Shows</span>
            <Segmented
              label="Shows"
              value={w.style}
              onChange={(v) => set({ style: v })}
              options={Object.entries(STYLES.tid).map(([value, name]) => ({ value, label: name }))}
            />
          </div>
          <div className="os-field">
            <span className="eyebrow">Time in</span>
            <Segmented
              label="Time in"
              value={w.zone}
              onChange={(v) => set({ zone: v })}
              options={[
                { value: 'eastern', label: 'New York' },
                { value: 'local', label: 'This machine' },
              ]}
            />
          </div>
          <label className="os-check">
            <input type="checkbox" checked={Boolean(w.repo)} onChange={(e) => set({ repo: e.target.checked })} />
            <span>Your repo’s latest revision too</span>
          </label>
        </>
      ) : null}

      {w.kind === 'poe' ? (
        <>
          <div className="os-field">
            <span className="eyebrow">Sits on the</span>
            <Segmented
              label="Sits on the"
              value={w.side}
              onChange={(v) => set({ side: v })}
              options={[
                { value: 'left', label: 'Left, facing right' },
                { value: 'right', label: 'Right, facing left' },
              ]}
            />
          </div>
          <label className="os-check">
            <input type="checkbox" checked={w.greet} onChange={(e) => set({ greet: e.target.checked })} />
            <span>Greets chatters and answers commands</span>
          </label>
          <label className="os-check">
            <input type="checkbox" checked={w.follows} onChange={(e) => set({ follows: e.target.checked })} />
            <span>Thanks new followers</span>
          </label>
          <label className="os-check">
            <input type="checkbox" checked={w.alerts} onChange={(e) => set({ alerts: e.target.checked })} />
            <span>Says weather alerts</span>
          </label>
          <label className="os-field">
            <span className="eyebrow">Noises · {w.volume ? `${w.volume}%` : 'silent'}</span>
            <input type="range" min={0} max={100} step={5} value={w.volume} onChange={(e) => set({ volume: Number(e.target.value) })} />
          </label>
          <NumberField label="Naps after this many quiet minutes (0 never)" value={w.nap} min={0} max={240} onChange={(n) => set({ nap: clampInt(n, 0, 240) })} />
          <p className="ss-hint">
            Poe is as wide as its box and sits at its foot; on the bottom row it tucks under the edge of the screen. Its
            noises play on stream only, when “Control audio via OBS” is on for the source. The preview here runs
            through example lines, quietly.
          </p>
        </>
      ) : null}

      {w.kind === 'title' ? (
        <>
          <label className="os-field">
            <span className="eyebrow">Heading</span>
            <input className="admin-input" value={w.text} maxLength={120} onChange={(e) => set({ text: e.target.value })} />
          </label>
          <label className="os-field">
            <span className="eyebrow">Line under it</span>
            <input className="admin-input" value={w.subtitle} maxLength={240} onChange={(e) => set({ subtitle: e.target.value })} />
          </label>
          <div className="os-field">
            <span className="eyebrow">Heading size</span>
            <Segmented
              label="Heading size"
              value={w.size}
              onChange={(v) => set({ size: v })}
              options={[
                { value: 'display', label: 'Display' },
                { value: 'heading', label: 'Heading' },
                { value: 'body', label: 'Body' },
              ]}
            />
          </div>
        </>
      ) : null}

      {w.kind === 'countdown' ? (
        <>
          <div className="os-field">
            <span className="eyebrow">Counts</span>
            <Segmented
              label="Counts"
              value={w.mode}
              onChange={(v) => set({ mode: v })}
              options={[
                { value: 'timer', label: 'A timer', title: 'From when the overlay is shown' },
                { value: 'until', label: 'To a time' },
              ]}
            />
          </div>
          {w.mode === 'timer' ? (
            <NumberField label="Minutes" value={w.minutes} min={1} max={240} onChange={(n) => set({ minutes: clampInt(n, 1, 240) })} />
          ) : (
            <label className="os-field">
              <span className="eyebrow">Until</span>
              <input
                className="admin-input"
                type="datetime-local"
                value={toLocalInput(w.at)}
                onChange={(e) => {
                  const d = new Date(e.target.value);
                  set({ at: Number.isNaN(d.getTime()) ? undefined : d.toISOString() });
                }}
              />
            </label>
          )}
          <label className="os-field">
            <span className="eyebrow">At zero it says</span>
            <input className="admin-input" value={w.done} maxLength={60} onChange={(e) => set({ done: e.target.value })} />
          </label>
        </>
      ) : null}

      {w.kind === 'clock' ? (
        <>
          <div className="os-field">
            <span className="eyebrow">Time in</span>
            <Segmented
              label="Time in"
              value={w.zone}
              onChange={(v) => set({ zone: v })}
              options={[
                { value: 'eastern', label: 'New York' },
                { value: 'local', label: 'This machine' },
              ]}
            />
          </div>
          <label className="os-check">
            <input type="checkbox" checked={w.seconds} onChange={(e) => set({ seconds: e.target.checked })} />
            <span>Seconds</span>
          </label>
        </>
      ) : null}

      {w.kind === 'chat' ? (
        <>
          <NumberField label="Messages at most" value={w.max} min={1} max={12} onChange={(n) => set({ max: clampInt(n, 1, 12) })} />
          <p className="ss-hint">
            Reads place.stream.chat.message records that name you as the streamer. Deleted messages, ones you hide in
            stream.place, and anyone you block on Bluesky stay off screen.
          </p>
        </>
      ) : null}

      {w.kind === 'music' || w.kind === 'mark' ? (
        <label className="os-check">
          <input type="checkbox" checked={w.art} onChange={(e) => set({ art: e.target.checked })} />
          <span>{w.kind === 'music' ? 'Album cover' : 'The hour’s sky avatar'}</span>
        </label>
      ) : null}

      {w.kind === 'frame' ? (
        <>
          <label className="os-field">
            <span className="eyebrow">Name</span>
            <input className="admin-input" value={w.text} maxLength={120} placeholder="screen" onChange={(e) => set({ text: e.target.value })} />
            <span className="ss-hint">
              Line a source up with it in OBS: {boxOf(w).width} × {boxOf(w).height} at {boxOf(w).left}, {boxOf(w).top}.
            </span>
          </label>
          <div className="os-field">
            <span className="eyebrow">Shape</span>
            <Segmented
              label="Shape"
              value={w.shape}
              onChange={(v) => set({ shape: v })}
              options={[
                { value: 'rect', label: 'Rectangle' },
                { value: 'circle', label: 'Circle' },
              ]}
            />
            {w.shape === 'circle' ? (
              <span className="ss-hint">
                The page is cut away in a circle (an oval in a box that isn’t square). Crop the camera to match in OBS
                with an image mask filter, or let the page hide its corners.
              </span>
            ) : null}
          </div>
          <label className="os-check">
            <input type="checkbox" checked={Boolean(w.plate)} onChange={(e) => set({ plate: e.target.checked })} />
            <span>Show its name on stream, as a nameplate</span>
          </label>
        </>
      ) : null}

      {w.kind === 'links' ? (
        <label className="os-field">
          <span className="eyebrow">A line each</span>
          <textarea
            className="admin-input admin-textarea"
            rows={4}
            value={w.lines.join('\n')}
            onChange={(e) => set({ lines: e.target.value.split('\n').slice(0, 6) })}
          />
        </label>
      ) : null}

    </section>
  );
}
