// Everything drawn over the island: the purse and the clock, the meters, the
// tools, the goal, and the cards that open on top. It reads a snapshot of the
// running game and calls back into it; it holds no game state of its own.
//
// One set of markup serves a desk and a phone. The stylesheet does the
// layout from the game's own width (a container query): on a phone the
// meters shrink to a row of chips, the buttons fold into a menu, and cards
// come up from the bottom as sheets. `compact` below says which it is, for
// the few things that behave differently and aren't just laid out
// differently.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { KINDS } from '../sim/catalog.js';
import { SPEEDS } from '../sunfarm.js';
import { TITLE } from '../meta.js';
import Board from './Board.jsx';
import {
  BackIcon,
  BankIcon,
  BatteryIcon,
  BoltIcon,
  CableIcon,
  ChartIcon,
  CheckIcon,
  CloseIcon,
  CoinIcon,
  ExpandIcon,
  FlagIcon,
  GeneratorIcon,
  HelpIcon,
  HouseIcon,
  LockIcon,
  LookIcon,
  MenuIcon,
  MinusIcon,
  MoonIcon,
  PanelIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RemoveIcon,
  RestartIcon,
  ResultsIcon,
  SKY_ICONS,
  ShrinkIcon,
  SoundOffIcon,
  SoundOnIcon,
  SunIcon,
  TrackerIcon,
  TurbineIcon,
  TurnLeftIcon,
  TurnRightIcon,
} from './icons.jsx';

const TOOL_LOOK = {
  tool: 'look',
  label: 'Look',
  name: 'Look',
  Icon: LookIcon,
  hint: 'Drag to move the view. Tap a tile to read it.',
};
const TOOL_REMOVE = {
  tool: 'remove',
  label: 'Remove',
  name: 'Remove',
  Icon: RemoveIcon,
  hint: 'Take a building back up for what it cost, or clear a tree or rock.',
};
const BUILD = {
  panel: { label: 'Panel', Icon: PanelIcon },
  tracker: { label: 'Tracker', Icon: TrackerIcon },
  turbine: { label: 'Turbine', Icon: TurbineIcon },
  battery: { label: 'Battery', Icon: BatteryIcon },
  bank: { label: 'Bank', Icon: BankIcon },
  cable: { label: 'Line', Icon: CableIcon },
};

const SEEN_KEY = 'sunfarming:seen:v2';
/**
 * The game's own size at and under which it hasn't room for the full HUD: a
 * phone either way up, a tablet held upright, a small window. The same two
 * numbers the stylesheet's container queries turn at.
 */
const COMPACT_WIDTH = 1000;
const COMPACT_HEIGHT = 520;
const isCompact = (width, height) =>
  width <= COMPACT_WIDTH || height <= COMPACT_HEIGHT;

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

// Whether the game is small enough to be laid out with the compact HUD
// (meters as chips that open on a tap, and the rest behind a menu).
function useCompact(host) {
  const [compact, setCompact] = useState(
    () => Boolean(host) && isCompact(host.clientWidth, host.clientHeight),
  );
  useEffect(() => {
    if (!host || typeof ResizeObserver === 'undefined') return undefined;
    const watcher = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setCompact(isCompact(width, height));
    });
    watcher.observe(host);
    return () => watcher.disconnect();
  }, [host]);
  return compact;
}

// One reading: a label, a value, and a bar. On a phone the label and the bar
// go and `short` stands in for the value, which makes it a chip.
function Meter({ label, value, short, share, tone, children }) {
  return (
    <div className={`sunfarm-meter sunfarm-meter--${tone}`}>
      <span className="sunfarm-meter-icon">{children}</span>
      <span className="sunfarm-meter-text">
        <span className="sunfarm-meter-label">{label}</span>
        <span className="sunfarm-meter-value">{value}</span>
        <span className="sunfarm-meter-short" aria-hidden="true">
          {short}
        </span>
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

// One island on the chart: its name, what is different about it, and where
// it stands (finished, under way, open, or still locked).
function Island({ entry, onSail }) {
  const status = entry.done
    ? `On the sun in ${entry.done} days`
    : !entry.open
      ? 'Locked'
      : entry.started
        ? 'Under way'
        : 'Not started';
  return (
    <li
      className={`sunfarm-isle${entry.current ? ' is-current' : ''}${entry.open ? '' : ' is-locked'}`}
    >
      <span className="sunfarm-isle-mark">
        {entry.done ? (
          <CheckIcon size={16} />
        ) : entry.open ? null : (
          <LockIcon size={15} />
        )}
      </span>
      <span className="sunfarm-isle-text">
        <span className="sunfarm-isle-name">{entry.name}</span>
        <span className="sunfarm-isle-blurb">{entry.blurb}</span>
        <span className="sunfarm-isle-status">{status}</span>
      </span>
      {entry.current ? (
        <span className="sunfarm-isle-here">Here</span>
      ) : (
        <button
          type="button"
          className="sunfarm-btn sunfarm-btn--plain sunfarm-btn--small"
          disabled={!entry.open}
          onClick={() => onSail(entry.id)}
        >
          Sail
        </button>
      )}
    </li>
  );
}

// Today and the three days after it, as icons with their names.
function Forecast({ days }) {
  return (
    <ul className="sunfarm-outlook">
      {days.map((sky, i) => {
        const Icon = SKY_ICONS[sky.key] || SunIcon;
        return (
          <li key={i}>
            <Icon size={24} />
            <span className="sunfarm-outlook-when">
              {i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `+${i} days`}
            </span>
            <span className="sunfarm-outlook-sky">{sky.name}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function Hud({ farm, host, fill, social, onExit, exitLabel }) {
  const s = useSyncExternalStore(farm.subscribe, farm.getSnapshot);
  const [card, setCard] = useState(() => (hasSeenHelp() ? null : 'help'));
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const compact = useCompact(host);

  const refocus = useCallback(
    () => host?.focus({ preventScroll: true }),
    [host],
  );

  const close = useCallback(() => {
    setCard((open) => {
      if (open === 'help') markHelpSeen();
      return null;
    });
    refocus();
  }, [refocus]);

  // The island waits while a card is open over it.
  const open = card || (s.finished ? 'finished' : null);
  useEffect(() => {
    if (!open) return undefined;
    const was = farm.getSnapshot().paused;
    farm.setPaused(true);
    return () => farm.setPaused(was);
  }, [open, farm]);

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
    const overlay = () => {
      host.classList.toggle('sunfarm--expanded');
      setExpanded(host.classList.contains('sunfarm--expanded'));
    };
    if (document.fullscreenElement === host) document.exitFullscreen?.();
    else if (host.requestFullscreen) host.requestFullscreen().catch(overlay);
    else overlay();
  };

  const sail = (id) => {
    farm.openIsland(id);
    setCard(null);
    refocus();
  };

  const copyResult = () => {
    const text = farm.shareText();
    if (!text || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  // Came back from signing in with a result posted on the way: show the board.
  const returned = social?.returned;
  useEffect(() => {
    if (returned) setCard('board');
  }, [returned]);

  const battery = s.capacityKwh > 0;
  const free = s.island.free;
  const making = s.makingKw > 0 || s.peakKw > 0;
  const dawn = [];
  if (s.dawn.moves) dawn.push('a family moves in');
  if (s.dawn.upgrades === 1) dawn.push('a home moves up');
  else if (s.dawn.upgrades > 1) dawn.push(`${s.dawn.upgrades} homes move up`);
  const tools = [
    TOOL_LOOK,
    ...s.tools.map((t) => ({
      ...t,
      ...BUILD[t.tool],
      name: KINDS[t.tool].name,
      hint: KINDS[t.tool].blurb,
    })),
    TOOL_REMOVE,
  ];
  const inHand = tools.find((t) => t.tool === s.tool);
  // Real full screen where the browser has it. Where it doesn't, the game is
  // laid over the window instead, which is no use if it already has it all.
  const canFullscreen =
    !fill ||
    (typeof document !== 'undefined' && Boolean(document.fullscreenEnabled));
  const leave = exitLabel ? `Back to ${exitLabel}` : 'Leave the game';
  const TodaySky = SKY_ICONS[s.forecast[0].key] || SunIcon;
  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}`
      : '';
  const compose = `https://bsky.app/intent/compose?text=${encodeURIComponent(
    `${farm.shareText()} ${shareUrl}`.trim(),
  )}`;

  return (
    <div className={`sunfarm-hud${compact ? ' is-compact' : ''}`}>
      <div className={`sunfarm-top${onExit ? ' has-exit' : ''}`}>
        {/* The way back out, when the game has been given the whole window
            by a host that has somewhere to go back to. */}
        {onExit && (
          <button
            type="button"
            className="sunfarm-btn sunfarm-pill sunfarm-pill--exit"
            onClick={onExit}
            title={leave}
            aria-label={leave}
          >
            <BackIcon />
            <span className="sunfarm-pill-name">{exitLabel || 'Exit'}</span>
          </button>
        )}
        <button
          type="button"
          className="sunfarm-btn sunfarm-pill sunfarm-pill--isle"
          onClick={() => setCard('chart')}
          title="The islands"
          aria-label={`The islands. This is ${s.island.name}.`}
        >
          <ChartIcon />
          <span className="sunfarm-pill-name">{s.island.name}</span>
        </button>
        <div className="sunfarm-pill sunfarm-pill--coins" title="Coins">
          <CoinIcon />
          <span className="sunfarm-pill-number">
            {free ? '∞' : s.coins.toLocaleString('en-US')}
          </span>
          <span className="sunfarm-sr">coins</span>
        </div>
        <div className="sunfarm-pill sunfarm-pill--clock">
          {s.daylight ? <SunIcon /> : <MoonIcon />}
          <span>
            <span className="sunfarm-wide">Day {s.day} · </span>
            <span className="sunfarm-narrow">D{s.day} </span>
            {s.clock}
            {s.season && (
              <span className="sunfarm-wide">{` · ${s.season}`}</span>
            )}
          </span>
          <span
            className="sunfarm-narrow sunfarm-pill-sky"
            title={s.forecast[0].name}
          >
            <TodaySky size={18} />
          </span>
        </div>
        <div
          className="sunfarm-pill sunfarm-forecast sunfarm-wide"
          role="group"
          aria-label="Weather"
        >
          {s.forecast.map((sky, i) => {
            const Icon = SKY_ICONS[sky.key] || SunIcon;
            const when =
              i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `In ${i} days`;
            return (
              <span
                key={i}
                className={i === 0 ? 'is-today' : undefined}
                title={`${when}: ${sky.name}`}
              >
                <Icon size={i === 0 ? 22 : 18} />
                <span className="sunfarm-sr">{`${when}: ${sky.name}. `}</span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="sunfarm-top-end">
        {social && (
          <button
            type="button"
            className="sunfarm-btn sunfarm-btn--round sunfarm-wide"
            onClick={() => setCard('board')}
            aria-label="Results"
            title="Results"
          >
            <ResultsIcon />
          </button>
        )}
        <button
          type="button"
          className="sunfarm-btn sunfarm-btn--round sunfarm-wide"
          onClick={() => setCard('goals')}
          aria-label="Goals"
          title="Goals"
        >
          <FlagIcon />
        </button>
        <button
          type="button"
          className="sunfarm-btn sunfarm-btn--round sunfarm-wide"
          onClick={() => setCard('help')}
          aria-label="How to play"
          title="How to play"
        >
          <HelpIcon />
        </button>
        <button
          type="button"
          className="sunfarm-btn sunfarm-btn--round sunfarm-wide"
          onClick={() => farm.setMuted(!s.muted)}
          aria-label={s.muted ? 'Turn sound on' : 'Turn sound off'}
          aria-pressed={!s.muted}
          title={s.muted ? 'Sound is off' : 'Sound is on'}
        >
          {s.muted ? <SoundOffIcon /> : <SoundOnIcon />}
        </button>
        {canFullscreen && (
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
        <button
          type="button"
          className="sunfarm-btn sunfarm-btn--round sunfarm-narrow"
          onClick={() => setCard('menu')}
          aria-label="Game menu"
        >
          <MenuIcon />
        </button>
      </div>

      <div
        className="sunfarm-meters"
        role="group"
        aria-label="Power"
        onClick={compact ? () => setCard('power') : undefined}
      >
        <Meter
          label="Sun & wind"
          value={s.clean === null ? 'No power yet' : `${s.clean}% today`}
          short={s.clean === null ? '–' : `${s.clean}%`}
          share={(s.clean || 0) / 100}
          tone="share"
        >
          <SunIcon size={18} />
        </Meter>
        <Meter
          label="Making"
          value={
            making
              ? `${s.makingKw.toFixed(1)} kW${s.shaded ? ` · ${s.shaded} shaded` : ''}`
              : 'Nothing built'
          }
          short={making ? s.makingKw.toFixed(1) : '–'}
          share={
            s.peakKw > 0
              ? Math.min(1, s.makingKw / s.peakKw)
              : s.makingKw > 0
                ? 1
                : 0
          }
          tone={making ? 'sun' : 'sun sunfarm-meter--none'}
        >
          <BoltIcon size={18} />
        </Meter>
        <Meter
          label="Generator"
          value={
            !s.generator
              ? 'Gone'
              : s.dieselKw > 0
                ? `${s.dieselKw.toFixed(1)} kW · fuel ${s.fuelToday}`
                : 'Silent'
          }
          short={
            !s.generator
              ? 'gone'
              : s.dieselKw > 0
                ? s.dieselKw.toFixed(1)
                : 'off'
          }
          share={s.wantedKw > 0 ? s.dieselKw / s.wantedKw : 0}
          tone={s.dieselKw > 0 ? 'diesel' : 'diesel sunfarm-meter--none'}
        >
          <GeneratorIcon size={18} />
        </Meter>
        <Meter
          label="Village"
          value={`${s.litHouses} of ${s.houses} lit`}
          short={`${s.litHouses}/${s.houses}`}
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
          short={
            battery
              ? `${Math.round((s.storedKwh / s.capacityKwh) * 100)}%`
              : '–'
          }
          share={battery ? s.storedKwh / s.capacityKwh : 0}
          tone={battery ? 'battery' : 'battery sunfarm-meter--none'}
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

      {s.info && !open && (
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
        {/* On a phone nothing can be hovered, so the tool in hand says what
            it is and what it does, just above the tools. */}
        {inHand && inHand.tool !== 'look' && (
          <p className="sunfarm-hint">
            <strong>{inHand.name}</strong>
            {inHand.cost ? ` · ${inHand.cost}` : ''}
            <span>{` ${inHand.hint}`}</span>
          </p>
        )}

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
          {tools.map(
            ({ tool, label, Icon, cost, hint, locked, afford, unlock }, i) => (
              <button
                key={tool}
                type="button"
                className={`sunfarm-btn sunfarm-tool${locked ? ' sunfarm-tool--locked' : ''}${
                  cost && afford === false && !locked
                    ? ' sunfarm-tool--short'
                    : ''
                }`}
                aria-pressed={s.tool === tool}
                aria-label={locked ? `${label}, locked: ${unlock}` : undefined}
                onClick={() => farm.setTool(s.tool === tool ? 'look' : tool)}
                title={locked ? `${label}. ${unlock}.` : `${hint} (${i + 1})`}
              >
                <span className="sunfarm-tool-icon">
                  <Icon size={26} />
                  {locked && (
                    <span className="sunfarm-tool-lock">
                      <LockIcon size={14} />
                    </span>
                  )}
                </span>
                <span className="sunfarm-tool-label">{label}</span>
                {locked ? (
                  <span className="sunfarm-tool-cost sunfarm-tool-cost--locked">
                    Locked
                  </span>
                ) : cost ? (
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
                    {free && tool !== 'look' && tool !== 'remove'
                      ? 'Free'
                      : i + 1}
                  </span>
                )}
              </button>
            ),
          )}
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

      {card === 'menu' && (
        <Card title={s.island.name} onClose={close}>
          <div className="sunfarm-menu">
            <button
              type="button"
              className="sunfarm-btn sunfarm-menu-item"
              onClick={() => setCard('chart')}
            >
              <ChartIcon />
              The islands
            </button>
            <button
              type="button"
              className="sunfarm-btn sunfarm-menu-item"
              onClick={() => setCard('goals')}
            >
              <FlagIcon />
              Goals
            </button>
            {social && (
              <button
                type="button"
                className="sunfarm-btn sunfarm-menu-item"
                onClick={() => setCard('board')}
              >
                <ResultsIcon />
                Results
              </button>
            )}
            <button
              type="button"
              className="sunfarm-btn sunfarm-menu-item"
              onClick={() => setCard('help')}
            >
              <HelpIcon />
              How to play
            </button>
            <button
              type="button"
              className="sunfarm-btn sunfarm-menu-item"
              aria-pressed={!s.muted}
              onClick={() => farm.setMuted(!s.muted)}
            >
              {s.muted ? <SoundOffIcon /> : <SoundOnIcon />}
              Sound: {s.muted ? 'off' : 'on'}
            </button>
            {onExit && (
              <button
                type="button"
                className="sunfarm-btn sunfarm-menu-item"
                onClick={onExit}
              >
                <BackIcon />
                {leave}
              </button>
            )}
          </div>
          <Forecast days={s.forecast} />
        </Card>
      )}

      {card === 'power' && (
        <Card title="Power" onClose={close}>
          <dl className="sunfarm-readings">
            <div>
              <dt>From sun and wind today</dt>
              <dd>{s.clean === null ? 'No power yet' : `${s.clean}%`}</dd>
            </div>
            <div>
              <dt>Making now</dt>
              <dd>
                {making ? `${s.makingKw.toFixed(1)} kW` : 'Nothing built'}
                {s.shaded ? ` (${s.shaded} in shade)` : ''}
              </dd>
            </div>
            <div>
              <dt>Generator</dt>
              <dd>
                {!s.generator
                  ? 'Gone'
                  : s.dieselKw > 0
                    ? `${s.dieselKw.toFixed(1)} kW, fuel ${s.fuelToday} today`
                    : 'Silent'}
              </dd>
            </div>
            <div>
              <dt>Village</dt>
              <dd>
                {s.litHouses} of {s.houses} lit, wants {s.wantedKw.toFixed(1)}{' '}
                kW
              </dd>
            </div>
            <div>
              <dt>Stored</dt>
              <dd>
                {battery
                  ? `${s.storedKwh.toFixed(1)} of ${s.capacityKwh} kWh`
                  : 'No batteries'}
              </dd>
            </div>
          </dl>
          <Forecast days={s.forecast} />
        </Card>
      )}

      {card === 'help' && (
        <Card title={TITLE} onClose={close} wide>
          <p className="sunfarm-card-lede">
            The island runs on a diesel generator. See how much of it the sun
            can take over.
          </p>
          <ol className="sunfarm-steps">
            <li>
              <PanelIcon />
              <span>
                <strong>Put down solar panels</strong> against the village’s
                power line. Things that touch share power. Every bit the sun
                makes is fuel the generator doesn’t burn.
              </span>
            </li>
            <li>
              <SunIcon />
              <span>
                <strong>Mind the shade.</strong> With a panel in hand the ground
                shows how much of the day’s light each tile gets. Trees and
                homes throw shadows.
              </span>
            </li>
            <li>
              <BatteryIcon />
              <span>
                <strong>Save some for the night.</strong> Batteries fill on
                spare sun and empty after dark, before the generator is asked.
              </span>
            </li>
            <li>
              <HouseIcon />
              <span>
                <strong>Watch the village grow.</strong> After a well powered
                day a family moves in and homes move up, wanting more power at
                harder hours, and new things to build turn up.
              </span>
            </li>
          </ol>
          <p className="sunfarm-card-small sunfarm-wide">
            Drag to move the view. Right-drag to turn it. Hold ctrl and scroll
            to zoom. Number keys pick a tool; space pauses.
          </p>
          <p className="sunfarm-card-small sunfarm-narrow">
            Tap to build. Drag to move the view, pinch to zoom, twist two
            fingers to turn. The power line is drawn with a drag.
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
        <Card title={s.island.name} onClose={close}>
          {s.goals.length > 0 ? (
            <ul className="sunfarm-goals">
              {s.goals.map((goal) => (
                <li
                  key={goal.key}
                  className={goal.done ? 'is-done' : undefined}
                >
                  <span className="sunfarm-goals-mark">
                    {goal.done ? <CheckIcon size={16} /> : null}
                  </span>
                  <span className="sunfarm-goals-title">{goal.title}</span>
                  <span className="sunfarm-goals-reward">+{goal.reward}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sunfarm-card-lede">
              No goals here. Build what you like.
            </p>
          )}
          <p className="sunfarm-card-small">
            The village:{' '}
            {s.tiers
              .map(
                (n, i) =>
                  `${n} ${s.tierNames[i].toLowerCase()}${n === 1 ? '' : 's'}`,
              )
              .join(', ')}
            {` on ${s.plots} plots.`}
          </p>
          <p className="sunfarm-card-small">
            {s.served === null
              ? 'Nothing has been asked for yet today.'
              : `So far today the village has had ${s.served}% of the power it wanted.`}{' '}
            {dawn.length > 0
              ? `At ${s.growAt}% by dawn, ${dawn.join(' and ')}.`
              : 'The village is as big and as grand as this island lets it be.'}
          </p>
        </Card>
      )}

      {card === 'chart' && (
        <Card title="The islands" onClose={close} wide>
          <ul className="sunfarm-isles">
            {s.chart.islands.map((entry) => (
              <Island key={entry.id} entry={entry} onSail={sail} />
            ))}
          </ul>
          <ul className="sunfarm-isles sunfarm-isles--extra">
            <Island entry={s.chart.today} onSail={sail} />
            <Island entry={s.chart.free} onSail={sail} />
          </ul>
          <p className="sunfarm-card-small">
            Each island opens when the one before it runs on the sun. What you
            learn to build comes with you.
          </p>
          <div className="sunfarm-card-foot">
            <button
              type="button"
              className="sunfarm-btn sunfarm-btn--plain"
              onClick={() => setCard('restart')}
            >
              <RestartIcon size={18} />
              Start this island over
            </button>
          </div>
        </Card>
      )}

      {card === 'restart' && (
        <Card title="Start over?" onClose={close}>
          <p className="sunfarm-card-lede">
            {s.island.name} goes back to the way it was found. Everything built
            on it is lost; the other islands are left alone.
          </p>
          <div className="sunfarm-card-foot">
            <button
              type="button"
              className="sunfarm-btn sunfarm-btn--plain"
              onClick={close}
            >
              Keep it
            </button>
            <button
              type="button"
              className="sunfarm-btn sunfarm-btn--primary"
              onClick={() => {
                farm.restart();
                setCard(null);
                refocus();
              }}
            >
              Start over
            </button>
          </div>
        </Card>
      )}

      {card === 'board' && social && (
        <Card title="Results" onClose={close} wide>
          <Board farm={farm} social={social} island={s.island} done={s.done} />
        </Card>
      )}

      {!card && s.finished && (
        <Card
          title={`${s.finished.name} runs on the sun`}
          onClose={() => {
            farm.acknowledge();
            setCopied(false);
            refocus();
          }}
          wide
        >
          <p className="sunfarm-card-lede">
            Every home lit, a whole day and night, and the generator never
            started. It took {s.finished.day} days.
          </p>
          <p className="sunfarm-card-small">
            The generator can go back on the boat now: the Remove tool will take
            it. Or stay a while and watch the place.
          </p>
          <div className="sunfarm-card-foot sunfarm-card-foot--wrap">
            {social ? (
              <button
                type="button"
                className="sunfarm-btn sunfarm-btn--plain"
                onClick={() => {
                  farm.acknowledge();
                  setCard('board');
                }}
              >
                <ResultsIcon size={18} />
                Post result
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="sunfarm-btn sunfarm-btn--plain"
                  onClick={copyResult}
                >
                  {copied ? 'Copied' : 'Copy result'}
                </button>
                <a
                  className="sunfarm-btn sunfarm-btn--plain"
                  href={compose}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Share on Bluesky
                </a>
              </>
            )}
            {s.finished.next ? (
              <button
                type="button"
                className="sunfarm-btn sunfarm-btn--primary"
                onClick={() => {
                  const { id } = s.finished.next;
                  farm.acknowledge();
                  setCopied(false);
                  sail(id);
                }}
              >
                Sail to {s.finished.next.name}
              </button>
            ) : (
              <button
                type="button"
                className="sunfarm-btn sunfarm-btn--primary"
                onClick={() => {
                  farm.acknowledge();
                  setCopied(false);
                  setCard('chart');
                }}
              >
                The islands
              </button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
