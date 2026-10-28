import { describe, it, expect } from 'vitest';
import { createScrollMemory, entryKey, restoreStep } from './scrollMemory.js';

function fakeStorage(initial = {}) {
  const items = { ...initial };
  return {
    items,
    getItem: (k) => (k in items ? items[k] : null),
    setItem: (k, v) => {
      items[k] = String(v);
    },
  };
}

describe('entryKey', () => {
  it('keeps entries that share the "default" key apart by URL', () => {
    const first = {
      key: 'default',
      pathname: '/blogging/a',
      search: '',
      hash: '',
    };
    const fragment = {
      key: 'default',
      pathname: '/blogging/a',
      search: '',
      hash: '#fn1',
    };
    expect(entryKey(first)).not.toBe(entryKey(fragment));
  });
});

describe('createScrollMemory', () => {
  it('remembers offsets and survives a round trip through storage', () => {
    const storage = fakeStorage();
    const memory = createScrollMemory(storage);
    memory.set('a|/', 4000.4);
    memory.set('b|/posting', 120);
    memory.persist();
    const reloaded = createScrollMemory(storage);
    expect(reloaded.get('a|/')).toBe(4000);
    expect(reloaded.get('b|/posting')).toBe(120);
    expect(reloaded.get('c|/listening')).toBeUndefined();
  });

  it('drops the least recently written entries past the cap', () => {
    const memory = createScrollMemory(fakeStorage(), { limit: 2 });
    memory.set('a', 1);
    memory.set('b', 2);
    memory.set('a', 3); // a is now the most recent
    memory.set('c', 4);
    expect(memory.get('b')).toBeUndefined();
    expect(memory.get('a')).toBe(3);
    expect(memory.get('c')).toBe(4);
  });

  it('ignores junk in storage and works without storage at all', () => {
    expect(
      createScrollMemory(fakeStorage({ 'dame.scroll': '{nope' })).get('a'),
    ).toBeUndefined();
    const blocked = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    };
    const memory = createScrollMemory(blocked);
    memory.set('a', 10);
    expect(() => memory.persist()).not.toThrow();
    expect(memory.get('a')).toBe(10);
    const none = createScrollMemory(null);
    none.set('a', 5);
    expect(none.get('a')).toBe(5);
  });

  it('refuses non-finite offsets and clamps negatives', () => {
    const memory = createScrollMemory(null);
    memory.set('a', NaN);
    memory.set('b', -30); // iOS rubber-banding past the top
    expect(memory.get('a')).toBeUndefined();
    expect(memory.get('b')).toBe(0);
  });
});

describe('restoreStep', () => {
  it('lands on the target once the page is tall enough', () => {
    expect(restoreStep(4000, 14000, 800)).toEqual({ y: 4000, done: true });
  });

  it('scrolls as far as it can while the page is still short', () => {
    // A skeleton a little over a screen tall: go to its bottom and keep trying.
    expect(restoreStep(4000, 1500, 800)).toEqual({ y: 700, done: false });
    expect(restoreStep(4000, 600, 800)).toEqual({ y: 0, done: false });
  });
});
