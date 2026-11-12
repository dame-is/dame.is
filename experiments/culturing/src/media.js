// The media: what a plate is poured from.
//
// A medium is how much there is to eat, how firm the gel is, what colour it
// is, and what it does when something growing on it changes it. Like the
// cultures, each is modelled on a real one (`after`), and the colours are
// estimates from manufacturers' descriptions of the prepared plate.
//
//   nutrient   1 is a rich broth agar
//   agar       percent; 1.5 is the standard firm plate, 0.5 a swarm plate
//   diffusion  mm²/h for whatever limits growth; left out, a sugar's
//   salt       true for a medium only salt-lovers and the salt-tolerant like
//   selects    growth multipliers by a culture's tags
//   ph         where the gel starts, as a shift from neutral (+ is acid)
//   buffer     how fast it pulls back toward that, per hour
//   look       see MEDIUM_LOOK_DEFAULTS in pack.js

export const MEDIA = [
  {
    id: 'broth',
    name: 'Broth agar',
    after: 'LB or nutrient agar',
    blurb:
      'The everyday plate: straw-coloured, clear, rich and firm. Most things grow on it and nothing shows off.',
    notes: [
      {
        text: 'Prepared LB agar is yellow-amber and clear to slightly opalescent.',
        href: 'https://www.himedialabs.com/media/TD/M1151.pdf',
      },
    ],
    nutrient: 1,
    agar: 1.5,
    look: { color: '#e0d093', opacity: 0.15 },
  },
  {
    id: 'swarm',
    name: 'Swarm agar',
    after: 'a 0.5 % swarm plate',
    blurb:
      'A third of the usual agar and half the food. Wet enough on top for anything that can travel to travel, and lean enough that it has to branch to do it.',
    notes: [
      {
        text: 'Surface movement needs a soft plate: Bacillus subtilis stops above about 0.8 % agar, and Pseudomonas swarm assays are run at 0.4–0.55 %.',
        href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8073002/',
      },
    ],
    nutrient: 0.3,
    agar: 0.5,
    look: { color: '#dccc8e', opacity: 0.11 },
  },
  {
    id: 'lean',
    name: 'Lean agar',
    after: 'peptone-poor hard agar',
    blurb:
      'Firm, pale and nearly empty. Colonies can’t round out on it: they reach.',
    notes: [
      {
        text: 'On hard agar with under a gram of peptone a litre, Bacillus subtilis grows as a branching fractal that takes a month to cross the dish. Here it is quicker than life.',
        href: 'https://arxiv.org/abs/cond-mat/9904367',
      },
      {
        text: 'The equations that reproduce those branches only draw them at the right width if the limiting nutrient diffuses about a hundred times more slowly than a sugar does in agar. This plate takes the same liberty the papers do.',
        href: 'https://arxiv.org/abs/cond-mat/9807088',
      },
    ],
    nutrient: 0.3,
    agar: 1.5,
    diffusion: 0.2,
    look: { color: '#e2dab2', opacity: 0.1 },
  },
  {
    id: 'blood',
    name: 'Blood agar',
    after: 'blood agar',
    blurb:
      'Opaque cherry red. Some cultures dissolve the red around themselves and leave a clear halo; put the plate on the light table to see it.',
    notes: [
      {
        text: 'Complete (beta) haemolysis is a clear, transparent zone round the colony, and is meant to be read with the light behind the plate.',
        href: 'https://asm.org/ASM/media/protocol-images/Blood-Agar-Plates-and-Hemolysis-Protocols.pdf',
      },
    ],
    nutrient: 1.15,
    agar: 1.5,
    look: {
      color: '#96192e',
      opacity: 0.96,
      clear: '#d9b062',
      clearOpacity: 0.2,
      clearGain: 3.5,
    },
  },
  {
    id: 'mannitol',
    name: 'Salt & mannitol',
    after: 'mannitol salt agar',
    blurb:
      'Red, and salty enough to stop most things. Whatever does grow and sours it turns the red to yellow.',
    notes: [
      {
        text: 'The indicator is phenol red: yellow below pH 6.9, red to 8.4, pink above. The 7.5 % salt selects for staphylococci and their like.',
        href: 'https://asm.org/ASM/media/protocol-images/Mannitol-Salt-Agar-Plates-Protocols.pdf',
      },
    ],
    nutrient: 0.9,
    agar: 1.5,
    salt: true,
    buffer: 0.02,
    look: {
      color: '#cf4f45',
      opacity: 0.32,
      acid: '#e8c62c',
      alkali: '#c2286e',
      phRange: 1.0,
    },
  },
  {
    id: 'bile',
    name: 'Bile & lactose',
    after: 'MacConkey agar',
    blurb:
      'Rose-coloured, with bile salts that hold back the Gram-positives. Acid-makers go hot pink and cloud the gel; the rest stay pale.',
    notes: [
      {
        text: 'Lactose fermenters drop the pH under 6.8, the neutral red turns pink-red, and the bile salts precipitate as a hazy halo.',
        href: 'https://asm.org/ASM/media/protocol-images/MacConkey-Agar-Plates-Protocols.pdf',
      },
    ],
    nutrient: 0.9,
    agar: 1.5,
    selects: { 'gram-positive': 0.04, mould: 0.3, yeast: 0.3 },
    buffer: 0.025,
    look: {
      color: '#c4707a',
      opacity: 0.34,
      acid: '#d21f55',
      alkali: '#d8c592',
      phRange: 1.0,
    },
  },
  {
    id: 'congo',
    name: 'Congo red',
    after: 'Congo red biofilm plates',
    blurb:
      'A brick-orange plate whose dye sticks to biofilm matrix. Films that build one come up red and every fold shows.',
    notes: [
      {
        text: 'Congo red binds the amyloid fibres and cellulose of the matrix, which is how biofilm colony morphology is usually photographed: red, dry and rough for strains that make both.',
        href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC10459773',
      },
      {
        text: 'On these plates a Pseudomonas that can’t make its phenazines wrinkles a day early and far more, to get more of itself near the air.',
        href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3624522',
      },
    ],
    nutrient: 0.8,
    agar: 1.0,
    look: { color: '#c7714c', opacity: 0.24, dye: '#a3121f' },
  },
  {
    id: 'morphology',
    name: 'Morphology agar',
    after: 'Congo red and Coomassie blue colony-morphology plates',
    blurb:
      'The same dye with a blue one beside it, in a softer, leaner gel. What takes them up comes out violet, and a film spreads wide enough on it to show everything it does.',
    notes: [
      {
        text: 'Colony biofilms are grown for days on 1 % tryptone and 1 % agar carrying both dyes, and photographed as they wrinkle: the standard assay for what a mutation does to a colony’s shape.',
        href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC3624522',
      },
    ],
    nutrient: 0.7,
    agar: 0.9,
    look: { color: '#7e6a8c', opacity: 0.26, dye: '#7a2a9e' },
  },
  {
    id: 'potato',
    name: 'Potato dextrose',
    after: 'potato dextrose agar',
    blurb:
      'Pale, sweet and a little sour: the mould plate. Bacteria manage on it; fungi prefer it.',
    notes: [
      {
        text: 'Prepared at about pH 5.6, which favours fungi over most bacteria.',
        href: 'https://www.himedialabs.com/media/TD/M096.pdf',
      },
    ],
    nutrient: 1,
    agar: 1.5,
    ph: 0.7,
    buffer: 0.06,
    selects: { mould: 1.3, yeast: 1.2 },
    look: { color: '#e6dcae', opacity: 0.16 },
  },
  {
    id: 'litmus',
    name: 'Indicator agar',
    after: 'bromothymol blue lactose agar',
    blurb:
      'Green while it is neutral. Acid turns it yellow and alkali blue, so every colony draws a weather map of what it is doing to the gel.',
    notes: [
      {
        text: 'Bromothymol blue is yellow under pH 6.0, green near neutral and blue over 7.6.',
        href: 'https://en.wikipedia.org/wiki/Bromothymol_blue',
      },
    ],
    nutrient: 1,
    agar: 1.5,
    buffer: 0.02,
    look: {
      color: '#5a8a50',
      opacity: 0.3,
      acid: '#e2c22e',
      alkali: '#2c62b4',
      phRange: 1.0,
    },
  },
  {
    id: 'milk',
    name: 'Milk agar',
    after: 'skim milk agar',
    blurb:
      'White and opaque with milk protein. A culture that digests it eats a clear window into the plate.',
    notes: [
      {
        text: 'Casein keeps the plate cloudy; a colony that secretes a protease is ringed by a clear zone.',
      },
    ],
    nutrient: 0.9,
    agar: 1.5,
    look: {
      color: '#ebe6d6',
      opacity: 0.9,
      clear: '#d9cfa2',
      clearOpacity: 0.14,
      clearGain: 3,
    },
  },
  {
    id: 'sea',
    name: 'Seawater agar',
    after: 'marine agar',
    blurb:
      'Broth agar made up in seawater, for the cultures that came out of it. The salt-shy stay small.',
    notes: [
      {
        text: 'The iridescent Cellulophaga and the luminous Aliivibrio are both marine and need the salt.',
        href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4730217',
      },
    ],
    nutrient: 0.9,
    agar: 1.2,
    salt: true,
    look: { color: '#d6cc98', opacity: 0.13 },
  },
  {
    id: 'chromogenic',
    name: 'Chromogenic agar',
    after: 'CHROMagar Orientation',
    blurb:
      'A pale plate laced with substrates that are colourless until a particular enzyme cuts them. Each kind of culture comes up in the colour its own enzymes make: pink, metallic blue, a brown halo, or nothing different at all.',
    notes: [
      {
        text: 'On it E. coli is dark pink to reddish; Klebsiella, Enterobacter, Citrobacter and Serratia metallic blue; Proteus has a brown halo; Pseudomonas stays translucent and S. aureus golden.',
        href: 'https://www.chromagar.com/wp-content/uploads/2021/11/NT-EXT-002-V13.1.pdf',
      },
    ],
    nutrient: 1,
    agar: 1.5,
    look: { color: '#e5dfcf', opacity: 0.5, chromogenic: true },
  },
  {
    id: 'charcoal',
    name: 'Charcoal agar',
    after: 'charcoal agar',
    blurb:
      'Black and opaque. Nothing shows through it, so every colour sits on it like paint, and anything that glows has the stage.',
    notes: [
      {
        text: 'Activated charcoal makes the prepared plate black and opaque.',
        href: 'https://www.himedialabs.com/media/TD/M344.pdf',
      },
    ],
    nutrient: 0.95,
    agar: 1.5,
    look: { color: '#161616', opacity: 0.98 },
  },
];

const BY_ID = new Map(MEDIA.map((m) => [m.id, m]));

export function mediumById(id) {
  return BY_ID.get(id) || null;
}

/** The softest and firmest gel the agar slider will pour. */
export const AGAR_RANGE = { min: 0.3, max: 2.5, step: 0.1 };
/** The leanest and richest. */
export const NUTRIENT_RANGE = { min: 0.1, max: 1.5, step: 0.05 };

/**
 * A gradient plate (Szybalski 1952): poured first as a wedge with the dish
 * tilted, then level with something added, so that once it has diffused
 * down through the wedge there is more of it toward one side. Here it runs
 * from none on the left to the most on the right, across every
 * compartment.
 *
 *   antibiotic  toxin X, up to about what a disc gives a few mm out
 *   sugar       food, on top of what the medium has
 *   ph          from alkaline on the left to acid on the right, and buffered
 *               there: the gel keeps its gradient
 */
export const GRADIENTS = [
  {
    value: 'antibiotic',
    label: 'Antibiotic',
    hint: 'None on the left, more and more to the right: each culture stops where it can’t take any more.',
  },
  {
    value: 'sugar',
    label: 'Sugar',
    hint: 'The medium as it is on the left, twice as rich on the right.',
  },
  {
    value: 'ph',
    label: 'pH',
    hint: 'Alkaline on the left, acid on the right. Put it in an indicator medium to see it.',
  },
];

/** The extra a gradient puts in at its strong side. */
export const GRADIENT_PEAK = { antibiotic: 5, sugar: 1, ph: 1.6 };
