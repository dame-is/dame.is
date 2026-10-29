import { describe, expect, it } from 'vitest';
import { planBarOverflow } from './useBarOverflow.js';

const chip = (key, over = {}) => ({ key, width: 28, gap: 8, shown: true, ...over });

describe('planBarOverflow', () => {
  it('leaves a bar that fits alone', () => {
    const plan = planBarOverflow({
      box: 300,
      natural: 200,
      items: [chip('sky'), chip('info'), chip('back')],
    });
    expect(plan).toEqual({ hidden: [], day: true });
  });

  it('moves ⓘ out first, then back, never anything not on the bar', () => {
    const items = [chip('sky'), chip('info'), chip('back'), chip('scroll')];
    expect(planBarOverflow({ box: 300, natural: 320, items }).hidden).toEqual(['info']);
    expect(planBarOverflow({ box: 300, natural: 350, items }).hidden).toEqual(['info', 'back']);
  });

  it('drops the day beside ↑ after ⓘ', () => {
    const items = [chip('info'), chip('scroll')];
    const plan = planBarOverflow({
      box: 300,
      natural: 350,
      items,
      dayWidth: 40,
      dayShown: true,
    });
    expect(plan).toEqual({ hidden: ['info'], day: false });
  });

  it('brings a chip back once there is room for it again', () => {
    // Info is hidden; the row needs 250 without it and 286 with it.
    const items = [chip('sky'), chip('info', { shown: false }), chip('back')];
    expect(planBarOverflow({ box: 300, natural: 250, items }).hidden).toEqual([]);
    expect(planBarOverflow({ box: 280, natural: 250, items }).hidden).toEqual(['info']);
  });

  it('keeps a chip out until there is room to spare for it', () => {
    // Info is out and would fit by 4px: not enough to come back.
    const items = [chip('sky'), chip('info', { shown: false }), chip('back')];
    expect(planBarOverflow({ box: 290, natural: 250, items }).hidden).toEqual(['info']);
    expect(planBarOverflow({ box: 300, natural: 250, items }).hidden).toEqual([]);
  });

  it('settles when the day costs more drawn than remembered', () => {
    // A 320px phone: with the day beside ↑ the row is 290 of 288; without it
    // 253, and the day was measured at 34.6 while drawn (↑'s face also
    // widened by 2.4, which the measure can't see). Each state must plan
    // itself, not the other.
    const base = [chip('sky', { width: 65 }), chip('info', { shown: false }), chip('back'), chip('scroll')];
    const withDay = planBarOverflow({ box: 288, natural: 290, items: base, dayWidth: 34.6, dayShown: true });
    expect(withDay).toEqual({ hidden: ['info'], day: false });
    const withoutDay = planBarOverflow({ box: 288, natural: 253, items: base, dayWidth: 34.6, dayShown: false });
    expect(withoutDay).toEqual({ hidden: ['info'], day: false });
  });

  it('keeps forced chips out and does not count them', () => {
    const items = [chip('home', { shown: false }), chip('info')];
    const plan = planBarOverflow({
      box: 300,
      natural: 100,
      items,
      forced: ['home'],
    });
    expect(plan.hidden).toEqual(['home']);
  });
});
