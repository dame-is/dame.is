// From what is ticked on a page to the command the bot runs.
//
// The panel does not change the list itself. It writes one of the bot's own
// commands and sends it to be parsed and run the way a DM is
// (src/panel/commands.js). These functions write that text, and say who a
// selection would add, so the page can show both before anything runs.
// Pure, and tested against the bot's own parser.

import { BANDS } from './format.js';

/** The engagement kinds behind each sector of a scan's radar. */
export const SECTOR_KINDS = {
  quote: ['quote'],
  reply: ['reply', 'threadReply'],
  repost: ['repost'],
  like: ['like'],
};

/** The word the bot's parser takes for each sector. */
const KIND_WORD = {
  quote: 'quoters',
  reply: 'repliers',
  repost: 'reposters',
  like: 'likers',
};

/**
 * The sector an account is drawn in: the loudest thing it did. Anything from
 * a lexicon outside Bluesky's own is 'other'.
 */
export function primaryKind(kinds = []) {
  for (const key of ['quote', 'reply', 'repost', 'like']) {
    if (kinds.some((k) => SECTOR_KINDS[key].includes(k))) return key;
  }
  return 'other';
}

/** The bands a selection names, in the bot's order, never PROTECTED. */
const bandsOf = (sel) =>
  BANDS.filter((b) => b !== 'PROTECTED' && (sel.bands || []).includes(b));

/** The sectors a selection narrows to, where the bot has a word for them. */
const sectorsOf = (sel) =>
  Object.keys(KIND_WORD).filter((k) => (sel.sectors || []).includes(k));

/**
 * Could an approval still add this account? Not someone protected, on the
 * list already, added by this plan, or added by it and taken back: the bot
 * skips a row it has acted on, so an undone one is added by name or not at
 * all.
 */
export const addable = (row) =>
  !row.protected && row.band !== 'PROTECTED' && !row.added && !row.undone && !row.listed;

/**
 * The accounts in a scan that a selection would add.
 *
 * @param {object[]} rows  the scan's rows, as /api/scan gives them
 * @param {{ bands: string[], sectors?: string[], hostileOnly?: boolean }} sel
 */
export function selected(rows, sel) {
  const bands = bandsOf(sel);
  if (!bands.length) return [];
  const kinds = sel.hostileOnly ? [] : sectorsOf(sel).flatMap((k) => SECTOR_KINDS[k]);
  return rows.filter(
    (r) =>
      addable(r) &&
      bands.includes(r.band) &&
      (!sel.hostileOnly || r.label === 'hostile') &&
      (!kinds.length || (r.kinds || []).some((k) => kinds.includes(k))),
  );
}

/**
 * The command that adds a selection, or null when nothing is ticked.
 *
 *   approve 3f2a1b7c UNKNOWN,NOTABLE
 *   approve 3f2a1b7c UNKNOWN likers reposters
 *   approve 3f2a1b7c hostile UNKNOWN
 *
 * A tone label does not combine with an engagement kind (the parser refuses
 * it), so "only the hostile ones" drops the sectors.
 *
 * `asOf` is when the newest hostile label the page counted was given. With
 * it the bot adds only what was labelled by then, so a watch that labels
 * more while the page is open does not add to what was shown.
 */
export function approveCommand(code, sel, { asOf = null } = {}) {
  const bands = bandsOf(sel);
  if (!bands.length) return null;
  if (sel.hostileOnly) return `approve ${code} hostile ${bands.join(',')}${asOf ? ` asof=${asOf}` : ''}`;
  const words = sectorsOf(sel).map((k) => KIND_WORD[k]);
  return `approve ${code} ${bands.join(',')}${words.length ? ` ${words.join(' ')}` : ''}`;
}

/** The most accounts one by-name command carries. */
export const NAMED_PER_COMMAND = 25;

/**
 * The commands that add named accounts from a scan: the personal path,
 * logged as "I looked at this account" and not as a band.
 */
export function approveByName(code, dids) {
  const out = [];
  const unique = [...new Set(dids)];
  for (let i = 0; i < unique.length; i += NAMED_PER_COMMAND) {
    out.push(`approve ${code} ${unique.slice(i, i + NAMED_PER_COMMAND).join(' ')}`);
  }
  return out;
}

/**
 * A command with the list it goes to named on it, for a bot with several
 * lists. `list:<record key>` is the token the bot's own menus write, so it
 * means the same list whatever the lists are called later. With no key the
 * command is left as it is, which is every command when there is one list.
 */
export const onList = (command, rkey) => (rkey ? `${command} list:${rkey}` : command);

export const blockCommand = (actor) => `block ${actor}`;
export const unblockCommand = (actor) => `unblock ${actor}`;
export const undoCommand = (code) => `undo ${code}`;
export const cancelCommand = (code) => `cancel ${code}`;
export const triageCommand = (code) => `triage ${code}`;
