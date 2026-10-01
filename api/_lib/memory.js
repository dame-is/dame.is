// Notes dame asked the bot to remember, from the chat.
//
// The standing instructions in the config record live in dame's own repo and
// the bot cannot write them, on purpose: a leaked bot password must not be able
// to rewrite the rules it runs under. These notes are the layer the chat can
// write, and only from dame's LITERAL words ("remember: never block people who
// only liked"), parsed by parseMemoryCommand. The model never writes one. A note
// is an instruction read on every turn, and a post the agent read could
// otherwise talk it into saving one.
//
// Removed notes are stamped rather than deleted, like everything else in mod.

import { select, upsert, update } from './modDb.js';

/** Enough to be standing guidance, not enough to be a second system prompt. */
export const MAX_NOTES = 30;
export const MAX_NOTE_CHARS = 500;

/** The live notes, oldest first, so their numbers stay put as notes are added. */
export async function listNotes() {
  const rows = await select('memory', {
    select: 'id,text,created_at',
    is: { removed_at: 'null' },
    order: 'created_at.asc',
    limit: MAX_NOTES,
  });
  return rows || [];
}

export async function remember(text) {
  const clean = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NOTE_CHARS);
  if (!clean) return { ok: false, message: 'Remember what?' };
  const notes = await listNotes();
  if (notes.some((n) => n.text.toLowerCase() === clean.toLowerCase())) {
    return { ok: true, message: `I already had that one: "${clean}"` };
  }
  if (notes.length >= MAX_NOTES) {
    return {
      ok: false,
      message: `I'm holding ${MAX_NOTES} notes already. "forget <number>" one first; "what do you remember" lists them.`,
    };
  }
  await upsert('memory', [{ text: clean }]);
  return {
    ok: true,
    message: `Noted, and I'll keep to it: "${clean}". "what do you remember" lists everything; "forget ${notes.length + 1}" drops this one.`,
  };
}

/** Forget by the number "what do you remember" showed, or by matching words. */
export async function forget({ index = null, text = null } = {}) {
  const notes = await listNotes();
  let note = null;
  if (index != null) note = notes[index - 1] ?? null;
  else if (text) {
    const needle = text.toLowerCase();
    const hits = notes.filter((n) => n.text.toLowerCase().includes(needle));
    if (hits.length > 1) {
      return {
        ok: false,
        message: `That matches ${hits.length} notes. "forget <number>" picks one; "what do you remember" numbers them.`,
      };
    }
    note = hits[0] ?? null;
  }
  if (!note) return { ok: false, message: "I don't have a note like that." };
  await update(
    'memory',
    { eq: { id: note.id } },
    { removed_at: new Date().toISOString() },
  );
  return { ok: true, message: `Forgotten: "${note.text}"` };
}

/** The reply to "what do you remember". */
export function recallText(notes) {
  if (!notes.length) {
    return 'Nothing yet. Start a message with "remember:" and I\'ll keep to it.';
  }
  return [
    'What you asked me to remember:',
    ...notes.map((n, i) => `${i + 1}. ${n.text}`),
    '',
    '"forget <number>" drops one.',
  ].join('\n');
}

/** The notes as a prompt block, or '' when there are none. */
export function notesBlock(notes) {
  if (!notes?.length) return '';
  return `THINGS DAME ASKED YOU TO REMEMBER, in dame's own words. Keep to them as you would the standing instructions:\n${notes.map((n) => `- ${n.text}`).join('\n')}`;
}
