import { describe, expect, it } from 'vitest';
import { isTypingTarget, shortcutBlocked } from './shortcuts.js';

const el = (tagName, { role = null, editable = false } = {}) => ({
  tagName,
  isContentEditable: editable,
  getAttribute: (name) => (name === 'role' ? role : null),
});
const noModal = { querySelector: () => null };
const withModal = {
  querySelector: (sel) => (sel === '[aria-modal="true"]' ? {} : null),
};
const key = (over = {}) => ({ key: 'i', target: el('BUTTON'), ...over });

describe('isTypingTarget', () => {
  it('knows the native fields', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT'])
      expect(isTypingTarget(el(tag))).toBe(true);
  });

  it('knows contentEditable and the typing roles', () => {
    expect(isTypingTarget(el('DIV', { editable: true }))).toBe(true);
    expect(isTypingTarget(el('DIV', { role: 'combobox' }))).toBe(true);
    expect(isTypingTarget(el('UL', { role: 'listbox' }))).toBe(true);
  });

  it('leaves buttons, links and the page alone', () => {
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
    expect(isTypingTarget(el('A'))).toBe(false);
    expect(isTypingTarget(el('BODY'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('shortcutBlocked', () => {
  it('lets a plain key through', () => {
    expect(shortcutBlocked(key(), noModal)).toBe(false);
    expect(shortcutBlocked(key({ key: '?', shiftKey: true }), noModal)).toBe(
      false,
    );
  });

  it('ignores auto-repeat and chords', () => {
    expect(shortcutBlocked(key({ repeat: true }), noModal)).toBe(true);
    expect(shortcutBlocked(key({ metaKey: true }), noModal)).toBe(true);
    expect(shortcutBlocked(key({ ctrlKey: true }), noModal)).toBe(true);
    expect(shortcutBlocked(key({ altKey: true }), noModal)).toBe(true);
  });

  it('ignores typing', () => {
    expect(shortcutBlocked(key({ target: el('SELECT') }), noModal)).toBe(true);
  });

  it('stays out from under a modal dialog', () => {
    expect(shortcutBlocked(key(), withModal)).toBe(true);
  });
});
