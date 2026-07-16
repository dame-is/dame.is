// Admin studio for is.dame.sky/self — the optional PDS override for the
// hour-tracking sky theme (src/lib/skyTheme.js). Pick any of the 24 hours
// and tune it: adjust the background, warm the borders and faint/muted
// text toward the horizon for contrast, and add a soft glow to chosen
// elements. Edits preview live on the whole site (tune on the fly) and
// nothing persists until Save. With the override toggled off (or no
// record), the site uses its built-in hourly palette. Follows the same
// contract + shell as NavMenuPanel; controls are the site's own vocabulary
// (color inputs, square/hairline sliders). The hour selector rides in a
// sticky bar pinned above the bottom chrome (portalled to <body>, like the
// owner edit-mode action bar), so you can switch hours from anywhere.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import PageShell from './PageShell.jsx';
import { AdminRecordListSkeleton } from './Skeleton.jsx';
import {
  paletteForHour,
  applySkyTheme,
  easternHour,
  skyHourKey,
  defaultPopForHour,
} from '../lib/skyTheme.js';
import {
  recordToDraft,
  draftToHoursArray,
  draftToTuning,
  identityHourCfg,
  hasOverride,
  GLOW_GROUPS,
} from '../lib/skyTuning.js';
import { skyAvatarUrl } from '../lib/skyAvatars.js';
import { useTheme } from '../hooks/useTheme.jsx';
import { SKY_NSID } from '../config.js';
import './SkyThemeStudio.css';

/* ---------- small color kit (hex + WCAG contrast) ---------- */
function hexToRgb(hex) {
  const n = parseInt(String(hex || '').replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function relLum(hex) {
  const lin = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrast(a, b) {
  const l1 = relLum(a);
  const l2 = relLum(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
const grade = (ratio, target) => (ratio >= target ? 'good' : ratio >= target * 0.8 ? 'warn' : 'bad');

/* ---------- hex ⇄ hsl, for the Hue / Brightness sliders on each color field
   (kept local rather than reaching into skyTheme.js's private conversion
   kit — same math, decoupled module). ---------- */
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = (g - b) / d + (g < b ? 6 : 0); break;
    case g: h = (b - r) / d + 2; break;
    default: h = (r - g) / d + 4;
  }
  return [h * 60, s, l];
}
function hslToRgb([h, s, l]) {
  h = (((h % 360) + 360) % 360) / 360;
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(hue(h + 1 / 3) * 255),
    Math.round(hue(h) * 255),
    Math.round(hue(h - 1 / 3) * 255),
  ];
}

// Map a paletteForHour() var set onto the real theme-token custom props, so
// the preview subtree renders in exactly the tuned palette.
function previewStyle(vars) {
  return {
    '--page': vars['--sky-page'],
    '--page-edge': vars['--sky-page-edge'],
    '--surface-raised': vars['--sky-surface-raised'],
    '--ink': vars['--sky-ink'],
    '--ink-soft': vars['--sky-ink-soft'],
    '--ink-muted': vars['--sky-ink-muted'],
    '--ink-faint': vars['--sky-ink-faint'],
    '--rule': vars['--sky-rule'],
    '--rule-soft': vars['--sky-rule-soft'],
    '--accent': vars['--sky-accent'],
    '--accent-soft': vars['--sky-accent-soft'],
    '--tan': vars['--sky-tan'],
    '--glow-buttons': vars['--sky-glow-buttons'],
    '--glow-avatar': vars['--sky-glow-avatar'],
    '--glow-accent': vars['--sky-glow-accent'],
    '--glow-controls': vars['--sky-glow-controls'],
  };
}

const hourLabel = (h) => skyHourKey(h).replace('am', ' AM').replace('pm', ' PM').toUpperCase();

export default function SkyThemeStudio({ agent, did }) {
  const { installSkyTuning, setSkyPreviewHour } = useTheme();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [byHour, setByHour] = useState(null);
  const [createdAt, setCreatedAt] = useState(null);
  const [hour, setHour] = useState(() => easternHour());
  const [liveApply, setLiveApply] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(false);
  const hourBarRef = useRef(null);

  // Reserve page space for the fixed hour bar (measured live) by feeding its
  // height into the .app-shell bottom padding, the same way the edit-mode
  // action bar does — so the last controls always clear it.
  useEffect(() => {
    if (loading || !byHour) return undefined;
    const el = hourBarRef.current;
    if (!el) return undefined;
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--sky-hourbar-h', `${el.offsetHeight}px`);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--sky-hourbar-h');
    };
  }, [loading, byHour]);

  // Load the existing override (or seed the two shoulder hours with the fix).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let record = null;
      try {
        const res = await agent.com.atproto.repo.getRecord({ repo: did, collection: SKY_NSID, rkey: 'self' });
        record = res?.data ? { value: res.data.value } : null;
      } catch {
        record = null; // 404 until one exists
      }
      if (cancelled) return;
      const draft = recordToDraft(record);
      setEnabled(draft.enabled);
      setByHour(draft.byHour);
      setCreatedAt(draft.createdAt);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, did]);

  // Live preview on the whole site (tune on the fly). Forces the override on
  // for the previewed hour regardless of the enable toggle, so a dormant
  // draft still previews, and mirrors the hour onto the chrome-bar avatar
  // mark via setSkyPreviewHour so the brand mark matches the tuned palette.
  // Restores the real hour (and clears the avatar mirror) when off / unmount.
  useEffect(() => {
    if (loading || !byHour) return undefined;
    if (liveApply) {
      applySkyTheme(hour, draftToTuning(true, byHour));
      setSkyPreviewHour(hour);
    } else {
      applySkyTheme(easternHour());
      setSkyPreviewHour(null);
    }
    return undefined;
  }, [loading, liveApply, hour, byHour, setSkyPreviewHour]);
  useEffect(
    () => () => {
      applySkyTheme(easternHour());
      setSkyPreviewHour(null);
    },
    [setSkyPreviewHour],
  );

  const cfg = byHour ? byHour[hour] : null;

  const patchHour = useCallback(
    (fields) => {
      setByHour((prev) => ({ ...prev, [hour]: { ...prev[hour], ...fields } }));
    },
    [hour],
  );
  const patchGlowTarget = useCallback(
    (group, on) => {
      setByHour((prev) => ({
        ...prev,
        [hour]: { ...prev[hour], glowTargets: { ...prev[hour].glowTargets, [group]: on } },
      }));
    },
    [hour],
  );
  const resetHour = useCallback(() => {
    setByHour((prev) => ({ ...prev, [hour]: identityHourCfg(hour) }));
  }, [hour]);

  // Tuned + baseline palettes for the selected hour, for the preview + readout.
  const tunedVars = useMemo(
    () => (byHour ? paletteForHour(hour, draftToTuning(true, byHour)).vars : null),
    [byHour, hour],
  );
  const baseVars = useMemo(() => paletteForHour(hour, null).vars, [hour]);

  const rows = useMemo(() => {
    if (!tunedVars) return [];
    const defs = [
      { name: 'muted ink · on page', a: '--sky-ink-muted', bg: '--sky-page', target: 4.5 },
      { name: 'faint ink · on page', a: '--sky-ink-faint', bg: '--sky-page', target: 3.0 },
      { name: 'muted · on chrome', a: '--sky-ink-muted-raised', bg: '--sky-surface-raised', target: 4.0 },
      { name: 'rule · on page', a: '--sky-rule', bg: '--sky-page', target: 3.0 },
    ];
    return defs.map((d) => ({
      name: d.name,
      target: d.target,
      now: contrast(baseVars[d.a], baseVars[d.bg]),
      tuned: contrast(tunedVars[d.a], tunedVars[d.bg]),
    }));
  }, [tunedVars, baseVars]);

  const overriddenCount = useMemo(
    () => (byHour ? Object.keys(byHour).filter((h) => hasOverride(byHour[h])).length : 0),
    [byHour],
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    setFlash(false);
    try {
      const hours = draftToHoursArray(byHour);
      const now = new Date().toISOString();
      const record = {
        $type: SKY_NSID,
        enabled,
        hours,
        createdAt: createdAt || now,
        updatedAt: now,
      };
      await agent.com.atproto.repo.putRecord({ repo: did, collection: SKY_NSID, rkey: 'self', record });
      setCreatedAt(record.createdAt);
      // Install the saved tuning into the global slot (for when the studio
      // unmounts) but don't trigger ThemeProvider's apply effect — that
      // would paint the real clock hour and clobber the selected-hour
      // preview. Instead, explicitly re-apply the studio's own preview so
      // the site stays on the hour being tuned.
      installSkyTuning(record);
      if (liveApply) applySkyTheme(hour, draftToTuning(true, byHour));
      else applySkyTheme(easternHour());
      setFlash(true);
      setTimeout(() => setFlash(false), 2400);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  const avatarUrl = skyAvatarUrl(hour);
  const isDay = byHour ? paletteForHour(hour, null).day : true;

  return (
    <PageShell
      title="Sky theme studio"
      intro="Tune the hour-tracking palette. Pick an hour, adjust its background, warm the borders and faint/muted text toward the horizon for contrast, and add a soft glow to chosen elements. Edits preview live on the site; nothing is written until you Save. Turn the override off to fall back to the built-in palette."
      headTitle="Sky theme studio — Admin — dame.is"
    >
      <div className="admin-toolbar">
        <Link to="/admin" className="admin-link-subtle">← All collections</Link>
        <code className="admin-collection-nsid">{SKY_NSID}/self</code>
      </div>

      {error && <p className="admin-error">{error}</p>}

      {loading || !byHour ? (
        <AdminRecordListSkeleton rows={5} />
      ) : (
        <>
          <label className="sky-enable">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span>
              <strong>Use this override</strong>
              <span className="sky-enable-hint">
                {enabled
                  ? 'Live on the site — the tuned hours below drive the palette for everyone.'
                  : 'Off — the site is using its built-in palette. Your edits are saved but dormant.'}
              </span>
            </span>
          </label>

          {/* ---- preview ---- */}
          <div className="sky-preview" style={previewStyle(tunedVars)}>
            <div className="sky-pv-chrome">
              {avatarUrl ? (
                <img className="sky-pv-avatar" src={avatarUrl} alt="" />
              ) : (
                <span className="sky-pv-avatar sky-pv-avatar-empty" />
              )}
              <span className="sky-pv-id"><b>dame.is</b> <span className="sky-pv-note">trying to take a nap</span></span>
              <span className="sky-pv-ago">1h</span>
            </div>
            <div className="sky-pv-body">
              <div className="sky-pv-hero">
                <span className="sky-pv-faint">who</span> <span className="sky-pv-muted">unconsciously</span>{' '}
                <span className="sky-pv-accent">hums christmas music</span>
              </div>
              <div className="sky-pv-nav">
                <span className="sky-pv-cta sky-pv-cta-primary">Resume</span>
                <span className="sky-pv-cta">Projects</span>
                <span className="sky-pv-cta">Blog</span>
              </div>
              <div className="sky-pv-row">
                <span className="sky-pv-lbl">listening</span>
                <span className="sky-pv-ttl">KNOWER, clown core · <span className="sky-pv-hl">5 songs</span></span>
                <span className="sky-pv-tm">6:02 pm</span>
              </div>
              <div className="sky-pv-row">
                <span className="sky-pv-lbl">posting</span>
                <span className="sky-pv-ttl">The Hi-C Department of Fruit Punch</span>
                <span className="sky-pv-tm">3:58 pm</span>
              </div>
            </div>
          </div>

          <label className="sky-live">
            <input type="checkbox" checked={liveApply} onChange={(e) => setLiveApply(e.target.checked)} />
            <span>Preview this hour on the whole site while I tune</span>
          </label>

          {/* ---- contrast readout ---- */}
          <div className="sky-readout">
            {rows.map((r) => (
              <div key={r.name} className="sky-read-row">
                <span className="sky-read-name">{r.name}</span>
                <span className="sky-read-nums">
                  <span className={`sky-chip ${grade(r.now, r.target)}`}>{r.now.toFixed(2)}</span>
                  <span className="sky-read-arrow">→</span>
                  <span className={`sky-chip ${grade(r.tuned, r.target)}`}>{r.tuned.toFixed(2)}</span>
                  <span className="sky-read-target">/ {r.target.toFixed(1)}</span>
                </span>
              </div>
            ))}
          </div>

          {/* ---- controls ---- */}
          <div className="sky-controls">
            <section className="sky-group">
              <h3 className="admin-collection-group-heading small-caps">Background</h3>
              <div className="sky-fields">
                <ColorField
                  label="Page color"
                  hint={cfg.page ? 'custom' : 'auto (sun-tracked)'}
                  value={cfg.page || baseVars['--sky-page']}
                  onChange={(v) => patchHour({ page: v })}
                  onReset={cfg.page ? () => patchHour({ page: null }) : null}
                />
                <SliderField label="Surface separation" value={cfg.surfaceSep} min={0.4} max={2} step={0.1} display={`${cfg.surfaceSep.toFixed(1)}×`} onChange={(v) => patchHour({ surfaceSep: v })} />
              </div>
            </section>

            <section className="sky-group">
              <h3 className="admin-collection-group-heading small-caps">Horizon pop</h3>
              <div className="sky-fields">
                <ColorField
                  label="Pop color"
                  hint="warms borders + text + highlight"
                  value={cfg.pop}
                  onChange={(v) => patchHour({ pop: v })}
                  onReset={cfg.pop !== defaultPopForHour(hour) ? () => patchHour({ pop: defaultPopForHour(hour) }) : null}
                />
              </div>
            </section>

            <section className="sky-group">
              <h3 className="admin-collection-group-heading small-caps">Borders</h3>
              <div className="sky-fields">
                <SliderField label="Warmth" value={Math.round(cfg.ruleWarmth * 100)} min={0} max={100} step={5} display={`${Math.round(cfg.ruleWarmth * 100)}%`} onChange={(v) => patchHour({ ruleWarmth: v / 100 })} />
                <SliderField label="Contrast" value={cfg.ruleContrast} min={0} max={0.45} step={0.02} display={cfg.ruleContrast.toFixed(2)} onChange={(v) => patchHour({ ruleContrast: v })} />
              </div>
            </section>

            <section className="sky-group">
              <h3 className="admin-collection-group-heading small-caps">Faint &amp; muted text</h3>
              <div className="sky-fields">
                <SliderField label="Warmth" value={Math.round(cfg.inkWarmth * 100)} min={0} max={100} step={5} display={`${Math.round(cfg.inkWarmth * 100)}%`} onChange={(v) => patchHour({ inkWarmth: v / 100 })} />
                <SliderField label="Contrast" value={cfg.inkContrast} min={0} max={0.45} step={0.02} display={cfg.inkContrast.toFixed(2)} onChange={(v) => patchHour({ inkContrast: v })} />
              </div>
            </section>

            <section className="sky-group">
              <h3 className="admin-collection-group-heading small-caps">Glow / shine</h3>
              <div className="sky-fields">
                <ColorField label="Glow color" value={cfg.glowColor} onChange={(v) => patchHour({ glowColor: v })} onReset={cfg.glowColor !== cfg.pop ? () => patchHour({ glowColor: cfg.pop }) : null} />
                <SliderField label="Size" value={cfg.glowSize} min={0} max={48} step={2} display={`${cfg.glowSize}px`} onChange={(v) => patchHour({ glowSize: v })} />
                <SliderField label="Strength" value={Math.round(cfg.glowStrength * 100)} min={0} max={100} step={5} display={`${Math.round(cfg.glowStrength * 100)}%`} onChange={(v) => patchHour({ glowStrength: v / 100 })} />
              </div>
              <div className="sky-targets">
                <span className="admin-field-label">Applies to</span>
                <div className="sky-targets-grid">
                  {GLOW_GROUPS.map((g) => (
                    <label key={g} className="sky-check">
                      <input type="checkbox" checked={Boolean(cfg.glowTargets[g])} onChange={(e) => patchGlowTarget(g, e.target.checked)} />
                      {GLOW_LABELS[g]}
                    </label>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <div className="sky-actions">
            <button type="button" className="admin-gate-button" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : flash ? 'Saved ✓' : 'Save'}
            </button>
            <button type="button" className="admin-link-subtle" onClick={resetHour} disabled={saving}>
              Reset {skyHourKey(hour)}
            </button>
          </div>

          {/* Hour selector: a sticky bar above the bottom chrome (portalled so
              a transformed route wrapper can't break its fixed position). */}
          {createPortal(
            <div className="sky-hourbar" ref={hourBarRef}>
              <div className="sky-hourbar-inner">
                <div className="sky-hourbar-row">
                  <button type="button" className="sky-step" onClick={() => setHour((h) => (h + 23) % 24)} aria-label="Previous hour">‹</button>
                  <span className="sky-hour-name">
                    {hourLabel(hour)}{' '}
                    <span className="sky-hour-tag">{isDay ? 'day' : 'night'}{hasOverride(cfg) ? ' · override' : ''}</span>
                  </span>
                  <button type="button" className="sky-step" onClick={() => setHour((h) => (h + 1) % 24)} aria-label="Next hour">›</button>
                  <span className="sky-hourbar-meta">{overriddenCount}/24 tuned</span>
                </div>
                <div className="sky-arc" role="tablist" aria-label="Hour">
                  {Array.from({ length: 24 }, (_, h) => {
                    const pv = paletteForHour(h, draftToTuning(true, byHour)).vars['--sky-page'];
                    return (
                      <button
                        key={h}
                        type="button"
                        role="tab"
                        aria-selected={h === hour}
                        className={`sky-arc-cell ${h === hour ? 'is-sel' : ''} ${hasOverride(byHour[h]) ? 'is-ovr' : ''}`}
                        style={{ background: pv }}
                        title={skyHourKey(h)}
                        onClick={() => setHour(h)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>,
            document.body,
          )}
        </>
      )}
    </PageShell>
  );
}

const GLOW_LABELS = {
  buttons: 'Accent buttons',
  avatar: 'Avatar mark',
  accentText: 'Accent text',
  controls: 'Outlined controls',
};

function ColorField({ label, hint, value, onChange, onReset }) {
  const [h, s, l] = rgbToHsl(hexToRgb(value));
  const setHue = (nh) => onChange(rgbToHex(hslToRgb([nh, s, l])));
  const setSaturation = (ns) => onChange(rgbToHex(hslToRgb([h, ns, l])));
  const setBrightness = (nl) => onChange(rgbToHex(hslToRgb([h, s, nl])));
  const midHue = rgbToHex(hslToRgb([h, s, 0.5]));
  const satLo = rgbToHex(hslToRgb([h, 0, l]));
  const satHi = rgbToHex(hslToRgb([h, 1, l]));
  return (
    // A plain div, not a <label> — unlike SliderField this field wraps
    // four inputs (swatch + three sliders), and a label should only ever
    // imply an association with one.
    <div className="sky-field sky-color-field">
      <span className="admin-field-label">
        {label}
        {hint ? <span className="admin-field-hint"> {hint}</span> : null}
      </span>
      <span className="sky-color-row">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        <code className="sky-color-hex">{value}</code>
        {onReset ? (
          <button type="button" className="sky-reset" onClick={onReset} title="Reset to default">reset</button>
        ) : null}
      </span>
      <span className="sky-hsl-group">
        <span className="admin-field-label sky-slider-label">
          <span>Hue</span>
          <span className="sky-field-val">{Math.round(h)}°</span>
        </span>
        <input
          className="sky-slider sky-slider-hue"
          type="range"
          min={0}
          max={359}
          step={1}
          value={Math.round(h)}
          onChange={(e) => setHue(Number(e.target.value))}
        />
      </span>
      <span className="sky-hsl-group">
        <span className="admin-field-label sky-slider-label">
          <span>Saturation</span>
          <span className="sky-field-val">{Math.round(s * 100)}%</span>
        </span>
        <input
          className="sky-slider sky-slider-saturation"
          style={{ '--sky-slider-sat-lo': satLo, '--sky-slider-sat-hi': satHi }}
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(s * 100)}
          onChange={(e) => setSaturation(Number(e.target.value) / 100)}
        />
      </span>
      <span className="sky-hsl-group">
        <span className="admin-field-label sky-slider-label">
          <span>Brightness</span>
          <span className="sky-field-val">{Math.round(l * 100)}%</span>
        </span>
        <input
          className="sky-slider sky-slider-lightness"
          style={{ '--sky-slider-mid': midHue }}
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(l * 100)}
          onChange={(e) => setBrightness(Number(e.target.value) / 100)}
        />
      </span>
    </div>
  );
}

function SliderField({ label, hint, value, min, max, step, display, onChange }) {
  return (
    <label className="sky-field sky-slider-field">
      <span className="admin-field-label sky-slider-label">
        <span>
          {label}
          {hint ? <span className="admin-field-hint"> {hint}</span> : null}
        </span>
        <span className="sky-field-val">{display}</span>
      </span>
      <input
        className="sky-slider"
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
