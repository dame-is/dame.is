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
//
// On the tutorial island the goal's place is taken by the coach: the one
// line the lesson is saying, and a ring round whichever button it is
// pointing at. Where it points on the ground is the stage's to draw.
//
// Nothing here appears or disappears without getting there. A card that is
// closed leaves before the next one arrives (useStaged); going to another
// island happens behind a curtain of sea that comes up, shows where it is
// bound, and goes on up and away (the crossing); and the HUD settles into
// place on each island it arrives at.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { KINDS } from '../sim/catalog.js';
import { SPEEDS } from '../sunfarm.js';
import { TITLE } from '../meta.js';
import Board from './Board.jsx';
import {
  BackIcon,
  BoatIcon,
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

// Whether the card on screen is on its way out (see useStaged).
const Leaving = createContext(false);

function Card({ title, onClose, children, wide = false }) {
  const leaving = useContext(Leaving);
  return (
    <div
      className={`sunfarm-veil${leaving ? ' is-leaving' : ''}`}
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
function Island({ entry, onSail, lesson = false }) {
  const status = entry.done
    ? lesson
      ? 'Done'
      : `On the sun in ${entry.done} ${entry.done === 1 ? 'day' : 'days'}`
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
          {lesson && entry.done ? 'Replay' : 'Sail'}
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

/** How long a card takes to leave, which the stylesheet's exit matches. */
const LEAVE_MS = 150;

/**
 * What is on screen lags what was asked for by long enough for the old
 * thing to leave: `[shown, leaving]`. Asked for something else (or for
 * nothing), what is shown stays for a moment with `leaving` true, and only
 * then gives way.
 */
function useStaged(wanted, ms = LEAVE_MS) {
  const [shown, setShown] = useState(wanted);
  useEffect(() => {
    if (wanted === shown) return undefined;
    // Nothing to see off: the new thing can come straight in.
    if (shown === null) {
      setShown(wanted);
      return undefined;
    }
    const timer = setTimeout(() => setShown(wanted), ms);
    return () => clearTimeout(timer);
  }, [wanted, shown, ms]);
  return [shown, shown !== null && wanted !== shown];
}

/**
 * A crossing, in milliseconds: the sea comes up over the picture (`in`),
 * stays while the island underneath is changed (`hold`), and goes on up and
 * away (`out`). The stylesheet's animations are the same lengths.
 */
const CROSSING = Object.freeze({ in: 520, hold: 700, out: 640 });

// The edge of the water: two swells, drawn twice as wide as the picture so
// it can drift sideways for ever without a seam, with the ink along its top.
const SWELL =
  'M0 28C120 0 240 0 360 28S600 56 720 28 960 0 1080 28s240 28 360 0';

function Swell() {
  return (
    <svg
      className="sunfarm-sail-swell"
      viewBox="0 0 1440 56"
      preserveAspectRatio="none"
      focusable="false"
    >
      <path d={`${SWELL}V57H0z`} />
      <path className="sunfarm-sail-edge" d={SWELL} />
    </svg>
  );
}

// The curtain itself: foam, then sea, with a sign on it saying where to.
function Crossing({ phase, kicker, name, blurb }) {
  return (
    <div className={`sunfarm-sail is-${phase}`} role="status">
      {['foam', 'sea'].map((layer) => (
        <span
          key={layer}
          className={`sunfarm-sail-water sunfarm-sail-water--${layer}`}
          aria-hidden="true"
        >
          <Swell />
          <i />
          <Swell />
        </span>
      ))}
      <div className="sunfarm-sail-sign">
        <BoatIcon size={64} />
        {kicker && <p className="sunfarm-sail-kicker">{kicker}</p>}
        <p className="sunfarm-sail-name">{name}</p>
        {blurb && <p className="sunfarm-sail-blurb">{blurb}</p>}
      </div>
    </div>
  );
}

export default function Hud({ farm, host, fill, social, onExit, exitLabel }) {
  const s = useSyncExternalStore(farm.subscribe, farm.getSnapshot);
  const [card, setCard] = useState(() => (hasSeenHelp() ? null : 'welcome'));
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const compact = useCompact(host);
  // The game opens the way it goes between islands: from behind the sea.
  const [crossing, setCrossing] = useState(() => ({
    phase: 'hold',
    kicker: TITLE,
    name: farm.getSnapshot().island.name,
    blurb: '',
    opening: true,
  }));
  // What to do while the picture is covered, and how many times it has been.
  const underway = useRef(null);
  const [arrivals, setArrivals] = useState(0);

  const refocus = useCallback(
    () => host?.focus({ preventScroll: true }),
    [host],
  );

  const close = useCallback(() => {
    setCard((open) => {
      if (open === 'welcome') markHelpSeen();
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
  // The card on screen, which is the one asked for a moment ago.
  const [screen, leaving] = useStaged(open);
  // A finished island's card goes on being drawn while it leaves, after the
  // game has stopped saying the island was just finished.
  const lastFinished = useRef(null);
  if (s.finished) lastFinished.current = s.finished;
  const fin = s.finished || lastFinished.current;

  // The crossing, a step at a time.
  useEffect(() => {
    if (!crossing) return undefined;
    const { phase, opening } = crossing;
    const timer = setTimeout(() => {
      if (phase === 'in') {
        underway.current?.();
        underway.current = null;
        setArrivals((n) => n + 1);
        setCrossing((c) => c && { ...c, phase: 'hold' });
      } else if (phase === 'hold') {
        setCrossing((c) => c && { ...c, phase: 'out' });
      } else {
        setCrossing(null);
        // Not on the way in: a game set in a page doesn't take the page's
        // focus just by loading.
        if (!opening) refocus();
      }
    }, CROSSING[phase]);
    return () => clearTimeout(timer);
  }, [crossing, refocus]);

  // The island's clock waits while it can't be seen.
  const covered = Boolean(crossing);
  useEffect(() => {
    if (!covered) return undefined;
    farm.cover(true);
    return () => farm.cover(false);
  }, [covered, farm]);

  // Cover the picture, do `action` behind the cover, and uncover it.
  const cross = useCallback(
    (to, action, kicker = 'Sailing to') => {
      if (underway.current) return;
      underway.current = action;
      setCard(null);
      farm.cue('sail');
      setCrossing({
        phase: 'in',
        kicker,
        name: to.name,
        blurb: to.blurb || '',
        opening: false,
      });
    },
    [farm],
  );

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
    const { chart } = s;
    const to = [chart.lesson, ...chart.islands, chart.today, chart.free].find(
      (entry) => entry.id === id,
    );
    if (!to || !to.open) return;
    if (to.current) {
      setCard(null);
      refocus();
      return;
    }
    cross(to, () => farm.openIsland(id));
  };

  // The tutorial island, from its first step.
  const teach = () => {
    markHelpSeen();
    cross(s.chart.lesson, () => farm.startTutorial());
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
  const lesson = s.lesson;
  // What the tutorial is pointing at on the HUD, if anything.
  const point = (!open && !crossing && lesson?.point) || null;
  const onLesson = s.island.lesson;
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
    <>
      {/* Keyed by arrival, so the HUD settles into place afresh on each
        island instead of being the last island's with the numbers changed. */}
      <div
        key={arrivals}
        className={`sunfarm-hud${compact ? ' is-compact' : ''}`}
      >
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
          {social && !onLesson && (
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
            aria-label={onLesson ? 'The tutorial’s steps' : 'Goals'}
            title={onLesson ? 'The tutorial’s steps' : 'Goals'}
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

        {lesson && (
          <div className="sunfarm-coach">
            <div className="sunfarm-coach-head">
              <span className="sunfarm-coach-dots" aria-hidden="true">
                {Array.from({ length: lesson.total }, (_, i) => (
                  <span
                    key={i}
                    className={
                      i < lesson.index
                        ? 'is-done'
                        : i === lesson.index
                          ? 'is-now'
                          : undefined
                    }
                  />
                ))}
              </span>
              <span className="sunfarm-sr">
                Step {lesson.index + 1} of {lesson.total}.
              </span>
            </div>
            {/* Keyed by step, so each one arrives rather than changing. */}
            <div key={lesson.key} className="sunfarm-coach-step" role="status">
              <p className="sunfarm-coach-say">{lesson.say}</p>
              {lesson.more && (
                <p className="sunfarm-coach-more">{lesson.more}</p>
              )}
            </div>
          </div>
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
            className={`sunfarm-group sunfarm-speed${s.held ? ' is-held' : ''}`}
            role="group"
            aria-label={s.held ? 'Speed. The clock is waiting.' : 'Speed'}
            title={s.held ? 'The clock waits while you build.' : undefined}
          >
            <button
              type="button"
              className="sunfarm-btn sunfarm-btn--seg"
              aria-pressed={s.paused}
              disabled={s.held}
              onClick={() => farm.setPaused(!s.paused)}
              aria-label={s.paused ? 'Resume' : 'Pause'}
              title={
                s.held
                  ? undefined
                  : s.paused
                    ? 'Resume (space)'
                    : 'Pause (space)'
              }
            >
              {s.paused ? <PlayIcon size={18} /> : <PauseIcon size={18} />}
            </button>
            {SPEEDS.map((speed) => (
              <button
                key={speed}
                type="button"
                className={`sunfarm-btn sunfarm-btn--seg${
                  point?.speed === speed ? ' is-pointed' : ''
                }`}
                aria-pressed={!s.paused && s.speed === speed}
                disabled={s.held}
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
              (
                { tool, label, Icon, cost, hint, locked, afford, unlock },
                i,
              ) => (
                <button
                  key={tool}
                  type="button"
                  className={`sunfarm-btn sunfarm-tool${locked ? ' sunfarm-tool--locked' : ''}${
                    cost && afford === false && !locked
                      ? ' sunfarm-tool--short'
                      : ''
                  }${point?.tool === tool ? ' is-pointed' : ''}`}
                  aria-pressed={s.tool === tool}
                  aria-label={
                    locked ? `${label}, locked: ${unlock}` : undefined
                  }
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
      </div>

      <Leaving.Provider value={leaving}>
        {screen === 'menu' && (
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
                {onLesson ? 'The steps' : 'Goals'}
              </button>
              {social && !onLesson && (
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

        {screen === 'power' && (
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

        {screen === 'welcome' && (
          <Card title={TITLE} onClose={close}>
            <p className="sunfarm-card-lede">
              A small island runs on a diesel generator. Take it onto the sun.
            </p>
            <p className="sunfarm-card-small">
              This first island is the tutorial. It takes a couple of minutes,
              and the other islands open when it is done.
            </p>
            <div className="sunfarm-card-foot">
              <button
                type="button"
                className="sunfarm-btn sunfarm-btn--primary"
                onClick={close}
              >
                Show me how
              </button>
            </div>
          </Card>
        )}

        {screen === 'help' && (
          <Card title="How to play" onClose={close}>
            <ul className="sunfarm-steps">
              <li>
                <GeneratorIcon />
                <span>The generator keeps the lights on, and burns fuel.</span>
              </li>
              <li>
                <PanelIcon />
                <span>Panels make power from the sun. Shade costs them.</span>
              </li>
              <li>
                <CableIcon />
                <span>Things that touch share power. Lines cross gaps.</span>
              </li>
              <li>
                <BatteryIcon />
                <span>Batteries keep the day’s spare for the night.</span>
              </li>
              <li>
                <HouseIcon />
                <span>A well powered village grows at dawn.</span>
              </li>
            </ul>
            <p className="sunfarm-card-small sunfarm-wide">
              Drag to move the view, right-drag to turn it, scroll to zoom (with
              ctrl, if the page scrolls too). Number keys pick a tool; space
              pauses.
            </p>
            <p className="sunfarm-card-small sunfarm-narrow">
              Tap to build. Drag to move the view, pinch to zoom, twist two
              fingers to turn. The power line is drawn with a drag.
            </p>
            <div className="sunfarm-card-foot">
              <button
                type="button"
                className="sunfarm-btn sunfarm-btn--plain"
                onClick={teach}
              >
                {onLesson ? 'Restart tutorial' : 'Play tutorial'}
              </button>
              <button
                type="button"
                className="sunfarm-btn sunfarm-btn--primary"
                onClick={close}
              >
                Got it
              </button>
            </div>
          </Card>
        )}

        {screen === 'goals' && (
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
                    {goal.reward > 0 && (
                      <span className="sunfarm-goals-reward">
                        +{goal.reward}
                      </span>
                    )}
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

        {screen === 'chart' && (
          <Card title="The islands" onClose={close} wide>
            <ul className="sunfarm-isles sunfarm-isles--first">
              <Island
                entry={s.chart.lesson}
                onSail={s.chart.lesson.done ? teach : sail}
                lesson
              />
            </ul>
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
              {s.chart.lesson.done
                ? 'Each island opens when the one before it runs on the sun. What you learn to build comes with you.'
                : `The islands open once ${s.chart.lesson.name} runs on the sun.`}
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

        {screen === 'restart' && (
          <Card title="Start over?" onClose={close}>
            <p className="sunfarm-card-lede">
              {s.island.name} goes back to the way it was found. Everything
              built on it is lost; the other islands are left alone.
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
                onClick={() =>
                  cross(s.island, () => farm.restart(), 'Starting over')
                }
              >
                Start over
              </button>
            </div>
          </Card>
        )}

        {screen === 'board' && social && (
          <Card title="Results" onClose={close} wide>
            <Board
              farm={farm}
              social={social}
              island={s.island}
              done={s.done}
            />
          </Card>
        )}

        {screen === 'finished' && fin && fin.lesson && (
          <Card
            title={`${fin.name} runs on the sun`}
            onClose={() => {
              farm.acknowledge();
              refocus();
            }}
          >
            <p className="sunfarm-card-lede">
              A whole day and night, and the generator never started. That is
              the game.
            </p>
            <p className="sunfarm-card-small">
              {fin.next.name} is next: a bigger island, a village that grows,
              and nobody pointing.
            </p>
            <div className="sunfarm-card-foot">
              <button
                type="button"
                className="sunfarm-btn sunfarm-btn--plain"
                onClick={() => {
                  farm.acknowledge();
                  refocus();
                }}
              >
                Stay a while
              </button>
              <button
                type="button"
                className="sunfarm-btn sunfarm-btn--primary"
                onClick={() => {
                  const { id } = fin.next;
                  farm.acknowledge();
                  sail(id);
                }}
              >
                Sail to {fin.next.name}
              </button>
            </div>
          </Card>
        )}

        {screen === 'finished' && fin && !fin.lesson && (
          <Card
            title={`${fin.name} runs on the sun`}
            onClose={() => {
              farm.acknowledge();
              setCopied(false);
              refocus();
            }}
            wide
          >
            <p className="sunfarm-card-lede">
              Every home lit, a whole day and night, and the generator never
              started. It took {fin.day} {fin.day === 1 ? 'day' : 'days'}.
            </p>
            <p className="sunfarm-card-small">
              The generator can go back on the boat now: the Remove tool will
              take it. Or stay a while and watch the place.
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
              {fin.next ? (
                <button
                  type="button"
                  className="sunfarm-btn sunfarm-btn--primary"
                  onClick={() => {
                    const { id } = fin.next;
                    farm.acknowledge();
                    setCopied(false);
                    sail(id);
                  }}
                >
                  Sail to {fin.next.name}
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
      </Leaving.Provider>

      {crossing && <Crossing {...crossing} />}
    </>
  );
}
