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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Copy, Check } from 'lucide-react';
import PageShell from './PageShell.jsx';
import { AdminRecordListSkeleton } from './Skeleton.jsx';
import { uploadImageFile } from './blocks/ImageBlockEditor.jsx';
import { rkeyFromUri } from './RecordEditor.jsx';
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
 * A publication that doesn't exist yet.
 *
 * Same shape the editor edits, with no rkey — which is what tells the save to
 * create rather than overwrite, and lets the PDS assign the TID rather than
 * this page inventing one.
 */
function newDraft() {
  return { rkey: null, uri: null, value: { $type: PUB_NSID, name: '', url: '', description: '' } };
}

/* ======================= list ======================= */
export default function PublicationsManager({ agent, did }) {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);
  const [editingRkey, setEditingRkey] = useState(null);
  const [draft, setDraft] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await agent.com.atproto.repo.listRecords({ repo: did, collection: PUB_NSID, limit: 100 });
      setRecords((res?.data?.records || []).map((r) => ({ ...r, rkey: rkeyFromUri(r.uri) })));
    } catch (err) {
      setError(err?.message || String(err));
      setRecords([]);
    }
  }, [agent, did]);

  useEffect(() => {
    load();
  }, [load]);

  const editing = useMemo(
    () => (records || []).find((r) => r.rkey === editingRkey) || null,
    [records, editingRkey],
  );

  if (draft) {
    return (
      <PublicationEditor
        key="new"
        agent={agent}
        did={did}
        record={draft}
        onBack={() => setDraft(null)}
        // Creating hands back the rkey the PDS assigned, so the page drops
        // straight into editing the real record — with its at:// URI on
        // screen, which is the thing that has to reach src/config.js.
        onSaved={(rkey) => {
          setDraft(null);
          if (rkey) setEditingRkey(rkey);
          load();
        }}
      />
    );
  }

  if (editing) {
    return (
      <PublicationEditor
        key={editing.rkey}
        agent={agent}
        did={did}
        record={editing}
        onBack={() => setEditingRkey(null)}
        onSaved={load}
      />
    );
  }

  return (
    <PageShell
      title="Publications"
      intro="The site.standard.publication records behind the Standard Site link embeds. Edit their fields, or apply the site's sky theme + a dynamic avatar in one step."
      headTitle="Publications — Admin — dame.is"
    >
      <div className="admin-toolbar">
        <Link to="/admin" className="admin-link-subtle">← All collections</Link>
        <code className="admin-collection-nsid">{PUB_NSID}</code>
      </div>

      <div className="pub-actions">
        <button type="button" className="admin-gate-button" onClick={() => setDraft(newDraft())}>
          <Plus size={14} aria-hidden="true" />
          New publication
        </button>
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
              <button type="button" className="pub-list-row" onClick={() => setEditingRkey(r.rkey)}>
                <span className="pub-list-name">{r.value?.name || '(untitled)'}</span>
                <span className="pub-list-url">{r.value?.url || '—'}</span>
                <code className="admin-mono pub-list-rkey">{r.rkey}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

/* ======================= editor ======================= */
function PublicationEditor({ agent, did, record, onBack, onSaved }) {
  // No rkey means this publication doesn't exist yet: save creates it and lets
  // the PDS assign the key, rather than this page inventing a TID.
  const isNew = !record.rkey;
  const rkey = record.rkey;
  const [value, setValue] = useState(() => clone(record.value));
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

  async function handleSave() {
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
      if (rawMode) setRawMode(false);
      setLocalIconUrl(null);
      setFlash(true);
      setTimeout(() => setFlash(false), 2400);
      onSaved?.(savedRkey);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  const theme = value.basicTheme || null;

  return (
    <PageShell
      title={isNew ? 'New publication' : value.name || rkey}
      intro={
        isNew
          ? 'A masthead for a group of documents — what Bluesky renders instead of a plain link card. The URL matters: verification is fetched from it, so it has to be the address this publication actually lives at. Nothing is written until you press Save.'
          : 'Edit this publication. Structured fields cover the essentials; the raw JSON toggle exposes everything (the leaflet theme, labels, …). Nothing is written until you press Save.'
      }
      headTitle={`${isNew ? 'New publication' : value.name || rkey} — Publications — dame.is`}
    >
      <div className="admin-toolbar">
        <button type="button" className="admin-link-subtle" onClick={onBack}>
          ← All publications
        </button>
        <code className="admin-collection-nsid">{isNew ? PUB_NSID : `${PUB_NSID}/${rkey}`}</code>
      </div>

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

      <div className="pub-actions">
        <button type="button" className="admin-gate-button" onClick={handleSave} disabled={saving || iconBusy}>
          {saving ? 'Saving…' : flash ? 'Saved ✓' : isNew ? 'Create publication' : 'Save'}
        </button>
        <button type="button" className="admin-link-subtle" onClick={toggleRaw} disabled={saving}>
          {rawMode ? '← Structured fields' : 'Edit raw JSON'}
        </button>
      </div>
    </PageShell>
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
            setTimeout(() => setCopied(false), 2000);
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
