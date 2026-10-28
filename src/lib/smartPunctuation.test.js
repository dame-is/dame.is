import { describe, it, expect } from 'vitest';
import { smartenText, countStraightMarks } from './smartPunctuation.js';

describe('smartenText', () => {
  it('curls double quotes by what comes before them', () => {
    expect(smartenText('the word "is" from "status updates".')).toBe(
      'the word “is” from “status updates”.',
    );
  });

  it('turns an apostrophe inside a word into a right single quote', () => {
    expect(smartenText("Why I started posting like it's the 2000s again")).toBe(
      'Why I started posting like it’s the 2000s again',
    );
    expect(smartenText("Dame's")).toBe('Dame’s');
  });

  it('opens and closes single quotes', () => {
    expect(smartenText("a 'quoted' word")).toBe('a ‘quoted’ word');
  });

  it("points an elided century's apostrophe the right way", () => {
    expect(smartenText("back in the '90s")).toBe('back in the ’90s');
  });

  it('sets an ellipsis and spaced dashes', () => {
    expect(smartenText('To be or not to be...')).toBe('To be or not to be…');
    expect(smartenText('one - two')).toBe('one – two');
    expect(smartenText('one--two')).toBe('one—two');
  });

  it('leaves hyphens inside words and ranges alone', () => {
    expect(smartenText('third-person 2010-2014')).toBe('third-person 2010-2014');
  });

  it('carries the previous segment so a quote can close across a facet', () => {
    // "…what was that change?" with the closing mark in the next run.
    expect(smartenText('" next', 'e')).toBe('” next');
    expect(smartenText('"open', ' ')).toBe('“open');
  });

  it('passes empty and non-string input through', () => {
    expect(smartenText('')).toBe('');
    expect(smartenText(null)).toBe(null);
  });
});

describe('countStraightMarks', () => {
  it('counts the marks the page will typeset', () => {
    expect(countStraightMarks('They removed the word "is" from "status updates".')).toBe(4);
    expect(countStraightMarks('Nothing to change here.')).toBe(0);
  });
});
