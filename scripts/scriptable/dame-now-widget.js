// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: satellite-dish;
//
// dame.is — "now" status widget for the Scriptable app (https://scriptable.app)
// ---------------------------------------------------------------------------
// Shows the latest `is.dame.now` status update(s) straight from the AT Protocol
// PDS — the same records that power dame.is/logging. No login required: `now`
// records are public, read via `com.atproto.repo.listRecords`.
//
// SETUP
//   1. Install Scriptable from the App Store.
//   2. Scriptable → + (new script) → paste this whole file. Name it "dame.is now".
//   3. Home screen → long-press → + → Scriptable → pick a size → add.
//   4. Long-press the widget → Edit Widget → Script: "dame.is now".
//      (Optional) "When Interacting: Run Script" if you'd rather it refresh on tap.
//
//   Sizes: small shows the latest status; medium/large show a short history.
//
//   Widget Parameter (optional, in Edit Widget) lets you point it at any repo
//   and tune it, as `key=value` pairs separated by `;`. Examples:
//     handle=dame.is
//     did=did:plc:gq4fo3u6tqzzdkjlwzpb23tj
//     count=5
//   Everything has sensible defaults, so an empty parameter just works.
//
// Runs standalone too: press ▶ in the Scriptable editor to preview.

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULTS = {
  handle: 'dame.is',
  // Pinned DID so the widget works even if handle resolution is down. The PDS
  // itself is always resolved live from the PLC directory, so a PDS migration
  // needs no change here.
  did: 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj',
  collection: 'is.dame.now',
  count: 4, // how many recent updates to show in medium/large widgets
  site: 'https://dame.is', // tapping the widget opens here (record page when possible)
};

const PLC_DIRECTORY = 'https://plc.directory';
const APPVIEW = 'https://public.api.bsky.app';
const PDS_FALLBACK = 'https://pds.atpota.to'; // last-known PDS if PLC is unreachable
const CACHE_FILE = 'dame-now-widget-cache.json';

// Palette — muted, atmospheric, tuned for both light and dark home screens.
const COLORS = {
  bgTop: new Color('#0b1020'),
  bgBottom: new Color('#161c2e'),
  prefix: new Color('#7c88a8'),
  status: new Color('#f2f4f8'),
  meta: new Color('#5f6b86'),
  accent: new Color('#6ea8fe'),
  divider: new Color('#2a3350'),
};

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

// ---------------------------------------------------------------------------
// AT Protocol helpers — plain fetch + JSON, no SDK.
// ---------------------------------------------------------------------------

async function getJson(url) {
  const req = new Request(url);
  req.timeoutInterval = 12;
  req.headers = { Accept: 'application/json' };
  return req.loadJSON();
}

async function resolveHandle(handle) {
  try {
    const res = await getJson(
      `${APPVIEW}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
    );
    if (res && res.did) return res.did;
  } catch (_) {
    // fall through to the pinned DID
  }
  return null;
}

async function resolvePds(did) {
  try {
    const doc = await getJson(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`);
    const services = (doc && doc.service) || [];
    const svc =
      services.find((s) => s.id === '#atproto_pds') || services[0];
    if (svc && svc.serviceEndpoint) return svc.serviceEndpoint.replace(/\/$/, '');
  } catch (_) {
    // fall through to the last-known PDS
  }
  return PDS_FALLBACK;
}

async function listNow(pds, did, limit) {
  const params = new URLSearchParams({
    repo: did,
    collection: cfg.collection,
    limit: String(limit),
  });
  // listRecords returns records in descending rkey order by default, and rkeys
  // are chronological TIDs — so this is already newest-first.
  const res = await getJson(`${pds}/xrpc/com.atproto.repo.listRecords?${params}`);
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
    fm.writeString(cachePath(), JSON.stringify({ items, savedAt: nowIso() }));
  } catch (_) {
    // best effort
  }
}

function nowIso() {
  return new Date().toISOString();
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
    const did = (await resolveHandle(cfg.handle)) || cfg.did;
    const pds = await resolvePds(did);
    const items = await listNow(pds, did, Math.max(want, 1));
    if (items.length) {
      writeCache(items);
      return { items, stale: false, did };
    }
  } catch (_) {
    // fall through to cache
  }
  const cached = readCache();
  if (cached && cached.items && cached.items.length) {
    return { items: cached.items, stale: true, did: cfg.did };
  }
  return { items: [], stale: false, did: cfg.did };
}

// ---------------------------------------------------------------------------
// Widget rendering
// ---------------------------------------------------------------------------

function backgroundGradient() {
  const g = new LinearGradient();
  g.colors = [COLORS.bgTop, COLORS.bgBottom];
  g.locations = [0, 1];
  return g;
}

function tapUrl(items, did) {
  // Deep-link to the newest status's record page when we can; otherwise the feed.
  const base = cfg.site.replace(/\/$/, '');
  const rkey = items[0] && items[0].rkey;
  return rkey ? `${base}/logging/${rkey}` : `${base}/logging`;
}

function addStatusLine(stack, item, { big }) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.spacing = 5;

  const prefix = row.addText('dame.is');
  prefix.font = big ? Font.mediumSystemFont(15) : Font.mediumSystemFont(12);
  prefix.textColor = COLORS.prefix;
  prefix.lineLimit = 1;

  const status = row.addText(item.status || '…');
  status.font = big ? Font.semiboldSystemFont(15) : Font.semiboldSystemFont(12);
  status.textColor = COLORS.status;
  status.lineLimit = big ? 2 : 1;
  status.minimumScaleFactor = 0.7;
}

function renderSmall(widget, data) {
  const { items, stale } = data;
  const item = items[0] || { status: 'no updates yet', createdAt: null };

  const header = widget.addStack();
  header.layoutHorizontally();
  const dot = header.addText('●');
  dot.font = Font.systemFont(9);
  dot.textColor = COLORS.accent;
  header.addSpacer(5);
  const label = header.addText('now');
  label.font = Font.mediumSystemFont(11);
  label.textColor = COLORS.meta;
  header.addSpacer();

  widget.addSpacer(8);

  const prefix = widget.addText('dame.is');
  prefix.font = Font.mediumSystemFont(13);
  prefix.textColor = COLORS.prefix;

  widget.addSpacer(2);

  const status = widget.addText(item.status || '…');
  status.font = Font.semiboldSystemFont(17);
  status.textColor = COLORS.status;
  status.lineLimit = 4;
  status.minimumScaleFactor = 0.6;

  widget.addSpacer();

  const meta = widget.addText(
    (stale ? '⚠ ' : '') + (relativeTime(item.createdAt) || ''),
  );
  meta.font = Font.systemFont(11);
  meta.textColor = COLORS.meta;
}

function renderList(widget, data, { big }) {
  const { items, stale } = data;

  const header = widget.addStack();
  header.layoutHorizontally();
  header.centerAlignContent();
  const dot = header.addText('●');
  dot.font = Font.systemFont(9);
  dot.textColor = COLORS.accent;
  header.addSpacer(6);
  const title = header.addText('dame.is · now');
  title.font = Font.semiboldSystemFont(13);
  title.textColor = COLORS.prefix;
  header.addSpacer();
  if (stale) {
    const warn = header.addText('offline');
    warn.font = Font.systemFont(10);
    warn.textColor = COLORS.meta;
  }

  widget.addSpacer(big ? 12 : 8);

  if (!items.length) {
    const empty = widget.addText('No status updates yet.');
    empty.font = Font.systemFont(13);
    empty.textColor = COLORS.meta;
    return;
  }

  const shown = items.slice(0, cfg.count);
  shown.forEach((item, i) => {
    if (i > 0) {
      widget.addSpacer(big ? 9 : 6);
      const line = widget.addStack();
      line.backgroundColor = COLORS.divider;
      line.size = new Size(0, 1);
      line.addSpacer();
      widget.addSpacer(big ? 9 : 6);
    }
    addStatusLine(widget, item, { big });
    const t = relativeTime(item.createdAt);
    if (t) {
      widget.addSpacer(2);
      const meta = widget.addText(t);
      meta.font = Font.systemFont(big ? 11 : 10);
      meta.textColor = COLORS.meta;
    }
  });

  widget.addSpacer();
}

async function buildWidget() {
  const data = await loadItems();
  const family = config.widgetFamily || 'medium';

  const widget = new ListWidget();
  widget.backgroundGradient = backgroundGradient();
  widget.setPadding(14, 15, 14, 15);
  widget.url = tapUrl(data.items, data.did);
  // Refresh at most a few times an hour; the home screen batches these.
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
  // Previewing in the app — show the medium layout.
  await widget.presentMedium();
}

Script.complete();
