// What Poe hears and what it says back, for one Poe widget: the wiring that
// atpota.to's overlay does in website/src/overlay/index.ts, around a mounted
// potato (mount.js).
//
//   the weather   the shared atmosphere reading (lib/atmosphere.js): its pace
//                 sets Poe's breathing, and what changes between readings
//                 becomes weather alerts, each kind at most once in a while
//   the stream    events from the overlay page's bus (pages/Overlay.jsx, from
//                 lib/overlayStream.js): chat, follows, the stream going live
//                 and ending. A first message gets a hello, a regular's a
//                 welcome back; !weather, !forecast, !apps, !pet and !poe get
//                 answers, each person's at most every 30 seconds
//   demo          example lines every DEMO_MS, for placing Poe in the studio
//
// The widget's switches (greet, follows, alerts) gate what it says; what it
// hears is the same either way.

import { alertsFor, forecastPoll, nowPoll, recordsPerSecond } from '../../lib/atmosphere.js';
import { getProfile } from '../../lib/atproto.js';
import { safeAvatar } from '../../lib/overlayStream.js';
import {
  ARRIVAL_EVERY_MS,
  COMMAND_ANY_MS,
  COMMAND_EACH_MS,
  COOLDOWN_MS,
  alertLine,
  appsLine,
  createGate,
  createRegulars,
  demoLines,
  endedLine,
  followLine,
  forecastLine,
  helloLine,
  liveLine,
  petLine,
  poeLine,
  weatherLine,
} from './lines.js';

export const DEMO_MS = 10_000;

const NOBODY = Object.freeze({ handle: null, avatar: null });
const HANDLE_RE = /^[a-z0-9][a-z0-9.-]{0,252}$/i;
const HANDLE_MAX = 32;

/** "@dame.is", cut to HANDLE_MAX, or null for an account without a working handle. */
export function atHandle(handle) {
  if (typeof handle !== 'string' || !HANDLE_RE.test(handle) || handle === 'handle.invalid') return null;
  return `@${handle.length > HANDLE_MAX ? `${handle.slice(0, HANDLE_MAX - 1)}…` : handle}`;
}

/** Handles and avatars, asked for once each per page. */
const known = new Map();
export function whoIs(did) {
  let who = known.get(did);
  if (!who) {
    who = getProfile(did)
      .then((p) => ({ handle: atHandle(p?.handle), avatar: safeAvatar(p?.avatar) }))
      .catch(() => NOBODY);
    known.set(did, who);
  }
  return who;
}

/**
 * Starts Poe listening. `getWidget()` reads the widget's switches as they are
 * now (the studio and a live save both change them under a running Poe).
 * Returns the stop function.
 */
export function startPoe(poe, { getWidget, bus = null, demo = false, streamer = null }) {
  const gate = createGate();
  const regulars = createRegulars();
  const stops = [];
  let latest = nowPoll.get();
  let watch = null;
  let forecast = null;

  stops.push(
    nowPoll.subscribe((reading) => {
      latest = reading;
      poe.setPace(recordsPerSecond(reading));
      const seen = alertsFor(watch, reading);
      watch = seen.watch;
      if (!getWidget().alerts || demo) return;
      for (const alert of seen.alerts) {
        if (gate(`alert:${alert.kind}`, alert.kind === 'arrival' ? ARRIVAL_EVERY_MS : COOLDOWN_MS)) poe.say(alertLine(alert));
      }
    }),
  );
  // The forecast is only read for !forecast, so it is listened to lazily.
  let unForecast = null;
  const readForecast = () => {
    if (!unForecast) {
      unForecast = forecastPoll.subscribe((f) => {
        forecast = f;
      });
      stops.push(() => unForecast());
    }
    return new Promise((resolve) => {
      if (forecast) resolve(forecast);
      else setTimeout(() => resolve(forecast), 4000);
    });
  };

  if (demo) {
    const lines = demoLines();
    let i = 0;
    const say = () => poe.say(lines[i++ % lines.length]());
    const first = setTimeout(say, 1500);
    const every = setInterval(say, DEMO_MS);
    stops.push(() => {
      clearTimeout(first);
      clearInterval(every);
    });
  }

  const said = new Set();
  const onEvent = async (e) => {
    const w = getWidget();
    if (e.type === 'live' || e.type === 'ended') {
      if (said.has(`${e.type}:${e.rkey}`)) return;
      said.add(`${e.type}:${e.rkey}`);
      poe.say(e.type === 'live' ? liveLine(e.title) : endedLine());
      return;
    }
    if (e.type === 'follow') {
      poe.stir();
      if (w.follows && gate(`follow:${e.did}`, Infinity)) poe.say(followLine(await whoIs(e.did)));
      return;
    }
    if (e.type !== 'chat') return;
    poe.stir();
    if (!w.greet) return;
    const greeting = e.did === streamer ? null : regulars.greet(e.did);
    if (e.command) {
      if (!gate(`${e.command}:${e.did}`, COMMAND_EACH_MS) || !gate(e.command, COMMAND_ANY_MS)) return;
      const who = e.command === 'poe' ? NOBODY : await whoIs(e.did);
      if (e.command === 'weather') poe.say(weatherLine(latest, who));
      else if (e.command === 'apps') poe.say(appsLine(latest, who));
      else if (e.command === 'forecast') poe.say(forecastLine(await readForecast(), who));
      else if (e.command === 'pet') poe.say(petLine(who));
      else poe.say(poeLine());
      return;
    }
    if (greeting) poe.say(helloLine(await whoIs(e.did), greeting === 'welcome-back'));
  };
  if (bus) stops.push(bus.on((e) => void onEvent(e)));

  return () => {
    for (const stop of stops) stop();
  };
}

/** A tiny event bus: the overlay page emits stream events, widgets listen. */
export function createBus() {
  const listeners = new Set();
  return {
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(e) {
      for (const fn of listeners) {
        try {
          fn(e);
        } catch {
          /* one listener failing must not stop the rest */
        }
      }
    },
  };
}
