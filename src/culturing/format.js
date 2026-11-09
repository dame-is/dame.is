// How the workbench says things: hours, and what was done to a plate.

import { cultureById } from './cultures.js';
import { additionById } from './additions.js';
import { mediumById } from './media.js';

/** "41 h" up to two days, then "3 d 4 h". */
export function formatHours(hours) {
  const h = Math.max(0, Math.round(hours));
  if (h < 48) return `${h} h`;
  const days = Math.floor(h / 24);
  const rest = h % 24;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

const LIGHT_WORDS = {
  cycle: 'day and night',
  on: 'lights on',
  dark: 'kept dark',
};

/** An incubator setting, or several, as words. */
export function describeEnv(env) {
  const parts = [];
  if (env.temperature != null) parts.push(`${env.temperature} °C`);
  if (env.humidity != null)
    parts.push(`${Math.round(env.humidity * 100)} % humidity`);
  if (env.light != null) parts.push(LIGHT_WORDS[env.light] || env.light);
  return parts.join(', ');
}

/** One line of a plate's record: what an event did. */
export function describeEvent(event) {
  if (event.do === 'set') return `Incubator set to ${describeEnv(event.env)}`;
  if (event.do === 'add') {
    const item = additionById(event.addition);
    if (!item) return 'Something added';
    if (item.cut)
      return event.path ? 'A cut with the scalpel' : 'A nick with the scalpel';
    if (item.scrape) return 'Growth scraped off with a loop';
    return item.name;
  }
  const culture = cultureById(event.culture);
  const name = culture ? culture.name : 'a culture';
  if (event.do === 'lawn') return `${name}, spread as a lawn`;
  if (event.do === 'streak') return `${name}, streaked`;
  return event.mixed ? `${name}, in a mixed drop` : `${name}, as a drop`;
}

/** The first line of every record: what the plate was poured from. */
export function describePour(dish) {
  const medium = mediumById(dish.medium);
  return `Poured: ${medium ? medium.name : 'agar'}, ${dish.agar} % agar`;
}
