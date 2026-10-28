import { describe, it, expect } from 'vitest';
import { registerDate, registerNumbers } from './guestbookRegister.js';

describe('registerNumbers', () => {
  const e = (uri, extra = {}) => ({ uri, ...extra });

  it('numbers the newest public signature as the count, and counts down', () => {
    const numbers = registerNumbers([e('a'), e('b'), e('c')], 36);
    expect([...numbers.entries()]).toEqual([
      ['a', 36],
      ['b', 35],
      ['c', 34],
    ]);
  });

  it('skips hidden and flagged entries without using up a number', () => {
    const numbers = registerNumbers([e('a'), e('h', { hidden: true }), e('f', { flagged: true }), e('b')], 10);
    expect(numbers.get('a')).toBe(10);
    expect(numbers.has('h')).toBe(false);
    expect(numbers.has('f')).toBe(false);
    expect(numbers.get('b')).toBe(9);
  });

  it('numbers nothing without a count', () => {
    expect(registerNumbers([e('a')], null).size).toBe(0);
  });
});

describe('registerDate', () => {
  it("dates a signature on Dame's calendar", () => {
    // 11pm in Los Angeles on Aug 31 is already Sep 1 in New York.
    expect(registerDate('2026-09-01T06:00:00Z')).toBe('Sep 1, 2026');
    expect(registerDate('2026-09-01T03:30:00Z')).toBe('Aug 31, 2026');
    expect(registerDate(undefined)).toBe('');
  });
});
