// The site's single-key shortcuts (`i` for inspect, `?` for the atmosphere
// sheet) fire from a window listener, so they see every keystroke on the page
// and have to decide for themselves when a key isn't theirs.

// Roles whose widgets take printable keys themselves: a combobox filters as
// you type, a listbox (and a native <select>) jumps to the option you type.
const TYPING_ROLES = new Set([
  'combobox',
  'listbox',
  'textbox',
  'searchbox',
  'spinbutton',
]);

/** Is `target` somewhere a typed character belongs to? */
export function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  const role = target.getAttribute?.('role');
  return !!role && TYPING_ROLES.has(role);
}

/**
 * Should a single-key shortcut leave this keydown alone? Yes for a held key's
 * auto-repeat (which toggled the mode on and off as fast as the keyboard
 * repeats), for a key chorded with Cmd, Ctrl or Alt (the browser's and the
 * OS's), for typing, and while a modal dialog is open: aria-modal says the
 * page behind it is out of reach, and that includes its shortcuts.
 */
export function shortcutBlocked(
  e,
  doc = typeof document === 'undefined' ? null : document,
) {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return true;
  if (isTypingTarget(e.target)) return true;
  return !!doc?.querySelector('[aria-modal="true"]');
}
