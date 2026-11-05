// Undo and redo for an editor's draft (the Overlays studio's), as a value:
// the states before the present one, the present, and the ones undone.
//
// One gesture is one step. A drag fires a change for every cell it crosses
// and typing one for every character; recording each would take forty undos
// to put a widget back. So a change can name a `group`, and a change in the
// same group as the last one, within COALESCE_MS of it, replaces the present
// rather than adding a step. A new drag, a different field or a pause starts
// a new step. Anything ungrouped (add, delete, arrange) is always its own.

export const COALESCE_MS = 800;
export const LIMIT = 100;

export function createHistory(present) {
  return { past: [], present, future: [], group: null, at: 0 };
}

/** The history with `next` as the present. */
export function record(h, next, { group = null, now = Date.now(), limit = LIMIT } = {}) {
  if (next === h.present) return h;
  if (group !== null && group === h.group && now - h.at < COALESCE_MS) {
    return { ...h, present: next, future: [], at: now };
  }
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [], group, at: now };
}

export function undo(h) {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], group: null, at: 0 };
}

export function redo(h) {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), group: null, at: 0 };
}

/** The present swapped without a step (what a save wrote back, say). */
export function replacePresent(h, present) {
  return { ...h, present, group: null, at: 0 };
}

export const canUndo = (h) => h.past.length > 0;
export const canRedo = (h) => h.future.length > 0;

/** Is a key event aimed at something that edits text itself (and so has its own undo)? */
export function isTextEntry(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = String(target.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = String(target.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(type);
  }
  return Boolean(target.isContentEditable);
}

/**
 * What a keydown asks the editor to do: 'undo', 'redo', 'delete', or null.
 * Cmd/Ctrl+Z undoes, Shift+Cmd/Ctrl+Z or Ctrl+Y redoes, Delete or Backspace
 * removes the picked widget. None of them while typing in a field, which
 * keeps the field's own undo and its own Backspace.
 */
export function keyAction(e) {
  if (isTextEntry(e.target)) return null;
  const mod = e.metaKey || e.ctrlKey;
  const key = String(e.key || '').toLowerCase();
  if (mod && !e.altKey && key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && key === 'y') return 'redo';
  if (!mod && !e.altKey && !e.shiftKey && (key === 'delete' || key === 'backspace')) return 'delete';
  return null;
}
