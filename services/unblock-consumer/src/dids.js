// DIDs, packed for the block index.
//
// The index holds one row for every block on the network that has not been
// undone, and each row names two accounts. Written out, a did:plc is 32 bytes;
// what it actually carries is 15, because the part after `did:plc:` is 24
// characters of base32 and 24 x 5 bits is 120. Storing the 15 takes a row from
// about 85 bytes to about 50, which on this box is the difference between an
// index that can place an unblock three months after the block and one that
// can place it five.
//
// Anything that is not a canonical did:plc (a did:web, a method that does not
// exist yet) is stored as it is written. The two never collide: a packed DID
// is a BLOB and a written one is TEXT, and SQLite keeps them apart, sorts
// every TEXT before every BLOB, and never calls one equal to the other.

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const VALUE = new Map([...ALPHABET].map((ch, i) => [ch, i]));

const PLC = /^did:plc:[a-z2-7]{24}$/;
const PLC_BYTES = 15;

// A DID as the syntax spec has it, held to a length nothing real approaches.
// The subject of a block is whatever its author typed into the record, so it
// is checked before it is allowed to become a row.
const DID = /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/;
const MAX_DID_LENGTH = 512;

/** Whether `value` is a DID this index is willing to hold. */
export function isDid(value) {
  return typeof value === 'string' && value.length <= MAX_DID_LENGTH && DID.test(value);
}

/**
 * A DID as the index stores it: 15 bytes for a did:plc, the string itself for
 * anything else.
 */
export function packDid(did) {
  if (!PLC.test(did)) return did;
  const out = new Uint8Array(PLC_BYTES);
  let bits = 0;
  let acc = 0;
  let at = 0;
  for (let i = 8; i < did.length; i += 1) {
    acc = (acc << 5) | VALUE.get(did[i]);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (acc >> bits) & 0xff;
      at += 1;
      // Keep only the bits not yet written, so `acc` never outgrows 32.
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

/** The DID a stored value stands for. */
export function unpackDid(value) {
  if (typeof value === 'string') return value;
  if (!(value instanceof Uint8Array) || value.length !== PLC_BYTES) {
    throw new TypeError('not a stored DID');
  }
  let out = 'did:plc:';
  let bits = 0;
  let acc = 0;
  for (const byte of value) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >> bits) & 31];
    }
    // Keep only the bits not yet written, so `acc` never outgrows 32.
    acc &= (1 << bits) - 1;
  }
  return out;
}
