// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: satellite-dish;
//
// dame.is — "now" status widget for the Scriptable app (https://scriptable.app)
// ---------------------------------------------------------------------------
// Shows the latest `is.dame.now` status update(s) straight from the AT Protocol
// PDS — the same records that power dame.is/logging. No login, and no Bluesky
// AppView: the PDS is queried directly with `com.atproto.repo.listRecords`,
// exactly like the website does.
//
// The look mirrors the site: flat earthy palette, a serif voice (Charter, the
// closest iOS system serif to the site's Crimson Pro), mono timestamps, square
// corners, hairline rules. It follows the phone's light/dark appearance.
//
// SETUP
//   1. Install Scriptable from the App Store.
//   2. Scriptable → + (new script) → paste this whole file. Name it "dame.is now".
//   3. Home screen → long-press → + → Scriptable → pick a size → add.
//   4. Long-press the widget → Edit Widget → Script: "dame.is now".
//
//   Sizes: small shows the latest status; medium/large show a short history.
//
//   Widget Parameter (optional, in Edit Widget) — `key=value` pairs separated
//   by `;`. All optional; empty just works:
//     did=did:plc:gq4fo3u6tqzzdkjlwzpb23tj
//     count=5
//     site=https://dame.is
//
// Runs standalone too: press ▶ in the Scriptable editor to preview.

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULTS = {
  // The repo (DID) whose `now` records we read. Pinned so the widget works
  // without any handle lookup against a third-party AppView.
  did: 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj',
  collection: 'is.dame.now',
  count: 4, // how many recent updates to show in medium/large widgets
  site: 'https://dame.is', // tapping opens here (record page when possible)
};

const PLC_DIRECTORY = 'https://plc.directory';
const PDS_FALLBACK = 'https://pds.atpota.to'; // last-known PDS if PLC is unreachable
const CACHE_FILE = 'dame-now-widget-cache.json';

// Palette lifted straight from the site's theme.css (earthy: warm off-white
// page, greenish-black ink, mossy-green accent). One set per appearance.
const THEMES = {
  light: {
    page: new Color('#f1ead4'),
    ink: new Color('#1d2419'),
    inkMuted: new Color('#6f6e58'),
    inkFaint: new Color('#9d9784'),
    accent: new Color('#5e7a47'),
    rule: new Color('#cabf9f'),
  },
  dark: {
    page: new Color('#1d2419'),
    ink: new Color('#ece4cb'),
    inkMuted: new Color('#9a9377'),
    inkFaint: new Color('#6a6450'),
    accent: new Color('#a3b486'),
    rule: new Color('#3a4232'),
  },
};

// Serif that matches the site's Crimson Pro voice. Charter ships with iOS and
// is in the site's own fallback stack; if unavailable Scriptable falls back to
// the system font on its own.
function serif(size) {
  return new Font('Charter-Roman', size);
}
// Mono for timestamps, matching the site's `.gutter` (IBM Plex Mono → Menlo).
function mono(size) {
  return new Font('Menlo', size);
}

// ---------------------------------------------------------------------------
// Parse the optional widget parameter (`key=value;key=value`)
// ---------------------------------------------------------------------------

function parseParams(raw) {
  const cfg = { ...DEFAULTS };
  if (!raw) return cfg;
  for (const pair of String(raw).split(/[;\n]+/)) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (!key || !val) continue;
    if (key === 'count') {
      const n = parseInt(val, 10);
      if (Number.isFinite(n) && n > 0) cfg.count = n;
    } else if (key in cfg) {
      cfg[key] = val;
    }
  }
  return cfg;
}

const cfg = parseParams(args.widgetParameter);
const theme = Device.isUsingDarkAppearance() ? THEMES.dark : THEMES.light;

// ---------------------------------------------------------------------------
// AT Protocol helpers — plain fetch + JSON. No SDK, no URLSearchParams (not
// available in Scriptable's JS engine); query strings are built by hand.
// ---------------------------------------------------------------------------

async function getJson(url) {
  const req = new Request(url);
  req.timeoutInterval = 12;
  req.headers = { Accept: 'application/json' };
  return req.loadJSON();
}

async function resolvePds(did) {
  try {
    const doc = await getJson(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`);
    const services = (doc && doc.service) || [];
    const svc = services.find((s) => s.id === '#atproto_pds') || services[0];
    if (svc && svc.serviceEndpoint) return svc.serviceEndpoint.replace(/\/$/, '');
  } catch (_) {
    // fall through to the last-known PDS
  }
  return PDS_FALLBACK;
}

async function listNow(pds, did, limit) {
  const qs =
    `repo=${encodeURIComponent(did)}` +
    `&collection=${encodeURIComponent(cfg.collection)}` +
    `&limit=${encodeURIComponent(String(limit))}`;
  // listRecords returns records in descending rkey order by default, and rkeys
  // are chronological TIDs — so this is already newest-first.
  const res = await getJson(`${pds}/xrpc/com.atproto.repo.listRecords?${qs}`);
  const records = (res && res.records) || [];
  return records.map((r) => {
    const v = r.value || {};
    return {
      // Older `now` records used `text`; the current lexicon uses `status`.
      status: v.status || v.text || '',
      createdAt: v.createdAt || v.updatedAt || null,
      rkey: rkeyFromUri(r.uri),
    };
  });
}

function rkeyFromUri(uri) {
  if (!uri) return null;
  const m = String(uri).match(/\/([^/]+)$/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Tiny on-disk cache so the widget still shows something when offline.
// ---------------------------------------------------------------------------

function cachePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.cacheDirectory(), CACHE_FILE);
}

function readCache() {
  try {
    const fm = FileManager.local();
    const p = cachePath();
    if (!fm.fileExists(p)) return null;
    return JSON.parse(fm.readString(p));
  } catch (_) {
    return null;
  }
}

function writeCache(items) {
  try {
    const fm = FileManager.local();
    fm.writeString(cachePath(), JSON.stringify({ items, savedAt: new Date().toISOString() }));
  } catch (_) {
    // best effort
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

// ---------------------------------------------------------------------------
// Data load — network first, cache on failure.
// ---------------------------------------------------------------------------

async function loadItems() {
  const family = config.widgetFamily || 'medium';
  const want = family === 'small' ? 1 : cfg.count;
  try {
    const pds = await resolvePds(cfg.did);
    const items = await listNow(pds, cfg.did, Math.max(want, 1));
    if (items.length) {
      writeCache(items);
      return { items, stale: false };
    }
  } catch (_) {
    // fall through to cache
  }
  const cached = readCache();
  if (cached && cached.items && cached.items.length) {
    return { items: cached.items, stale: true };
  }
  return { items: [], stale: false };
}

// ---------------------------------------------------------------------------
// Widget rendering — flat page color, serif voice, mono timestamps, hairlines.
// ---------------------------------------------------------------------------

function tapUrl(items) {
  const base = cfg.site.replace(/\/$/, '');
  const rkey = items[0] && items[0].rkey;
  return rkey ? `${base}/logging/${rkey}` : `${base}/logging`;
}

// Uppercase, letter-spaced metadata label like the site's `.metadata` class.
function addHeader(widget, stale) {
  const row = widget.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  const label = row.addText('N O W');
  label.font = mono(9);
  label.textColor = theme.inkMuted;

  row.addSpacer();

  const site = row.addText(stale ? 'offline' : 'dame.is');
  site.font = mono(9);
  site.textColor = theme.inkFaint;
}

// A 1px hairline in the site's --rule color.
function addHairline(widget) {
  const line = widget.addStack();
  line.size = new Size(0, 1);
  line.backgroundColor = theme.rule;
  line.addSpacer();
}

// One status row: "dame.is" (faint) + body (ink) on the left, mono time right.
function addStatusRow(widget, item, { size }) {
  const row = widget.addStack();
  row.layoutHorizontally();
  row.topAlignContent();
  row.spacing = 6;

  const prefix = row.addText('dame.is');
  prefix.font = serif(size);
  prefix.textColor = theme.inkFaint;
  prefix.lineLimit = 1;

  const body = row.addText(item.status || '—');
  body.font = serif(size);
  body.textColor = theme.ink;
  body.lineLimit = size >= 17 ? 3 : 2;
  body.minimumScaleFactor = 0.7;

  row.addSpacer();

  const t = relativeTime(item.createdAt);
  if (t) {
    const time = row.addText(t);
    time.font = mono(Math.max(9, size - 7));
    time.textColor = theme.inkFaint;
    time.lineLimit = 1;
  }
}

function renderSmall(widget, data) {
  const item = (data.items && data.items[0]) || { status: 'no updates yet', createdAt: null };

  addHeader(widget, data.stale);
  widget.addSpacer(10);

  const prefix = widget.addText('dame.is');
  prefix.font = serif(15);
  prefix.textColor = theme.inkFaint;

  widget.addSpacer(3);

  const body = widget.addText(item.status || '—');
  body.font = serif(19);
  body.textColor = theme.ink;
  body.lineLimit = 4;
  body.minimumScaleFactor = 0.6;

  widget.addSpacer();

  const t = relativeTime(item.createdAt);
  const meta = widget.addText(t || '');
  meta.font = mono(10);
  meta.textColor = theme.inkFaint;
}

function renderList(widget, data, { big }) {
  addHeader(widget, data.stale);
  widget.addSpacer(big ? 12 : 9);

  if (!data.items.length) {
    const empty = widget.addText('No status updates yet.');
    empty.font = serif(15);
    empty.textColor = theme.inkMuted;
    widget.addSpacer();
    return;
  }

  const size = big ? 17 : 14;
  const shown = data.items.slice(0, cfg.count);
  shown.forEach((item, i) => {
    if (i > 0) {
      widget.addSpacer(big ? 9 : 7);
      addHairline(widget);
      widget.addSpacer(big ? 9 : 7);
    }
    addStatusRow(widget, item, { size });
  });

  widget.addSpacer();
}

async function buildWidget() {
  const data = await loadItems();
  const family = config.widgetFamily || 'medium';

  const widget = new ListWidget();
  widget.backgroundColor = theme.page; // flat, square — matches the site
  widget.setPadding(15, 16, 15, 16);
  widget.url = tapUrl(data.items);
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  if (family === 'small') {
    renderSmall(widget, data);
  } else {
    renderList(widget, data, { big: family === 'large' || family === 'extraLarge' });
  }

  return widget;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const widget = await buildWidget();

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}

Script.complete();
