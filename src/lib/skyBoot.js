// The table behind index.html's sky boot paint.
//
// index.html paints this hour's page colour, colour scheme and browser-chrome
// tint before the bundle has downloaded (its inline script explains why). It
// can't import skyTheme.js to work them out — nothing has loaded yet — so it
// carries all 24 hours as a literal. That literal used to be pasted in by hand
// and guarded by a test, which meant every retune of the owner's is.dame.sky
// record shipped a boot paint that disagreed with the bundle's until someone
// re-pasted it. Now vite.config.js writes it into the page at build time (and
// on every dev request) from the same paletteForHour() and the same tuning
// snapshot the bundle installs, so the two can't drift.
//
// Build-only: imported by vite.config.js and its test, never by the app.

import { paletteForHour } from './skyTheme.js';

/** The placeholder index.html's boot script holds where the table goes. */
export const SKY_BOOT_MARKER = '__SKY_BOOT__';

/**
 * `[page, theme-color, color-scheme]` per Eastern hour from 12am, under
 * `tuning` (an effectiveSkyTuning() map) or the built-in palette when null.
 */
export function skyBootTable(tuning = null) {
  return Array.from({ length: 24 }, (_, hour) => {
    const palette = paletteForHour(hour, tuning);
    return [
      palette.vars['--sky-page'],
      palette.themeColor,
      palette.colorScheme,
    ];
  });
}

/**
 * index.html with its SKY_BOOT_MARKER replaced by the table for `tuning`.
 * Throws when the marker isn't there exactly once: a boot script left without
 * its table would quietly fall back to the parchment paint on every load.
 */
export function injectSkyBoot(html, tuning = null) {
  const parts = html.split(SKY_BOOT_MARKER);
  if (parts.length !== 2) {
    throw new Error(
      `index.html should hold ${SKY_BOOT_MARKER} exactly once (found ${parts.length - 1})`,
    );
  }
  return parts.join(JSON.stringify(skyBootTable(tuning)));
}
