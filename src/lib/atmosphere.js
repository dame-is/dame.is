// The atmosphere's weather, for the overlays: the AT Protocol network's
// records a second and what they add up to, as atpota.to's weather station
// measures it (atpota.to/weather). dame.is draws it its own way (the
// atmosphere widget's styles, src/overlay/widgets.jsx) and Poe talks about it
// (src/overlay/poe/lines.js), but the readings are the station's, and so are
// the words for its conditions, its scales and its alerts: they are ported
// from atpota.to's website/src/scripts/weather.ts, weather-forecast.ts and
// weather-alerts.ts so the two sites never describe the same sky two ways.
//
// Two readings, through dame.is's own /api/atmosphere (api/atmosphere.js),
// which asks atpota.to and hands the answer on:
//
//   now        the live minute: every LIVE_MS while it comes from the station,
//              every SAMPLE_MS from the fallback sample
//   forecast   the next hours, every FORECAST_MS
//
// atpota.to's /api/atmosphere answers any origin, so `now` falls back to it
// directly when dame.is's own function isn't there (a dev server); its
// forecast doesn't, so the forecast has no such fallback.
//
// One store for the page: every widget and Poe read the same reading, and the
// polling stops when the last of them goes.

export const LIVE_MS = 15_000;
export const SAMPLE_MS = 60_000;
export const FORECAST_MS = 5 * 60_000;
export const NOW_URLS = Object.freeze(['/api/atmosphere?what=now', 'https://atpota.to/api/atmosphere']);
export const FORECAST_URLS = Object.freeze(['/api/atmosphere?what=forecast']);

export const CONDITIONS = Object.freeze(['calm', 'light', 'breezy', 'gusty', 'stormy']);

/** Each condition as the station says it (atpota.to weather.ts CONDITION_TEXT). */
export const CONDITION_TEXT = Object.freeze({
  calm: 'calm. a quiet moment in the atmosphere',
  light: 'a light breeze. a quiet spell',
  breezy: 'breezy. a usual day in the atmosphere',
  gusty: 'gusty. lots going on out there',
  stormy: 'stormy. somebody said something',
});

/** Each condition as a forecast says it. */
export const CONDITION_WORDS = Object.freeze({
  calm: 'calm',
  light: 'a light breeze',
  breezy: 'breezy',
  gusty: 'gusty',
  stormy: 'stormy',
});

export const DIVERSITY_LEVELS = Object.freeze(['low', 'moderate', 'high', 'very high', 'extreme']);

const num = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const obj = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
const nums = (x, keys) => obj(x) && keys.every((k) => num(x[k]));
const date = (x) => typeof x === 'string' && Number.isFinite(Date.parse(x));
/** App domains and collection names as the station lets them through; anything else is dropped. */
const NAME_RE = /^[a-z0-9][a-z0-9.-]{0,252}$/i;
const name = (x) => typeof x === 'string' && NAME_RE.test(x);

/**
 * A reading, keeping only what checks out (one odd field can't spoil the
 * rest), or null when it isn't one. App names are other people's words: they
 * reach the screen as text, and only when they look like a domain.
 */
export function readReading(body) {
  if (!obj(body) || !nums(body.perSecond, ['posts', 'likes', 'reposts', 'follows']) || !CONDITIONS.includes(body.condition)) return null;
  const out = { perSecond: { ...body.perSecond }, condition: body.condition };
  if (date(body.measuredAt)) out.measuredAt = body.measuredAt;
  if (num(body.seconds)) out.seconds = body.seconds;
  if (body.source === 'station' || body.source === 'sample') out.source = body.source;
  if (nums(body.records, ['perSecond', 'bluesky', 'elsewhere'])) out.records = { ...body.records };
  const d = body.diversity;
  if (nums(d, ['index', 'apps', 'collections']) && DIVERSITY_LEVELS.includes(d.level)) {
    out.diversity = { index: d.index, level: d.level, apps: d.apps, collections: d.collections };
    if (nums(d, ['share', 'spread'])) Object.assign(out.diversity, { share: d.share, spread: d.spread });
  }
  if (Array.isArray(body.apps)) {
    out.apps = body.apps
      .filter((a) => nums(a, ['perSecond', 'count']) && name(a.domain) && Array.isArray(a.collections))
      .map((a) => ({ domain: a.domain, perSecond: a.perSecond, count: a.count, collections: a.collections.filter(name).slice(0, 3) }));
  }
  if (Array.isArray(body.series)) {
    out.series = body.series.slice(-120).map((p) => (nums(p, ['t', 'creates', 'bluesky', 'elsewhere', 'posts']) ? { ...p } : null));
  }
  const h = body.hosts;
  if (nums(h, ['listed', 'active', 'bluesky', 'independent']) && date(h.measuredAt)) {
    out.hosts = { measuredAt: h.measuredAt, listed: h.listed, active: h.active, bluesky: h.bluesky, independent: h.independent };
  }
  return out;
}

/** A forecast, keeping what checks out: a malformed hour is dropped, a malformed answer is null. */
export function readForecast(body) {
  if (!obj(body) || !date(body.madeAt) || !nums(body.basis, ['hours', 'days'])) return null;
  const out = { madeAt: body.madeAt, basis: { hours: body.basis.hours, days: body.basis.days }, hours: [] };
  if (body.learning === true) return { ...out, learning: true };
  const chance = (x) => num(x) && x <= 1;
  if (Array.isArray(body.hours)) {
    out.hours = body.hours
      .filter((h) => obj(h) && date(h.t) && nums(h, ['perSecond', 'low', 'high']) && CONDITIONS.includes(h.condition) && obj(h.chance) && chance(h.chance.gusts) && chance(h.chance.storm))
      .map((h) => ({ t: h.t, perSecond: h.perSecond, low: h.low, high: h.high, condition: h.condition, chance: { gusts: h.chance.gusts, storm: h.chance.storm } }));
  }
  return out;
}

/* --- words ------------------------------------------------------------------ */

/** The headline: every new record a second, in any app (Bluesky's posts for an old reading). */
export function recordsPerSecond(r) {
  return r.records?.perSecond ?? r.perSecond.posts;
}

/** Records a second as people read them: one decimal under 100, whole after that. */
export function formatRate(n) {
  return n < 100 ? n.toLocaleString('en-US', { maximumFractionDigits: 1 }) : Math.round(n).toLocaleString('en-US');
}

/** The diversity index: two decimals under 1, one under 10, whole after that. */
export function formatIndex(index) {
  return index < 1 ? index.toFixed(2) : index < 10 ? index.toFixed(1) : String(Math.round(index));
}

/** "3 pm" in a zone (New York by default, the site's clock). */
export function hourLabel(iso, tz = 'America/New_York') {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', timeZone: tz }).toLowerCase();
}

export function chanceWords(p) {
  return `${Math.min(90, Math.max(10, Math.round(p * 10) * 10))}%`;
}

/** The next hours in a sentence (atpota.to weather-forecast.ts forecastWords). */
export function forecastWords(hours, tz) {
  const first = hours[0];
  if (!first) return '';
  const rank = (c) => CONDITIONS.indexOf(c);
  const turn = hours.findIndex((h) => h.condition !== first.condition);
  let words;
  if (turn < 0) words = `${CONDITION_WORDS[first.condition]} for the next ${hours.length === 1 ? 'hour' : `${hours.length} hours`}`;
  else {
    const next = hours[turn];
    const how = rank(next.condition) > rank(first.condition) ? 'picking up to' : 'calming down to';
    words = `${CONDITION_WORDS[first.condition]} until about ${hourLabel(next.t, tz)}, then ${how} ${CONDITION_WORDS[next.condition]}`;
  }
  const storm = hours.reduce((best, h) => (h.chance.storm > (best?.chance.storm ?? 0) ? h : best), null);
  if (storm && storm.chance.storm >= 0.25) words += `. a ${chanceWords(storm.chance.storm)} chance of a storm around ${hourLabel(storm.t, tz)}`;
  return `${words}.`;
}

/* --- alerts (atpota.to weather-alerts.ts alertsFor) ----------------------------- */

/** Records in the live minute before an app this page hasn't heard counts as blowing in. */
export const ARRIVAL_MIN = 5;

/**
 * What changed between the last reading and this one, as alerts, and what to
 * compare the next one with. `prev` null is the page's first reading, which
 * only sets the scene.
 */
export function alertsFor(prev, r, arrivalMin = ARRIVAL_MIN) {
  const apps = r.source === 'station' ? r.apps || [] : [];
  const watch = {
    seen: new Set(prev?.seen),
    condition: r.condition,
    level: r.diversity?.level ?? null,
    independentHosts: r.hosts?.independent ?? prev?.independentHosts ?? null,
    censusAt: r.hosts?.measuredAt ?? prev?.censusAt ?? null,
  };
  const fresh = apps.filter((a) => !watch.seen.has(a.domain) && a.count >= arrivalMin);
  for (const a of apps) watch.seen.add(a.domain);
  if (!prev) return { watch, alerts: [] };
  const alerts = [];
  const rate = Math.round(recordsPerSecond(r));
  if (r.condition === 'stormy' && prev.condition !== 'stormy') {
    alerts.push({ kind: 'storm', label: 'storm warning', text: 'whoa, a storm just rolled in', sub: `${rate} new records a second. somebody said something.` });
  }
  if (prev.condition === 'stormy' && ['calm', 'light', 'breezy'].includes(r.condition)) {
    alerts.push({ kind: 'clear', label: 'weather alert', text: "the storm's passed. look up, a rainbow (◕‿◕)", sub: `back down to ${rate} new records a second.` });
  }
  const level = r.diversity?.level;
  if (level && prev.level && DIVERSITY_LEVELS.indexOf(level) > DIVERSITY_LEVELS.indexOf(prev.level)) {
    alerts.push({ kind: 'mixed', label: 'weather alert', text: `the sky's getting mixed: ${level}`, sub: `diversity index ${formatIndex(r.diversity.index)}.` });
  }
  const h = r.hosts;
  if (h && prev.censusAt && h.measuredAt !== prev.censusAt && prev.independentHosts != null && h.independent > prev.independentHosts) {
    const more = h.independent - prev.independentHosts;
    alerts.push({
      kind: 'host',
      label: 'weather alert',
      text: more === 1 ? 'a new independent host just came online' : `${more} more independent hosts just came online`,
      sub: `${h.independent.toLocaleString('en-US')} independent pds hosts now, ${h.active.toLocaleString('en-US')} in all.`,
    });
  }
  const app = fresh[0];
  if (app) {
    const records = `${app.count.toLocaleString('en-US')} records in the last minute`;
    alerts.push({ kind: 'arrival', label: 'weather alert', text: `${app.domain} just blew in`, sub: app.collections[0] ? `${records}: ${app.collections[0]}` : records });
  }
  return { watch, alerts };
}

/* --- examples, for placing widgets before there is a reading ------------------- */

const DEMO_SERIES = Array.from({ length: 60 }, (_, i) => {
  const creates = Math.round(560 + 60 * Math.sin(i / 6) + 25 * Math.sin(i * 1.7));
  return { t: i, creates, bluesky: creates - 50, elsewhere: 50, posts: 54 };
});

export const DEMO_READING = Object.freeze({
  measuredAt: '2026-11-05T20:00:00.000Z',
  seconds: 60,
  source: 'station',
  condition: 'gusty',
  perSecond: { posts: 54.2, likes: 395.6, reposts: 59.8, follows: 29.1 },
  records: { perSecond: 598.5, bluesky: 546.9, elsewhere: 51.6 },
  diversity: { index: 1.56, level: 'low', share: 0.37, spread: 17.7, apps: 17, collections: 43 },
  apps: [
    { domain: 'teal.fm', perSecond: 50.2, count: 3011, collections: ['fm.teal.feed.play'] },
    { domain: 'standard.site', perSecond: 0.4, count: 25, collections: ['site.standard.document'] },
    { domain: 'tangled.org', perSecond: 0.2, count: 11, collections: ['org.tangled.graph.follow'] },
    { domain: 'flushes.app', perSecond: 0.1, count: 6, collections: ['im.flushing.right.now'] },
    { domain: 'dame.is', perSecond: 0.05, count: 3, collections: ['is.dame.now'] },
  ],
  series: DEMO_SERIES,
});

export const DEMO_FORECAST = Object.freeze({
  madeAt: '2026-11-05T20:00:00.000Z',
  basis: { hours: 335, days: 13 },
  hours: [538, 547, 519, 486, 452, 430].map((perSecond, i) => ({
    t: new Date(Date.parse('2026-11-05T21:00:00.000Z') + i * 3_600_000).toISOString(),
    perSecond,
    low: perSecond - 25,
    high: perSecond + 30,
    condition: perSecond > 500 ? 'gusty' : 'breezy',
    chance: { gusts: perSecond > 500 ? 0.9 : 0.3, storm: 0.05 },
  })),
});

/* --- the store ----------------------------------------------------------------- */

async function firstGood(urls, read, fetchImpl) {
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
      if (!res.ok) continue;
      const out = read(await res.json());
      if (out) return out;
    } catch {
      /* the next address */
    }
  }
  return null;
}

/**
 * A polled value shared by everyone who listens: it starts with the first
 * listener and stops with the last. `every(value)` is how long to wait before
 * asking again.
 */
export function createPoll(load, every, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const listeners = new Set();
  let value = null;
  let timer = null;
  let running = false;
  const tick = async () => {
    const next = await load();
    if (!running) return;
    if (next) {
      value = next;
      for (const fn of listeners) fn(value);
    }
    timer = setTimer(tick, every(next));
  };
  return {
    get: () => value,
    subscribe(fn) {
      listeners.add(fn);
      if (value) fn(value);
      if (!running) {
        running = true;
        tick();
      }
      return () => {
        listeners.delete(fn);
        if (!listeners.size) {
          running = false;
          clearTimer(timer);
        }
      };
    },
  };
}

export const nowPoll = createPoll(
  () => firstGood(NOW_URLS, readReading, (...a) => fetch(...a)),
  (r) => (r?.source === 'station' ? LIVE_MS : SAMPLE_MS),
);

export const forecastPoll = createPoll(
  () => firstGood(FORECAST_URLS, readForecast, (...a) => fetch(...a)),
  () => FORECAST_MS,
);
