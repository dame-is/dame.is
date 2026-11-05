// One overlay, drawn on its 1920x1080 canvas. Used twice: by the public page
// (/overlay/:id, what OBS loads) at full size, and by the admin's Overlays
// studio as a scaled preview of the draft. It owns no data: the config, the
// hour and the chat are handed to it.
//
// The palette is the hour's sky (lib/skyTheme.js), set on the canvas itself
// rather than on <html>, so the studio can preview 7pm while the admin around
// it is painted for 2pm. theme.css maps the real tokens (--page, --ink…) onto
// the --sky-* ones at <html>, where they resolve once, so setting --sky-* on a
// child would change nothing: both names are written here.

import { memo, useMemo } from 'react';
import { paletteForHour } from '../lib/skyTheme.js';
import {
  CANVAS_H,
  CANVAS_W,
  CELL,
  MARGIN_X,
  MARGIN_Y,
  PITCH,
  boxOf,
} from '../lib/overlay.js';
import { WIDGET_COMPONENTS } from './widgets.jsx';
import './overlay.css';

/** The hour's palette as inline custom properties, under both names. */
export function paletteStyle(hour) {
  const { vars, colorScheme } = paletteForHour(hour);
  const style = { colorScheme };
  for (const [name, value] of Object.entries(vars)) {
    style[name] = value;
    style[name.replace(/^--sky-/, '--')] = value;
  }
  return style;
}

/**
 * The page colour with a hole cut for each capture frame, as one even-odd
 * path, so a screen share's captures show through the overlay in OBS while
 * the frame around them is the page.
 */
function backdropPath(widgets) {
  let d = `M0 0H${CANVAS_W}V${CANVAS_H}H0Z`;
  for (const w of widgets) {
    if (w.kind !== 'frame') continue;
    const b = boxOf(w);
    d += `M${b.left} ${b.top}h${b.width}v${b.height}h${-b.width}Z`;
  }
  return d;
}

function OverlayCanvas({ config, hour, demo = false, chat = null, className = '' }) {
  const palette = useMemo(() => paletteStyle(hour), [hour]);
  const style = useMemo(
    () => ({
      ...palette,
      '--ov-cell': `${CELL}px`,
      '--ov-pitch': `${PITCH}px`,
      '--ov-mx': `${MARGIN_X}px`,
      '--ov-my': `${MARGIN_Y}px`,
    }),
    [palette],
  );
  return (
    <div
      className={`ov-canvas ${className}`.trim()}
      style={style}
      data-backdrop={config.backdrop}
      data-day={palette.colorScheme === 'light' ? '' : undefined}
    >
      {config.backdrop === 'page' ? (
        <svg className="ov-backdrop" viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`} aria-hidden="true">
          <path d={backdropPath(config.widgets)} fillRule="evenodd" />
        </svg>
      ) : null}
      {config.grid ? <div className="ov-grid" aria-hidden="true" /> : null}
      {config.widgets.map((w, i) => {
        const Widget = WIDGET_COMPONENTS[w.kind];
        if (!Widget) return null;
        const b = boxOf(w);
        return (
          <section
            // Index and kind: two widgets of one kind are allowed, and a
            // reorder in the studio is rare enough that a remount is fine.
            key={`${i}-${w.kind}`}
            className={`ov-w ov-w-${w.kind}`}
            data-surface={w.surface}
            data-align={w.align}
            style={{
              left: b.left,
              top: b.top,
              width: b.width,
              height: b.height,
              '--ov-scale': w.scale / 100,
            }}
          >
            <Widget widget={w} hour={hour} demo={demo} chat={chat} />
          </section>
        );
      })}
    </div>
  );
}

export default memo(OverlayCanvas);
