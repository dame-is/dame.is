// Everything drawn over the island: the purse and the clock, the meters, the
// tools, the goal, and the few cards that open on top. It reads a snapshot of
// the running game and calls back into it; it holds no game state of its own.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { KINDS } from '../sim/catalog.js';
import { SPEEDS } from '../sunfarm.js';
import { TITLE } from '../meta.js';
import {
  BatteryIcon,
  BoltIcon,
  CableIcon,
  CheckIcon,
  CloseIcon,
  CoinIcon,
  ExpandIcon,
  FlagIcon,
  HelpIcon,
  HouseIcon,
  LookIcon,
  MinusIcon,
  MoonIcon,
  PanelIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RemoveIcon,
  RestartIcon,
  ShrinkIcon,
  SunIcon,
  TurnLeftIcon,
  TurnRightIcon,
} from './icons.jsx';

const TOOLBAR = [
  {
    tool: 'look',
    label: 'Look',
    Icon: LookIcon,
    hint: 'Drag to move the view. Tap a tile to read it.',
  },
  {
    tool: 'panel',
    label: 'Panel',
    Icon: PanelIcon,
    cost: KINDS.panel.cost,
    hint: KINDS.panel.blurb,
  },
  {
    tool: 'battery',
    label: 'Battery',
    Icon: BatteryIcon,
    cost: KINDS.battery.cost,
    hint: KINDS.battery.blurb,
  },
  {
    tool: 'cable',
    label: 'Line',
    Icon: CableIcon,
    cost: KINDS.cable.cost,
    hint: KINDS.cable.blurb,
  },
  {
    tool: 'remove',
    label: 'Remove',
    Icon: RemoveIcon,
    hint: 'Take a building back up, or clear a tree or rock.',
  },
];

const SEEN_KEY = 'sunfarming:seen:v1';

function hasSeenHelp() {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true;
  }
}

function markHelpSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // It will be offered again next time, then.
  }
}

function Meter({ label, value, share, tone, children }) {
  return (
    <div className={`sunfarm-meter sunfarm-meter--${tone}`}>
      <span className="sunfarm-meter-icon">{children}</span>
      <span className="sunfarm-meter-text">
        <span className="sunfarm-meter-label">{label}</span>
        <span className="sunfarm-meter-value">{value}</span>
      </span>
      <span className="sunfarm-meter-bar" aria-hidden="true">
        <span
          style={{
            width: `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`,
          }}
        />
      </span>
    </div>
  );
}

function Card({ title, onClose, children, wide = false }) {
  return (
    <div
      className="sunfarm-veil"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className={`sunfarm-card${wide ? ' sunfarm-card--wide' : ''}`}
        role="dialog"
        aria-label={title}
      >
        <header className="sunfarm-card-head">
          <h2 className="sunfarm-card-title">{title}</h2>
          <button
            type="button"
            className="sunfarm-btn sunfarm-btn--round"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

export default function Hud({ farm, host, fill }) {
  const s = useSyncExternalStore(farm.subscribe, farm.getSnapshot);
  const [card, setCard] = useState(() => (hasSeenHelp() ? null : 'help'));
  const [expanded, setExpanded] = useState(false);

  const close = useCallback(() => {
    setCard((open) => {
      if (open === 'help') markHelpSeen();
      return null;
    });
    host?.focus({ preventScroll: true });
  }, [host]);

  // The island waits while a card is open over it.
  useEffect(() => {
    if (!card) return undefined;
    const was = farm.getSnapshot().paused;
    farm.setPaused(true);
    return () => farm.setPaused(was);
  }, [card, farm]);

  useEffect(() => {
    if (!card) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, close]);

  // Full screen where the browser has it; where it doesn't (an iPhone), the
  // game is laid over the whole window instead.
  useEffect(() => {
    const onChange = () => setExpanded(document.fullscreenElement === host);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [host]);

  const toggleExpanded = () => {
    if (!host) return;
    if (document.fullscreenElement === host) {
      document.exitFullscreen?.();
    } else if (host.requestFullscreen) {
      host.requestFullscreen().catch(() => {
        host.classList.toggle('sunfarm--expanded');
        setExpanded(host.classList.contains('sunfarm--expanded'));
      });
    } else {
      host.classList.toggle('sunfarm--expanded');
      setExpanded(host.classList.contains('sunfarm--expanded'));
    }
  };

  const battery = s.capacityKwh > 0;
  const flowNote =
    s.chargingKw > 0.05
      ? 'filling'
      : s.chargingKw < -0.05
        ? 'emptying'
        : s.storedKwh > 0.05
          ? 'holding'
          : 'empty';

  return (
    <div className="sunfarm-hud">
      <div className="sunfarm-top">
        <div className="sunfarm-pill sunfarm-pill--coins" title="Coins">
          <CoinIcon />
          <span className="sunfarm-pill-number">
            {s.coins.toLocaleString('en-US')}
          </span>
          <span className="sunfarm-sr">coins</span>
        </div>
        <div
          className="sunfarm-pill"
          title={`${s.todayShare}% of today's demand met so far`}
        >
          {s.daylight ? <SunIcon /> : <MoonIcon />}
          <span>
            Day {s.day}
            <span className="sunfarm-dot" aria-hidden="true">
              {' · '}
            </span>
            {s.clock}
          </span>
        </div>
      </div>

      <div className="sunfarm-top-end">
        <button
          type="button"
          className="sunfarm-btn sunfarm-btn--round"
          onClick={() => setCard('goals')}
          aria-label="Goals"
          title="Goals"
        >
          <FlagIcon />
        </button>
        <button
          type="button"
          className="sunfarm-btn sunfarm-btn--round"
          onClick={() => setCard('help')}
          aria-label="How to play"
          title="How to play"
        >
          <HelpIcon />
        </button>
        <button
          type="button"
          className="sunfarm-btn sunfarm-btn--round"
          onClick={() => setCard('restart')}
          aria-label="New island"
          title="New island"
        >
          <RestartIcon />
        </button>
        {!fill && (
          <button
            type="button"
            className="sunfarm-btn sunfarm-btn--round"
            onClick={toggleExpanded}
            aria-label={expanded ? 'Leave full screen' : 'Full screen'}
            title={expanded ? 'Leave full screen' : 'Full screen'}
          >
            {expanded ? <ShrinkIcon /> : <ExpandIcon />}
          </button>
        )}
      </div>

      <div className="sunfarm-meters" role="group" aria-label="Power">
        <Meter
          label="Solar"
          value={
            s.peakKw > 0
              ? `${s.makingKw.toFixed(1)} of ${s.peakKw} kW`
              : 'No panels'
          }
          share={s.peakKw > 0 ? s.makingKw / s.peakKw : 0}
          tone={s.peakKw > 0 ? 'sun' : 'sun sunfarm-meter--none'}
        >
          <BoltIcon size={18} />
        </Meter>
        <Meter
          label="Village"
          value={`${s.litHouses} of ${s.houses} lit`}
          share={s.wantedKw > 0 ? s.sentKw / s.wantedKw : 0}
          tone="village"
        >
          <HouseIcon size={18} />
        </Meter>
        <Meter
          label="Stored"
          value={
            battery
              ? `${s.storedKwh.toFixed(1)} of ${s.capacityKwh} kWh`
              : 'No batteries'
          }
          share={battery ? s.storedKwh / s.capacityKwh : 0}
          tone={`battery sunfarm-meter--${battery ? flowNote : 'none'}`}
        >
          <BatteryIcon size={18} />
        </Meter>
      </div>

      {s.goal && (
        <button
          type="button"
          className="sunfarm-goal"
          onClick={() => setCard('goals')}
        >
          <FlagIcon size={18} />
          <span className="sunfarm-goal-text">
            <span className="sunfarm-goal-title">{s.goal.title}</span>
            <span className="sunfarm-goal-hint">{s.goal.hint}</span>
          </span>
          <span className="sunfarm-goal-reward">+{s.goal.reward}</span>
        </button>
      )}

      <div className="sunfarm-toasts" aria-live="polite">
        {s.toasts.map((t) => (
          <p key={t.id} className={`sunfarm-toast sunfarm-toast--${t.tone}`}>
            {t.text}
          </p>
        ))}
      </div>

      {s.info && !card && (
        <div className="sunfarm-info">
          <p className="sunfarm-info-title">{s.info.title}</p>
          {s.info.lines.map((line) => (
            <p key={line} className="sunfarm-info-line">
              {line}
            </p>
          ))}
          {s.info.action && (
            <p className="sunfarm-info-action">{s.info.action}</p>
          )}
        </div>
      )}

      <div className="sunfarm-bottom">
        <div
          className="sunfarm-group sunfarm-speed"
          role="group"
          aria-label="Speed"
        >
          <button
            type="button"
            className="sunfarm-btn sunfarm-btn--seg"
            aria-pressed={s.paused}
            onClick={() => farm.setPaused(!s.paused)}
            aria-label={s.paused ? 'Resume' : 'Pause'}
            title={s.paused ? 'Resume (space)' : 'Pause (space)'}
          >
            {s.paused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
          </button>
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              className="sunfarm-btn sunfarm-btn--seg"
              aria-pressed={!s.paused && s.speed === speed}
              onClick={() => farm.setSpeed(speed)}
              aria-label={`${speed} times speed`}
            >
              {speed}×
            </button>
          ))}
        </div>

        <div
          className="sunfarm-group sunfarm-tools"
          role="toolbar"
          aria-label="Tools"
        >
          {TOOLBAR.map(({ tool, label, Icon, cost, hint }, i) => (
            <button
              key={tool}
              type="button"
              className={`sunfarm-btn sunfarm-tool${cost && !s.afford[tool] ? ' sunfarm-tool--short' : ''}`}
              aria-pressed={s.tool === tool}
              onClick={() => farm.setTool(s.tool === tool ? 'look' : tool)}
              title={`${hint} (${i + 1})`}
            >
              <Icon size={26} />
              <span className="sunfarm-tool-label">{label}</span>
              {cost ? (
                <span className="sunfarm-tool-cost">
                  <CoinIcon size={13} />
                  {cost}
                  <span className="sunfarm-sr"> coins</span>
                </span>
              ) : (
                <span
                  className="sunfarm-tool-cost sunfarm-tool-cost--key"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
              )}
            </button>
          ))}
        </div>

        <div
          className="sunfarm-group sunfarm-camera"
          role="group"
          aria-label="View"
        >
          <button
            type="button"
            className="sunfarm-btn sunfarm-btn--seg"
            onClick={() => farm.turn(-1)}
            aria-label="Turn the view left"
            title="Turn left (Q)"
          >
            <TurnLeftIcon size={18} />
          </button>
          <button
            type="button"
            className="sunfarm-btn sunfarm-btn--seg"
            onClick={() => farm.turn(1)}
            aria-label="Turn the view right"
            title="Turn right (E)"
          >
            <TurnRightIcon size={18} />
          </button>
          <button
            type="button"
            className="sunfarm-btn sunfarm-btn--seg"
            onClick={() => farm.zoom(1)}
            aria-label="Zoom in"
            title="Zoom in (+)"
          >
            <PlusIcon size={18} />
          </button>
          <button
            type="button"
            className="sunfarm-btn sunfarm-btn--seg"
            onClick={() => farm.zoom(-1)}
            aria-label="Zoom out"
            title="Zoom out (-)"
          >
            <MinusIcon size={18} />
          </button>
        </div>
      </div>

      {card === 'help' && (
        <Card title={TITLE} onClose={close} wide>
          <p className="sunfarm-card-lede">Power the village with sunshine.</p>
          <ol className="sunfarm-steps">
            <li>
              <PanelIcon />
              <span>
                <strong>Put down solar panels.</strong> They make power while
                the sun is up.
              </span>
            </li>
            <li>
              <CableIcon />
              <span>
                <strong>Wire them to the village.</strong> Things that touch
                share power; a power line crosses a gap.
              </span>
            </li>
            <li>
              <BatteryIcon />
              <span>
                <strong>Save some for the night.</strong> Batteries fill on
                spare sun and empty after dark. Houses pay for every bit of
                power they get.
              </span>
            </li>
            <li>
              <HouseIcon />
              <span>
                <strong>Grow the village.</strong> Keep it {s.growAt}% powered
                for a day and a new family moves in at dawn.
              </span>
            </li>
          </ol>
          <p className="sunfarm-card-small">
            Drag to move the view. Right-drag or twist two fingers to turn it.
            Pinch, or hold ctrl and scroll, to zoom. Keys 1 to 5 pick a tool;
            space pauses.
          </p>
          <div className="sunfarm-card-foot">
            <button
              type="button"
              className="sunfarm-btn sunfarm-btn--primary"
              onClick={close}
            >
              Start building
            </button>
          </div>
        </Card>
      )}

      {card === 'goals' && (
        <Card title="Goals" onClose={close}>
          <ul className="sunfarm-goals">
            {s.goals.map((goal) => (
              <li key={goal.key} className={goal.done ? 'is-done' : undefined}>
                <span className="sunfarm-goals-mark">
                  {goal.done ? <CheckIcon size={16} /> : null}
                </span>
                <span className="sunfarm-goals-title">{goal.title}</span>
                <span className="sunfarm-goals-reward">+{goal.reward}</span>
              </li>
            ))}
          </ul>
          <p className="sunfarm-card-small">
            Day so far: the village has had {s.todayShare}% of the power it
            wanted. At {s.growAt}% by dawn, a family moves in ({s.houses} of{' '}
            {s.plots} houses built).
          </p>
        </Card>
      )}

      {card === 'restart' && (
        <Card title="New island?" onClose={close}>
          <p className="sunfarm-card-lede">
            Start over on a different island. Everything built on this one is
            lost.
          </p>
          <div className="sunfarm-card-foot">
            <button
              type="button"
              className="sunfarm-btn sunfarm-btn--plain"
              onClick={close}
            >
              Keep this one
            </button>
            <button
              type="button"
              className="sunfarm-btn sunfarm-btn--primary"
              onClick={() => {
                farm.newIsland();
                setCard(null);
                host?.focus({ preventScroll: true });
              }}
            >
              New island
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
