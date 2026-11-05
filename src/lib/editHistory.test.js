import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, createHistory, keyAction, record, redo, replacePresent, undo } from './editHistory.js';

describe('edit history', () => {
  it('undoes and redoes, and a new change drops what was undone', () => {
    let h = createHistory('a');
    h = record(h, 'b', { now: 0 });
    h = record(h, 'c', { now: 10_000 });
    expect(undo(h).present).toBe('b');
    expect(undo(undo(h)).present).toBe('a');
    expect(canUndo(undo(undo(h)))).toBe(false);
    expect(redo(undo(h)).present).toBe('c');
    const branched = record(undo(h), 'd', { now: 20_000 });
    expect(canRedo(branched)).toBe(false);
  });

  it('makes one step of a gesture, and a new step after a pause or another group', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 10; i += 1) h = record(h, i, { group: 'drag:1', now: i * 50 });
    expect(h.past).toEqual([0]);
    expect(undo(h).present).toBe(0);
    h = record(h, 11, { group: 'drag:2', now: 600 });
    expect(h.past).toEqual([0, 10]);
    h = record(h, 12, { group: 'drag:2', now: 5000 });
    expect(h.past).toEqual([0, 10, 11]);
  });

  it('never merges into a step it undid', () => {
    let h = record(createHistory(0), 1, { group: 'g', now: 0 });
    h = undo(h);
    h = record(h, 2, { group: 'g', now: 100 });
    expect(h.past).toEqual([0]);
    expect(undo(h).present).toBe(0);
  });

  it('swaps the present without a step', () => {
    const h = replacePresent(record(createHistory(0), 1, { now: 0 }), 'saved');
    expect(h.present).toBe('saved');
    expect(undo(h).present).toBe(0);
  });

  it('caps how far back it goes', () => {
    let h = createHistory(0);
    for (let i = 1; i <= 10; i += 1) h = record(h, i, { now: i * 10_000, limit: 3 });
    expect(h.past).toEqual([7, 8, 9]);
  });
});

describe('keyAction', () => {
  const key = (k, mods = {}, target = { tagName: 'DIV' }) => keyAction({ key: k, target, ...mods });

  it('reads undo, redo and delete', () => {
    expect(key('z', { metaKey: true })).toBe('undo');
    expect(key('Z', { ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(key('y', { ctrlKey: true })).toBe('redo');
    expect(key('Delete')).toBe('delete');
    expect(key('Backspace')).toBe('delete');
    expect(key('a')).toBeNull();
    expect(key('Backspace', { metaKey: true })).toBeNull();
  });

  it('leaves typing in a field alone, but not a checkbox or a slider', () => {
    expect(key('Backspace', {}, { tagName: 'INPUT', type: 'text' })).toBeNull();
    expect(key('z', { metaKey: true }, { tagName: 'TEXTAREA' })).toBeNull();
    expect(key('Backspace', {}, { tagName: 'DIV', isContentEditable: true })).toBeNull();
    expect(key('Delete', {}, { tagName: 'INPUT', type: 'checkbox' })).toBe('delete');
    expect(key('z', { ctrlKey: true }, { tagName: 'INPUT', type: 'range' })).toBe('undo');
  });
});
