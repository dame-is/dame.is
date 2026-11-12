// The things on the tray: whatever can be put on a plate that isn't alive.
//
// Each is a stamp into the agar's chemistry (and for the two tools, onto the
// surface). `drop` lists what a stamp adds, in the agar's own channels:
//
//   nutrient, surfactant, toxinX, signal, acid (negative = alkali), toxinY,
//   paper (a disc you can see)
//
// and in the reagents' (shaders/reagents.js):
//
//   dye (a colour, kept as what it absorbs), indicator, ttc, calcofluor,
//   fluorescein
//
// A drop spreads from where it lands at the rate of the thing dropped. Set
// down, it is a drop of `radius`; dragged across the gel, it is drawn as a
// line `line` wide either side, and a disc is a ribbon of soaked paper.

export const ADDITIONS = [
  {
    id: 'penicillin',
    name: 'Antibiotic disc',
    after: 'a penicillin disc',
    kind: 'disc',
    blurb:
      'A 6 mm paper disc soaked in something that stops the Gram-positives. It clears a round zone, sharp at the edge.',
    notes: [
      {
        text: 'The zone’s edge is set early: it is where the drug had reached a stopping dose by the time the lawn was dense enough not to care. The drug keeps spreading afterwards; the edge doesn’t move.',
        href: 'https://asm.org/ASM/media/protocol-images/Kirby-Bauer-Disk-Diffusion-Susceptibility-Test-Protocol.pdf',
      },
    ],
    radius: 3,
    line: 2.5,
    drop: { toxinX: 12, paper: 1 },
  },
  {
    id: 'biocide',
    name: 'Biocide disc',
    after: 'a disinfectant disc',
    kind: 'disc',
    blurb:
      'A disc of something cruder. Nearly everything on the shelf gives it room; the moulds give it less.',
    notes: [],
    radius: 3,
    line: 2.5,
    drop: { toxinY: 9, paper: 1 },
  },
  {
    id: 'etest',
    name: 'Gradient strip',
    after: 'an Etest strip',
    kind: 'disc',
    blurb:
      'A strip carrying an antibiotic that halves fourteen times from one end to the other. Laid on a lawn it clears an ellipse, widest at the strong end, and where the ellipse meets the strip is the dose that stops the lawn.',
    notes: [
      {
        text: 'Gradient strips were first made in 1991. They give an elliptical zone, and the minimum inhibitory concentration is read where its edge crosses the strip.',
        href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6627445/',
      },
    ],
    radius: 2.5,
    // Laid as a whole: the strong end where the hand starts, the strip
    // pointing the way it is dragged. Set down with a touch, it lies along
    // the radius with its strong end toward the middle.
    strip: { length: 50, halvings: 14 },
    drop: { toxinX: 24, paper: 1 },
  },
  {
    id: 'sugar',
    name: 'Sugar',
    after: 'a drop of glucose',
    kind: 'drop',
    blurb:
      'Food, where you put it. Growth thickens over it, and a swarm on its way past will turn toward it.',
    notes: [],
    radius: 3.5,
    line: 1.2,
    drop: { nutrient: 1.6 },
  },
  {
    id: 'signal',
    name: 'Signal',
    after: 'a drop of autoinducer',
    kind: 'drop',
    blurb:
      'The molecule Violet and Lantern use to count themselves. A drop of it tells whatever is listening that the crowd has arrived.',
    notes: [
      {
        text: 'Quorum signals of this family are small lactones that cross agar about as fast as a sugar does, and fall apart over hours.',
        href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC148055/',
      },
    ],
    radius: 3,
    line: 1.2,
    drop: { signal: 4 },
  },
  {
    id: 'acid',
    name: 'Acid',
    after: 'a drop of dilute acid',
    kind: 'drop',
    blurb:
      'Sours the gel where it lands. On a plate with an indicator in it, the colour turns at once and the stain spreads.',
    notes: [],
    radius: 3,
    line: 1.2,
    drop: { acid: 3 },
  },
  {
    id: 'alkali',
    name: 'Alkali',
    after: 'a drop of dilute base',
    kind: 'drop',
    blurb:
      'The other way. Most growth slows where the gel is far from neutral.',
    notes: [],
    radius: 3,
    line: 1.2,
    drop: { acid: -3 },
  },
  {
    id: 'soap',
    name: 'Surfactant',
    after: 'a drop of detergent',
    kind: 'drop',
    blurb:
      'Wets the surface, so swarmers can move where the plate was too dry, and pushes them away from where it is strongest.',
    notes: [
      {
        text: 'A mutant Bacillus that makes no surfactin can’t spread, and spreads again when surfactant is added to the plate.',
        href: 'https://uni-muenster.de/Physik.TP/~thiele/Paper/TJLT2017prl.pdf',
      },
    ],
    radius: 3,
    line: 1.2,
    drop: { surfactant: 5 },
  },
  {
    id: 'dye-violet',
    name: 'Crystal violet',
    after: 'crystal violet',
    kind: 'dye',
    blurb:
      'A purple stain that every cell takes up. A colony stains from the side the dye reaches first, deepest in the floors of its folds, and draws the colour out of the gel round it.',
    notes: [
      {
        text: 'Crystal violet stains whatever is stuck to a surface, cells and the matrix they make alike, which is why it is the usual way to measure how much biofilm has grown.',
        href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC4568995/',
      },
    ],
    radius: 2.4,
    line: 0.9,
    drop: { dye: '#55278f', strength: 2.6 },
  },
  {
    id: 'dye-blue',
    name: 'Methylene blue',
    after: 'methylene blue',
    kind: 'dye',
    blurb:
      'A blue stain. Where it meets a yellow pigment in the gel the gel goes green by itself.',
    notes: [],
    radius: 2.4,
    line: 0.9,
    drop: { dye: '#1c5aa6', strength: 2.6 },
  },
  {
    id: 'dye-red',
    name: 'Safranin',
    after: 'safranin',
    kind: 'dye',
    blurb: 'A red stain, the counterstain to crystal violet.',
    notes: [],
    radius: 2.4,
    line: 0.9,
    drop: { dye: '#c12c48', strength: 2.6 },
  },
  {
    id: 'fluorescein',
    name: 'Fluorescein',
    after: 'sodium fluorescein',
    kind: 'dye',
    blurb:
      'Yellow in the gel and green where light catches it, even in daylight. It glows under the ultraviolet lamp too, though that isn’t the light that suits it, and it fades where the gel turns acid.',
    notes: [
      {
        text: 'Fluorescein absorbs best at 490 nm and glows at 514. It is a weak acid, and below pH 7 it loses much of its glow.',
        href: 'https://www.thermofisher.com/us/en/home/references/molecular-probes-the-handbook/fluorophores-and-their-amine-reactive-derivatives/fluorescein-oregon-green-and-rhodamine-green-dyes.html',
      },
      {
        text: 'At the 365 nm of an ultraviolet lamp it absorbs only a few per cent as much as at its peak.',
        href: 'https://omlc.org/spectra/PhotochemCAD/html/037.html',
      },
    ],
    radius: 2.4,
    line: 0.9,
    drop: { fluorescein: 3 },
  },
  {
    id: 'universal',
    name: 'Universal indicator',
    after: 'universal indicator',
    kind: 'dye',
    blurb:
      'A mix of indicators that runs from red through yellow and green to violet as the gel goes from acid to alkaline. Dropped near a colony, it maps what the colony is doing to the gel.',
    notes: [],
    radius: 4,
    line: 1.2,
    drop: { indicator: 8 },
  },
  {
    id: 'ttc',
    name: 'Tetrazolium',
    after: 'TTC, triphenyltetrazolium chloride',
    kind: 'dye',
    blurb:
      'Colourless until a living cell turns it red. Growth that is still feeding goes deep red; old, starved growth stays pale.',
    notes: [
      {
        text: 'TTC is colourless as it is and red once microorganisms reduce it, to a formazan that doesn’t dissolve, so the colour stays with the cells that made it.',
        href: 'https://www.scielo.br/j/rm/a/V7P89Qhddc86rDLP38Xzcbz/?lang=en',
      },
    ],
    radius: 4,
    line: 1.2,
    drop: { ttc: 6 },
  },
  {
    id: 'calcofluor',
    name: 'Calcofluor white',
    after: 'calcofluor white',
    kind: 'dye',
    blurb:
      'Invisible under the lamp. It sticks to the chitin in a mould’s walls and the cellulose in some films, and glows blue under ultraviolet wherever it has stuck.',
    notes: [
      {
        text: 'Calcofluor binds β-glucans, chitin and cellulose among them, and glows blue (433 nm) under ultraviolet.',
        href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9849195/',
      },
      {
        text: 'Mixed into agar, it shows which colonies make cellulose: they glow under a 366 nm lamp.',
        href: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC1082824/',
      },
    ],
    radius: 3.5,
    line: 1.2,
    drop: { calcofluor: 4 },
  },
  {
    id: 'scalpel',
    name: 'Scalpel',
    after: 'a scalpel',
    kind: 'tool',
    blurb:
      'Cuts the gel out down to the plastic. Nothing grows across a cut and nothing diffuses across it either.',
    notes: [],
    radius: 0.9,
    cut: true,
  },
  {
    id: 'loop',
    name: 'Sterile loop',
    after: 'a flamed loop',
    kind: 'tool',
    blurb: 'Scrapes growth off the surface and leaves the gel as it was.',
    notes: [],
    radius: 1.7,
    scrape: true,
  },
];

const BY_ID = new Map(ADDITIONS.map((a) => [a.id, a]));

export function additionById(id) {
  return BY_ID.get(id) || null;
}

export const ADDITION_KINDS = [
  { kind: 'disc', label: 'Discs' },
  { kind: 'drop', label: 'Drops' },
  { kind: 'dye', label: 'Dyes and stains' },
  { kind: 'tool', label: 'Tools' },
];
