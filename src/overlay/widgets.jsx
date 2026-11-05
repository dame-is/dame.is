// The overlay's widgets: one component per kind in lib/overlay.js WIDGETS.
//
// Each is drawn inside a box of whole grid cells (OverlayCanvas places the
// box), in the site's own voice: Crimson Pro, the small-caps label over a
// reading the way the ledger sets "dame is listening" over a track, square
// corners, hairline rules, and the hour's sky palette. They read the same
// live sources the chrome bar does (the hooks below share the 30s refresh
// tick and a module-level memory), so the overlay says what the site says.
//
// `demo` fills a widget whose source has nothing yet with an example, so it
// can be placed in the studio before there is anything to show. On stream it
// is off, and a widget with nothing to say shows a quiet dash.

import { useRef } from 'react';
import { useNowStatus } from '../hooks/useNowStatus.js';
import { useNowPlaying } from '../hooks/useNowPlaying.js';
import { useDameState } from '../hooks/useDameState.js';
import { useLiveDayOfLife } from '../hooks/useLiveDayOfLife.js';
import { useAlbumArt } from '../hooks/useAlbumArt.js';
import { activityLabel } from '../lib/activity.js';
import { relativeTime } from '../lib/time.js';
import { vitalsFreshness } from '../lib/vitals.js';
import { skyAvatarUrl } from '../lib/skyAvatars.js';
import { countdownLeft } from '../lib/overlay.js';
import { DASH, Label, useTicker } from './parts.jsx';
import PoeWidget from './PoeWidget.jsx';
import { AtmosphereWidget } from './atmosphereWidgets.jsx';
import { TextWidget, TidWidget } from './wordWidgets.jsx';
import { DEMO_CHAT } from '../lib/overlayStream.js';
import { ME_HANDLE } from '../config.js';

/* --- the widgets ----------------------------------------------------------- */

function TitleWidget({ widget }) {
  return (
    <>
      <Label widget={widget} />
      {widget.text ? (
        <h1 className="ov-title" data-size={widget.size}>
          {widget.text}
        </h1>
      ) : null}
      {widget.subtitle ? <p className="ov-sub">{widget.subtitle}</p> : null}
    </>
  );
}

function CountdownWidget({ widget }) {
  // A timer runs from when the overlay was shown: in OBS, from when the
  // browser source loaded, which is when the scene went up.
  const started = useRef(Date.now());
  const now = useTicker(1000);
  const left = countdownLeft(widget, now, started.current);
  return (
    <>
      <Label widget={widget} />
      {left ? (
        <p className="ov-figure ov-figure-big">{left}</p>
      ) : (
        <p className="ov-reading">{widget.done || DASH}</p>
      )}
    </>
  );
}

const CLOCK_FORMATS = new Map();
function clockFormat(zone, seconds) {
  const key = `${zone}|${seconds}`;
  if (!CLOCK_FORMATS.has(key)) {
    CLOCK_FORMATS.set(
      key,
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        ...(seconds ? { second: '2-digit' } : {}),
        ...(zone === 'eastern' ? { timeZone: 'America/New_York' } : {}),
      }),
    );
  }
  return CLOCK_FORMATS.get(key);
}

function ClockWidget({ widget }) {
  const now = useTicker(widget.seconds ? 1000 : 15_000);
  // "7:42 pm", the way the site prints a time: lower-case, no dots.
  const time = clockFormat(widget.zone, widget.seconds).format(now).replace(/\s?(AM|PM)$/, (_, m) => ` ${m.toLowerCase()}`);
  return (
    <>
      <Label widget={widget} fallback={widget.zone === 'eastern' ? 'in new york' : ''} />
      <p className="ov-figure">{time}</p>
    </>
  );
}

function DayWidget({ widget }) {
  const snap = useLiveDayOfLife();
  return (
    <>
      <Label widget={widget} />
      <p className="ov-figure">
        {snap.day.toLocaleString('en-US')}
        <span className="ov-figure-meta"> year {snap.year}</span>
      </p>
    </>
  );
}

function StatusWidget({ widget, demo }) {
  const { record } = useNowStatus();
  const text = record?.value?.status || (demo ? 'making a stream overlay' : '');
  const at = record?.value?.createdAt;
  return (
    <>
      <Label widget={widget} />
      <p className="ov-reading">
        {text || DASH}
        {text && at ? <span className="ov-meta"> {relativeTime(at)}</span> : null}
      </p>
    </>
  );
}

function MusicWidget({ widget, demo }) {
  const play = useNowPlaying();
  const payload = play?.raw?.value?.item || play?.raw?.value || null;
  const art = useAlbumArt(widget.art && play?.track ? payload : null, { size: 300 });
  const cover = art.status === 'hit' ? art.art?.url : null;
  const track = play?.track || (demo ? 'Raven' : '');
  const artist = play?.track ? play.artist : demo ? 'Kelela' : '';
  // The kind's own label says "is listening"; a play that has ended is said
  // in the past tense, the way the chrome dates it.
  const own = typeof widget.label !== 'string';
  const label = own && play && !play.live ? 'dame was listening' : undefined;
  return (
    <div className="ov-row">
      {widget.art ? (
        <span className="ov-art" aria-hidden="true">
          {cover ? <img src={cover} alt="" /> : null}
        </span>
      ) : null}
      <div className="ov-col">
        {label ? <p className="ov-label">{label}</p> : <Label widget={widget} />}
        <p className="ov-reading">
          {track ? (
            <>
              <strong>{track}</strong>
              {artist ? <span className="ov-soft"> by {artist}</span> : null}
            </>
          ) : (
            DASH
          )}
        </p>
      </div>
    </div>
  );
}

function VitalsWidget({ widget, demo }) {
  const { vitals } = useDameState();
  const fresh = vitals ? vitalsFreshness(vitals.sampledAt) : null;
  const v =
    vitals && !fresh?.expired
      ? vitals
      : demo
        ? { heartRate: 72, activity: 'stationary', batteryLevel: 84, soundLevel: 41 }
        : null;
  const parts = [];
  if (v?.heartRate) parts.push(['♥', `${v.heartRate}`, 'bpm']);
  if (v?.activity) parts.push(['', activityLabel(v.activity) || v.activity, '']);
  if (v?.batteryLevel) parts.push(['', `${v.batteryLevel}%`, v.charging ? 'charging' : 'battery']);
  if (v?.soundLevel) parts.push(['', `${v.soundLevel}`, 'dB']);
  return (
    <>
      <Label widget={widget} />
      <p className="ov-reading ov-vitals" data-stale={vitals && fresh?.stale ? '' : undefined}>
        {parts.length
          ? parts.map(([glyph, value, unit], i) => (
              <span key={i} className="ov-vital">
                {glyph ? <span className="ov-vital-glyph">{glyph} </span> : null}
                {value}
                {unit ? <span className="ov-meta"> {unit}</span> : null}
              </span>
            ))
          : DASH}
      </p>
    </>
  );
}

function ChatWidget({ widget, chat, demo }) {
  const list =
    chat && chat.length
      ? chat
      : demo
        ? DEMO_CHAT.map((m, i) => ({ id: `demo-${i}`, handle: m.handle, text: m.text }))
        : [];
  const shown = list.slice(-widget.max);
  return (
    <>
      <Label widget={widget} />
      {shown.length ? (
        <ol className="ov-chat">
          {shown.map((m) => (
            <li key={m.id} className="ov-chat-line">
              <span className="ov-chat-who">{m.handle ? `@${m.handle}` : 'someone'}</span>{' '}
              <span className="ov-chat-text">{m.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="ov-meta ov-chat-empty">say hello in the chat</p>
      )}
    </>
  );
}

/**
 * A capture frame draws nothing inside: it is a window for a source in OBS.
 * Its name only shows on stream as a nameplate at its foot, when asked for
 * (a camera's "dame"); the studio shows every frame's name on its own layer.
 */
function FrameWidget({ widget }) {
  return widget.plate && widget.text ? <p className="ov-frame-plate">{widget.text}</p> : null;
}

function MarkWidget({ widget, hour }) {
  const src = widget.art ? skyAvatarUrl(hour) : null;
  return (
    <div className="ov-row ov-mark">
      {src ? <img className="ov-mark-img" src={src} alt="" /> : null}
      <div className="ov-col">
        <Label widget={widget} />
        <p className="ov-wordmark">{ME_HANDLE}</p>
      </div>
    </div>
  );
}

function LinksWidget({ widget }) {
  // The studio's draft keeps the empty line being typed; the screen doesn't.
  const lines = (widget.lines || []).map((l) => l.trim()).filter(Boolean);
  return (
    <>
      <Label widget={widget} />
      <ul className="ov-links">
        {(lines.length ? lines : [DASH]).map((line, i) => (
          <li key={i} className="ov-reading">
            {line}
          </li>
        ))}
      </ul>
    </>
  );
}

export const WIDGET_COMPONENTS = {
  title: TitleWidget,
  text: TextWidget,
  tid: TidWidget,
  atmosphere: AtmosphereWidget,
  poe: PoeWidget,
  countdown: CountdownWidget,
  clock: ClockWidget,
  day: DayWidget,
  status: StatusWidget,
  music: MusicWidget,
  vitals: VitalsWidget,
  chat: ChatWidget,
  frame: FrameWidget,
  mark: MarkWidget,
  links: LinksWidget,
};
