# Culturing

A workbench of petri dishes that aren't real. Pour a medium, put cultures on
it, add a disc or a drop of dye, and leave it in the incubator. Nothing on it
is science, and everything on it is modelled on how real colonies and biofilms
look and grow; the page says which parts are borrowed from where, in the notes
on each culture and medium and in "What is real here" at its foot.

```
npm run dev      # http://localhost:5181
npm test         # what can be checked without a GPU
npm run build    # a standalone build in dist/
```

(From the repo root: `npm run dev -w @dame-is/culturing`, and so on.)

## How it is built

It carries a WebGL2 simulation and its shaders, so wherever it is embedded it
should be its own chunk, loaded only by the page that shows it.

- **The model** ([`shaders/culture.js`](src/shaders/culture.js),
  [`agar.js`](src/shaders/agar.js),
  [`wrinkle.js`](src/shaders/wrinkle.js)). A plate is a handful of
  float textures. Each of up to four cultures is a thin layer that travels and
  a film that stays; growth eats a nutrient that diffuses through the gel; a
  swarm is carried down the gradient of its own surfactant, faster where it
  lies thicker, which is what breaks its front into tendrils; a film buckles
  into wrinkles past a thickness (Swift–Hohenberg), a biofilm as it grows and
  a plain colony only after a couple of days, in folds that then set; toxins,
  quorum signals, acid, enzymes and pigments spread through the agar at half
  the surface's resolution. What is put on from the tray to look with (dyes,
  a universal indicator, tetrazolium, calcofluor, fluorescein) has textures
  and a pass of its own ([`reagents.js`](src/shaders/reagents.js)), run only
  on a plate that has had one: each spreads loose through the gel, and cells
  take up a dye and keep it. No pattern is drawn. Branches, tendrils, rings,
  spokes, sectors, halos and standoffs are what those rules do when they meet,
  which is why the cultures are only parameter sets
  ([`cultures.js`](src/cultures.js)).
- **Units.** Every number in the libraries is in millimetres and hours
  ([`units.js`](src/units.js) converts), so the same recipe grows
  the same plate at 256 texels (phones) or 384, and a culture's numbers can be
  read against a paper's. [`pack.js`](src/pack.js) turns a recipe
  into uniforms and clamps anything that would break the explicit schemes.
- **The grid** ([`units.js`](src/units.js) `gridSize`). A plate is worked out
  on 384 texels across (256 on a phone). The Incubator tab can ask for one
  size finer, which is about three times the work for every hour grown; the
  plates are let go and grown again from their records on the new grid.
- **Vessels** ([`vessels.js`](src/vessels.js)). A plate is poured into a
  dish, a bi-plate or a six-well plate, with a medium for each compartment.
  The pour writes which compartment each point of the agar is in, beside the
  pH its gel is buffered to, and the passes look up that compartment's food,
  buffer, selectivity and colour; nothing crosses from one to the next. All
  of a vessel is poured from one gel, so its firmness is the plate's. The
  six-well plate is two thirds of real size, to fit the grid a dish is worked
  out on. A gradient (antibiotic, sugar or pH) is poured as a ramp across the
  whole vessel, and any compartment can be tinted a colour picked by hand,
  which changes its look and nothing else.
- **The lid** ([`simulation.js`](src/simulation.js) `setLid`). A word typed in
  the Incubator tab is drawn in black on a texture the size of the plate,
  and the biology pass reads the incubator's light through it, so a culture
  that pigments only in the light (Day rings) or only in the dark
  (Darkroom) develops it. The word is part of the incubator's settings, so
  it is kept in the record with the hour it was put on or taken off.
- **The velvet** ([`tools.js`](src/tools.js) `printOf`). Pressing a velvet onto
  a grown plate reads its biomass back from the GPU and keeps, for each cell
  of a 64 × 64 grid over the dish, whichever culture has the most there.
  That map, as runs, is written into the other plate's record as a print, and
  stamped as a few cells along each run. So a printed plate is still only
  its recipe, and grows again without the plate it was printed from.
- **A plate is its recipe** ([`recipe.js`](src/recipe.js),
  [`incubate.js`](src/incubate.js)): the medium, the incubator, and
  everything done to it with the hour it was done. The picture is not kept.
  The bench is saved to `localStorage` as recipes and re-grown on return, and
  a plate travels in a link as `?plate=…`. Grown twice, a plate comes out
  alike but not the same.
- **Drawing** ([`renderer.js`](src/renderer.js),
  [`shaders/scene.js`](src/shaders/scene.js)). The surface is one
  displaced sheet per plate, lit four ways a microbiologist would recognise:
  a raking lamp over a black bench, a light table from underneath, a 365 nm
  lamp, and the dark. Heights are true and the vertical is stretched, by an
  amount the page states. A plate is a few hundred texels across and is
  looked at from much nearer than that, so the scene reads it through a cubic
  B-spline and makes every hard edge afterwards, from the smooth value: a
  colony's outline from its optical depth, a cut from how much gel is round
  the point. Made before, on the grid, those edges were staircases. Two things
  are drawn below the grid and say so on the page: a mould's tufts
  ([`shaders/display.js`](src/shaders/display.js)), which are noise in
  millimetres with the spore colour gathered on them, and a little fraying of
  a colony's outline up close.
- **The bench** ([`bench.js`](src/bench.js)) owns the canvas, the
  clock and the pointer, and knows nothing about React; the page reads a
  snapshot of it. A plate's clock runs ahead of its simulation by as much as
  the incubator's speed allows, so stopping the incubator (or putting a plate
  in the fridge) hands that lead back: a stopped plate stays at the hour it
  has reached. One that was still re-growing from its recipe waits where it
  stands and goes on when the incubator starts again.
- **Replay** ([`incubate.js`](src/incubate.js) `replayOf`). A plate can be
  watched again from the pour to the hour it stands at, in about twelve
  seconds whatever its age. It is the same record grown once more at a pace
  that can be followed, so nothing is kept for it and nothing in the record
  changes; a replay cut short puts the plate back at the age it was. The
  Record tab can film one (`MediaRecorder` on the canvas, MP4 where the
  browser makes it, WebM otherwise) and photograph the plate under all four
  lights on one sheet, drawing it four times while it holds still.
- **Randomize** ([`chance.js`](src/chance.js)) deals a plate nobody
  chose: a medium, a few cultures that can live on it, one of a handful of
  ways to lay them out (one big drop in the middle, two or three mixed in it,
  a ring, a pair facing each other, a scatter), and now and then something
  off the tray. Across the bench it deals every plate; with one picked up,
  that one. It only asks first when a plate holds something done by hand.
- **On a phone** ([`useCompact.js`](src/useCompact.js), and the last section
  of [`culturing.css`](src/culturing.css))
  the shelf lies on its side: each tab is a strip of chips that scrolls
  sideways with the card for what is picked under it, the bar is one row with
  the system's pickers for speed and light, and the camera's controls sit on
  the picture. The stage takes the height the rest leaves, so picking
  something up and putting it on a plate fits one screen.

[`src/culturing.test.js`](src/culturing.test.js) covers what can be checked without a GPU:
that every uniform a shader declares is supplied, that every culture on every
medium stays inside the schemes' stability bounds on every grid, that
recipes survive a link and reject what isn't one, that a stopped plate takes
no further step, that a drop mixes with a wet one of another culture and
with nothing else, and that a dealt plate is a recipe like any other.

## What it borrows from the site

Culturing was built as a page of dame.is and is dressed in the site's kit, so
unlike an experiment that brings its whole look with it, this one leans on the
repo around it in two places, and only these two:

- [`src/host.js`](src/host.js) re-exports four of the site's components
  (`Button`, `Segmented`, `Tag`, `SectionHead`). Everything else under `src/`
  imports them from there.
- [`standalone/host.css`](standalone/host.css) imports the site's base
  stylesheets (fonts, reset, theme tokens, typography, controls, app) for the
  standalone page. Embedded in the site they are already on the page.
  [`src/culturing.css`](src/culturing.css) is written in those tokens, and
  answers to the site's stylelint guards (`npm run lint:css` at the root).

So inside this repository it runs on its own, and to take it out those two
files are the list of what has to come with it: copy the four components and
the six stylesheets alongside, and point the two files at the copies.

## Embedding it

```jsx
import Culturing from '@dame-is/culturing';

<Culturing />;
```

It reads and writes `?plate=…` in the address through `react-router`, so it
has to be rendered inside a Router, on a page that has the site's base styles.
`@dame-is/culturing/meta` exports `TITLE`, `PITCH` and `SLUG` on their own.
