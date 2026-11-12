// A plate nobody chose.
//
// The randomize button deals one of these: a medium, a few cultures that can
// live on it, and somewhere to put them. It is a recipe like any other
// (recipe.js), written at hour zero, so what comes up is what those cultures
// do on that medium and not a picture of it. Nothing here touches the bench
// or the GPU; `random` is handed in so the dealing can be held to account
// (culturing.test.js).
//
// What is left to chance is who and on what. Where is dealt from a handful
// of layouts, because where is most of what makes a plate worth watching:
// two cultures a hand's width apart never meet, and two in one drop have to
// settle who gets the edge.

import { CULTURES } from './cultures.js';
import { MEDIA } from './media.js';
import { cleanDish } from './recipe.js';
import { DROPS } from './tools.js';

/** What may turn up beside the cultures: things that show on any plate. */
const EXTRAS = ['penicillin', 'biocide', 'sugar', 'dye-violet', 'dye-blue'];

/**
 * How a plate is laid out, and how often.
 *
 *   middle   one culture in a big drop in the middle, with the plate to
 *            itself or a few others dotted round it for it to run into
 *   shared   two or three in one drop in the middle, mixed
 *   ring     drops evenly round a ring, the cultures taking turns
 *   facing   two drops either side of the middle, and now and then a third
 *            between them
 *   scatter  drops and streaks wherever they fall
 */
const LAYOUTS = [
  ['middle', 3],
  ['shared', 4],
  ['ring', 2],
  ['facing', 2],
  ['scatter', 3],
];

/** Media a film or a swarm has room to do something on come up more often. */
const MEDIUM_WEIGHT = { congo: 3, morphology: 3, swarm: 2 };

/** The kinds that make a shape of their own, given room. */
const SPREADS = new Set(['biofilm', 'swarmer', 'mould']);

const radiusOf = (name) => DROPS.find((d) => d.value === name).radius;

/** The cultures that would do something on a medium rather than sit there:
 *  salt-lovers on the salty ones, and nothing the medium holds back. */
export function suitedTo(medium) {
  return CULTURES.filter((c) => {
    if (medium.salt) return Boolean(c.salt);
    if (c.salt === 'needs') return false;
    return !(
      medium.selects && (c.tags || []).some((t) => medium.selects[t] < 0.5)
    );
  });
}

/**
 * Deal a plate.
 *
 * @param {() => number} [random]  0 to 1, as Math.random gives
 * @returns a dish, fresh from the pour, with its cultures just put down
 */
export function randomDish(random = Math.random) {
  const pick = (list) =>
    list[Math.min(list.length - 1, (random() * list.length) | 0)];
  const weighted = (list, weightOf) => {
    const total = list.reduce((sum, item) => sum + weightOf(item), 0);
    let at = random() * total;
    for (const item of list) {
      at -= weightOf(item);
      if (at < 0) return item;
    }
    return list[list.length - 1];
  };
  const seed = () => (random() * 1e6) | 0;
  const between = (lo, hi) => lo + random() * (hi - lo);

  const medium = weighted(MEDIA, (m) => MEDIUM_WEIGHT[m.id] ?? 1);
  const left = suitedTo(medium).slice();
  /** One culture off what is left of the shelf, never the same one twice.
   *  `showy` leans toward the ones that spread; 'only' takes nothing else
   *  while there is one to take. */
  const draw = (showy = false) => {
    if (!left.length) return null;
    const spreaders = left.filter((c) => SPREADS.has(c.kind));
    const from = showy === 'only' && spreaders.length ? spreaders : left;
    const culture = weighted(from, (c) =>
      showy && SPREADS.has(c.kind) ? 4 : 1,
    );
    left.splice(left.indexOf(culture), 1);
    return culture.id;
  };

  const events = [];
  const drop = (culture, x, y, size, mixed = false) => {
    if (!culture) return;
    const event = { at: 0, do: 'spot', culture, x, y, seed: seed() };
    const radius = radiusOf(size);
    if (size !== 'touch') event.size = radius;
    if (mixed) event.mixed = true;
    events.push(event);
  };
  const at = (angle, radius) => [
    Math.cos(angle) * radius,
    Math.sin(angle) * radius,
  ];

  const [layout] = weighted(LAYOUTS, (l) => l[1]);
  const turn = random() * Math.PI * 2;

  if (layout === 'middle') {
    // Company, as often as not: a few touches of something else, out
    // where the first will take a day or two to reach them. With the plate
    // to itself, it had better be something that makes use of it.
    const others = random() < 0.55 ? 1 + ((random() * 3) | 0) : 0;
    drop(draw(others ? true : 'only'), 0, 0, 'pool');
    const guest = draw();
    const second = random() < 0.4 ? draw() : null;
    const radius = between(22, 30);
    for (let i = 0; i < others; i += 1) {
      const [x, y] = at(turn + (i * Math.PI * 2) / others, radius);
      drop(i % 2 && second ? second : guest, x, y, 'touch');
    }
  } else if (layout === 'shared') {
    const size = random() < 0.6 ? 'pool' : 'drop';
    const count = random() < 0.25 ? 3 : 2;
    drop(draw(true), 0, 0, size, true);
    for (let i = 1; i < count; i += 1) drop(draw(), 0, 0, size, true);
  } else if (layout === 'ring') {
    const count = 3 + ((random() * 3) | 0);
    const cast = [draw(true), draw(), random() < 0.5 ? draw() : null].filter(
      Boolean,
    );
    const radius = between(14, 24);
    const size = random() < 0.5 ? 'drop' : 'touch';
    for (let i = 0; i < count; i += 1) {
      const [x, y] = at(turn + (i * Math.PI * 2) / count, radius);
      drop(cast[i % cast.length], x, y, size);
    }
  } else if (layout === 'facing') {
    const apart = between(11, 19);
    const size = random() < 0.5 ? 'pool' : 'drop';
    const [x, y] = at(turn, apart);
    drop(draw(true), x, y, size);
    drop(draw(true), -x, -y, size);
    if (random() < 0.35) drop(draw(), 0, 0, 'touch');
  } else {
    const count = 2 + ((random() * 3) | 0);
    const cast = Array.from({ length: Math.min(count, 4) }, () => draw());
    for (let i = 0; i < count; i += 1) {
      const culture = cast[i % cast.length];
      if (!culture) continue;
      const angle = random() * Math.PI * 2;
      const radius = between(6, 30);
      if (random() < 0.3) {
        // A streak: an arc round the plate's middle, from where it began.
        const sweep = between(0.6, 1.8);
        const path = [];
        for (let k = 0; k <= 14; k += 1) {
          path.push(at(angle + (sweep * k) / 14, radius));
        }
        events.push({ at: 0, do: 'streak', culture, path, seed: seed() });
      } else {
        const [x, y] = at(angle, radius);
        drop(culture, x, y, random() < 0.3 ? 'drop' : 'touch');
      }
    }
  }

  if (random() < 0.35) {
    // Something off the tray, a little way out, where growth will find it.
    const [x, y] = at(random() * Math.PI * 2, between(12, 20));
    events.push({ at: 0, do: 'add', addition: pick(EXTRAS), x, y });
  }
  return cleanDish({ medium: medium.id, seed: seed(), events, hours: 0 });
}
