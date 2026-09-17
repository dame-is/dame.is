// What the bot says when it is not the model talking.
//
// Acknowledgements, nudges and receipts are written here rather than generated,
// because the whole point of an ack is that it arrives before the model does.
// An LLM call to say "on it" would cost the five seconds the ack exists to fill.
//
// THE SAME SPLIT AS VOICE AND SURFACE. An OPENER is character and is editable
// from the portal: "Acknowledged.", "On it boss.", whatever dame wants the thing
// to sound like. A CLAUSE is a statement of fact about what is happening next,
// and stays here. An editable clause could say "Writing to the list" while the
// thing is actually harvesting, which is a receipt that lies.
//
// No em dashes. They are everywhere in this codebase's comments and nowhere in
// what it says out loud, which is a deliberate difference: the comments are
// prose for a reader and these are a machine talking.

/** Openers. Overridden by `openers` in the config record. */
export const DEFAULT_OPENERS = [
  'Acknowledged.',
  'On it.',
  'On it, boss.',
  'Got it.',
  'Right.',
  'Heard you.',
  'Yep.',
];

/** What is about to happen. Not editable: a false receipt is worse than a dull one. */
export const ACK_CLAUSE = {
  plan: [
    'Harvesting and scoring that post.',
    'Pulling everyone who touched it and scoring them.',
    'Running the harvest now.',
  ],
  approve: [
    'Writing to the list.',
    'Adding them now.',
    'Putting those on the list.',
  ],
  review: [
    'Pulling the accounts that need a look.',
    'Fetching the ones worth reading.',
  ],
  cancel: ['Standing down.', 'Nothing will be written.'],
  undo: ['Taking those back off the list.', 'Undoing that.'],
  history: ['Pulling the record.'],
  list_add: ['Checking the list.', 'Looking them up.'],
  list_remove: ['Checking the list.', 'Looking them up.'],
  think: ['Thinking.', 'Having a look.', 'Reading up.'],
};

/**
 * Which commands are worth announcing.
 *
 * An ack exists to fill five to twenty seconds of silence. A lookup is rendered
 * now and arrives instantly, so announcing it means two messages for one answer
 * -- the ack was right when everything went through a model and is noise for
 * the things that no longer do.
 */
export const SLOW = new Set(['plan', 'approve', 'undo', 'review', 'think']);

export function worthAcking(cmd) {
  return SLOW.has(cmd?.action ?? 'think');
}

/** Pick one. `rng` is injectable so tests are not flaky. */
export function pick(list, rng = Math.random) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!arr.length) return '';
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/**
 * Parse the editable openers.
 *
 * One per line, because a textarea is what the portal gives dame and asking
 * her to write JSON in it would be a worse trade than splitting on newlines.
 * Blank input falls back to the defaults rather than leaving the bot mute.
 */
export function parseOpeners(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines : DEFAULT_OPENERS;
}

/**
 * What to say the moment a message is picked up, before the work starts.
 *
 * A harvest or a model call is five to twenty seconds of silence, which reads
 * as broken rather than busy.
 *
 * @param {object|null} cmd  the parsed command, or null for a question
 * @param {object} [opts]
 * @param {string[]} [opts.openers]
 * @param {Function} [opts.rng]
 */
export function ackFor(
  cmd,
  { openers = DEFAULT_OPENERS, rng = Math.random } = {},
) {
  const key = cmd?.action && ACK_CLAUSE[cmd.action] ? cmd.action : 'think';
  return `${pick(openers, rng)} ${pick(ACK_CLAUSE[key], rng)}`.trim();
}

/** Nudges, when a command arrived without enough to act on. */
export const NUDGE = {
  actor: [
    'Name the account and I will do it. "block @handle", or a profile link. I will not work out who you meant from context; that is the one thing standing between a stranger\'s post and your block list.',
    'Give me the handle. "block @handle" or a profile link. I do not guess who "them" is, on purpose: a pronoun resolved against something I just read is a command from that post, not from you.',
  ],
  post: [
    'Attach the post or paste its link and I will harvest and score it.',
    'Send me the post, either attached or as a link, and I will run it.',
  ],
  plan: [
    'Which plan? Send the code from the plan message, like "approve 3f9a2c1b UNKNOWN".',
    'I need the plan code. It is in the message with the band counts.',
  ],
};

export function nudge(kind, rng = Math.random) {
  return pick(NUDGE[kind] || NUDGE.actor, rng);
}
