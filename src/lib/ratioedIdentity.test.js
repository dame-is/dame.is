import { describe, it, expect } from 'vitest';
import { identify, identifyAcross, UNRESOLVED } from './ratioedIdentity.js';

describe('identify', () => {
  it('uses a DID whenever the row carries one', () => {
    const who = identify([]);
    expect(who({ did: 'did:plc:a', h: 'a.test' })).toBe('did:plc:a');
  });

  it('resolves a did-less row through a row that carries both', () => {
    // The whole point: take 4's harvest has handles only, and take 17's
    // recorded log is what proves whose DID that handle belongs to.
    const who = identify([
      { h: 'cam', k: 'reply', off: 1 },
      { h: 'cam', did: 'did:plc:cam', k: 'repost', off: 2 },
    ]);
    expect(who({ h: 'cam', k: 'reply', off: 1 })).toBe('did:plc:cam');
  });

  it('falls back to the handle when nothing links it', () => {
    const who = identify([{ h: 'lone', k: 'reply', off: 1 }]);
    expect(who({ h: 'lone' })).toBe('h:lone');
  });

  it('will not link a handle two DIDs both claim', () => {
    // A rename. Guessing which account acted is worse than keeping them apart.
    const who = identify([
      { h: 'shared', did: 'did:plc:one' },
      { h: 'shared', did: 'did:plc:two' },
    ]);
    expect(who({ h: 'shared' })).toBe('h:shared');
    expect(who({ h: 'shared', did: 'did:plc:one' })).toBe('did:plc:one');
  });

  it('never links through the unresolvable placeholder', () => {
    // Every deactivated account answers to it; collapsing them would report a
    // dozen people as one.
    const who = identify([
      { h: UNRESOLVED, did: 'did:plc:gone1' },
      { h: UNRESOLVED, did: 'did:plc:gone2' },
    ]);
    expect(who({ h: UNRESOLVED, did: 'did:plc:gone1' })).toBe('did:plc:gone1');
    expect(who({ h: UNRESOLVED, rkey: 'r1' })).toBe('row:r1');
    expect(who({ h: UNRESOLVED, rkey: 'r2' })).toBe('row:r2');
  });

  it('keys a nameless row by the record it is, so two are not one', () => {
    const who = identify([]);
    expect(who({ k: 'reply', off: 12 })).toBe('row:reply:12');
    expect(who({ k: 'reply', offMs: 12_000 })).toBe('row:reply:12000');
  });

  it('answers null for nothing', () => {
    expect(identify([])(null)).toBe(null);
    expect(identify(null)({})).toBe('row:undefined:');
  });
});

describe('identifyAcross', () => {
  it('builds one link from several logs', () => {
    const who = identifyAcross([
      [{ h: 'cam', k: 'reply', off: 1 }],
      [{ h: 'cam', did: 'did:plc:cam', k: 'repost', off: 2 }],
    ]);
    expect(who({ h: 'cam' })).toBe('did:plc:cam');
  });

  it('survives empty and absent logs', () => {
    expect(identifyAcross([null, [], undefined])({ h: 'x' })).toBe('h:x');
    expect(identifyAcross(null)({ did: 'did:plc:a' })).toBe('did:plc:a');
  });
});
