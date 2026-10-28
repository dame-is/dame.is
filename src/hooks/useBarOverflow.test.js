import { describe, expect, it } from 'vitest';
import { planBarOverflow } from './useBarOverflow.js';

const chip = (key, over = {}) => ({ key, width: 28, gap: 8, extra: 0, shown: true, ...over });

describe('planBarOverflow', () => {
  it('leaves a bar that fits alone', () => {
    const plan = planBarOverflow({
      box: 300,
      natural: 200,
      items: [chip('sky'), chip('info'), chip('back')],
      wordsWanted: false,
      wordsShown: false,
    });
    expect(plan).toEqual({ hidden: [], words: false, day: true });
  });

  it('moves ⓘ out first, then back, never anything not on the bar', () => {
    const items = [chip('sky'), chip('info'), chip('back'), chip('scroll')];
    expect(
      planBarOverflow({ box: 300, natural: 320, items, wordsWanted: false, wordsShown: false }).hidden,
    ).toEqual(['info']);
    expect(
      planBarOverflow({ box: 300, natural: 350, items, wordsWanted: false, wordsShown: false }).hidden,
    ).toEqual(['info', 'back']);
  });

  it('drops the words before any chip', () => {
    const items = [chip('sky', { extra: 20 }), chip('info', { extra: 30 })];
    const plan = planBarOverflow({ box: 300, natural: 340, items, wordsWanted: true, wordsShown: true });
    expect(plan).toEqual({ hidden: [], words: false, day: true });
  });

  it('drops the day beside ↑ after ⓘ', () => {
    const items = [chip('info'), chip('scroll')];
    const plan = planBarOverflow({
      box: 300,
      natural: 350,
      items,
      wordsWanted: false,
      wordsShown: false,
      dayWidth: 40,
      dayShown: true,
    });
    expect(plan).toEqual({ hidden: ['info'], words: false, day: false });
  });

  it('brings a chip back once there is room for it again', () => {
    // Info is hidden; the row needs 250 without it and 286 with it.
    const items = [chip('sky'), chip('info', { shown: false }), chip('back')];
    expect(
      planBarOverflow({ box: 300, natural: 250, items, wordsWanted: false, wordsShown: false }).hidden,
    ).toEqual([]);
    expect(
      planBarOverflow({ box: 280, natural: 250, items, wordsWanted: false, wordsShown: false }).hidden,
    ).toEqual(['info']);
  });

  it('keeps forced chips out and does not count them', () => {
    const items = [chip('home', { shown: false }), chip('info')];
    const plan = planBarOverflow({
      box: 300,
      natural: 100,
      items,
      wordsWanted: false,
      wordsShown: false,
      forced: ['home'],
    });
    expect(plan.hidden).toEqual(['home']);
  });

  it('counts the words a hidden chip would bring back', () => {
    // Words are wanted but currently hidden: the row needs 250 + 2 × 30.
    const items = [chip('sky', { extra: 30 }), chip('info', { extra: 30 })];
    const tight = planBarOverflow({ box: 300, natural: 250, items, wordsWanted: true, wordsShown: false });
    expect(tight.words).toBe(false);
    const roomy = planBarOverflow({ box: 320, natural: 250, items, wordsWanted: true, wordsShown: false });
    expect(roomy.words).toBe(true);
  });
});
