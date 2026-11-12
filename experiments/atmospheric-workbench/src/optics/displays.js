// What goes into the air, and a shelf of skies to start from.
//
// A halo has no recipe of its own. What there is to choose is the crystals:
// their shape, and how they lie as they fall. The names on the right are
// what each kind is known for making, as worked out by the people who trace
// these for a living (see FieldNotes); the bench doesn't use them, it only
// traces the rays.

export const CRYSTALS = [
  {
    key: 'random',
    name: 'Tumbling crystals',
    how: 'Small or lumpy crystals that turn every way as they fall.',
    makes: ['22° halo', '46° halo'],
    ratio: 1,
    wobble: 0,
    wobbles: false,
  },
  {
    key: 'plate',
    name: 'Plates',
    how: 'Flat six-sided plates that fall level, like leaves.',
    makes: ['Sun dogs', 'Circumzenithal arc', 'Parhelic circle'],
    ratio: 0.3,
    wobble: 1,
    wobbles: true,
  },
  {
    key: 'column',
    name: 'Columns',
    how: 'Pencil-shaped crystals that fall on their sides, free to roll.',
    makes: ['Tangent arcs', 'Circumscribed halo', 'Supralateral arc'],
    ratio: 2.5,
    wobble: 0.5,
    wobbles: true,
  },
  {
    key: 'parry',
    name: 'Parry columns',
    how: 'Columns that fall on their sides with two faces level, and don’t roll.',
    makes: ['Parry arcs'],
    ratio: 2.5,
    wobble: 0.5,
    wobbles: true,
  },
];

export const CRYSTAL_KEYS = CRYSTALS.map((c) => c.key);

/** Every kind, none of it in the air yet. */
export function emptyAir() {
  return Object.fromEntries(
    CRYSTALS.map((c) => [
      c.key,
      { amount: 0, ratio: c.ratio, wobble: c.wobble },
    ]),
  );
}

/**
 * Skies to start from. `sun` is its height in degrees, `air` how much of
 * each crystal (0 to 1) with anything else about it that differs from the
 * shelf, `rain` a shower opposite the sun, and `look` where to turn to see
 * it: at the sun, well above it, under it, or the other way.
 */
export const DISPLAYS = [
  {
    key: 'halo',
    name: '22° halo',
    note: 'The common one: a ring round the sun, red on the inside.',
    sun: 38,
    air: { random: { amount: 1 } },
    look: 'sun',
  },
  {
    key: 'dogs',
    name: 'Sun dogs',
    note: 'Parhelia: a bright patch either side of a low sun.',
    sun: 12,
    air: { plate: { amount: 1 }, random: { amount: 0.25 } },
    look: 'sun',
  },
  {
    key: 'cza',
    name: 'Circumzenithal arc',
    note: 'An upside-down rainbow near the top of the sky. Only under a 32° sun.',
    sun: 20,
    air: { plate: { amount: 1 }, random: { amount: 0.2 } },
    look: 'above',
  },
  {
    key: 'parhelic',
    name: 'Parhelic circle',
    note: 'A white line right round the sky at the height of the sun.',
    sun: 28,
    air: { plate: { amount: 1, ratio: 0.9 }, column: { amount: 0.5 } },
    look: 'sun',
  },
  {
    key: 'tangent',
    name: 'Tangent arcs',
    note: 'Wings on the top and bottom of the 22° halo.',
    sun: 16,
    air: { column: { amount: 1 }, random: { amount: 0.35 } },
    look: 'sun',
  },
  {
    key: 'circumscribed',
    name: 'Circumscribed halo',
    note: 'With the sun above 29° the tangent arcs join into one oval.',
    sun: 50,
    air: { column: { amount: 1 }, random: { amount: 0.3 } },
    look: 'sun',
  },
  {
    key: 'parry',
    name: 'Parry arc',
    note: 'A second arc over the upper tangent arc, from columns that don’t roll.',
    sun: 22,
    air: {
      parry: { amount: 1 },
      column: { amount: 0.5 },
      random: { amount: 0.2 },
    },
    look: 'sun',
  },
  {
    key: 'winter',
    name: 'A cold morning',
    note: 'Everything at once, the way it sometimes is in diamond dust.',
    sun: 22,
    air: {
      random: { amount: 0.5 },
      plate: { amount: 1 },
      column: { amount: 0.8 },
      parry: { amount: 0.3 },
    },
    look: 'sun',
  },
  {
    key: 'cha',
    name: 'Circumhorizon arc',
    note: 'A band of colour low under a high summer sun. Only above 58°.',
    sun: 66,
    air: { plate: { amount: 1 }, random: { amount: 0.2 } },
    look: 'below',
  },
  {
    key: 'rainbow',
    name: 'Rainbow',
    note: 'Rain opposite a low sun. The second bow is the other way up.',
    sun: 16,
    air: {},
    rain: 1,
    look: 'away',
  },
];
