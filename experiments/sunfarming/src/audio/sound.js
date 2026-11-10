// The game's sound, all of it made here from oscillators and noise. There
// are no audio files: the package stays one folder of source, and the sounds
// can be tuned in code like everything else.
//
// Two kinds. One-shots answer something that just happened (a panel put
// down, a goal reached, a family moving in). The ambience is a few nodes that
// run all the time and are turned up and down by what the island is doing:
// the sea, the wind, crickets after dark, and the generator's drone, which is
// there so that the day it stops can be heard.
//
// A browser will not make a sound until the visitor has done something, so
// nothing starts before unlock() is called from a pointer or key press.

const VOLUME = 0.55;

// Notes, by name, for the little tunes.
const NOTE = {
  G4: 392,
  A4: 440,
  B4: 493.9,
  C5: 523.3,
  D5: 587.3,
  E5: 659.3,
  F5: 698.5,
  G5: 784,
  A5: 880,
  C6: 1046.5,
  D6: 1174.7,
  E6: 1318.5,
};

const PLACE = {
  panel: 'panel',
  tracker: 'tracker',
  turbine: 'turbine',
  battery: 'battery',
  bank: 'bank',
  cable: 'cable',
};

export function createSound({ muted = false } = {}) {
  let ctx = null;
  let master = null;
  let scene = null;
  let isMuted = Boolean(muted);
  // Held: the game is hidden or off screen, so it should be silent whatever
  // the mute button says.
  let held = false;
  let nextGull = 0;

  function ensure() {
    if (ctx) return ctx;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = isMuted ? 0 : VOLUME;
    master.connect(ctx.destination);
    scene = startAmbience();
    return ctx;
  }

  /* ── one-shots ────────────────────────────────────────────────────────── */

  // A single note: a pitch (optionally sliding to another), a quick attack
  // and a decay to nothing.
  function tone({
    freq,
    to,
    type = 'sine',
    at = 0,
    dur = 0.15,
    gain = 0.1,
    attack = 0.005,
  }) {
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // A burst of filtered noise: a knock, a click, a gust.
  function hiss({ at = 0, dur = 0.08, gain = 0.1, band = 1200, to, q = 1 }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = scene.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(band, t);
    if (to) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    filter.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur / 3));
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(amp).connect(master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  // A run of notes, one after another.
  function tune(
    notes,
    { step = 0.09, dur = 0.24, gain = 0.09, type = 'triangle', at = 0 } = {},
  ) {
    notes.forEach((freq, i) =>
      tone({ freq, type, at: at + i * step, dur, gain }),
    );
  }

  const SOUNDS = {
    tap: () => tone({ freq: 540, to: 700, dur: 0.05, gain: 0.05 }),
    panel: () => {
      tone({ freq: NOTE.A5, type: 'triangle', dur: 0.14, gain: 0.08 });
      tone({
        freq: NOTE.E6,
        type: 'triangle',
        at: 0.03,
        dur: 0.16,
        gain: 0.05,
      });
    },
    tracker: () => {
      tone({ freq: NOTE.G5, type: 'triangle', dur: 0.14, gain: 0.08 });
      tone({
        freq: NOTE.D6,
        type: 'triangle',
        at: 0.03,
        dur: 0.16,
        gain: 0.05,
      });
      tone({
        freq: 320,
        to: 520,
        type: 'sawtooth',
        at: 0.08,
        dur: 0.1,
        gain: 0.018,
      });
    },
    turbine: () => {
      hiss({ dur: 0.3, gain: 0.07, band: 400, to: 1700, q: 0.8 });
      tone({ freq: NOTE.A4, type: 'triangle', at: 0.05, dur: 0.2, gain: 0.07 });
    },
    battery: () => {
      tone({ freq: 150, to: 92, dur: 0.16, gain: 0.2 });
      hiss({ dur: 0.03, gain: 0.05, band: 2400 });
    },
    bank: () => {
      tone({ freq: 118, to: 66, dur: 0.24, gain: 0.24 });
      hiss({ dur: 0.05, gain: 0.06, band: 1800 });
    },
    cable: () => {
      hiss({ dur: 0.045, gain: 0.09, band: 1300, q: 2 });
      tone({ freq: 330, to: 300, type: 'triangle', dur: 0.07, gain: 0.07 });
    },
    remove: () =>
      tone({ freq: 520, to: 250, type: 'triangle', dur: 0.13, gain: 0.08 }),
    deny: () => {
      tone({ freq: 178, type: 'triangle', dur: 0.07, gain: 0.1 });
      tone({ freq: 160, type: 'triangle', at: 0.1, dur: 0.09, gain: 0.1 });
    },
    goal: () => tune([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6]),
    morning: () =>
      tune([NOTE.G4, NOTE.C5], {
        step: 0.16,
        dur: 0.5,
        gain: 0.06,
        type: 'sine',
      }),
    house: () => {
      hiss({ dur: 0.05, gain: 0.07, band: 900 });
      tune([NOTE.A4, NOTE.D5], { at: 0.04, step: 0.1, gain: 0.07 });
    },
    upgrade: () =>
      tune([NOTE.B4, NOTE.E5, NOTE.G5], { step: 0.08, gain: 0.07 }),
    unlock: () =>
      tune([NOTE.D5, NOTE.F5, NOTE.A5, NOTE.D6], { step: 0.1, gain: 0.08 }),
    done: () => {
      tune([NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6], {
        step: 0.12,
        dur: 0.4,
        gain: 0.09,
      });
      for (const freq of [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6]) {
        tone({
          freq,
          type: 'sine',
          at: 0.7,
          dur: 1.6,
          gain: 0.05,
          attack: 0.08,
        });
      }
    },
    gull: () => {
      const base = 1500 + Math.random() * 500;
      for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i += 1) {
        tone({
          freq: base,
          to: base * 0.62,
          at: i * 0.22,
          dur: 0.17,
          gain: 0.022,
          attack: 0.03,
        });
      }
    },
  };

  /* ── the ambience ─────────────────────────────────────────────────────── */

  function startAmbience() {
    // Two seconds of white noise, looped: the raw stuff of sea and wind.
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

    const bed = ctx.createBufferSource();
    bed.buffer = noise;
    bed.loop = true;

    // The sea: low noise that swells and falls back, a wave every nine seconds.
    const seaFilter = ctx.createBiquadFilter();
    seaFilter.type = 'bandpass';
    seaFilter.frequency.value = 420;
    seaFilter.Q.value = 0.5;
    const sea = ctx.createGain();
    sea.gain.value = 0.035;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.11;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.022;
    swell.connect(swellDepth).connect(sea.gain);
    bed.connect(seaFilter).connect(sea).connect(master);

    // The wind: higher, thinner noise, as loud as the wind is strong.
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 760;
    windFilter.Q.value = 1.1;
    const wind = ctx.createGain();
    wind.gain.value = 0;
    bed.connect(windFilter).connect(wind).connect(master);

    // The generator: two low saws a fifth apart through a muffler, with the
    // shudder of an engine on it.
    const muffler = ctx.createBiquadFilter();
    muffler.type = 'lowpass';
    muffler.frequency.value = 190;
    const generator = ctx.createGain();
    generator.gain.value = 0;
    const shudder = ctx.createOscillator();
    shudder.frequency.value = 11;
    const shudderDepth = ctx.createGain();
    shudderDepth.gain.value = 0;
    shudder.connect(shudderDepth).connect(generator.gain);
    const engine = [52, 78.4].map((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.connect(muffler);
      return osc;
    });
    muffler.connect(generator).connect(master);

    // Crickets: one high note, chopped fast, coming and going.
    const cricket = ctx.createOscillator();
    cricket.frequency.value = 4300;
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    const chopper = ctx.createOscillator();
    chopper.type = 'square';
    chopper.frequency.value = 26;
    const chopDepth = ctx.createGain();
    chopDepth.gain.value = 0.5;
    chopper.connect(chopDepth).connect(chop.gain);
    const crickets = ctx.createGain();
    crickets.gain.value = 0;
    const lull = ctx.createOscillator();
    lull.frequency.value = 0.31;
    const lullDepth = ctx.createGain();
    lullDepth.gain.value = 0;
    lull.connect(lullDepth).connect(crickets.gain);
    cricket.connect(chop).connect(crickets).connect(master);

    const sources = [bed, swell, shudder, ...engine, cricket, chopper, lull];
    for (const node of sources) node.start();

    return {
      noise,
      sources,
      wind,
      generator,
      shudderDepth,
      crickets,
      lullDepth,
    };
  }

  // Ease a gain toward a level instead of jumping to it.
  const ease = (param, value, seconds = 0.6) =>
    param.setTargetAtTime(value, ctx.currentTime, seconds / 3);

  function sync() {
    if (!ctx) return;
    master.gain.setTargetAtTime(isMuted ? 0 : VOLUME, ctx.currentTime, 0.05);
    if (held || isMuted) {
      if (ctx.state === 'running') ctx.suspend().catch(() => {});
    } else if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  return {
    /** Call from a pointer or key press: the first one starts the sound. */
    unlock() {
      if (isMuted || !ensure()) return;
      sync();
    },
    get muted() {
      return isMuted;
    },
    setMuted(value) {
      isMuted = Boolean(value);
      if (!isMuted) ensure();
      sync();
    },
    /** Silence everything while the game can't be seen. */
    hold(value) {
      held = Boolean(value);
      sync();
    },
    /** Play a one-shot by name; `place` takes the kind of building. */
    play(name) {
      if (!ctx || isMuted || held || ctx.state !== 'running') return;
      const sound = SOUNDS[name];
      if (sound) sound();
    },
    place(kind) {
      this.play(PLACE[kind] || 'panel');
    },
    /**
     * Tell the ambience what the island is doing: `wind` and `night` from 0
     * to 1, whether the `generator` is running, how much of the island's
     * power is `clean`, and whether time is `paused`.
     */
    ambience({
      wind = 0,
      generator = false,
      night = 0,
      clean = 0,
      paused = false,
    } = {}) {
      if (!ctx || isMuted || held || ctx.state !== 'running') return;
      ease(scene.wind.gain, 0.004 + wind * 0.05, 1.5);
      const running = generator && !paused;
      ease(scene.generator.gain, running ? 0.085 : 0, running ? 0.5 : 1.8);
      ease(scene.shudderDepth.gain, running ? 0.02 : 0, 0.5);
      ease(scene.crickets.gain, night * 0.012, 2);
      ease(scene.lullDepth.gain, night * 0.008, 2);
      // A gull now and then, by day, over an island that has earned them.
      const now = ctx.currentTime;
      if (!paused && night < 0.3 && clean > 0.2 && now > nextGull) {
        if (nextGull > 0) SOUNDS.gull();
        nextGull = now + (6 + Math.random() * 16) / Math.min(1, clean + 0.2);
      }
    },
    dispose() {
      if (!ctx) return;
      for (const node of scene.sources) {
        try {
          node.stop();
        } catch {
          // Already stopped.
        }
      }
      ctx.close().catch(() => {});
      ctx = null;
    },
  };
}
