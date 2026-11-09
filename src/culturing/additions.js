// The things on the tray: whatever can be put on a plate that isn't alive.
//
// Each is a stamp into the agar's chemistry (and for the two tools, onto the
// surface). `drop` lists what a stamp adds, in the agar's own channels:
//
//   nutrient, surfactant, toxinX, signal, acid (negative = alkali), toxinY,
//   dye (a colour, kept as what it absorbs), paper (a disc you can see)
//
// A drop spreads from where it lands at the rate of the thing dropped.

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
    drop: { toxinY: 9, paper: 1 },
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
    drop: { surfactant: 5 },
  },
  {
    id: 'dye-violet',
    name: 'Crystal violet',
    after: 'crystal violet',
    kind: 'dye',
    blurb:
      'A drop of purple stain. Does nothing but spread, and look good doing it.',
    notes: [],
    radius: 2.4,
    drop: { dye: '#55278f', strength: 2.6 },
  },
  {
    id: 'dye-blue',
    name: 'Methylene blue',
    after: 'methylene blue',
    kind: 'dye',
    blurb:
      'A drop of blue. Where it meets a yellow pigment the gel goes green by itself.',
    notes: [],
    radius: 2.4,
    drop: { dye: '#1c5aa6', strength: 2.6 },
  },
  {
    id: 'dye-red',
    name: 'Safranin',
    after: 'safranin',
    kind: 'dye',
    blurb: 'A drop of red.',
    notes: [],
    radius: 2.4,
    drop: { dye: '#c12c48', strength: 2.6 },
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
  { kind: 'dye', label: 'Dyes' },
  { kind: 'tool', label: 'Tools' },
];
