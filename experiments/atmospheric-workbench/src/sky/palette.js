// The colour of the sky by how high the sun is.
//
// Four skies, painted by hand, are pinned to the sun
// heights they were painted for, and anything between is a blend of its two
// neighbours. Night is its own sky, with the moon where the sun would be.

const hex = (h) => [
  parseInt(h.slice(1, 3), 16) / 255,
  parseInt(h.slice(3, 5), 16) / 255,
  parseInt(h.slice(5, 7), 16) / 255,
];
const paint = (o) =>
  Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? hex(v) : v]),
  );

export const COLOR_KEYS = [
  'top',
  'mid',
  'low',
  'hor',
  'floor',
  'sunCol',
  'lit',
  'shadow',
  'rim',
  'storm',
  'fog',
  'rain',
];

// `at` is the sun's height in degrees.
const DAY = [
  paint({
    at: -1,
    top: '#343B78',
    mid: '#6659A2',
    low: '#BC82A9',
    hor: '#F09F8A',
    floor: '#9D7896',
    sunCol: '#FF8E66',
    lit: '#F1B3A6',
    shadow: '#635E9C',
    rim: '#FF8A66',
    storm: '#3A3662',
    fog: '#86709F',
    rain: '#7D74A8',
    stars: 0.35,
    fogMax: 0.75,
  }),
  paint({
    at: 7,
    top: '#8496DA',
    mid: '#B9ACE2',
    low: '#F0BFB6',
    hor: '#FFD3A1',
    floor: '#F4D9C8',
    sunCol: '#FFB878',
    lit: '#FFE7CB',
    shadow: '#A69CCD',
    rim: '#FFB46A',
    storm: '#685C86',
    fog: '#EAC9BF',
    rain: '#8A7FB0',
    stars: 0,
    fogMax: 0.72,
  }),
  paint({
    at: 23.5,
    top: '#A7C4F2',
    mid: '#C4D7F6',
    low: '#E0E5F8',
    hor: '#F0EBF6',
    floor: '#F2EEF9',
    sunCol: '#FFE9C4',
    lit: '#FFFFFF',
    shadow: '#BCC5EE',
    rim: '#FFE2B5',
    storm: '#777BA6',
    fog: '#E3E7F7',
    rain: '#8C93C8',
    stars: 0,
    fogMax: 0.72,
  }),
  paint({
    at: 62,
    top: '#79A6EE',
    mid: '#A3C3F5',
    low: '#CBDDF8',
    hor: '#E7EFFA',
    floor: '#F1F5FC',
    sunCol: '#FFF8E6',
    lit: '#FFFFFF',
    shadow: '#B3C1E6',
    rim: '#FFFFFF',
    storm: '#6C7397',
    fog: '#D7E3F6',
    rain: '#8790BE',
    stars: 0,
    fogMax: 0.7,
  }),
];
const NIGHT = paint({
  top: '#0C1030',
  mid: '#181F52',
  low: '#2B3270',
  hor: '#41478A',
  floor: '#20244E',
  sunCol: '#8FA2E6',
  lit: '#B5C0EC',
  shadow: '#454C88',
  rim: '#C6D2FF',
  storm: '#22264A',
  fog: '#262C5E',
  rain: '#6D76B0',
  stars: 1,
  fogMax: 0.78,
});

const mix = (a, b, t) => a + (b - a) * t;

/**
 * The sky for a sun `altitude` degrees up: every colour in COLOR_KEYS as
 * [r, g, b] from 0 to 1, plus `stars` and `fogMax`.
 */
export function skyAt(altitude, night = false) {
  if (night) return NIGHT;
  if (altitude <= DAY[0].at) return DAY[0];
  const last = DAY[DAY.length - 1];
  if (altitude >= last.at) return last;
  let i = 0;
  while (altitude > DAY[i + 1].at) i++;
  const a = DAY[i];
  const b = DAY[i + 1];
  let t = (altitude - a.at) / (b.at - a.at);
  t = t * t * (3 - 2 * t);
  const out = {
    stars: mix(a.stars, b.stars, t),
    fogMax: mix(a.fogMax, b.fogMax, t),
  };
  for (const k of COLOR_KEYS) {
    out[k] = [0, 1, 2].map((c) => mix(a[k][c], b[k][c], t));
  }
  return out;
}

/**
 * Which way the sun is, as the sky's x and z: off to the right of the view
 * the bench opens on, so the clouds there are lit from the side.
 */
export const SUN_BEARING = [0.669, -0.743];

/** The unit vector toward a sun `altitude` degrees up. */
export function sunVector(altitude) {
  const a = (altitude * Math.PI) / 180;
  return [
    SUN_BEARING[0] * Math.cos(a),
    Math.sin(a),
    SUN_BEARING[1] * Math.cos(a),
  ];
}
