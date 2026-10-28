import { describe, it, expect } from 'vitest';
import { guardStorage, isStorageVolatile } from './storageGuard.js';

function blocked() {
  const target = {};
  Object.defineProperty(target, 'localStorage', {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error('SecurityError: access is denied for this document');
    },
  });
  return target;
}

describe('guardStorage', () => {
  it('leaves a working storage untouched', () => {
    const real = { getItem: () => null, setItem: () => {} };
    const target = { localStorage: real };
    expect(guardStorage(target, 'localStorage')).toBe(false);
    expect(target.localStorage).toBe(real);
  });

  it('replaces a storage whose getter throws with one that works', () => {
    const target = blocked();
    expect(guardStorage(target, 'localStorage')).toBe(true);
    // The pattern every provider initialiser uses must no longer throw.
    expect(() => target.localStorage.getItem('dame.feedLayout')).not.toThrow();
    expect(target.localStorage.getItem('dame.feedLayout')).toBe(null);
    target.localStorage.setItem('dame.feedLayout', 'cards');
    expect(target.localStorage.getItem('dame.feedLayout')).toBe('cards');
    expect(target.localStorage.length).toBe(1);
    target.localStorage.removeItem('dame.feedLayout');
    expect(target.localStorage.getItem('dame.feedLayout')).toBe(null);
    expect(isStorageVolatile('localStorage')).toBe(true);
  });

  it('replaces a null storage (webviews with DOM storage off)', () => {
    const target = { sessionStorage: null };
    expect(guardStorage(target, 'sessionStorage')).toBe(true);
    target.sessionStorage.setItem('k', 1);
    expect(target.sessionStorage.getItem('k')).toBe('1');
    expect(isStorageVolatile('sessionStorage')).toBe(true);
  });
});
