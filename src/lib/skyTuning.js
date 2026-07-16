// The parametric tuning layer for the sky theme.
//
// The hour-tracking palette in src/lib/skyTheme.js is computed from the
// hardcoded SKY_BANDS + SUN_CURVE arrays. This module is the optional
// *override* on top of it, stored as an is.dame.sky/self record on the PDS
// (see lexicons/is.dame.sky.json) and edited in the admin "Sky theme
// studio". It follows the same contract as the nav-menu override: when the
// record is `enabled`, its per-hour entries layer onto the built-in
// palette; otherwise the built-in derivation stands unchanged.
//
// Two shapes flow through here:
//   - the RECORD (what lives on the PDS): { enabled, hours: [{hour, …}], … },
//     compact — only overridden hours are listed, knobs default to no-ops.
//   - the DRAFT (what the studio edits): a full 0–23 map of normalized cfg
//     objects, every field present, so the controls always have a value.
// effectiveSkyTuning() turns a record into the { enabled, hours:{h:cfg} }
// map that skyTheme.setSkyTuning() applies at runtime.

import { defaultPopForHour } from './skyTheme.js';

const HEX = /^#[0-9a-fA-F]{6}$/;
const isHex = (v) => typeof v === 'string' && HEX.test(v);
const numOr = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));

export const GLOW_GROUPS = ['buttons', 'avatar', 'accentText', 'controls'];
const DEFAULT_TARGETS = { buttons: true, avatar: true, accentText: true, controls: false };

// The suggested contrast-fix starting point for the two shoulder hours —
// what the studio seeds when no record exists yet (dawn 7am, dusk 6pm).
// These are the values dialed in during the design pass.
const FIX = { ruleWarmth: 0.5, ruleContrast: 0.24, inkWarmth: 0.3, inkContrast: 0.24, glowSize: 16, glowStrength: 0.3 };
const FIX_HOURS = new Set([7, 18]);

/** A no-op cfg for an hour: renders identically to the built-in palette. */
export function identityHourCfg(hour) {
  const pop = defaultPopForHour(hour);
  return {
    pop,
    page: null,
    surfaceSep: 1,
    ruleWarmth: 0,
    ruleContrast: 0,
    inkWarmth: 0,
    inkContrast: 0,
    glowColor: pop,
    glowSize: 16,
    glowStrength: 0,
    glowTargets: { ...DEFAULT_TARGETS },
  };
}

/** The studio's seeded starting cfg for an hour (FIX on 7am/6pm, else identity). */
export function seedHourCfg(hour) {
  const cfg = identityHourCfg(hour);
  if (FIX_HOURS.has(hour)) Object.assign(cfg, FIX);
  return cfg;
}

/** A cfg is an override when it changes anything vs. the built-in palette. */
export function hasOverride(cfg) {
  if (!cfg) return false;
  return (
    cfg.page != null ||
    numOr(cfg.surfaceSep, 1) !== 1 ||
    clamp01(cfg.ruleWarmth) > 0 ||
    numOr(cfg.ruleContrast, 0) > 0 ||
    clamp01(cfg.inkWarmth) > 0 ||
    numOr(cfg.inkContrast, 0) > 0 ||
    clamp01(cfg.glowStrength) > 0
  );
}

/** Normalize one record `hours` item into a full cfg (fills every field). */
function normalizeHourCfg(item, hour) {
  const pop = isHex(item?.pop) ? item.pop : defaultPopForHour(hour);
  const targets = Array.isArray(item?.glowTargets) ? item.glowTargets : [];
  return {
    pop,
    page: isHex(item?.page) ? item.page : null,
    surfaceSep: numOr(item?.surfaceSep, 1),
    ruleWarmth: clamp01(item?.ruleWarmth),
    ruleContrast: numOr(item?.ruleContrast, 0),
    inkWarmth: clamp01(item?.inkWarmth),
    inkContrast: numOr(item?.inkContrast, 0),
    glowColor: isHex(item?.glowColor) ? item.glowColor : pop,
    glowSize: numOr(item?.glowSize, 16),
    glowStrength: clamp01(item?.glowStrength),
    glowTargets: GLOW_GROUPS.reduce((o, g) => ((o[g] = targets.includes(g)), o), {}),
  };
}

/** The record's `value` whether it's wrapped ({value}) or already bare. */
function recordValue(record) {
  if (!record) return null;
  return record.value ?? record.data?.value ?? (record.enabled !== undefined ? record : null);
}

/**
 * Turn an is.dame.sky record into the runtime tuning map
 * { enabled, hours: { <h>: cfg } }, or null when it's absent / disabled /
 * empty (so callers cleanly fall back to the built-in palette).
 */
export function effectiveSkyTuning(record) {
  const v = recordValue(record);
  if (!v || !v.enabled || !Array.isArray(v.hours)) return null;
  const hours = {};
  for (const item of v.hours) {
    const h = Number(item?.hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) continue;
    const cfg = normalizeHourCfg(item, h);
    if (hasOverride(cfg)) hours[h] = cfg;
  }
  if (!Object.keys(hours).length) return null;
  return { enabled: true, hours };
}

/**
 * Build the studio's editable draft from a record: a full 0–23 map of cfgs.
 * With no record, seed the two shoulder hours with the contrast fix.
 */
export function recordToDraft(record) {
  const v = recordValue(record);
  const byHour = {};
  const seeded = !v || !Array.isArray(v.hours) || !v.hours.length;
  for (let h = 0; h < 24; h += 1) byHour[h] = seeded ? seedHourCfg(h) : identityHourCfg(h);
  if (v && Array.isArray(v.hours)) {
    for (const item of v.hours) {
      const h = Number(item?.hour);
      if (Number.isInteger(h) && h >= 0 && h <= 23) byHour[h] = normalizeHourCfg(item, h);
    }
  }
  return { enabled: Boolean(v?.enabled), byHour, createdAt: v?.createdAt || null };
}

/** Compact a draft cfg down to only the fields that differ from an identity. */
function compactHourCfg(cfg, hour) {
  const out = { hour };
  const base = defaultPopForHour(hour);
  if ((cfg.ruleWarmth || cfg.ruleContrast) && cfg.pop && cfg.pop !== base) out.pop = cfg.pop;
  else if ((cfg.inkWarmth || cfg.inkContrast) && cfg.pop && cfg.pop !== base) out.pop = cfg.pop;
  else if (cfg.pop && cfg.pop !== base) out.pop = cfg.pop;
  if (cfg.page) out.page = cfg.page;
  if (numOr(cfg.surfaceSep, 1) !== 1) out.surfaceSep = round(cfg.surfaceSep, 2);
  if (cfg.ruleWarmth) out.ruleWarmth = round(cfg.ruleWarmth, 2);
  if (cfg.ruleContrast) out.ruleContrast = round(cfg.ruleContrast, 3);
  if (cfg.inkWarmth) out.inkWarmth = round(cfg.inkWarmth, 2);
  if (cfg.inkContrast) out.inkContrast = round(cfg.inkContrast, 3);
  if (cfg.glowStrength > 0 && cfg.glowSize > 0) {
    if (cfg.glowColor && cfg.glowColor !== cfg.pop) out.glowColor = cfg.glowColor;
    out.glowSize = Math.round(cfg.glowSize);
    out.glowStrength = round(cfg.glowStrength, 2);
    out.glowTargets = GLOW_GROUPS.filter((g) => cfg.glowTargets?.[g]);
  }
  return out;
}

const round = (v, n) => {
  const f = 10 ** n;
  return Math.round(Number(v) * f) / f;
};

/** The record `hours` array from a draft — only overridden hours, compact. */
export function draftToHoursArray(byHour) {
  const hours = [];
  for (let h = 0; h < 24; h += 1) {
    if (hasOverride(byHour[h])) hours.push(compactHourCfg(byHour[h], h));
  }
  return hours;
}

/** A runtime tuning map from a draft, for live preview via setSkyTuning. */
export function draftToTuning(enabled, byHour) {
  const hours = {};
  for (let h = 0; h < 24; h += 1) {
    if (hasOverride(byHour[h])) hours[h] = byHour[h];
  }
  return { enabled: Boolean(enabled), hours };
}
