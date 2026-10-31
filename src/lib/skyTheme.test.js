import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  paletteForHour,
  contrastRatio,
  mixOklab,
  mixSrgb,
  solveContrast,
  SKY_TEXT_FLOOR,
  NEST_STEP,
  TEXT_CONTRAST_MIN,
  skyHourKey,
  skyHourLabel,
} from './skyTheme.js';
import { effectiveSkyTuning } from './skyTuning.js';
import { injectSkyBoot, SKY_BOOT_MARKER } from './skyBoot.js';
import { easternHour } from '../../og/time.js';

// The live is.dame.sky/self record as of its 16 July 2026 update. Held here
// rather than read from public/data (which CI never prefetches) so a future
// tuning can be pasted in and checked against the same floor.
const SKY_RECORD = {
  value: {
    enabled: true,
    hours: [
      { hour: 3, page: '#191817' },
      { hour: 4, page: '#1e1a15' },
      { hour: 5, page: '#1d222a', glowSize: 16, inkWarmth: 55, ruleWarmth: 40, surfaceSep: 140, glowTargets: ['buttons', 'avatar', 'accentText'], glowStrength: 20 },
      { pop: '#453228', hour: 6, page: '#2a315f', glowSize: 12, glowColor: '#5f3c06', inkWarmth: 50, ruleWarmth: 65, surfaceSep: 200, glowTargets: ['buttons', 'avatar', 'accentText'], glowStrength: 20 },
      { pop: '#607df0', hour: 7, page: '#a8b8e1', glowSize: 12, glowColor: '#eac276', inkWarmth: 90, ruleWarmth: 30, surfaceSep: 170, glowTargets: ['buttons', 'avatar', 'accentText'], inkContrast: 12, glowStrength: 25, ruleContrast: 6 },
      { pop: '#fbf9ee', hour: 8, page: '#c5d3fc', glowSize: 40, glowColor: '#decdba', inkWarmth: 15, ruleWarmth: 15, surfaceSep: 140, glowTargets: ['buttons', 'avatar', 'accentText'], glowStrength: 20, ruleContrast: 14 },
      { pop: '#cbd5fb', hour: 9, page: '#d5e0fc', inkWarmth: 80, ruleWarmth: 30, ruleContrast: 6 },
      { pop: '#8db7f4', hour: 10, page: '#cee7fd', inkWarmth: 45, ruleWarmth: 15, surfaceSep: 140, inkContrast: 2, ruleContrast: 4 },
      { hour: 11, page: '#e9f8fb', inkWarmth: 80, ruleWarmth: 50, surfaceSep: 140, ruleContrast: 2 },
      { hour: 12, page: '#f1fcfe' },
      { hour: 13, page: '#f0fcfe', inkWarmth: 60, ruleWarmth: 35, surfaceSep: 200, inkContrast: 6, ruleContrast: 10 },
      { pop: '#9ee8fa', hour: 14, page: '#d8f5fd', inkWarmth: 30, ruleWarmth: 50, surfaceSep: 160, inkContrast: 4, ruleContrast: 10 },
      { pop: '#bfe6fd', hour: 15, glowSize: 16, inkWarmth: 50, ruleWarmth: 75, surfaceSep: 150, glowTargets: ['buttons', 'avatar'], glowStrength: 20, ruleContrast: 2 },
      { pop: '#bae4fc', hour: 16, page: '#b5e0fc', inkWarmth: 65, ruleWarmth: 65, surfaceSep: 110, inkContrast: 2, ruleContrast: 6 },
      { pop: '#c4c5f7', hour: 17, page: '#a9c6f9', glowSize: 34, glowColor: '#a8a9f0', inkWarmth: 65, ruleWarmth: 70, surfaceSep: 140, glowTargets: ['buttons', 'avatar', 'accentText'], glowStrength: 25, ruleContrast: 2 },
      { pop: '#5b4cd2', hour: 18, page: '#909fea', glowSize: 18, glowColor: '#ca696b', inkWarmth: 55, ruleWarmth: 5, surfaceSep: 90, glowTargets: ['buttons', 'avatar', 'accentText'], inkContrast: 10, glowStrength: 20, ruleContrast: 10 },
      { hour: 19, page: '#41358d', glowSize: 10, inkWarmth: 45, ruleWarmth: 25, surfaceSep: 140, glowTargets: ['buttons', 'avatar', 'accentText'], inkContrast: 4, glowStrength: 25 },
      { hour: 20, glowSize: 30, inkWarmth: 55, ruleWarmth: 30, glowTargets: ['buttons', 'avatar', 'accentText'], glowStrength: 15 },
    ],
  },
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const TUNED = effectiveSkyTuning(SKY_RECORD);
const worst = (c, grounds) => Math.min(...grounds.map((g) => contrastRatio(c, g)));

describe.each([
  ['the live tuning', TUNED],
  ['the built-in palette', null],
])('the contrast floor, with %s', (_, tuning) => {
  it.each(HOURS)('hour %i: faint, muted and accent clear the floor on --page', (h) => {
    const v = paletteForHour(h, tuning).vars;
    const page = v['--sky-page'];
    expect(contrastRatio(v['--sky-ink-faint'], page)).toBeGreaterThanOrEqual(SKY_TEXT_FLOOR);
    expect(contrastRatio(v['--sky-ink-muted'], page)).toBeGreaterThanOrEqual(SKY_TEXT_FLOOR);
    expect(contrastRatio(v['--sky-accent'], page)).toBeGreaterThanOrEqual(SKY_TEXT_FLOOR);
  });

  it.each(HOURS)('hour %i: the ramp keeps its order (faint < muted <= soft <= ink)', (h) => {
    const v = paletteForHour(h, tuning).vars;
    const page = v['--sky-page'];
    const faint = contrastRatio(v['--sky-ink-faint'], page);
    const muted = contrastRatio(v['--sky-ink-muted'], page);
    const soft = contrastRatio(v['--sky-ink-soft'], page);
    const ink = contrastRatio(v['--sky-ink'], page);
    // Where the page leaves the primary ink itself barely 5:1 (the untuned
    // 7am sunrise) the quiet tones meet the ink, so allow a tie, never a
    // visible inversion.
    expect(muted).toBeGreaterThan(faint);
    expect(soft).toBeGreaterThanOrEqual(muted - 0.05);
    expect(ink).toBeGreaterThanOrEqual(soft - 0.05);
  });

  it.each(HOURS)('hour %i: the chrome pair clears both bar surfaces', (h) => {
    const v = paletteForHour(h, tuning).vars;
    const grounds = [v['--sky-surface-raised'], v['--sky-surface-deep']];
    // A quiet ink can't out-contrast the primary ink, so on a ground the
    // ink itself fails (only the untuned 7am chrome) the floor is the ink.
    const floor = Math.min(SKY_TEXT_FLOOR, worst(v['--sky-ink'], grounds));
    expect(worst(v['--sky-ink-faint-raised'], grounds)).toBeGreaterThanOrEqual(floor);
    expect(worst(v['--sky-ink-muted-raised'], grounds)).toBeGreaterThanOrEqual(floor);
  });

  it.each(HOURS)('hour %i: the card inks clear the quote and link surfaces', (h) => {
    const v = paletteForHour(h, tuning).vars;
    for (const level of [1, 2]) {
      const card = mixOklab(v['--sky-ink'], v['--sky-page'], level * NEST_STEP);
      const floor = Math.min(SKY_TEXT_FLOOR, contrastRatio(v['--sky-ink'], card));
      expect(contrastRatio(v['--sky-ink-faint-nest'], card)).toBeGreaterThanOrEqual(floor);
      expect(contrastRatio(v['--sky-accent-nest'], card)).toBeGreaterThanOrEqual(floor);
    }
  });

  it.each(HOURS)('hour %i: a filled label (--page on --accent-fill) clears the floor', (h) => {
    const v = paletteForHour(h, tuning).vars;
    // theme.css: --accent-fill is the accent mixed 15% toward the ink.
    const fill = mixSrgb(v['--sky-accent'], v['--sky-ink'], 0.85);
    expect(contrastRatio(v['--sky-page'], fill)).toBeGreaterThanOrEqual(SKY_TEXT_FLOOR);
  });
});

describe('skyHourLabel', () => {
  it('writes the hour with a capital AM or PM', () => {
    expect(skyHourLabel(0)).toBe('12 AM');
    expect(skyHourLabel(9)).toBe('9 AM');
    expect(skyHourLabel(12)).toBe('12 PM');
    expect(skyHourLabel(21)).toBe('9 PM');
  });

  it('leaves the key, which names the avatar files, lowercase', () => {
    expect(skyHourKey(21)).toBe('9pm');
  });
});

describe('the contrast floor keeps each hour its own colour', () => {
  it('lands on the values the design audit solved for', () => {
    // docs/design-audit/index.html#c-02, the contrast strip.
    expect(paletteForHour(0, TUNED).vars['--sky-ink-faint']).toBe('#728686');
    expect(paletteForHour(6, TUNED).vars['--sky-ink-faint']).toBe('#a59b9e');
    // 1pm lands a shade deeper than the audit's #367d82: the floor also
    // measures the page inks against --surface-deep, the ground of the sheets
    // that draw page-level text, which the audit's strip didn't.
    expect(paletteForHour(13, TUNED).vars['--sky-ink-faint']).toBe('#34777c');
    expect(paletteForHour(19, TUNED).vars['--sky-ink-faint']).toBe('#c0a9c4');
    expect(paletteForHour(21, TUNED).vars['--sky-ink-faint']).toBe('#877f92');
  });

  it('never moves an ink that already clears', () => {
    const vars = {
      '--sky-page': '#ffffff',
      '--sky-ink': '#111111',
      '--sky-ink-soft': '#333333',
      '--sky-ink-muted': '#555555',
      '--sky-ink-faint': '#666666',
      '--sky-accent': '#1a4d8f',
      '--sky-surface-raised': '#eeeeee',
      '--sky-surface-deep': '#f6f6f6',
      '--sky-ink-faint-raised': '#555555',
      '--sky-ink-muted-raised': '#444444',
    };
    const out = solveContrast({ ...vars });
    for (const k of Object.keys(vars)) expect(out[k]).toBe(vars[k]);
  });

  it('keeps 1pm in-page surfaces off the chrome-strength cyan', () => {
    // surfaceSep 200 at 1pm separates the chrome; it used to scale the
    // image mats too, which came out #b7f1fa.
    const v = paletteForHour(13, TUNED).vars;
    expect(v['--sky-page-edge']).not.toBe('#b7f1fa');
    expect(contrastRatio(v['--sky-page-edge'], v['--sky-page'])).toBeLessThan(1.15);
  });
});

const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

// The build's copy of the owner's tuning. public/data/ is gitignored and only
// written by scripts/prefetch.mjs, so the tests that need it skip without it.
const SNAPSHOT = root('public/data/sky.json');
const snapshotTuning = existsSync(SNAPSHOT)
  ? effectiveSkyTuning(JSON.parse(readFileSync(SNAPSHOT, 'utf8')))
  : null;

// An override pushed as far toward the page as the knobs go: full warmth
// toward a pop the same tone as the page, and contrast pulled backwards.
// The floor has to hold even against that.
function hostileTuning() {
  const hours = {};
  for (const h of HOURS) {
    const page = paletteForHour(h, null).vars['--sky-page'];
    hours[h] = {
      pop: page,
      page: null,
      surfaceSep: 1,
      ruleWarmth: 1,
      ruleContrast: -0.3,
      inkWarmth: 1,
      inkContrast: -0.3,
      glowColor: page,
      glowSize: 16,
      glowStrength: 0,
      glowTargets: {},
    };
  }
  return { enabled: true, hours };
}

const TUNINGS = [
  ['the built-in palette', null],
  ['a hostile override', hostileTuning()],
  ...(snapshotTuning ? [['the snapshot tuning', snapshotTuning]] : []),
];

describe('sky palette contrast floor', () => {
  for (const [label, tuning] of TUNINGS) {
    it(`keeps every text ink at AA against its ground, under ${label}`, () => {
      for (const h of HOURS) {
        const v = paletteForHour(h, tuning).vars;
        const onPage = [v['--sky-page'], v['--sky-surface-deep']];
        for (const ink of [
          '--sky-ink-soft',
          '--sky-ink-muted',
          '--sky-ink-faint',
        ]) {
          for (const bg of onPage) {
            expect(
              contrastRatio(v[ink], bg),
              `${ink} at ${h}h`,
            ).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
          }
        }
        // The untuned 7am chrome is a mid-tone that not even black clears
        // 4.5:1 on — it is the hour the studio's seeded contrast fix exists
        // for. Where the floor can't be met, the ink must at least have gone
        // as far as it can.
        const raised = v['--sky-surface-raised'];
        const extreme = paletteForHour(h, tuning).day ? '#000000' : '#ffffff';
        for (const ink of [
          '--sky-ink-muted-raised',
          '--sky-ink-faint-raised',
        ]) {
          if (contrastRatio(extreme, raised) < TEXT_CONTRAST_MIN) {
            expect(v[ink], `${ink} at ${h}h`).toBe(extreme);
          } else {
            expect(
              contrastRatio(v[ink], raised),
              `${ink} at ${h}h`,
            ).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
          }
        }
        expect(
          contrastRatio(v['--sky-accent'], v['--sky-page']),
        ).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
        // Destructive text is drawn on all three grounds.
        const grounds = [...onPage, raised];
        const worst = (c) =>
          Math.min(...grounds.map((bg) => contrastRatio(c, bg)));
        if (worst(extreme) < TEXT_CONTRAST_MIN) {
          expect(v['--sky-danger'], `--sky-danger at ${h}h`).toBe(extreme);
        } else {
          expect(
            worst(v['--sky-danger']),
            `--sky-danger at ${h}h`,
          ).toBeGreaterThanOrEqual(TEXT_CONTRAST_MIN);
        }
      }
    });
  }

  it('keeps --sky-danger red, and leaves the plain mix where it already clears', () => {
    // Midnight: theme.css's color-mix(#d4483a 74%, ink) on its own.
    expect(paletteForHour(0, null).vars['--sky-danger']).toBe('#d77167');
    for (const [, tuning] of TUNINGS) {
      for (const h of HOURS) {
        const d = paletteForHour(h, tuning).vars['--sky-danger'];
        if (d === '#000000' || d === '#ffffff') continue;
        const [r, g, b] = d
          .slice(1)
          .match(/../g)
          .map((x) => parseInt(x, 16));
        expect(r, `--sky-danger at ${h}h`).toBeGreaterThan(Math.max(g, b));
      }
    }
  });

  it('keeps muted ink a step stronger than faint ink', () => {
    for (const [, tuning] of TUNINGS) {
      for (const h of HOURS) {
        const v = paletteForHour(h, tuning).vars;
        const page = v['--sky-page'];
        expect(contrastRatio(v['--sky-ink-muted'], page)).toBeGreaterThan(
          contrastRatio(v['--sky-ink-faint'], page),
        );
      }
    }
  });

  it('leaves inks that already clear the floor alone', () => {
    // Midnight's muted ink sat at 6.9:1 before the floor existed.
    expect(paletteForHour(0, null).vars['--sky-ink-muted']).toBe('#93a5a5');
  });
});

describe("index.html's boot paint", () => {
  const source = readFileSync(root('index.html'), 'utf8');

  // Run the page's inline boot script the way a browser does before the
  // bundle arrives: against a document still holding the two static
  // theme-color metas, at a fixed instant.
  function bootAt(html, instant) {
    const script = html
      .match(/<script>([\s\S]*?)<\/script>/g)
      .find((tag) => tag.includes('var SKY_BOOT'))
      .replace(/^<script>|<\/script>$/g, '');
    const removed = [];
    const parentNode = { removeChild: (el) => removed.push(el) };
    const metas = [
      { content: '#e3d8ba', parentNode },
      { content: '#13180f', parentNode },
    ];
    const attrs = {};
    const props = {};
    const style = { setProperty: (k, v) => (props[k] = v), colorScheme: '' };
    const appended = [];
    const document = {
      documentElement: { setAttribute: (k, v) => (attrs[k] = v), style },
      querySelectorAll: () => metas,
      createElement: () => {
        const el = { attrs: {} };
        el.setAttribute = (k, v) => (el.attrs[k] = v);
        return el;
      },
      head: { appendChild: (el) => appended.push(el) },
    };
    class FixedDate extends Date {
      constructor(...args) {
        super(...(args.length ? args : [instant]));
      }
    }
    new Function('document', 'Date', script)(document, FixedDate);
    return {
      theme: attrs['data-theme'],
      page: props['--sky-page'],
      scheme: style.colorScheme,
      metas: appended.map((el) => [el.attrs.name, el.attrs.content]),
      removed: removed.length,
    };
  }

  // One instant per Eastern hour, in summer and in winter time.
  const INSTANTS = HOURS.flatMap((h) => [
    new Date(Date.UTC(2026, 6, 15, 4 + h, 30)),
    new Date(Date.UTC(2026, 0, 15, 5 + h, 30)),
  ]);

  // An override that moves the 9am page, to prove the table follows the
  // tuning it was built from rather than the built-in derivation.
  const RETUNED = { enabled: true, hours: { 9: { page: '#123456' } } };

  it('holds the marker the build fills, exactly once', () => {
    expect(source.split(SKY_BOOT_MARKER)).toHaveLength(2);
    expect(() => injectSkyBoot('<html></html>')).toThrow(SKY_BOOT_MARKER);
  });

  const BUILDS = [
    ['without a snapshot', null],
    ['under a retuned hour', RETUNED],
    ...(snapshotTuning ? [['under the snapshot tuning', snapshotTuning]] : []),
  ];

  for (const [label, tuning] of BUILDS) {
    it(`paints what the bundle paints at every hour, ${label}`, () => {
      const html = injectSkyBoot(source, tuning);
      for (const instant of INSTANTS) {
        const palette = paletteForHour(easternHour(instant), tuning);
        const at = instant.toISOString();
        expect(bootAt(html, instant), at).toEqual({
          theme: 'sky',
          page: palette.vars['--sky-page'],
          scheme: palette.colorScheme,
          metas: [['theme-color', palette.themeColor]],
          removed: 2,
        });
      }
    });
  }

  it('reaches the retuned page only through the tuning', () => {
    const at9 = new Date(Date.UTC(2026, 6, 15, 13, 30));
    expect(bootAt(injectSkyBoot(source, RETUNED), at9).page).toBe('#123456');
    expect(bootAt(injectSkyBoot(source, null), at9).page).not.toBe('#123456');
  });
});
