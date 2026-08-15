// Admin editor for site.standard.publication records — the blog + portfolio
// publications that back the Standard Site link embeds on Bluesky. Edit the
// core fields (url, name, description, comment/discover prefs, basicTheme
// colors, icon) with structured controls, or drop into raw JSON for anything
// else (the leaflet `theme`, labels, …).
//
// The headline feature is "Apply sky theme + avatar": it fills basicTheme from
// the site's own hour-tracking sky palette (src/lib/skyTheme.js) and uploads
// that hour's sky-avatar frame as the publication icon, so the publication
// matches the website instead of the old Leaflet look. Nothing is written until
// you press Save.
//
// As a studio it is a BODY, not a page: StudioPane draws the title, the blurb
// and the NSID, and the workbench's status strip owns Save — so there is no
// PageShell, no "← All collections" link and no save bar here.
//
// **Selection lives in the URL**, which is the one structural change from the
// version that lived at `?view=publications` and routed internally:
//
//   /admin?view=publications             the list
//   /admin?view=publications&r=<rkey>    editing that publication
//   /admin?view=publications&mode=new    the new-publication draft
//
// It cannot be `?c=site.standard.publication&r=<rkey>` — with no `view` that
// resolves to the GENERIC records surface, which is a different (and still
// valid) way to reach the same records. Because the editor is no longer thrown
// away and rebuilt by a `key` when the selection changes, it re-syncs its lazily
// initialised `value` from a `record.uri` effect instead.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Copy, Check } from 'lucide-react';
import { AdminRecordListSkeleton } from './Skeleton.jsx';
import { uploadImageFile } from './blocks/ImageBlockEditor.jsx';
import { rkeyFromUri } from './RecordEditor.jsx';
import { useAdminShell } from '../admin/useAdminShell.jsx';
import { paletteForHour, skyHourKey, easternHour } from '../lib/skyTheme.js';
import { skyAvatarUrl } from '../lib/skyAvatars.js';
import { resolvePds } from '../lib/atproto.js';
import './PublicationsManager.css';

const PUB_NSID = 'site.standard.publication';
const BASIC_THEME_TYPE = 'site.standard.theme.basic';
const RGB_TYPE = 'site.standard.theme.color#rgb';

const THEME_FIELDS = [
  { key: 'background', label: 'Background' },
  { key: 'foreground', label: 'Text' },
  { key: 'accent', label: 'Accent' },
  { key: 'accentForeground', label: 'Accent text' },
];

/** On-screen names for the top-level fields, for the status strip's sentence. */
const FIELD_LABELS = {
  url: 'URL',
  name: 'Name',
  description: 'Description',
  preferences: 'Preferences',
  basicTheme: 'Theme',
  icon: 'Icon',
};

/* ---------- color helpers (hex ⇄ site.standard rgb) ---------- */
const clamp = (n) => Math.max(0, Math.min(255, Math.round(n || 0)));
const hex2 = (n) => clamp(n).toString(16).padStart(2, '0');
function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16) || 0, g: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0 };
}
function rgbToHex(c) {
  return c ? `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}` : '#000000';
}
const rgbColor = (hex) => ({ $type: RGB_TYPE, ...hexToRgb(hex) });
const cssRgb = (c) => (c ? `rgb(${clamp(c.r)}, ${clamp(c.g)}, ${clamp(c.b)})` : 'transparent');

/** basicTheme derived from the site's sky palette for a given hour. */
function basicThemeForHour(hour) {
  const v = paletteForHour(hour).vars;
  return {
    $type: BASIC_THEME_TYPE,
    background: rgbColor(v['--sky-page']),
    foreground: rgbColor(v['--sky-ink']),
    accent: rgbColor(v['--sky-accent']),
    // Accent text reads on the accent fill; the page color contrasts it at
    // every hour (dark accent by day, light glow by night).
    accentForeground: rgbColor(v['--sky-page']),
  };
}

/** Strip any `_url` display annotations before a record hits the PDS. */
function stripUrl(node) {
  if (Array.isArray(node)) node.forEach(stripUrl);
  else if (node && typeof node === 'object') {
    delete node._url;
    for (const k of Object.keys(node)) stripUrl(node[k]);
  }
  return node;
}

const clone = (v) => JSON.parse(JSON.stringify(v ?? {}));

/**
 * Which top-level fields differ from the last-saved record, by their on-screen
 * labels. The status strip names them, and "URL, Theme" is a much better answer
 * to "what is unsaved?" than "something". `$type` is skipped because the save
 * stamps it unconditionally — it is never a change the owner made.
 */
function changedFields(next, base) {
  const keys = new Set([...Object.keys(next || {}), ...Object.keys(base || {})]);
  const out = [];
  for (const key of keys) {
    if (key === '$type') continue;
    if (JSON.stringify(next?.[key]) !== JSON.stringify(base?.[key])) {
      out.push(FIELD_LABELS[key] || key);
    }
  }
  return out;
}

/**
 * A publication that doesn't exist yet.
 *
 * Same shape the editor edits, with no rkey — which is what tells the save to
 * create rather than overwrite, and lets the PDS assign the TID rather than
 * this page inventing one.
 */
function newDraft() {
  return { rkey: null, uri: null, value: { $type: PUB_NSID, name: '', url: '', description: '' } };
}

/**
 * `go` is merge-only, so every link inside this studio names all three of the
 * params that decide what it shows. `view` is repeated deliberately: a link
 * built here can also be followed from a browser-restored URL that has `c` set.
 */
function pubLink(go, { rkey = null, mode = null } = {}) {
  const patch = { view: 'publications', c: null, r: rkey, mode, for: null };
  const query = new URLSearchParams({ view: 'publications' });
  if (rkey) query.set('r', rkey);
  if (mode) query.set('mode', mode);
  return {
    to: `/admin?${query}`,
    onClick: (event) => {
      // Modified and non-primary clicks stay the browser's, so cmd-click still
      // opens a publication in a new tab.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      go(patch);
    },
  };
}

/* ======================= list ======================= */
export default function PublicationsManager({ agent, did, rkey = null, isNew = false }) {
  const { go } = useAdminShell();
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);

  // `load` runs on mount AND after every save, so the cancellation guard is a
  // ref the unmount flips rather than an effect-local flag: flipping to another
  // surface mid-request must not write records into a panel that is gone.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await agent.com.atproto.repo.listRecords({ repo: did, collection: PUB_NSID, limit: 100 });
      if (!aliveRef.current) return;
      setRecords((res?.data?.records || []).map((r) => ({ ...r, rkey: rkeyFromUri(r.uri) })));
    } catch (err) {
      if (!aliveRef.current) return;
      setError(err?.message || String(err));
      setRecords([]);
    }
  }, [agent, did]);

  useEffect(() => {
    load();
  }, [load]);

  // One draft object for the life of the studio. The editor re-syncs on
  // `record.uri`, and a fresh `newDraft()` per render would hand it a new object
  // with the same null uri on every keystroke.
  const draft = useMemo(() => newDraft(), []);

  const editing = useMemo(
    () => (records || []).find((r) => r.rkey === rkey) || null,
    [records, rkey],
  );

  const backLink = pubLink(go);
  const record = isNew ? draft : editing;

  if (isNew || rkey) {
    // A deep link into an editor arrives before the list does — the record being
    // edited is only known once `listRecords` lands.
    if (!record) {
      return records === null ? (
        <AdminRecordListSkeleton rows={2} label="Loading publications" />
      ) : (
        <>
          <div className="admin-toolbar">
            <Link className="admin-link-subtle" {...backLink}>
              ← All publications
            </Link>
          </div>
          <p className="placeholder-card">
            No <code>{PUB_NSID}</code> record with the key <code className="admin-mono">{rkey}</code>{' '}
            under this DID.
          </p>
        </>
      );
    }
    return (
      <PublicationEditor
        agent={agent}
        did={did}
        record={record}
        isNew={isNew}
        backLink={backLink}
        onSaved={async (savedRkey) => {
          // Refresh BEFORE navigating. The freshly created record has to be in
          // `records` by the time the URL names it, or this pane would flip back
          // to the list for a frame and unmount the editor mid-save.
          await load();
          // Creating hands back the rkey the PDS assigned, so the studio drops
          // straight into editing the real record — with its at:// URI on
          // screen, which is the thing that has to reach src/config.js. It
          // REPLACES the `mode=new` entry (going back should land on the list,
          // not on a draft of a record that now exists) and is forced, because
          // the save that triggered it is the reason there is nothing to lose.
          if (savedRkey && savedRkey !== rkey) {
            go({ view: 'publications', c: null, r: savedRkey, mode: null, for: null }, { replace: true, force: true });
          }
        }}
      />
    );
  }

  return (
    <>
      <div className="pub-actions">
        <Link className="admin-gate-button" {...pubLink(go, { mode: 'new' })}>
          <Plus size={14} aria-hidden="true" />
          New publication
        </Link>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {records === null ? (
        <AdminRecordListSkeleton rows={2} />
      ) : records.length === 0 ? (
        <p className="placeholder-card">
          No {PUB_NSID} records found under this DID. Create one above.
        </p>
      ) : (
        <ul className="pub-list">
          {records.map((r) => (
            <li key={r.rkey}>
              <Link className="pub-list-row" {...pubLink(go, { rkey: r.rkey })}>
                <span className="pub-list-name">{r.value?.name || '(untitled)'}</span>
                <span className="pub-list-url">{r.value?.url || '—'}</span>
                <code className="admin-mono pub-list-rkey">{r.rkey}</code>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ======================= editor ======================= */
function PublicationEditor({ agent, did, record, isNew, backLink, onSaved }) {
  const { registerActions, reportDirty, invalidate } = useAdminShell();
  const rkey = record.rkey;
  const [value, setValue] = useState(() => clone(record.value));
  // What is on the PDS, as the strip's comparison baseline. Cloned from the same
  // source as `value`, so a JSON round-trip can never read as an unsaved edit.
  const [baseline, setBaseline] = useState(() => clone(record.value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(false);

  const [pds, setPds] = useState(null);
  const [localIconUrl, setLocalIconUrl] = useState(null); // freshly chosen avatar/file
  const [iconBusy, setIconBusy] = useState(false);
  const [hour, setHour] = useState(() => easternHour());

  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState('');
  const [rawError, setRawError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    resolvePds(did)
      .then((p) => {
        if (!cancelled) setPds(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [did]);

  // Selection is a URL param now, so picking another publication hands this
  // component a new `record` prop instead of remounting it under a new `key`.
  // `value` is lazily initialised state — without this it would keep showing the
  // previous publication's fields forever. Keyed on the URI rather than on the
  // object, so a post-save `load()` that returns an equal record does NOT reset
  // the form under the owner's hands.
  const recordRef = useRef(record);
  recordRef.current = record;
  useEffect(() => {
    const next = recordRef.current;
    setValue(clone(next.value));
    setBaseline(clone(next.value));
    setRawMode(false);
    setRawText('');
    setRawError(null);
    setLocalIconUrl(null);
    setError(null);
    setFlash(false);
  }, [record.uri]);

  const patch = (fields) => setValue((v) => ({ ...v, ...fields }));
  const patchPrefs = (fields) =>
    setValue((v) => ({ ...v, preferences: { ...(v.preferences || {}), ...fields } }));
  const setThemeColor = (key, hexStr) =>
    setValue((v) => ({
      ...v,
      basicTheme: { $type: BASIC_THEME_TYPE, ...(v.basicTheme || {}), [key]: rgbColor(hexStr) },
    }));

  // Current icon preview: a freshly chosen avatar/file wins, else the stored blob.
  const existingCid = value?.icon?.ref?.$link || null;
  const iconUrl =
    localIconUrl ||
    (existingCid && pds
      ? `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(existingCid)}`
      : null);

  async function uploadAndSet(file, previewUrl) {
    setIconBusy(true);
    setError(null);
    try {
      const { blob } = await uploadImageFile(agent, file);
      setValue((v) => ({ ...v, icon: blob }));
      setLocalIconUrl(previewUrl);
    } catch (err) {
      setError(`Icon upload failed: ${err?.message || err}`);
    } finally {
      setIconBusy(false);
    }
  }

  async function applySky() {
    // Theme is local (no upload); the avatar frame is uploaded as the icon.
    setValue((v) => ({ ...v, basicTheme: basicThemeForHour(hour) }));
    const url = skyAvatarUrl(hour);
    if (!url) {
      setError(`No sky-avatar frame for hour ${hour}.`);
      return;
    }
    try {
      const resp = await fetch(url);
      const data = await resp.blob();
      const file = new File([data], `sky-${skyHourKey(hour)}.jpg`, { type: data.type || 'image/jpeg' });
      await uploadAndSet(file, url);
    } catch (err) {
      setError(`Avatar fetch failed: ${err?.message || err}`);
    }
  }

  function applyThemeOnly() {
    setValue((v) => ({ ...v, basicTheme: basicThemeForHour(hour) }));
  }

  function onPickFile(e) {
    const file = e.target.files?.[0];
    if (file) uploadAndSet(file, URL.createObjectURL(file));
    e.target.value = '';
  }

  function toggleRaw() {
    if (!rawMode) {
      setRawText(JSON.stringify(clone(value), null, 2));
      setRawError(null);
      setRawMode(true);
    } else {
      try {
        const parsed = JSON.parse(rawText);
        setValue(parsed);
        setRawError(null);
        setRawMode(false);
      } catch (err) {
        setRawError(`Invalid JSON: ${err.message}`);
      }
    }
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
      let payload;
      if (rawMode) {
        try {
          payload = JSON.parse(rawText);
        } catch (err) {
          throw new Error(`Invalid JSON: ${err.message}`);
        }
      } else {
        payload = clone(value); // normalizes any fresh BlobRef to wire form
      }
      stripUrl(payload);
      if (payload.$type && payload.$type !== PUB_NSID) {
        throw new Error(`$type must be ${PUB_NSID}.`);
      }
      payload.$type = PUB_NSID;
      // A publication with no url can't be verified — Bluesky fetches
      // {url}/.well-known/site.standard.publication to confirm it — so the
      // embed silently never renders. Catch it here rather than at the point
      // somebody wonders why a shared link looks ordinary.
      if (!String(payload.url || '').trim()) {
        throw new Error('A publication needs a URL — verification is fetched from it.');
      }
      let savedRkey = rkey;
      if (isNew) {
        const res = await agent.com.atproto.repo.createRecord({
          repo: did,
          collection: PUB_NSID,
          record: payload,
        });
        savedRkey = rkeyFromUri(res?.data?.uri) || null;
      } else {
        await agent.com.atproto.repo.putRecord({ repo: did, collection: PUB_NSID, rkey, record: payload });
      }
      setValue(payload);
      setBaseline(clone(payload));
      if (rawMode) setRawMode(false);
      setLocalIconUrl(null);
      setFlash(true);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(false), 2400);
      // A create changes the collection's count, which the rail dims on and the
      // Front Desk shows. The counts cache holds for a minute otherwise.
      if (isNew) invalidate([PUB_NSID]);
      await onSaved?.(savedRkey);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }, [agent, did, rkey, isNew, rawMode, rawText, value, onSaved, invalidate]);

  /* --- what the shell needs to know ------------------------------------- */

  // `handleSave` closes over every edited field, so it changes identity on every
  // keystroke. Registering it directly would republish the shell context — and
  // re-render every consumer of it — per character typed, so what gets
  // registered is this one stable wrapper around a latest-value ref.
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  const save = useCallback(() => saveRef.current(), []);

  // `record.uri` is in the deps on purpose, and it is read below so it is not an
  // "unnecessary dependency": the shell clears `actions` whenever the subject in
  // the URL changes, and this editor stays MOUNTED across a change of `r`. Left
  // out, a jump straight from one publication to another would clear the strip's
  // Save and never put it back.
  useEffect(() => {
    registerActions({
      save,
      remove: null,
      saving,
      deleting: false,
      loading: false,
      // Deleting a publication silently breaks whichever src/config.js constant
      // points at it, so this studio has never offered it — the generic record
      // list is the deliberate long way round.
      canDelete: false,
      isNew: isNew || !record.uri,
    });
  }, [registerActions, save, saving, isNew, record.uri]);

  const dirtyState = useMemo(() => {
    if (rawMode) {
      let parsed;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // Half-typed JSON is still an unsaved edit — it just cannot be named
        // field by field yet.
        return { dirty: true, fields: [], records: 0, note: 'Raw JSON edited (not valid yet)' };
      }
      const fields = changedFields(parsed, baseline);
      return fields.length ? { dirty: true, fields, records: 0, note: null } : null;
    }
    const fields = changedFields(value, baseline);
    return fields.length ? { dirty: true, fields, records: 0, note: null } : null;
  }, [rawMode, rawText, value, baseline]);

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

  const theme = value.basicTheme || null;

  return (
    <>
      <div className="admin-toolbar">
        <Link className="admin-link-subtle" {...backLink}>
          ← All publications
        </Link>
        <h2 className="admin-collection-group-heading small-caps pub-editor-title">
          {isNew ? 'New publication' : value.name || rkey}
        </h2>
      </div>

      <p className="admin-collection-group-note">
        {isNew
          ? 'A masthead for a group of documents — what Bluesky renders instead of a plain link card. The URL matters: verification is fetched from it, so it has to be the address this publication actually lives at. Nothing is written until you press Save.'
          : 'Structured fields cover the essentials; the raw JSON toggle exposes everything (the leaflet theme, labels, …). Nothing is written until you press Save.'}
      </p>

      {error && <p className="admin-error">{error}</p>}

      {/* The at:// URI is the reason anyone comes back to this page: it's what
          src/config.js points at, and there is nowhere else to read it off. */}
      {!isNew && <AtUriRow did={did} rkey={rkey} />}

      {rawMode ? (
        <div className="admin-field">
          <label className="admin-field-label" htmlFor="pub-raw">
            Raw record JSON
          </label>
          <textarea
            id="pub-raw"
            className="admin-input pub-raw"
            spellCheck={false}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={22}
          />
          {rawError && <p className="admin-error-inline">{rawError}</p>}
        </div>
      ) : (
        <div className="admin-form">
          <label className="admin-field">
            <span className="admin-field-label">URL <span className="admin-field-hint">(base for the embed + verification)</span></span>
            <input
              className="admin-input"
              type="text"
              value={value.url || ''}
              onChange={(e) => patch({ url: e.target.value })}
              placeholder="https://dame.is/blogging"
            />
          </label>

          <label className="admin-field">
            <span className="admin-field-label">Name</span>
            <input
              className="admin-input"
              type="text"
              value={value.name || ''}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>

          <label className="admin-field">
            <span className="admin-field-label">Description</span>
            <textarea
              className="admin-input"
              rows={2}
              value={value.description || ''}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </label>

          <div className="admin-field">
            <span className="admin-field-label">Preferences</span>
            <label className="pub-check">
              <input
                type="checkbox"
                checked={Boolean(value.preferences?.showComments)}
                onChange={(e) => patchPrefs({ showComments: e.target.checked })}
              />
              Show comments
            </label>
            <label className="pub-check">
              <input
                type="checkbox"
                checked={Boolean(value.preferences?.showInDiscover)}
                onChange={(e) => patchPrefs({ showInDiscover: e.target.checked })}
              />
              Show in discover feeds
            </label>
          </div>

          {/* ---- theme ---- */}
          <div className="admin-field">
            <span className="admin-field-label">
              Theme <span className="admin-field-hint">(site.standard.theme.basic — what Bluesky renders)</span>
            </span>
            <div className="pub-theme-grid">
              {THEME_FIELDS.map((f) => (
                <label key={f.key} className="pub-color">
                  <input
                    type="color"
                    value={rgbToHex(theme?.[f.key])}
                    onChange={(e) => setThemeColor(f.key, e.target.value)}
                  />
                  <span>{f.label}</span>
                </label>
              ))}
            </div>
            {theme && (
              <div
                className="pub-theme-preview"
                style={{ background: cssRgb(theme.background), color: cssRgb(theme.foreground) }}
              >
                <span>{value.name || 'Publication'}</span>
                <span className="pub-theme-chip" style={{ background: cssRgb(theme.accent), color: cssRgb(theme.accentForeground) }}>
                  Accent
                </span>
              </div>
            )}
          </div>

          {/* ---- icon ---- */}
          <div className="admin-field">
            <span className="admin-field-label">Icon</span>
            <div className="pub-icon-row">
              {iconUrl ? (
                <img className="pub-icon-preview" src={iconUrl} alt="Publication icon" />
              ) : (
                <div className="pub-icon-preview pub-icon-empty">none</div>
              )}
              <label className="admin-gate-button admin-gate-button-tight pub-file">
                Upload file…
                <input type="file" accept="image/*" onChange={onPickFile} hidden />
              </label>
            </div>
          </div>

          {/* ---- migrate ---- */}
          <div className="admin-field pub-migrate">
            <span className="admin-field-label">Apply the site's look</span>
            <p className="admin-field-hint">
              Fill the theme from the sky palette and set the icon to that hour's dynamic avatar.
            </p>
            <div className="pub-migrate-row">
              <label className="pub-hour">
                Hour
                <select value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {skyHourKey(h)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="admin-gate-button admin-gate-button-tight" onClick={applySky} disabled={iconBusy}>
                {iconBusy ? 'Applying…' : 'Apply theme + avatar'}
              </button>
              <button type="button" className="admin-link-subtle" onClick={applyThemeOnly} disabled={iconBusy}>
                theme only
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save is the strip's, at the top of the pane. What stays here is the one
          control that changes what the form IS rather than what it holds. */}
      <div className="pub-actions">
        <button type="button" className="admin-link-subtle" onClick={toggleRaw} disabled={saving}>
          {rawMode ? '← Structured fields' : 'Edit raw JSON'}
        </button>
        <span aria-live="polite">{flash ? <span className="admin-success">Saved ✓</span> : null}</span>
      </div>
    </>
  );
}

/**
 * The publication's at:// URI, ready to copy.
 *
 * Nothing on the site reads a publication by name — the routing constants in
 * src/config.js hold URIs — so creating one is only half the job until this
 * string is pasted into the right constant. Showing it here is the difference
 * between "created it" and "wired it up".
 */
function AtUriRow({ did, rkey }) {
  const uri = `at://${did}/${PUB_NSID}/${rkey}`;
  const [copied, setCopied] = useState(false);
  // Same reason as the save flash: a 2s timer must not outlive the component.
  const copiedTimer = useRef(null);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  return (
    <div className="pub-uri">
      <code className="admin-mono pub-uri-value">{uri}</code>
      <button
        type="button"
        className="admin-gate-button admin-gate-button-tight"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(uri);
            setCopied(true);
            clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => setCopied(false), 2000);
          } catch {
            /* no clipboard permission — the URI is on screen to select by hand */
          }
        }}
      >
        {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <p className="admin-field-hint pub-uri-hint">
        Paste into <code>src/config.js</code> — <code>PORTFOLIO_PUBLICATION</code>,{' '}
        <code>BLOG_PUBLICATION</code> or <code>RATIOED_PUBLICATION</code> — and redeploy. Until then
        the site doesn&rsquo;t know this publication exists.
      </p>
    </div>
  );
}
