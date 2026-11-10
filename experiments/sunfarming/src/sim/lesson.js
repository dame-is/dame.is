// The tutorial: a lesson in steps, each of which points at one thing to do
// and is over the moment it has been done.
//
// It runs on the tutorial island (TUTORIAL in islands.js), whose map names
// the tiles the steps point at. Nothing here is a script the player has to
// follow to the letter: a step is done when the island is in the state the
// step was after, however it got there, so a panel put somewhere other than
// the marked tile still counts, and a step whose work is already done is
// passed straight over.
//
// Like the rest of src/sim this is plain data and plain functions. What the
// player has in hand, has looked at and has pressed is not part of the game,
// so it comes in from the running game as `seen`:
//
//   { tool, selected, looked, speed, paused }
//
// and what comes back out is what to say and where to point.

import { generatorTile, networks } from './game.js';

const isPanel = (thing) => thing?.kind === 'panel' || thing?.kind === 'tracker';
const marked = (game, name) => game.marks?.[name] || [];
const empty = (game, name) =>
  marked(game, name).filter((idx) => !game.things[idx]);

// Counted over the networks that reach a home: a panel on its own in a field
// is not yet doing the village any good.
const wired = (game, pick) =>
  networks(game)
    .nets.filter((net) => net.houses.length > 0)
    .reduce((count, net) => count + pick(net).length, 0);
const wiredPanels = (game) => wired(game, (net) => net.panels);
const wiredStores = (game) => wired(game, (net) => net.stores);

/**
 * The steps, in order. Each has:
 *
 *   key     its name
 *   title   two or three words, for the list of steps
 *   say     the one line the player is shown
 *   more    a second, smaller line (or a function of the game giving one)
 *   tool    the tool the step is done with; until it is in hand, the lesson
 *           points at the tool instead of at the ground
 *   tiles   the tiles to mark, given the game
 *   speed   a speed to point at while the clock is running slower
 *   hold    whether the island's clock waits while the step is open
 *   done    whether the step is over, given the game and what was `seen`
 *
 * The clock is held through all but the last, so the sun stays where the
 * lesson needs it and nothing is burned or earned while the player reads.
 */
export const LESSON = Object.freeze(
  [
    {
      key: 'look',
      title: 'Look around',
      say: 'Drag to look around.',
      more: 'Scroll or pinch to zoom.',
      hold: true,
      done: (game, seen) => Boolean(seen.looked),
    },
    {
      key: 'generator',
      title: 'Meet the generator',
      say: 'Tap the generator.',
      more: 'It keeps the lights on, and burns fuel to do it.',
      tool: 'look',
      tiles: (game) => [generatorTile(game)].filter((idx) => idx >= 0),
      hold: true,
      done: (game, seen) => {
        const at = generatorTile(game);
        return at < 0 || seen.selected === at;
      },
    },
    {
      key: 'panel',
      title: 'A solar panel',
      say: 'Put a solar panel on the marked tile.',
      more: 'Brighter ground gets more of the day’s sun.',
      tool: 'panel',
      tiles: (game) => empty(game, 'a'),
      hold: true,
      done: (game) => game.things.some(isPanel),
    },
    {
      key: 'line',
      title: 'Wire it in',
      say: 'It isn’t wired to anything. Draw a power line to the old one.',
      tool: 'cable',
      tiles: (game) => empty(game, 'c'),
      hold: true,
      done: (game) => wiredPanels(game) >= 1,
    },
    {
      key: 'more',
      title: 'Two more panels',
      say: 'Things that touch share power. Add two more panels.',
      more: 'Watch the generator ease off.',
      tool: 'panel',
      tiles: (game) => empty(game, 'b'),
      hold: true,
      done: (game) => wiredPanels(game) >= 3,
    },
    {
      key: 'shade',
      title: 'Clear the shade',
      say: 'That tree’s shadow is on a panel. Clear the tree.',
      more: 'A panel in shade makes a quarter of what it could.',
      tool: 'remove',
      tiles: (game) =>
        marked(game, 'tree').filter((idx) => game.things[idx]?.kind === 'tree'),
      hold: true,
      done: (game) =>
        marked(game, 'tree').every((idx) => game.things[idx]?.kind !== 'tree'),
    },
    {
      key: 'battery',
      title: 'Two batteries',
      say: 'The sun sets every evening. Build two batteries for the night.',
      more: 'They fill on whatever the homes don’t use.',
      tool: 'battery',
      tiles: (game) => empty(game, 'e'),
      hold: true,
      done: (game) => wiredStores(game) >= 2,
    },
    {
      key: 'run',
      title: 'A day on the sun',
      say: 'Now let a day and a night go by.',
      // Said again, differently, if the first try wasn't enough.
      more: (game) =>
        game.yesterday && game.yesterday.diesel >= 0.01
          ? 'The generator still ran. Add a panel or a battery and give it another day.'
          : 'A whole day without the generator, and the island is done.',
      speed: 10,
      done: (game) => Boolean(game.done),
    },
  ].map(Object.freeze),
);

/** Whether the island has a lesson and it isn't over yet. */
export function inLesson(game) {
  return Boolean(game.lesson) && game.lesson.step < LESSON.length;
}

/**
 * Whether the island's clock is waiting on the lesson: time doesn't pass
 * while a step that holds it is open.
 */
export function lessonHolds(game) {
  return inLesson(game) && Boolean(LESSON[game.lesson.step].hold);
}

/**
 * Move the lesson on past every step that is done. Returns the keys of the
 * steps passed, in order, which is nothing at all most of the time.
 */
export function advanceLesson(game, seen = {}) {
  const passed = [];
  while (inLesson(game) && LESSON[game.lesson.step].done(game, seen)) {
    passed.push(LESSON[game.lesson.step].key);
    game.lesson.step += 1;
  }
  return passed;
}

/**
 * The step the player is on, as what to show for it, or null when there is
 * no lesson or it is over:
 *
 *   { index, total, key, title, say, more, hold, point, tiles }
 *
 * `point` is a control to draw the eye to (`{ tool }` or `{ speed }`), or
 * null. `tiles` are the tiles to mark on the ground, and are empty while
 * the lesson is still pointing at a tool: one thing at a time.
 */
export function lessonNow(game, seen = {}) {
  if (!inLesson(game)) return null;
  const step = LESSON[game.lesson.step];
  let point = null;
  if (step.tool && seen.tool !== step.tool) point = { tool: step.tool };
  else if (step.speed && (seen.paused || !(seen.speed >= step.speed)))
    point = { speed: step.speed };
  return {
    index: game.lesson.step,
    total: LESSON.length,
    key: step.key,
    title: step.title,
    say: step.say,
    more: typeof step.more === 'function' ? step.more(game) : step.more || '',
    hold: Boolean(step.hold),
    point,
    tiles: point?.tool || !step.tiles ? [] : step.tiles(game),
  };
}

/** The lesson as a list of what there is to do and what has been done. */
export function lessonSteps(game) {
  if (!game.lesson) return [];
  return LESSON.map((step, i) => ({
    key: step.key,
    title: step.title,
    done: i < game.lesson.step,
  }));
}
