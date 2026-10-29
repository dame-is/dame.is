import { describe, it, expect } from 'vitest';
import { previewCss, scopeSelector, smallCapsSelectors } from './labelPreview.js';

// Just enough of the CSSOM for the walk: style rules carry a selector and a
// style, grouping rules (@media, @supports) carry rules of their own.
const style = (props) => ({ getPropertyValue: (name) => props[name] || '' });
const rule = (selectorText, props) => ({ selectorText, style: style(props) });
const group = (...cssRules) => ({ cssRules });

describe('smallCapsSelectors', () => {
  it('finds every selector that asks for all small caps, inside groups too', () => {
    const found = smallCapsSelectors([
      rule('.small-caps, .eyebrow', { 'font-variant': 'all-small-caps' }),
      rule('.plain', { 'font-variant': 'normal' }),
      group(rule('.chrome-label', { 'font-variant-caps': 'all-small-caps' })),
    ]);
    expect([...found]).toEqual(['.small-caps', '.eyebrow', '.chrome-label']);
  });

  it('keeps a selector list inside :is() whole, and skips pseudo-elements', () => {
    const found = smallCapsSelectors([
      rule(':is(.a, .b) .label, .leaflet-doc > p::first-line', { 'font-variant-caps': 'all-small-caps' }),
    ]);
    expect([...found]).toEqual([':is(.a, .b) .label']);
  });
});

describe('scopeSelector', () => {
  it('scopes under the preview attribute, joining one that starts at the root', () => {
    expect(scopeSelector('.eyebrow')).toBe(":root[data-label-preview='caps'] .eyebrow");
    expect(scopeSelector(":root[data-xray='on'] .tag")).toBe(
      ":root[data-label-preview='caps'][data-xray='on'] .tag",
    );
  });
});

describe('previewCss', () => {
  it('writes nothing for no selectors, and exempts units otherwise', () => {
    expect(previewCss(new Set())).toBe('');
    const css = previewCss(new Set(['.eyebrow']));
    expect(css).toContain('text-transform: uppercase');
    expect(css).toContain(".unit { text-transform: none; }");
  });
});
