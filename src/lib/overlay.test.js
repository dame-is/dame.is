import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CANVAS_H,
  CANVAS_W,
  CELL,
  COLS,
  GUTTER,
  MARGIN_X,
  MARGIN_Y,
  OVERLAY_NSID,
  PRESETS,
  ROWS,
  WIDGET_KINDS,
  WIDGETS,
  boxOf,
  cellAt,
  cleanWidget,
  countdownLeft,
  fromRecord,
  isOverlayId,
  labelOf,
  moveWidget,
  newOverlayId,
  newWidget,
  resizeWidget,
  sameOverlay,
  toRecord,
} from './overlay.js';

const lexicon = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../lexicons/is.dame.overlay.json'),
    'utf8',
  ),
);

describe('the canvas grid', () => {
  it('is the site grid: a 92px column on a 24px gutter, centred on 1920x1080', () => {
    expect(CELL).toBe(92);
    expect(GUTTER).toBe(24);
    expect(MARGIN_X).toBe(44);
    expect(MARGIN_Y).toBe(30);
    // the last column ends where the right margin starts
    const last = boxOf({ col: COLS, row: ROWS, cols: 1, rows: 1 });
    expect(last.left + last.width).toBe(CANVAS_W - MARGIN_X);
    expect(last.top + last.height).toBe(CANVAS_H - MARGIN_Y);
  });

  it('spans whole cells and the gutters between them', () => {
    expect(boxOf({ col: 1, row: 1, cols: 3, rows: 2 })).toEqual({
      left: 44,
      top: 30,
      width: 3 * 92 + 2 * 24,
      height: 2 * 92 + 24,
    });
  });

  it('finds the cell under a point, pinned to the grid', () => {
    expect(cellAt(44, 30)).toEqual({ col: 1, row: 1 });
    expect(cellAt(44 + 116 * 5 + 10, 30 + 116 * 2 + 10)).toEqual({ col: 6, row: 3 });
    expect(cellAt(-500, -500)).toEqual({ col: 1, row: 1 });
    expect(cellAt(5000, 5000)).toEqual({ col: COLS, row: ROWS });
  });
});

describe('widgets', () => {
  it('drops what is not a widget', () => {
    expect(cleanWidget(null)).toBeNull();
    expect(cleanWidget({ kind: 'nope', col: 1, row: 1, cols: 1, rows: 1 })).toBeNull();
  });

  it('keeps a box on the grid', () => {
    const w = cleanWidget({ kind: 'status', col: 14, row: 9, cols: 8, rows: 4 });
    expect(w).toMatchObject({ col: 14, row: 9, cols: 3, rows: 1 });
    expect(cleanWidget({ kind: 'status', col: 99, row: -3, cols: 1, rows: 1 })).toMatchObject({ col: 16, row: 1 });
  });

  it('keeps only the options its kind reads', () => {
    const w = cleanWidget({ kind: 'clock', col: 1, row: 1, cols: 2, rows: 1, text: 'hi', lines: ['a'], seconds: true });
    expect(w.text).toBeUndefined();
    expect(w.lines).toBeUndefined();
    expect(w.seconds).toBe(true);
    expect(w.zone).toBe('eastern');
  });

  it('cleans words: control characters out, one line, cut short', () => {
    const w = cleanWidget({ kind: 'title', col: 1, row: 1, cols: 2, rows: 1, text: ' a\u0000\n  b ', subtitle: 'x'.repeat(500) });
    expect(w.text).toBe('a b');
    expect(w.subtitle).toHaveLength(240);
  });

  it('never gives a frame a plate', () => {
    expect(cleanWidget({ kind: 'frame', col: 1, row: 1, cols: 2, rows: 2, surface: 'raised' }).surface).toBe('none');
  });

  it('keeps a label three ways: its own, a chosen one, or none', () => {
    const base = { kind: 'music', col: 1, row: 1, cols: 2, rows: 1 };
    expect(labelOf(cleanWidget(base))).toBe('dame is listening');
    expect(labelOf(cleanWidget({ ...base, label: 'on the stereo' }))).toBe('on the stereo');
    expect(labelOf(cleanWidget({ ...base, label: '' }))).toBe('');
  });

  it('places a new one where its box is free', () => {
    const first = newWidget('status', []);
    expect(first).toMatchObject({ col: 1, row: 1, cols: 5, rows: 1 });
    const second = newWidget('status', [first]);
    expect(second).toMatchObject({ col: 6, row: 1 });
  });

  it('moves and resizes inside the grid', () => {
    const w = cleanWidget({ kind: 'status', col: 1, row: 1, cols: 5, rows: 1 });
    expect(moveWidget(w, 15, 9)).toMatchObject({ col: 12, row: 9 });
    expect(resizeWidget(w, 0, 0)).toMatchObject({ cols: 1, rows: 1 });
    expect(resizeWidget(w, 40, 40)).toMatchObject({ cols: 16, rows: 9 });
  });
});

describe('records', () => {
  it('reads anything as an overlay', () => {
    expect(fromRecord(null)).toEqual({ name: '', backdrop: 'transparent', hour: null, grid: false, widgets: [] });
    expect(fromRecord({ backdrop: 'page', hour: 25, grid: 'yes', widgets: [{ kind: 'x' }] })).toMatchObject({
      backdrop: 'page',
      hour: null,
      grid: false,
      widgets: [],
    });
  });

  it('writes what it reads', () => {
    const preset = PRESETS.find((p) => p.key === 'starting').config;
    const record = toRecord(preset, { createdAt: '2026-11-01T00:00:00.000Z', now: new Date('2026-11-05T00:00:00Z') });
    expect(record.$type).toBe(OVERLAY_NSID);
    expect(record.createdAt).toBe('2026-11-01T00:00:00.000Z');
    expect(record.updatedAt).toBe('2026-11-05T00:00:00.000Z');
    expect(record).not.toHaveProperty('hour');
    expect(sameOverlay(fromRecord(record), preset)).toBe(true);
  });

  it('writes a fixed hour, and only a whole one', () => {
    expect(toRecord({ ...fromRecord({}), hour: 19 }).hour).toBe(19);
  });
});

describe('the lexicon', () => {
  it('names every widget kind the model knows, and no others', () => {
    expect(lexicon.id).toBe(OVERLAY_NSID);
    expect(lexicon.defs.widget.properties.kind.knownValues).toEqual([...WIDGET_KINDS]);
    expect(Object.keys(WIDGETS)).toEqual([...WIDGET_KINDS]);
  });

  it('bounds the grid as the model does', () => {
    const p = lexicon.defs.widget.properties;
    expect(p.col.maximum).toBe(COLS);
    expect(p.row.maximum).toBe(ROWS);
  });

  it('every preset survives its own record', () => {
    for (const p of PRESETS) {
      for (const w of p.config.widgets) expect(w).not.toBeNull();
      expect(sameOverlay(fromRecord(toRecord(p.config)), p.config)).toBe(true);
    }
  });
});

describe('ids', () => {
  it('slugs a name and steps past taken ones', () => {
    expect(newOverlayId('Just Chatting!')).toBe('just-chatting');
    expect(newOverlayId('Just Chatting', ['just-chatting'])).toBe('just-chatting-2');
    expect(newOverlayId('   ')).toBe('overlay');
    expect(isOverlayId('starting-soon')).toBe(true);
    expect(isOverlayId('Starting')).toBe(false);
    expect(isOverlayId('a.b')).toBe(false);
  });
});

describe('countdown', () => {
  it('counts a timer down from when it was shown', () => {
    const w = { mode: 'timer', minutes: 5 };
    expect(countdownLeft(w, 0, 0)).toBe('5:00');
    expect(countdownLeft(w, 61_000, 0)).toBe('3:59');
    expect(countdownLeft(w, 300_000, 0)).toBeNull();
  });

  it('counts to a time, with hours past the hour', () => {
    const w = { mode: 'until', at: '2026-11-05T20:00:00.000Z' };
    const now = Date.parse('2026-11-05T18:29:30.000Z');
    expect(countdownLeft(w, now, 0)).toBe('1:30:30');
    expect(countdownLeft({ mode: 'until' }, now, 0)).toBeNull();
  });
});
