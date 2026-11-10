// A plate nobody chose.
//
// The randomize button deals one of these: a medium, a few cultures that can
// live on it, put down as drops or streaks, and now and then something off
// the tray. It is a recipe like any other (recipe.js), written at hour zero,
// so what comes up is what those cultures do on that medium and not a
// picture of it. Nothing here touches the bench or the GPU; `random` is
// handed in so the dealing can be held to account (culturing.test.js).

import { CULTURES } from './cultures.js';
import { MEDIA } from './media.js';
import { cleanDish } from './recipe.js';

/** What may turn up beside the cultures: things that show on any plate. */
const EXTRAS = ['penicillin', 'biocide', 'sugar', 'dye-violet', 'dye-blue'];

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
  const seed = () => (random() * 1e6) | 0;
  const medium = pick(MEDIA);
  const suited = suitedTo(medium);
  const events = [];
  const count = 2 + ((random() * 3) | 0);
  for (let i = 0; i < count && suited.length; i += 1) {
    const culture = pick(suited).id;
    const angle = random() * Math.PI * 2;
    const radius = 6 + random() * 24;
    if (random() < 0.3) {
      // A streak: an arc round the plate's middle, from where it began.
      const sweep = 0.6 + random() * 1.2;
      const path = [];
      for (let k = 0; k <= 14; k += 1) {
        const a = angle + (sweep * k) / 14;
        path.push([Math.cos(a) * radius, Math.sin(a) * radius]);
      }
      events.push({ at: 0, do: 'streak', culture, path, seed: seed() });
    } else {
      events.push({
        at: 0,
        do: 'spot',
        culture,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        seed: seed(),
      });
    }
  }
  if (random() < 0.4) {
    const angle = random() * Math.PI * 2;
    events.push({
      at: 0,
      do: 'add',
      addition: pick(EXTRAS),
      x: Math.cos(angle) * 14,
      y: Math.sin(angle) * 14,
    });
  }
  return cleanDish({ medium: medium.id, seed: seed(), events, hours: 0 });
}
