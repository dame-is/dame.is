import { describe, it, expect } from 'vitest';
import {
  participantSlug,
  participantPath,
  findParticipant,
  participantDossier,
} from './ratioedParticipant.js';

const ev = (k, h, off, pre = 1, extra = {}) => ({ k, h, off, pre, ...extra });

const piece = (take, events, breaker = { handle: 'someone.test', likeSurvives: true }) => ({
  take,
  rkey: `r${take}`,
  breaker,
  events,
});

const person = (over = {}) => ({
  did: 'did:plc:a',
  h: 'a.test',
  dn: '',
  pre: [],
  post: [],
  kinds: {},
  ...over,
});

const dossier = (p, pieces) => participantDossier(p, { pieces, resolveEvents: (x) => x.events });

describe('participantSlug / participantPath', () => {
  it('addresses a person by the handle a reader would type', () => {
    expect(participantSlug(person())).toBe('a.test');
    expect(participantPath(person(), 'ratioed')).toBe('/creating/ratioed/participant/a.test');
  });

  it('has no address for an account nothing could name', () => {
    expect(participantPath(person({ h: '(unresolvable)' }))).toBe(null);
  });
});

describe('findParticipant', () => {
  const rows = [person(), person({ did: 'did:plc:b', h: 'b.test' })];

  it('resolves a handle, however it was written', () => {
    expect(findParticipant(rows, 'A.Test')?.did).toBe('did:plc:a');
    expect(findParticipant(rows, '@a.test')?.did).toBe('did:plc:a');
  });

  it('resolves a DID too, so a link written from a record still lands', () => {
    expect(findParticipant(rows, 'did:plc:b')?.h).toBe('b.test');
  });

  it('refuses a handle two entries share rather than guessing', () => {
    // The placeholder for deactivated accounts covers more than one DID, and
    // crediting either of them with the other's acts is worse than a 404.
    const shared = [person({ h: '(unresolvable)' }), person({ did: 'did:plc:b', h: '(unresolvable)' })];
    expect(findParticipant(shared, '(unresolvable)')).toBe(null);
  });
});

describe('participantDossier', () => {
  it('splits what somebody did either side of each seal', () => {
    const d = dossier(person({ pre: [1], post: [2] }), [
      piece(1, [ev('reply', 'a.test', 5), ev('repost', 'a.test', 9)]),
      piece(2, [ev('like', 'a.test', 400, 0)]),
    ]);
    expect(d.live).toBe(1);
    expect(d.afterOnly).toBe(1);
    expect(d.acts).toBe(2);
    expect(d.afterActs).toBe(1);
    expect(d.kinds).toEqual({ reply: 1, repost: 1 });
    expect(d.afterKinds).toEqual({ like: 1 });
  });

  it('counts a piece once, whichever window the person turned up in', () => {
    // Somebody who replied while it stood and quoted it a year later is in one
    // take, not two — and it is a live one, because they were there.
    const d = dossier(person({ pre: [1], post: [1] }), [
      piece(1, [ev('reply', 'a.test', 5), ev('quote', 'a.test', 90000, 0)]),
    ]);
    expect(d.takes).toHaveLength(1);
    expect(d.live).toBe(1);
    expect(d.afterOnly).toBe(0);
  });

  it("ignores the artist's own records", () => {
    const d = dossier(person({ h: 'dame.is', pre: [1] }), [
      piece(1, [ev('reply', 'dame.is', 5, 1, { self: 1 })]),
    ]);
    expect(d.acts).toBe(0);
  });

  it('holds a take the roster names but no log accounts for', () => {
    // The nine pieces harvested before logs were recorded. A take with nothing
    // to show still happened, and dropping it would undercount the person.
    const d = dossier(person({ pre: [4] }), [piece(4, [])]);
    expect(d.live).toBe(1);
    expect(d.takes[0]).toMatchObject({ take: 4, wasAlive: true });
  });

  it('names the breaker even when the like they cast is gone', () => {
    const d = dossier(person({ h: 'gone.test', did: 'did:plc:gone' }), [
      piece(1, [], { handle: 'gone.test', did: 'did:plc:gone', likeSurvives: false }),
    ]);
    expect(d.broke).toEqual([1]);
    expect(d.likeGone).toBe(true);
    // Being the breaker is being there, whatever the indexes hold.
    expect(d.live).toBe(1);
  });

  it('follows a did-less harvest row through a DID another log recorded', () => {
    // Take 1 is harvest and carries a handle alone; take 2 was recorded and
    // ties that handle to a DID. Without the link the same person reads as two.
    const d = dossier(person({ did: 'did:plc:a' }), [
      piece(1, [ev('reply', 'a.test', 5)]),
      piece(2, [{ k: 'repost', did: 'did:plc:a', h: 'a.test', off: 3, pre: 1 }]),
    ]);
    expect(d.live).toBe(2);
    expect(d.acts).toBe(2);
  });

  it('lets a DID overrule a handle somebody else has since taken', () => {
    const d = dossier(person({ did: 'did:plc:a' }), [
      piece(1, [{ k: 'reply', did: 'did:plc:other', h: 'a.test', off: 5, pre: 1 }]),
    ]);
    expect(d.acts).toBe(0);
  });

  it('reads the debut in take order and the reflex off the clock', () => {
    const d = dossier(person({ pre: [2, 5] }), [
      piece(2, [ev('reply', 'a.test', 30)]),
      piece(5, [ev('like', 'a.test', 4)]),
    ]);
    expect(d.debut.take).toBe(2);
    expect(d.quickest).toMatchObject({ take: 5, off: 4 });
  });
});
