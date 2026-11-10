import { describe, expect, it } from 'vitest';
import { isDid, packDid, unpackDid } from './dids.js';

describe('packing a DID for the index', () => {
  it('takes a did:plc to 15 bytes and back to the same string', () => {
    for (const did of [
      'did:plc:gq4fo3u6tqzzdkjlwzpb23tj',
      'did:plc:loilflxis3le26aehdmjrmm2',
      'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa',
      'did:plc:777777777777777777777777',
      'did:plc:z2lowatnvob5g77btjblxxvu',
    ]) {
      const packed = packDid(did);
      expect(packed).toBeInstanceOf(Uint8Array);
      expect(packed.length).toBe(15);
      expect(unpackDid(packed)).toBe(did);
    }
  });

  it('gives two accounts two different keys', () => {
    const a = packDid('did:plc:gq4fo3u6tqzzdkjlwzpb23tj');
    const b = packDid('did:plc:gq4fo3u6tqzzdkjlwzpb23tk');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('leaves anything that is not a canonical did:plc as it is written', () => {
    for (const did of [
      'did:web:example.com',
      // Fifteen characters, the length of a packed did:plc. It stays a string,
      // which is what keeps it from being read back as one.
      'did:web:abc.com',
      'did:plc:tooshort',
      'did:plc:GQ4FO3U6TQZZDKJLWZPB23TJ',
      'did:plc:gq4fo3u6tqzzdkjlwzpb23t1',
    ]) {
      expect(packDid(did)).toBe(did);
      expect(unpackDid(did)).toBe(did);
    }
  });

  it('refuses to unpack what it did not pack', () => {
    expect(() => unpackDid(new Uint8Array(14))).toThrow();
    expect(() => unpackDid(null)).toThrow();
  });
});

describe('what counts as a DID', () => {
  it('holds a subject to the syntax and to a sane length', () => {
    expect(isDid('did:plc:gq4fo3u6tqzzdkjlwzpb23tj')).toBe(true);
    expect(isDid('did:web:example.com')).toBe(true);
    expect(isDid('did:web:localhost%3A8080')).toBe(true);
    expect(isDid('dame.is')).toBe(false);
    expect(isDid('at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj')).toBe(false);
    expect(isDid('did:plc:')).toBe(false);
    expect(isDid('did:plc:abc def')).toBe(false);
    expect(isDid(`did:web:${'a'.repeat(600)}`)).toBe(false);
    expect(isDid(null)).toBe(false);
    expect(isDid({ did: 'did:plc:x' })).toBe(false);
  });
});
