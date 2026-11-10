// Plates worth starting from.
//
// Each of these is a recipe that shows one thing the model does on its own
// when the right cultures meet the right medium: nothing in it is drawn.
// `watch` says what to look for and how to look (some of these only show
// under the right light). `start` is how many hours the plate has already
// been in the incubator when it is first put on the bench, so there is
// something on it; events can also be set for a later hour, and happen when
// the plate gets there.

const TAU = Math.PI * 2;

/** Points along an arc, for a streak. Angles in turns. */
function arc(cx, cy, radius, from, to, steps = 18) {
  const path = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = (from + ((to - from) * i) / steps) * TAU;
    path.push([cx + Math.cos(t) * radius, cy + Math.sin(t) * radius]);
  }
  return path;
}

/** Points along a straight line. */
function line(x0, y0, x1, y1, steps = 10) {
  const path = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    path.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
  }
  return path;
}

const spot = (culture, x, y, extra = {}) => ({
  at: 0,
  do: 'spot',
  culture,
  x,
  y,
  seed: 1 + Math.round(Math.abs(x * 31 + y * 17)),
  ...extra,
});
const streak = (culture, path, extra = {}) => ({
  at: 0,
  do: 'streak',
  culture,
  path,
  seed: 11,
  ...extra,
});
const lawn = (culture, extra = {}) => ({
  at: 0,
  do: 'lawn',
  culture,
  seed: 5,
  ...extra,
});
const add = (addition, x, y, extra = {}) => ({
  at: 0,
  do: 'add',
  addition,
  x,
  y,
  ...extra,
});

export const RECIPES = [
  {
    id: 'wrinkles',
    name: 'Wrinkles',
    watch:
      'A film buckling as it grows: a maze in the middle first, then ridges running out to the rim as spokes. The dye in the plate shows every fold.',
    dish: {
      medium: 'congo',
      events: [spot('hay', 0, 0, { size: 2.2 })],
    },
    start: 44,
  },
  {
    id: 'palette',
    name: 'Palette',
    watch:
      'Four pigments, each on its own schedule. The yellow is there from the start, the red comes up from the middle of each streak, and the violet waits until it is crowded.',
    dish: {
      medium: 'broth',
      events: [
        streak('crimson', arc(0, 0, 27, 0.02, 0.23)),
        streak('lemon', arc(0, 0, 27, 0.27, 0.48)),
        streak('violet', arc(0, 0, 27, 0.52, 0.73)),
        streak('coral', arc(0, 0, 27, 0.77, 0.98)),
        spot('crimson', 0, 0),
        spot('violet', 9, 9),
        spot('lemon', -9, 9),
        spot('coral', -9, -9),
        spot('lemon', 9, -9),
      ],
    },
    start: 30,
  },
  {
    id: 'bullseye',
    name: 'Bull’s-eye',
    watch:
      'A swarm that moves and rests by turns. Each rest leaves a ring in the film, so the colony keeps a record of its own stops and starts.',
    dish: {
      medium: 'broth',
      env: { temperature: 34 },
      events: [spot('bullseye', 0, 0)],
    },
    start: 20,
  },
  {
    id: 'zone',
    name: 'Zone of inhibition',
    watch:
      'A lawn coming up everywhere except round the disc. The clear zone’s edge is drawn in the first few hours and then stays put.',
    dish: {
      medium: 'broth',
      env: { temperature: 36 },
      events: [lawn('gold'), add('penicillin', -12, 6), add('biocide', 14, -8)],
    },
    start: 9,
  },
  {
    id: 'mould',
    name: 'The mould and the lawn',
    watch:
      'A mould that got there a day before the bacteria. They grow everywhere but near it: the plate a contaminated culture dish made famous.',
    dish: {
      medium: 'broth',
      env: { temperature: 28 },
      events: [spot('velvet', -20, 8, { size: 2 }), lawn('gold', { at: 30 })],
    },
    start: 34,
  },
  {
    id: 'sectors',
    name: 'Sectors',
    watch:
      'Two strains alike in everything but a tag, mixed in one drop. On the bench it is one grey colony. Switch to ultraviolet.',
    light: 2,
    dish: {
      medium: 'broth',
      env: { temperature: 36 },
      events: [
        spot('cyan-tag', 0, 0, { size: 3, mixed: true, seed: 3 }),
        spot('yellow-tag', 0, 0, { size: 3, mixed: true, seed: 8 }),
      ],
    },
    start: 20,
  },
  {
    id: 'eavesdrop',
    name: 'Eavesdropping',
    watch:
      'A lawn that can hear but not speak, and one colony in the middle that speaks. The lawn turns violet as far as the signal carries.',
    dish: {
      medium: 'broth',
      events: [lawn('listener'), spot('violet', 0, 0, { size: 2.2 })],
    },
    start: 18,
  },
  {
    id: 'fingers',
    name: 'Fingers',
    watch:
      'A swarm on a soft, lean plate, breaking into fingers because the front has outrun its food. The gel behind it goes blue-green; under ultraviolet it glows.',
    dish: {
      medium: 'swarm',
      env: { temperature: 36 },
      events: [spot('verdigris', 0, 0, { size: 2.2 })],
    },
    start: 18,
  },
  {
    id: 'feathers',
    name: 'Standoff',
    watch:
      'Three colonies of one branching culture. They grow toward the empty agar and away from each other, and leave a gap where they should have met.',
    dish: {
      medium: 'lean',
      events: [
        spot('feather', -15, -9),
        spot('feather', 15, -9),
        spot('feather', 0, 17),
      ],
    },
    start: 60,
  },
  {
    id: 'rings',
    name: 'Day rings',
    watch:
      'A mould that fruits only where it was young at dawn. Leave the incubator on its day-and-night cycle and it keeps a calendar; set the light to dark and it stays white.',
    dish: {
      medium: 'potato',
      env: { temperature: 26, light: 'cycle' },
      events: [spot('rings', 0, 0, { size: 1.5 })],
    },
    start: 30,
  },
  {
    id: 'weather',
    name: 'Weather map',
    watch:
      'An indicator plate. The acid-makers push yellow fronts out into the green and the others push blue ones back, and where they meet the gel is at war with itself.',
    dish: {
      medium: 'litmus',
      events: [
        spot('gold', -16, 10),
        spot('soot', 14, 12, { size: 1.4 }),
        spot('bullseye', 0, -16),
        spot('hay', -18, -8),
      ],
    },
    start: 20,
  },
  {
    id: 'haemolysis',
    name: 'Halos',
    watch:
      'Colonies dissolving the blood around themselves. Hard to see from above; put the plate on the light table.',
    light: 1,
    dish: {
      medium: 'blood',
      env: { temperature: 36 },
      events: [
        streak('gold', line(-24, -10, 22, -14)),
        spot('gold', -10, 12),
        spot('violet', 12, 14),
        spot('lemon', 0, 2),
      ],
    },
    start: 24,
  },
  {
    id: 'lanterns',
    name: 'Lanterns',
    watch:
      'Nothing to see with the lights on. In the dark the thick parts of each streak shine first, because that is where the quorum is.',
    light: 3,
    dish: {
      medium: 'sea',
      env: { temperature: 22 },
      events: [
        streak('lantern', arc(0, 0, 24, 0.05, 0.6, 26)),
        streak('lantern', arc(0, 0, 12, 0.55, 1.1, 20)),
        spot('lantern', 0, 0),
      ],
    },
    start: 16,
  },
  {
    id: 'opal',
    name: 'Opal',
    watch:
      'A film with almost no colour of its own. Drag to turn the plate and watch it go from green to red to violet.',
    dish: {
      medium: 'sea',
      env: { temperature: 24 },
      events: [spot('opal', -8, 4, { size: 2.2 }), spot('opal', 14, -10)],
    },
    start: 40,
  },
  {
    id: 'moat',
    name: 'Moat',
    watch:
      'A ring cut out of the gel round a swarmer, with one gap left in it. Nothing crosses a cut, not the swarm and not the food on the far side: it fills its island and leaves by the gap.',
    dish: {
      medium: 'swarm',
      env: { temperature: 34 },
      events: [
        {
          at: 0,
          do: 'add',
          addition: 'scalpel',
          path: arc(0, 0, 21, 0.03, 0.97, 44),
        },
        spot('hay', 0, 0),
        spot('crimson', 0, 31),
      ],
    },
    start: 12,
  },
];

const BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

export function recipeById(id) {
  return BY_ID.get(id) || null;
}

/** What is on the bench the first time it is opened: four plates already
 *  growing, and two poured and waiting. */
export const OPENING_BENCH = [
  { recipe: 'wrinkles' },
  { recipe: 'palette' },
  { recipe: 'bullseye' },
  { recipe: 'zone' },
  { medium: 'swarm' },
  { medium: 'litmus' },
];
