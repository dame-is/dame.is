import { describe, it, expect } from 'vitest';
import {
  ackFor,
  nudge,
  pick,
  parseOpeners,
  DEFAULT_OPENERS,
  ACK_CLAUSE,
  NUDGE,
} from './phrases.js';

/** Deterministic rng so a variety test is not a flaky test. */
const always = (i) => () => i;

describe('nothing it says out loud contains an em dash', () => {
  // The comments in this codebase are full of them and the replies are not.
  // That difference is deliberate: comments are prose for a reader, replies are
  // a machine talking.
  const everything = [
    ...DEFAULT_OPENERS,
    ...Object.values(ACK_CLAUSE).flat(),
    ...Object.values(NUDGE).flat(),
  ];
  it.each(everything)('%s', (phrase) => {
    expect(phrase).not.toMatch(/—/);
  });
});

describe('ackFor', () => {
  it('pairs an opener with what is actually about to happen', () => {
    expect(ackFor({ action: 'plan' }, { rng: always(0) })).toBe(
      'Acknowledged. Harvesting and scoring that post.',
    );
    expect(ackFor({ action: 'approve' }, { rng: always(0) })).toBe(
      'Acknowledged. Writing to the list.',
    );
  });

  it('varies, so it does not read like a machine stamping a form', () => {
    const seen = new Set();
    for (let i = 0; i < DEFAULT_OPENERS.length; i += 1) {
      seen.add(
        ackFor({ action: 'plan' }, { rng: always(i / DEFAULT_OPENERS.length) }),
      );
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('uses the configured openers when there are some', () => {
    const out = ackFor(
      { action: 'plan' },
      { openers: ['On it boss.'], rng: always(0) },
    );
    expect(out).toBe('On it boss. Harvesting and scoring that post.');
  });

  it('falls back to thinking for a question rather than a command', () => {
    expect(ackFor(null, { rng: always(0) })).toBe('Acknowledged. Thinking.');
    expect(ackFor({ action: 'nonsense' }, { rng: always(0) })).toMatch(
      /Thinking/,
    );
  });

  it('never says only the opener', () => {
    // An "Acknowledged" with nothing after it is a second message carrying no
    // information. Some clauses are a single word ("Thinking."), so the check
    // is that a clause is present, not that the reply is long.
    for (const action of Object.keys(ACK_CLAUSE)) {
      const out = ackFor({ action }, { openers: ['Yo.'], rng: always(0) });
      expect(out.startsWith('Yo. ')).toBe(true);
      expect(out.slice(4)).toBe(ACK_CLAUSE[action][0]);
    }
  });
});

describe('parseOpeners', () => {
  it('takes one per line, because a textarea is what the portal gives', () => {
    expect(parseOpeners('Acknowledged.\n  On it.  \n\nGot it.')).toEqual([
      'Acknowledged.',
      'On it.',
      'Got it.',
    ]);
  });

  it('falls back to the defaults rather than leaving the bot mute', () => {
    expect(parseOpeners('')).toBe(DEFAULT_OPENERS);
    expect(parseOpeners(null)).toBe(DEFAULT_OPENERS);
    expect(parseOpeners('   \n  ')).toBe(DEFAULT_OPENERS);
  });
});

describe('nudge', () => {
  it('explains why it will not guess a target', () => {
    for (let i = 0; i < NUDGE.actor.length; i += 1) {
      const out = nudge('actor', always(i / NUDGE.actor.length));
      expect(out).toMatch(/@handle|handle/);
    }
  });

  it('falls back rather than returning nothing for an unknown kind', () => {
    expect(nudge('nope')).toBeTruthy();
  });
});

describe('pick', () => {
  it('survives an empty or broken list', () => {
    expect(pick([])).toBe('');
    expect(pick(null)).toBe('');
    expect(pick([null, 'ok'], always(0.99))).toBe('ok');
  });
});
