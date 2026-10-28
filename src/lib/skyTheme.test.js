import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  contrastRatio,
  paletteForHour,
  TEXT_CONTRAST_MIN,
} from './skyTheme.js';
import { effectiveSkyTuning } from './skyTuning.js';
import { injectSkyBoot, SKY_BOOT_MARKER } from './skyBoot.js';
import { easternHour } from '../../og/time.js';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
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
