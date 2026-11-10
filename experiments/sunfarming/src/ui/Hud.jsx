// Everything drawn over the island: the purse and the clock, the meters, the
// tools, the goal, and the few cards that open on top. It reads a snapshot of
// the running game and calls back into it; it holds no game state of its own.

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { KINDS } from '../sim/catalog.js';
import { SPEEDS } from '../sunfarm.js';
import { TITLE } from '../meta.js';
import {
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
  MinusIcon,
  MoonIcon,
  PanelIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RemoveIcon,
  RestartIcon,
  SKY_ICONS,
  ShrinkIcon,
  SunIcon,
  TrackerIcon,
  TurbineIcon,
  TurnLeftIcon,
  TurnRightIcon,
} from './icons.jsx';

const TOOL_LOOK = {
  tool: 'look',
  label: 'Look',
  Icon: LookIcon,
  hint: 'Drag to move the view. Tap a tile to read it.',
};
const TOOL_REMOVE = {
  tool: 'remove',
  label: 'Remove',
  Icon: RemoveIcon,
  hint: 'Take a building back up, or clear a tree or rock.',
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

export default function Hud({ farm, host, fill }) {
  const s = useSyncExternalStore(farm.subscribe, farm.getSnapshot);
  const [card, setCard] = useState(() => (hasSeenHelp() ? null : 'help'));
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const battery = s.capacityKwh > 0;
  const free = s.island.free;
  const dawn = [];
  if (s.dawn.moves) dawn.push('a family moves in');
  if (s.dawn.upgrades === 1) dawn.push('a home moves up');
  else if (s.dawn.upgrades > 1) dawn.push(`${s.dawn.upgrades} homes move up`);
  const tools = [
    TOOL_LOOK,
    ...s.tools.map((t) => ({
      ...t,
      ...BUILD[t.tool],
      hint: KINDS[t.tool].blurb,
    })),
    TOOL_REMOVE,
  ];

  return (
    <div className="sunfarm-hud">
      <div className="sunfarm-top">
        <button
          type="button"
          className="sunfarm-btn sunfarm-pill sunfarm-pill--isle"
          onClick={() => setCard('chart')}
          title="The islands"
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
        <div className="sunfarm-pill">
          {s.daylight ? <SunIcon /> : <MoonIcon />}
          <span>
            Day {s.day}
            <span aria-hidden="true">{' · '}</span>
            {s.clock}
            {s.season && (
              <span className="sunfarm-pill-extra">{` · ${s.season}`}</span>
            )}
          </span>
        </div>
        <div
          className="sunfarm-pill sunfarm-forecast"
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
          label="Sun & wind"
          value={s.clean === null ? 'No power yet' : `${s.clean}% today`}
          share={(s.clean || 0) / 100}
          tone="share"
        >
          <SunIcon size={18} />
        </Meter>
        <Meter
          label="Making"
          value={
            s.makingKw > 0 || s.peakKw > 0
              ? `${s.makingKw.toFixed(1)} kW${s.shaded ? ` · ${s.shaded} shaded` : ''}`
              : 'Nothing built'
          }
          share={
            s.peakKw > 0
              ? Math.min(1, s.makingKw / s.peakKw)
              : s.makingKw > 0
                ? 1
                : 0
          }
          tone={
            s.makingKw > 0 || s.peakKw > 0 ? 'sun' : 'sun sunfarm-meter--none'
          }
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
          share={s.wantedKw > 0 ? s.dieselKw / s.wantedKw : 0}
          tone={s.dieselKw > 0 ? 'diesel' : 'diesel sunfarm-meter--none'}
        >
          <GeneratorIcon size={18} />
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
                  <span className="sunfarm-tool-cost">Locked</span>
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
          <p className="sunfarm-card-small">
            Drag to move the view. Right-drag or twist two fingers to turn it.
            Pinch, or hold ctrl and scroll, to zoom. Number keys pick a tool;
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
          <div className="sunfarm-card-foot">
            <button
              type="button"
              className="sunfarm-btn sunfarm-btn--plain"
              onClick={copyResult}
            >
              {copied ? 'Copied' : 'Copy result'}
            </button>
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
