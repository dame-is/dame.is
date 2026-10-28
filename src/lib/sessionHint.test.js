import { describe, expect, it } from 'vitest';
import {
  SESSION_HINT_KEY,
  clearSessionHint,
  readSessionHint,
  restoresAtStartup,
  writeSessionHint,
} from './sessionHint.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

const throwingStorage = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
  removeItem() {
    throw new Error('SecurityError');
  },
};

describe('session hint', () => {
  it('round-trips both kinds', () => {
    const storage = memoryStorage();
    writeSessionHint(storage, 'guest');
    expect(readSessionHint(storage)).toBe('guest');
    writeSessionHint(storage, 'owner');
    expect(readSessionHint(storage)).toBe('owner');
    clearSessionHint(storage);
    expect(readSessionHint(storage)).toBeNull();
  });

  it('reads the pre-split "1" as the owner’s, so it keeps restoring eagerly', () => {
    expect(readSessionHint(memoryStorage({ [SESSION_HINT_KEY]: '1' }))).toBe(
      'owner',
    );
  });

  it('ignores values it doesn’t know, and kinds it isn’t given', () => {
    expect(
      readSessionHint(memoryStorage({ [SESSION_HINT_KEY]: 'yes' })),
    ).toBeNull();
    const storage = memoryStorage();
    writeSessionHint(storage, 'admin');
    expect(storage.map.size).toBe(0);
  });

  it('fails soft when storage is unavailable', () => {
    expect(readSessionHint(throwingStorage)).toBeNull();
    expect(() => writeSessionHint(throwingStorage, 'owner')).not.toThrow();
    expect(() => clearSessionHint(throwingStorage)).not.toThrow();
    expect(readSessionHint(undefined)).toBeNull();
  });
});

describe('restoresAtStartup', () => {
  it('restores for the owner and on the OAuth callback', () => {
    expect(restoresAtStartup({ hint: 'owner', onCallback: false })).toBe(true);
    expect(restoresAtStartup({ hint: null, onCallback: true })).toBe(true);
    expect(restoresAtStartup({ hint: 'guest', onCallback: true })).toBe(true);
  });

  it('leaves a guest’s session, and anonymous visitors, unloaded', () => {
    expect(restoresAtStartup({ hint: 'guest', onCallback: false })).toBe(false);
    expect(restoresAtStartup({ hint: null, onCallback: false })).toBe(false);
  });
});
