# Sunfarming

A small island, a village, and the sun. Put down solar panels, wire them to the
houses, keep the spare in batteries for the night, and the village grows.

It is the beginnings of a game: one loop that works end to end, drawn in a
cel-shaded 3D style, on a grid. Everything past that is still to be found out.

```
npm run dev      # http://localhost:5180
npm test         # the rules of the game
npm run build    # a standalone build in dist/
```

(From the repo root: `npm run dev -w @dame-is/sunfarming`, and so on.)

## How it plays

The island is a 20 × 20 grid of sea, beach and grass. A village of three
houses stands on it, with nine more plots pegged out beside them.

- **Solar panels** (40 coins) make up to 1 kW each, following the sun: nothing
  at night, a half sine from dawn (6 am) to dusk (6 pm), full power at noon.
- **Things that touch share power.** A panel, a battery, a power line and a
  house all conduct to whatever stands on the four tiles beside them, so a
  block of panels is already wired together.
- **Power lines** (4 coins) carry power across a gap. Drag to lay a run.
- **Houses** want 0.4 kW each, day and night, and pay 5 coins for every
  kilowatt-hour they are actually sent. That is the only income.
- **Batteries** (100 coins) hold 8 kWh and move up to 2 kW. They fill on
  whatever the houses didn't need and hand it back after dark.
- **At dawn the day's books close.** If the village got at least 90% of the
  power it asked for, a family moves onto the next plot, and the village wants
  more.
- **Trees and rocks** are in the way and cost coins to clear. Buildings come
  back up for what they cost, so trying a different layout is free.

Five goals lead through it, each paying a bonus: wire a panel to the village,
light every house, last a whole day and night, reach six houses, fill all
twelve. The island is saved in `localStorage` and picked up on the next visit;
**New island** starts over on a different one.

### Controls

|                | mouse and keys                        | touch                 |
| -------------- | ------------------------------------- | --------------------- |
| Move the view  | drag with **Look**, or WASD / arrows  | drag with **Look**    |
| Turn the view  | right-drag, or Q / E                  | twist two fingers     |
| Zoom           | ctrl + wheel (plain wheel standalone) | pinch                 |
| Pick a tool    | 1 to 5; Esc for **Look**              | tap it                |
| Build / remove | click, or drag to paint               | tap, or drag to paint |
| Read a tile    | hover, or click with **Look**         | tap with **Look**     |
| Pause          | space                                 | the pause button      |

Embedded in a page, a plain scroll wheel is left to the page.

## How it is built

Three layers, each knowing nothing about the one above it:

```
src/
  sim/        the rules. Plain data and plain functions: no DOM, no GPU,
              no wall clock. A week on the island can be played out in a test.
  view/       the picture. three.js. Reads a game, never changes one.
  sunfarm.js  the game running: the clock that steps the sim and redraws the
              view, the pointer and keys that turn into building, the save.
  ui/         the HUD, in React, reading a snapshot of the running game.
  Sunfarming.jsx   the one component a host renders.
  index.js    the package's front door.
```

**The rules** ([`src/sim/`](src/sim/)). [`catalog.js`](src/sim/catalog.js) is
every number the game is balanced on, in real units (kW, kWh, hours).
[`island.js`](src/sim/island.js) grows an island from a seed: a coast, a
beach, woods, and the village's plots.
[`network.js`](src/sim/network.js) finds which things are wired to which with
a flood fill. [`game.js`](src/sim/game.js) is the state and everything that
changes it: building, removing, and `step(game, hours)`, where each network
balances on its own (panels feed houses, spare charges batteries, a shortfall
drains them, the rest is wasted). It also serialises a game to JSON and reads
one back, refusing anything that isn't a save.

**The picture** ([`src/view/`](src/view/)). The look is two old tricks
([`toon.js`](src/view/toon.js)): a three-step light ramp instead of smooth
shading, and an "inverted hull" outline, a second copy of each model drawn
inside out and pushed outwards along its normals. Models
([`models.js`](src/view/models.js)) are a few boxes and blobs merged into one
vertex-coloured geometry each, so a building is one mesh and one material
serves the whole scene. The sea ([`water.js`](src/view/water.js)) is a single
sheet whose shader knows how far each point is from land: banded shallows,
foam on the shore, rings of foam travelling in. The sky
([`sky.js`](src/view/sky.js)) is the day in keyframes, with one light that is
the sun by day and the moon by night. [`world.js`](src/view/world.js) keeps the
models in step with the game by comparing, every frame, what is on each tile
with what it drew there.

**The game running** ([`src/sunfarm.js`](src/sunfarm.js)) is framework-free:
`createSunfarm({ host })` puts a canvas in an element and returns
`{ subscribe, getSnapshot, setTool, setSpeed, … , destroy }`. The React HUD is
one reader of that; anything else could be another.

## Embedding it

```jsx
import Sunfarming from '@dame-is/sunfarming';

<div style={{ height: '80vh', '--sunfarm-height': '100%' }}>
  <Sunfarming />
</div>;
```

| prop        | what it does                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `fill`      | Take the whole window (what the standalone build does).                                            |
| `storage`   | Where the island is saved: `{ load, save, clear }`. Default: `localStorage`. `null` keeps nothing. |
| `onReady`   | Called with the running game once it is up.                                                        |
| `className` | Added to the root element.                                                                         |

Two CSS custom properties can be set from outside: `--sunfarm-height` (how
tall it is when embedded) and `--sunfarm-font` (the HUD's typeface). Everything
else it brings itself, scoped under `.sunfarm`.

`@dame-is/sunfarming/meta` exports `TITLE`, `PITCH` and `SLUG` on their own, so
a host can name the game without loading it.

In development the standalone page puts the running game on the console as
`sunfarm`: `sunfarm.game` is the live state, to poke at or fast-forward.

## What might come next

It is rough on purpose. Some of what it doesn't do yet:

- **Weather.** Clouds that actually shade panels, so a bank of batteries is
  insurance and not just a night light.
- **Somewhere to send the surplus.** An undersea cable to the mainland, paying
  less than the village does, so over-building is worth something.
- **More to build.** Trackers that follow the sun, wind turbines for the
  night, bigger batteries, transformers with a limit on what one line carries.
- **Demand with a shape.** An evening peak; a workshop that only runs by day.
- **Terrain.** Hills that shade their neighbours, cliffs that lines can't
  cross, more than one island.
- **Performance.** Every building is its own mesh. Past a few hundred, they
  should be instanced.
- **Sound.**
