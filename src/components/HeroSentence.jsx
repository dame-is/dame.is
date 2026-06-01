import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { ME_DID, COLLECTIONS } from '../config.js';

/**
 * The home-page hero is one combinatorial sentence:
 *
 *   dame is [a — role with article] [who — relative clause]
 *
 * Each part rotates independently, every few seconds, at organic
 * intervals (random 4–8 s) so you almost never see the same pair
 * twice in a row. "dame is" itself stays put as the muted lead.
 *
 * Phrases live on the PDS as `is.dame.hero.phrase` records (managed in
 * the admin panel) and are loaded at runtime. The in-file VARIANTS_A /
 * VARIANTS_B arrays below are the fallback shown before/without any
 * records, and the seed the admin "Seed defaults" button writes.
 */
export const VARIANTS_A = [
  'a design engineer',
  'an artist',
  'a lepidopterist',
  'a sourdough baker',
  'a weird little guy',
  'a they/them',
  'an Appalachian',
  'a creative technologist',
  'a tennis player',
  'an interface designer',
];

export const VARIANTS_B = [
  'who sometimes stays up late mothing',
  'who makes social software with open protocols',
  'who unconsciously hums christmas music all year round',
  'who loves weird little beverages',
  'who has a little tan dog named Cooper',
  'who fostered two lost kune kune pigs that one time',
  'who gave a talk titled “From Toilets to Moths” at a conference',
  'who built anisota.net',
  'who made a niche social network called Flushes',
  'who thinks the future of social media is weird and not for everyone',
  'who creates software to help people be offline more and online better',
];

const EASE = [0.22, 0.61, 0.36, 1];

// Motion variants for the word-by-word stagger inside each rotator.
// The container itself has no visual animation — it just orchestrates
// timing for its word children via `staggerChildren`. Children inherit
// the variant name set on the parent (hidden / visible / exit) so the
// same machinery drives both entry and exit.
const phraseVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
  exit: { transition: { staggerChildren: 0.04 } },
};

const wordVariants = {
  hidden: { opacity: 0, y: -18, transition: { duration: 0.4, ease: EASE } },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
  exit: { opacity: 0, y: 18, transition: { duration: 0.3, ease: EASE } },
};

export default function HeroSentence({ shuffleRef = null } = {}) {
  const reduce = useReducedMotion();

  // Phrases come from the PDS (`is.dame.hero.phrase`), snapshot-first with a
  // live overlay. The in-file VARIANTS_* arrays are the fallback when the
  // collection is empty or unreachable.
  const { items: heroRecords } = useLiveFeed({
    name: 'hero',
    strategy: 'snapshot-first',
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      return listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.heroPhrase, max: 200 });
    },
    mapItems: (snap) => (Array.isArray(snap) ? snap.filter((r) => r?.value) : []),
  });

  // Split records into the two pools by `part`, dropping disabled ones.
  // Fallback is per-part: if the PDS has roles but no clauses, clauses use
  // the in-file defaults rather than emptying the second half of the sentence.
  const { poolA, poolB } = useMemo(() => {
    const recs = heroRecords || [];
    const enabled = recs.filter(
      (r) => r.value?.enabled !== false && typeof r.value?.text === 'string' && r.value.text.trim(),
    );
    const roles = enabled.filter((r) => r.value.part === 'role').map((r) => r.value.text);
    const clauses = enabled.filter((r) => r.value.part === 'clause').map((r) => r.value.text);
    return {
      poolA: roles.length ? roles : VARIANTS_A,
      poolB: clauses.length ? clauses : VARIANTS_B,
    };
  }, [heroRecords]);

  // Random starting pair so returning visitors don't always see the
  // same opener. Under reduced motion both pin to 0 for a predictable,
  // non-surprising default.
  const [indexA, setIndexA] = useState(() =>
    reduce ? 0 : Math.floor(Math.random() * VARIANTS_A.length),
  );
  const [indexB, setIndexB] = useState(() =>
    reduce ? 0 : Math.floor(Math.random() * VARIANTS_B.length),
  );

  // Pools are dynamic (they load and can change). Keep indices in range so
  // `Rotator` never dereferences an out-of-bounds phrase.
  useEffect(() => {
    setIndexA((i) => (poolA.length ? i % poolA.length : 0));
    setIndexB((i) => (poolB.length ? i % poolB.length : 0));
  }, [poolA.length, poolB.length]);

  // Imperative shuffle handle the parent (Home) wires to a button so
  // users can advance the sentence manually instead of waiting for the
  // next timed swap. Always picks a fresh A and B both — picking the
  // same pair would feel like a broken button.
  useEffect(() => {
    if (!shuffleRef) return undefined;
    shuffleRef.current = () => {
      setIndexA((i) => pickDifferent(i, poolA.length));
      setIndexB((i) => pickDifferent(i, poolB.length));
    };
    return () => {
      if (shuffleRef.current) shuffleRef.current = null;
    };
  }, [shuffleRef, poolA.length, poolB.length]);
  const [paused, setPaused] = useState(false);
  const [minHeight, setMinHeight] = useState(null);
  const wrapRef = useRef(null);
  const measureRef = useRef(null);

  // Part-A timer: schedule the next swap whenever index, pause, or
  // reduced-motion state changes. Random interval per round so two
  // adjacent swaps never feel metronomic.
  useEffect(() => {
    if (reduce || paused) return;
    const ms = 4000 + Math.random() * 4000;
    const id = setTimeout(
      () => setIndexA((i) => (i + 1) % poolA.length),
      ms,
    );
    return () => clearTimeout(id);
  }, [indexA, paused, reduce, poolA.length]);

  // Part-B timer: same logic, but a small phase offset (4500 base
  // instead of 4000) so A and B drift independently rather than
  // locking into a shared rhythm.
  useEffect(() => {
    if (reduce || paused) return;
    const ms = 4500 + Math.random() * 4000;
    const id = setTimeout(
      () => setIndexB((i) => (i + 1) % poolB.length),
      ms,
    );
    return () => clearTimeout(id);
  }, [indexB, paused, reduce, poolB.length]);

  // Pause when the tab is hidden — otherwise the timer fires
  // unattended and the user comes back to an arbitrary mid-cycle pair.
  useEffect(() => {
    function onVisibility() {
      if (document.hidden) setPaused(true);
      else setPaused(false);
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Reserve vertical space equal to the tallest A×B combination so the
  // feed below the hero doesn't jump as variants cycle. Wrapping
  // depends on both parts combined, so per-part measurement isn't
  // enough — we measure every combination in the hidden layer.
  useEffect(() => {
    const wrap = wrapRef.current;
    const measure = measureRef.current;
    if (!wrap || !measure) return;

    function recompute() {
      let max = 0;
      for (const child of measure.children) {
        const h = child.getBoundingClientRect().height;
        if (h > max) max = h;
      }
      if (max > 0) setMinHeight(max);
    }

    // The serif font loads asynchronously; measuring before fonts
    // settle yields the (shorter) fallback's height and forces a
    // shift on first cycle. Gate the first measure behind fonts.ready.
    const fontsReady = document.fonts?.ready;
    if (fontsReady && typeof fontsReady.then === 'function') {
      fontsReady.then(recompute);
    } else {
      recompute();
    }

    // Re-measure on container resize (width changes alter wrapping,
    // and therefore which combination is tallest).
    const ro = new ResizeObserver(recompute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  return (
    <span
      ref={wrapRef}
      className="hero-sentence"
      style={minHeight ? { minHeight: `${minHeight}px` } : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <span className="hero-sentence-lead">dame is</span>{' '}
      <Rotator index={indexA} pool={poolA} reduce={reduce} className="hero-rotator-a" />{' '}
      <Rotator index={indexB} pool={poolB} reduce={reduce} className="hero-rotator-b" />

      {/* Each measure entry mirrors the live nested structure (lead +
          two inline-block rotators) so wrapping at the rotator
          boundaries matches the live render. A flat text equivalent
          would let the browser break mid-phrase and report a shorter
          height than the live layout — which then shows up as a feed
          jump on narrow viewports. */}
      <span
        aria-hidden="true"
        className="hero-sentence-measure"
        ref={measureRef}
      >
        {poolA.flatMap((a) =>
          poolB.map((b) => (
            <span key={`${a}|${b}`}>
              <span className="hero-sentence-lead">dame is</span>{' '}
              <span className="hero-rotator hero-rotator-a">
                <span className="hero-rotator-phrase">{a}</span>
              </span>{' '}
              <span className="hero-rotator hero-rotator-b">
                <span className="hero-rotator-phrase">{b}</span>
              </span>
            </span>
          )),
        )}
      </span>
    </span>
  );
}

function pickDifferent(current, length) {
  if (length <= 1) return 0;
  let next;
  do {
    next = Math.floor(Math.random() * length);
  } while (next === current);
  return next;
}

function Rotator({ index, pool, reduce, className = '' }) {
  // Split the active phrase into words once per index change. Real
  // space text nodes between word spans preserve the wrap-anywhere
  // behavior the measure layer already counts on. Guard the lookup: the
  // pool can change a render before the parent clamps `index` back in range.
  const words = useMemo(() => {
    const phrase = pool[index] ?? pool[0] ?? '';
    return phrase.split(' ');
  }, [pool, index]);

  return (
    <span className={`hero-rotator ${className}`}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={index}
          className="hero-rotator-phrase"
          variants={reduce ? undefined : phraseVariants}
          initial={reduce ? false : 'hidden'}
          animate={reduce ? undefined : 'visible'}
          exit={reduce ? { opacity: 0 } : 'exit'}
        >
          {words.map((word, i) => (
            <Fragment key={i}>
              <motion.span
                className="hero-rotator-word"
                variants={reduce ? undefined : wordVariants}
              >
                {word}
              </motion.span>
              {i < words.length - 1 && ' '}
            </Fragment>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
