// The atmosphere's weather, dame.is's way: the network's records a second and
// what they add up to, from atpota.to's weather station (lib/atmosphere.js),
// set in the site's own type on its grid rather than in atpotato's cards.
// One widget kind, six styles:
//
//   card      the figure, the condition in words, and where the records are from
//   strip     all of it on one line, for along the top or the bottom
//   badge     the condition and the figure, small
//   apps      the five busiest apps outside Bluesky, each with a hairline bar
//   forecast  the next six hours, an hour a column
//   pulse     the station's last minute as a line, a second a point
//
// App names are other people's words: text only, and only names the station
// let through as domains.

import { useEffect, useMemo, useState } from 'react';
import {
  CONDITION_TEXT,
  DEMO_FORECAST,
  DEMO_READING,
  forecastPoll,
  forecastWords,
  formatIndex,
  formatRate,
  hourLabel,
  nowPoll,
  recordsPerSecond,
} from '../lib/atmosphere.js';
import { DASH } from './parts.jsx';

/** Each style's own label, unless the widget sets one ('' drops it). */
const STYLE_LABEL = {
  card: 'the atmosphere',
  strip: 'the atmosphere',
  badge: 'the atmosphere',
  apps: 'busiest outside bluesky',
  forecast: 'the next hours',
  pulse: 'the last minute',
};

function labelText(widget) {
  return typeof widget.label === 'string' ? widget.label : STYLE_LABEL[widget.style] || 'the atmosphere';
}

function Label({ widget }) {
  const text = labelText(widget);
  return text ? <p className="ov-label">{text}</p> : null;
}

function usePoll(poll, demo, example) {
  const [value, setValue] = useState(() => poll.get());
  useEffect(() => poll.subscribe(setValue), [poll]);
  return value || (demo ? example : null);
}

const useReading = (demo) => usePoll(nowPoll, demo, DEMO_READING);
const useForecast = (demo) => usePoll(forecastPoll, demo, DEMO_FORECAST);

/** "gusty", the condition's first word, as the strip and badge say it. */
const conditionWord = (c) => CONDITION_TEXT[c].split('.')[0];

function Card({ widget, r }) {
  const d = r.diversity;
  return (
    <>
      <Label widget={widget} />
      <p className="ov-atm-figure">
        <span className="ov-figure">{formatRate(recordsPerSecond(r))}</span>
        <span className="ov-meta"> records a second</span>
      </p>
      <p className="ov-reading ov-atm-condition">{CONDITION_TEXT[r.condition]}</p>
      {r.records ? (
        <p className="ov-meta ov-atm-foot">
          bluesky {formatRate(r.records.bluesky)} · elsewhere {formatRate(r.records.elsewhere)}
          {d ? ` · diversity ${formatIndex(d.index)} ${d.level}` : ''}
        </p>
      ) : null}
    </>
  );
}

function Strip({ widget, r }) {
  const top = r.apps?.[0];
  const parts = [
    conditionWord(r.condition),
    `${formatRate(recordsPerSecond(r))} records a second`,
    `${formatRate(r.perSecond.posts)} posts`,
    `${formatRate(r.perSecond.likes)} likes`,
    r.diversity ? `diversity ${formatIndex(r.diversity.index)}` : null,
    top ? `busiest elsewhere: ${top.domain}` : null,
  ].filter(Boolean);
  return (
    <p className="ov-atm-strip">
      {labelText(widget) ? <span className="ov-label">{labelText(widget)}</span> : null}
      {parts.map((p, i) => (
        <span key={i} className={i === 0 ? 'ov-atm-strip-lead' : undefined}>
          {p}
        </span>
      ))}
    </p>
  );
}

function Badge({ widget, r }) {
  return (
    <>
      <Label widget={widget} />
      <p className="ov-reading">
        <em>{conditionWord(r.condition)}</em>
        <span className="ov-meta"> {formatRate(recordsPerSecond(r))} a second</span>
      </p>
    </>
  );
}

function Apps({ widget, r }) {
  const apps = (r.apps || []).slice(0, 5);
  const most = Math.max(...apps.map((a) => a.perSecond), 0.001);
  return (
    <>
      <Label widget={widget} />
      {apps.length ? (
        <ol className="ov-atm-apps">
          {apps.map((a) => (
            <li key={a.domain}>
              <span className="ov-atm-app">{a.domain}</span>
              <span className="ov-meta ov-atm-rate">{formatRate(a.perSecond)}/s</span>
              <span className="ov-atm-bar" style={{ '--share': Math.max(0.02, a.perSecond / most) }} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="ov-reading">all bluesky just now</p>
      )}
    </>
  );
}

function Forecast({ widget, demo }) {
  const f = useForecast(demo);
  if (!f) return <Fallback widget={widget} text="the forecast is on its way" />;
  if (f.learning || !f.hours.length) return <Fallback widget={widget} text="still learning the sky’s habits" />;
  const hours = f.hours.slice(0, 6);
  return (
    <>
      <Label widget={widget} />
      <ol className="ov-atm-hours">
        {hours.map((h) => (
          <li key={h.t}>
            <span className="ov-meta">{hourLabel(h.t)}</span>
            <span className="ov-figure ov-atm-hour-rate">{formatRate(h.perSecond)}</span>
            <span className="ov-label">{conditionWord(h.condition)}</span>
          </li>
        ))}
      </ol>
      <p className="ov-meta ov-atm-words">{forecastWords(hours)}</p>
    </>
  );
}

const PULSE_W = 600;
const PULSE_H = 200;

function Pulse({ widget, r }) {
  const points = useMemo(() => {
    const series = (r.series || []).filter(Boolean);
    if (series.length < 2) return null;
    const values = series.map((p) => p.creates);
    const hi = Math.max(...values);
    const lo = Math.min(...values);
    const span = Math.max(1, hi - lo);
    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * PULSE_W;
        const y = PULSE_H - 8 - ((v - lo) / span) * (PULSE_H - 16);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [r.series]);
  return (
    <>
      <div className="ov-atm-pulse-head">
        <Label widget={widget} />
        <span className="ov-meta">{formatRate(recordsPerSecond(r))} a second</span>
      </div>
      {points ? (
        <svg className="ov-atm-pulse" viewBox={`0 0 ${PULSE_W} ${PULSE_H}`} preserveAspectRatio="none" aria-hidden="true">
          <polygon className="ov-atm-pulse-area" points={`0,${PULSE_H} ${points} ${PULSE_W},${PULSE_H}`} />
          <polyline className="ov-atm-pulse-line" points={points} />
        </svg>
      ) : (
        <p className="ov-reading">{DASH}</p>
      )}
    </>
  );
}

function Fallback({ widget, text }) {
  return (
    <>
      <Label widget={widget} />
      <p className="ov-reading ov-soft">{text}</p>
    </>
  );
}

const STYLE_VIEWS = { card: Card, strip: Strip, badge: Badge, apps: Apps, pulse: Pulse };

export function AtmosphereWidget({ widget, demo }) {
  const r = useReading(demo);
  if (widget.style === 'forecast') return <Forecast widget={widget} demo={demo} />;
  if (!r) return <Fallback widget={widget} text="reading the sky…" />;
  const View = STYLE_VIEWS[widget.style] || Card;
  return <View widget={widget} r={r} />;
}
