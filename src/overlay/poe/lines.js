// What Poe says on dame.is's stream, and how often. Ported from atpota.to
// (website/src/overlay/lines.ts and regulars.ts), so Poe sounds the same on
// both sites: weather alerts, answers to !weather, !forecast, !apps, !pet and
// !poe, hellos and welcome-backs to chatters, thanks to new followers, a
// cheer when the stream goes live and a goodbye when it ends.
//
// Handles are the only names said. A chatter's own words never are.

import { CONDITION_TEXT, forecastWords, formatIndex, formatRate, recordsPerSecond } from '../../lib/atmosphere.js';

/** A weather alert, at most once every COOLDOWN_MS per kind (arrivals every ARRIVAL_EVERY_MS). */
export const COOLDOWN_MS = 10 * 60_000;
export const ARRIVAL_EVERY_MS = 3 * 60_000;
/** One person's command, at most this often; anyone's same command, at most COMMAND_ANY_MS. */
export const COMMAND_EACH_MS = 30_000;
export const COMMAND_ANY_MS = 8000;
export const APPS_SAID = 3;

export const RANK = Object.freeze({ live: 4, follow: 3, alert: 2, command: 2, hello: 1 });

const ALERT_FACE = { record: 'wow', storm: 'wow', new: 'happy', newhost: 'happy', clear: 'happy', mixed: 'wink', moving: 'wink', host: 'kawaii', arrival: 'kawaii' };

export { commandOf } from '../../lib/overlayStream.js';

export function alertLine(alert) {
  const line = { label: alert.label, text: alert.text, sub: alert.sub, face: ALERT_FACE[alert.kind] || 'wow', rank: RANK.alert, sound: 'alert' };
  if (alert.kind === 'clear') line.burst = 'petals';
  return line;
}

const reportFor = (who) => (who.handle ? `weather report for ${who.handle}` : 'weather report');
const hardToRead = (label) => ({ label, text: "the sky's hard to read right now. try again in a bit", face: 'scawy', rank: RANK.command });

export function weatherLine(r, who) {
  if (!r) return hardToRead(reportFor(who));
  const rate = Math.round(recordsPerSecond(r)).toLocaleString('en-US');
  const d = r.diversity;
  return {
    label: reportFor(who),
    text: CONDITION_TEXT[r.condition],
    sub: `${rate} new records a second, every app${d ? `. diversity index ${formatIndex(d.index)}, ${d.level}` : ''}. atpota.to/weather`,
    face: r.condition === 'stormy' ? 'wow' : 'happy',
    avatar: who.avatar,
    rank: RANK.command,
  };
}

export function forecastLine(f, who) {
  const label = who.handle ? `forecast for ${who.handle}` : 'forecast';
  if (!f) return hardToRead(label);
  if (f.learning || !f.hours.length) return { label, text: "i'm still learning the sky's habits. ask me again tomorrow", face: 'sleepy', avatar: who.avatar, rank: RANK.command };
  return { label, text: forecastWords(f.hours), sub: 'the next few hours of the atmosphere. atpota.to/weather', face: 'kawaii', avatar: who.avatar, rank: RANK.command };
}

export function appsLine(r, who) {
  const label = who.handle ? `apps for ${who.handle}` : 'busy outside bluesky';
  if (!r) return hardToRead(label);
  const apps = (r.apps || []).slice(0, APPS_SAID);
  if (!apps.length) return { label, text: "it's all bluesky out there right now", face: 'wink', avatar: who.avatar, rank: RANK.command };
  const names = apps.map((a) => a.domain);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return {
    label,
    text: `busiest outside bluesky: ${list}`,
    sub: apps.map((a) => `${a.domain} ${formatRate(a.perSecond)}/sec`).join(' · '),
    face: 'happy',
    avatar: who.avatar,
    rank: RANK.command,
  };
}

const HELLOS = ['hi {who}! welcome in (◕‿◕)', 'oh hey {who}! pull up a chair', '{who} is here! hello hello', 'welcome, {who}! the weather is lovely in here'];
const WELCOME_BACKS = ['welcome back, {who}! (◕‿◕)', '{who}! good to see you again', 'look who it is! hi again {who}'];
const POE_LINES = [
  'hi! i am poe. a potato, mostly',
  "i'm visiting from atpota.to. dame's sky is very nice",
  "i'm watching the sky for you (◕‿◕)",
  'try !weather, !forecast or !apps and i will read you the atmosphere',
  'blink twice if you like potatoes',
];

const pick = (list, random) => list[Math.floor(random() * list.length)] ?? list[0];
const fill = (s, who) => s.replaceAll('{who}', who.handle ?? 'friend');

export function helloLine(who, again = false, random = Math.random) {
  return { label: 'in the chat', text: fill(pick(again ? WELCOME_BACKS : HELLOS, random), who), face: 'happy', avatar: who.avatar, wave: true, sound: 'hello', rank: RANK.hello };
}

export function followLine(who) {
  return { label: 'new follower', text: `${who.handle ?? 'someone'} just followed! thank you (◕‿◕)`, face: 'kawaii', avatar: who.avatar, hop: true, burst: 'leaves', sound: 'follow', rank: RANK.follow };
}

/**
 * A pet. In dame.is's chat it also counts on atpota.to's pets leaderboard:
 * the garden index there counts !pet messages in this streamer's chat itself,
 * so the line only has to say so.
 */
export function petLine(who) {
  return {
    label: 'pets',
    text: `hehe. thank you ${who.handle ?? 'friend'} (◕ᴗ◕✿)`,
    sub: 'one pet an hour counts on the pets leaderboard at atpota.to/garden',
    face: 'kawaii',
    avatar: who.avatar,
    hop: true,
    burst: 'hearts',
    sound: 'pet',
    rank: RANK.command,
  };
}

export function poeLine(random = Math.random) {
  return { text: pick(POE_LINES, random), face: 'wink', rank: RANK.command };
}

export function liveLine(title) {
  const line = { label: "we're live", text: "we're live! hi everyone (◕‿◕)", face: 'happy', wave: true, burst: 'leaves', sound: 'live', rank: RANK.live, ms: 9000 };
  if (title) line.sub = title;
  return line;
}

export function endedLine() {
  return { label: "that's a wrap", text: 'thanks for watching! see you next time', face: 'happy', wave: true, sound: 'hello', rank: RANK.live, ms: 9000 };
}

/** Says yes to something at most once every `ms` per key. */
export function createGate(now = () => Date.now()) {
  const last = new Map();
  return (key, ms) => {
    const t = now();
    const at = last.get(key);
    if (at !== undefined && t - at < ms) return false;
    last.set(key, t);
    return true;
  };
}

/* --- regulars ------------------------------------------------------------------ */

/**
 * Who Poe has said hello to, kept in this browser source's localStorage, so a
 * regular gets "welcome back" instead of a first hello, and a reload of the
 * source mid-stream doesn't greet the whole chat again:
 *
 *   never seen                   a first hello
 *   seen in the last AGAIN_MS    nothing: greeted this stream already
 *   seen before that             welcome back
 */
export const AGAIN_MS = 4 * 60 * 60_000;
export const MAX_KEPT = 2000;
const REGULARS_KEY = 'dame.overlay.regulars';

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function createRegulars(storage = safeStorage(), now = () => Date.now()) {
  let seen = new Map();
  try {
    const data = JSON.parse(storage?.getItem(REGULARS_KEY) || 'null');
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      seen = new Map(Object.entries(data).filter((e) => typeof e[1] === 'number' && Number.isFinite(e[1])));
    }
  } catch {
    /* start afresh */
  }
  const greeted = new Set();
  const save = () => {
    const kept = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_KEPT);
    try {
      storage?.setItem(REGULARS_KEY, JSON.stringify(Object.fromEntries(kept)));
    } catch {
      /* full or blocked: remembered for this visit */
    }
  };
  return {
    /** How to greet `did` now ('hello', 'welcome-back' or null), remembering they were here. */
    greet(did) {
      const t = now();
      const last = seen.get(did);
      seen.set(did, t);
      save();
      if (greeted.has(did)) return null;
      greeted.add(did);
      if (last === undefined) return 'hello';
      return t - last >= AGAIN_MS ? 'welcome-back' : null;
    },
  };
}

/** Example lines for placing Poe (the studio's preview, and ?demo), in turn. */
export function demoLines() {
  const dame = { handle: '@dame.is', avatar: null };
  return [
    () => helloLine(dame),
    () => followLine({ handle: '@poe.atpota.to', avatar: null }),
    () => alertLine({ kind: 'arrival', label: 'weather alert', text: 'flushes.app just blew in', sub: '12 records in the last minute: im.flushing.right.now' }),
    () => petLine(dame),
    () => helloLine(dame, true),
    () => poeLine(),
  ];
}
