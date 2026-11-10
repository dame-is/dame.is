// Which things are wired to which.
//
// There are no wires to route. Anything that conducts (a panel, a battery, a
// power line, a house) joins the network of any conducting thing on the four
// tiles it touches. So a network is a patch of touching tiles, found with a
// flood fill, and it is recounted only when something is built or removed.

import { KINDS } from './catalog.js';
import { neighbours } from './island.js';

export function conducts(thing) {
  return Boolean(thing && KINDS[thing.kind]?.conducts);
}

/**
 * Split the board into power networks.
 *
 * Returns `{ netOf, nets }`. `netOf[idx]` is the network a tile belongs to,
 * or -1. Each net lists its tiles by what stands on them; houses are in the
 * order the village built them, which is the order they are lit in when
 * there isn't enough to go round.
 */
export function findNetworks(things, size) {
  const netOf = new Int32Array(things.length).fill(-1);
  const nets = [];
  for (let start = 0; start < things.length; start += 1) {
    if (netOf[start] !== -1 || !conducts(things[start])) continue;
    const net = {
      id: nets.length,
      tiles: [],
      panels: [],
      batteries: [],
      houses: [],
      cables: [],
    };
    const queue = [start];
    netOf[start] = net.id;
    while (queue.length) {
      const idx = queue.pop();
      net.tiles.push(idx);
      const kind = things[idx].kind;
      if (kind === 'panel') net.panels.push(idx);
      else if (kind === 'battery') net.batteries.push(idx);
      else if (kind === 'house') net.houses.push(idx);
      else if (kind === 'cable') net.cables.push(idx);
      for (const n of neighbours(idx, size)) {
        if (netOf[n] !== -1 || !conducts(things[n])) continue;
        netOf[n] = net.id;
        queue.push(n);
      }
    }
    net.houses.sort((a, b) => (things[a].order ?? 0) - (things[b].order ?? 0));
    nets.push(net);
  }
  return { netOf, nets };
}
