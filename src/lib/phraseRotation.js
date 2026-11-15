/**
 * The order one half of the hero sentence shows its phrases in.
 *
 * Every phrase shows once before any shows twice (a round), and a new round
 * never opens with the phrases the last one ended on: the last half of the
 * pool shown is held back until other phrases have had a turn. So a phrase
 * is always at least half the pool away from its repeat, whether the timer
 * or the shuffle button moved it.
 *
 * `see` records what is actually on screen; `next` only proposes, so calling
 * it twice has no effect on the order.
 */
export function createRotation() {
  let recent = [];
  let round = new Set();

  return {
    see(text, pool) {
      if (text == null || recent[recent.length - 1] === text) return;
      recent = [...recent, text].slice(-Math.max(pool.length, 1));
      round.add(text);
      if (pool.every((p) => round.has(p))) round = new Set();
    },

    /** An index into `pool` for the phrase to show next. */
    next(pool, random = Math.random) {
      if (pool.length <= 1) return 0;
      const held = new Set(recent.slice(-Math.floor(pool.length / 2)));
      const current = recent[recent.length - 1];
      const candidates = [
        (i) => !round.has(pool[i]) && !held.has(pool[i]),
        // Only reachable after the pool itself changed under a round.
        (i) => !held.has(pool[i]),
        (i) => pool[i] !== current,
      ];
      for (const ok of candidates) {
        const open = pool.map((_, i) => i).filter(ok);
        if (open.length) return open[Math.floor(random() * open.length)];
      }
      return 0;
    },
  };
}
