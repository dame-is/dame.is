// The detail-page "plate": the fixed slots every record page fills (running
// head, title, colophon, body, actions, replies, foot, folio), worked out
// here as plain data so the chrome, the record page and the generated verb
// indexes all agree, and so it can be tested without a browser.

import { VERB_REGISTRY, nsidConfig, verbConfig } from './verbRegistry.js';
import { playArtistLine, playTrackName } from './teal.js';
import { calendarDay, dateKey, formatDateWeekday, formatMonthDay, formatTime, formatWeekday, isDayOnly } from './time.js';
import { dayOfLife } from './dayOfLife.js';

/** Dame's clock. Record colophons are set in it, as everything else is. */
export { DAME_ZONE } from './time.js';

/** Verbs whose index page is written by hand. */
const HAND_INDEXES = new Set(['posting', 'logging', 'listening', 'blogging', 'creating', 'curating', 'mothing']);

/**
 * Verbs that get a generated index at `/{verb}`: the home ledger filtered to
 * that verb. Flushing has no page here, since vercel.json sends /flushing to
 * flushes.app.
 */
export const GENERATED_INDEX_VERBS = VERB_REGISTRY.map((v) => v.verb).filter(
  (v) => !HAND_INDEXES.has(v) && v !== 'flushing',
);

/** Where a verb's records live as a list, or null when nowhere on this site. */
export function indexPathForVerb(verb) {
  if (HAND_INDEXES.has(verb) || GENERATED_INDEX_VERBS.includes(verb)) return `/${verb}`;
  return null;
}

/** One line for each generated index, under its "dame is reposting" title. */
export const VERB_GLOSSES = {
  photographing: 'Photographs and stories posted to Grain.',
  observing: 'Birds, plants, fungi and everything else that isn’t a moth, mirrored from iNaturalist.',
  liking: 'Posts Dame liked, on Bluesky and elsewhere in the atmosphere.',
  reposting: 'Other people’s posts, reshared.',
  following: 'Accounts Dame followed.',
  listing: 'Lists Dame keeps on Bluesky.',
  feeding: 'Custom feeds Dame published.',
  commenting: 'Comments Dame left on other people’s work.',
  crafting: 'Things made in the Anisota lab.',
};

/** "Each entry is one app.bsky.feed.repost record." */
export function verbIndexIntro(verb) {
  const gloss = VERB_GLOSSES[verb] || '';
  const nsids = (verbConfig(verb)?.collections || []).map((c) => c.nsid);
  if (!nsids.length) return gloss;
  const list = nsids.length === 1 ? nsids[0] : `${nsids.slice(0, -1).join(', ')} or ${nsids[nsids.length - 1]}`;
  return `${gloss} Each entry is one ${list} record.`.trim();
}

// Paths that are pages on their own, beyond the verb indexes.
const STATIC_PAGES = new Set([
  '/welcoming',
  '/themself',
  '/available',
  '/sharing',
  '/exploring',
  '/listening/albums',
]);
const PAGE_PATTERNS = [
  /^\/(creating|curating|blogging|available|mothing)\/[^/]+$/,
  /^\/listening\/albums\/[^/]+$/,
  /^\/creating\/[^/]+\/participants$/,
  /^\/exploring(\/.*)?$/,
];

function isPage(path) {
  if (STATIC_PAGES.has(path)) return true;
  const verb = path.slice(1);
  if (/^\/[a-z]+$/.test(path) && indexPathForVerb(verb)) return true;
  return PAGE_PATTERNS.some((re) => re.test(path));
}

function decode(seg) {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/**
 * The running head's crumbs for a path: `[{ label, to }]`, where `to` is
 * null for a segment with no page behind it (rendered as plain text, never
 * a link to "Nowhere to be found"). A lexicon-form record path
 * (`/app.bsky.feed.repost/3my…`) resolves its first crumb through the verb
 * registry to that verb's index. `lastLabel`, when the page supplies one,
 * replaces the final segment (an rkey becomes "Oct 26 · 5:36 pm").
 */
export function resolveCrumbs(pathname, lastLabel = null) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  const crumbs = [];
  let acc = '';
  parts.forEach((part, i) => {
    acc += `/${part}`;
    const last = i === parts.length - 1;
    let label = decode(part);
    let to = acc;
    if (i === 0 && !last) {
      const byNsid = nsidConfig(label);
      if (byNsid) {
        const verb = VERB_REGISTRY.find((v) => v.collections.some((c) => c.nsid === label))?.verb;
        if (verb) {
          label = verb;
          to = indexPathForVerb(verb);
        }
      }
    }
    if (last && lastLabel) label = lastLabel;
    crumbs.push({ label, to: last ? acc : to && isPage(to) ? to : null });
  });
  return crumbs;
}

/** The nearest ancestor with a page: where "up" goes. Home when none. */
export function upFrom(pathname) {
  const crumbs = resolveCrumbs(pathname);
  for (let i = crumbs.length - 2; i >= 0; i -= 1) {
    if (crumbs[i].to) return { to: crumbs[i].to, label: crumbs[i].label };
  }
  return { to: '/', label: 'home' };
}

/* ---------- Dame's clock ---------- */

// The plate reads time through lib/time.js and lib/dayOfLife.js like the rest
// of the site. These names are what the record page and its neighbours were
// written against; they're kept as the plate's own vocabulary.

/** "5:36 pm" in Dame's clock. */
export const clockTime = (iso) => formatTime(iso);

/** "Monday, October 26, 2026" in Dame's clock. */
export const longDate = (iso) => formatDateWeekday(iso);

/**
 * Day of life for the calendar day `iso` falls on in Dame's clock: the same
 * count as the chrome's "on day N", the ledger's day headers and the share
 * cards' folio. Null for a date that won't parse.
 */
export function easternDayOfLife(iso) {
  const n = dayOfLife(iso);
  return Number.isFinite(n) ? n : null;
}

/**
 * "Oct 26 · 5:36 pm": a record's day and time, the year added when it isn't
 * `now`'s ("Mar 2, 2025 · 4:00 pm"). The last crumb for a record addressed
 * by time, and the date at the right of a post's trail.
 */
export function crumbStamp(iso, now = new Date()) {
  const day = formatMonthDay(iso);
  if (!day) return null;
  const year = calendarDay(iso)?.y;
  const dated = year === calendarDay(now)?.y ? day : `${day}, ${year}`;
  return `${dated} · ${clockTime(iso)}`;
}

/** A title cut for a crumb, about 28 characters, at a word. */
export function crumbTitle(title, n = 28) {
  const s = String(title || '').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const at = cut.lastIndexOf(' ');
  return `${(at > 12 ? cut.slice(0, at) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

/**
 * The colophon: one small-caps line in Dame's time.
 * "logged Monday, October 26, 2026 · 5:36 pm · day 12,226". A record dated
 * to a day (a back-filled work's UTC midnight) gets no clock: read as an
 * instant, that's 7 pm the evening before.
 */
export function colophon(verb, iso) {
  if (!iso) return '';
  const past = verbConfig(verb)?.pastTense || verb;
  const n = easternDayOfLife(iso);
  const time = isDayOnly(iso) ? null : clockTime(iso);
  return [`${past} ${longDate(iso)}`, time, n ? `day ${n.toLocaleString('en-US')}` : null]
    .filter(Boolean)
    .join(' · ');
}

/** How far apart two records are: "20 h", "58 min", "3 days". */
export function gapBetween(a, b) {
  const ms = Math.abs(new Date(a).getTime() - new Date(b).getTime());
  if (!Number.isFinite(ms)) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d} days`;
  const mo = Math.round(d / 30);
  return mo < 24 ? `${mo} months` : `${Math.round(d / 365)} years`;
}

/** "Sunday 9:28 pm", or just "9:28 pm" when it's the same day as `ref`. */
export function neighbourWhen(iso, ref) {
  const same = ref && dateKey(iso) === dateKey(ref);
  return same ? clockTime(iso) : `${formatWeekday(iso)} ${clockTime(iso)}`;
}

/* ---------- the record's own sentence ---------- */

const clip = (s, n) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

/**
 * The title for a record, in the hero's grammar: a quiet lead, then the
 * thing itself. `{ lead, verb?, rest }`, all strings; `verb` is the ink
 * word between them when the sentence has one ("dame reposted Poe").
 *
 * `value` is the record's own value or its feed payload (the two share the
 * fields read here); `subject` names who or what a reference points at.
 */
export function recordSentence(verb, value = {}, { subject = null } = {}) {
  const past = verbConfig(verb)?.pastTense || verb;
  switch (verb) {
    case 'logging': {
      const status = value.status || value.text || '';
      return { lead: 'dame is', rest: clip(status, 140) || 'somewhere' };
    }
    case 'posting': {
      const text = clip(value.text, 90);
      const alt = value.embed?.images?.[0]?.alt || value.images?.[0]?.alt;
      return { lead: 'dame posted', rest: text ? `“${text}”` : alt ? `an image: ${clip(alt, 70)}` : 'a post' };
    }
    case 'listening': {
      const track = playTrackName(value);
      const artist = playArtistLine(value);
      return { lead: 'dame listened to', rest: [track, artist].filter(Boolean).join(' by ') || 'a song' };
    }
    case 'mothing':
    case 'observing': {
      const t = value.taxon || {};
      return { lead: `dame ${past}`, rest: t.commonName || t.name || 'something' };
    }
    case 'blogging':
    case 'creating':
      return { lead: '', rest: value.title || 'Untitled' };
    default:
      return subject
        ? { lead: 'dame', verb: past, rest: subject }
        : { lead: `dame ${past}`, rest: '' };
  }
}

/** The sentence as plain text, for a tab title or a neighbour link. */
export function sentenceText(s) {
  return [s.lead, s.verb, s.rest].filter(Boolean).join(' ');
}
