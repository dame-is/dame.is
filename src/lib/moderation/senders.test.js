import { describe, it, expect } from 'vitest';
import { parseDids, makeRoster, rosterFromEnv } from './senders.js';

const OWNER = 'did:plc:owner';
const GUEST = 'did:plc:guest';
const WRITER = 'did:plc:writer';

describe('parseDids', () => {
  it('takes commas or whitespace', () => {
    expect(parseDids(`${OWNER}, ${GUEST}`)).toEqual([OWNER, GUEST]);
    expect(parseDids(`${OWNER}\n${GUEST}`)).toEqual([OWNER, GUEST]);
  });

  it('drops anything that is not a DID', () => {
    // A handle here would be a boundary that silently does not hold: handles
    // are rented, so the account answered today is not necessarily the one
    // answered next month.
    expect(parseDids('dame.is, notadid, did:plc:ok')).toEqual(['did:plc:ok']);
    expect(parseDids('')).toEqual([]);
    expect(parseDids(null)).toEqual([]);
  });

  it('does not repeat a DID listed twice', () => {
    expect(parseDids(`${OWNER} ${OWNER}`)).toEqual([OWNER]);
  });
});

describe('the roster', () => {
  const roster = makeRoster({
    owner: OWNER,
    writers: [WRITER],
    allowed: [GUEST],
  });

  it('answers everyone on it and nobody else', () => {
    expect(roster.answers(OWNER)).toBe(true);
    expect(roster.answers(WRITER)).toBe(true);
    expect(roster.answers(GUEST)).toBe(true);
    expect(roster.answers('did:plc:stranger')).toBe(false);
  });

  it('lets only the owner and named writers write', () => {
    expect(roster.writes(OWNER)).toBe(true);
    expect(roster.writes(WRITER)).toBe(true);
    // The whole point of the two tiers. A guest can ask anything and change
    // nothing.
    expect(roster.writes(GUEST)).toBe(false);
    expect(roster.writes('did:plc:stranger')).toBe(false);
  });

  it('answers a writer without them being listed twice', () => {
    expect(roster.all).toContain(WRITER);
  });

  it('treats a missing did as not on it, rather than throwing', () => {
    expect(roster.answers(undefined)).toBe(false);
    expect(roster.writes(null)).toBe(false);
    expect(roster.answers('')).toBe(false);
  });

  it('is owner-only when nothing else is configured', () => {
    const solo = makeRoster({ owner: OWNER });
    expect(solo.answers(GUEST)).toBe(false);
    expect(solo.all).toEqual([OWNER]);
    expect(solo.hasGuests).toBe(false);
  });
});

describe('rosterFromEnv', () => {
  it('reads both tiers, falling back to the owner', () => {
    const r = rosterFromEnv(
      { MOD_ALLOWED_DIDS: GUEST, MOD_WRITER_DIDS: WRITER },
      OWNER,
    );
    expect(r.owner).toBe(OWNER);
    expect(r.answers(GUEST)).toBe(true);
    expect(r.writes(GUEST)).toBe(false);
    expect(r.writes(WRITER)).toBe(true);
  });

  it('is owner-only on an empty environment', () => {
    // The default has to be the narrow one. An allowlist that defaults to open
    // because a variable was unset is the failure this whole file exists to
    // prevent.
    const r = rosterFromEnv({}, OWNER);
    expect(r.all).toEqual([OWNER]);
    expect(r.answers('did:plc:anyone')).toBe(false);
  });
});
