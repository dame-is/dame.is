# Sunfarming

A small island that runs on a diesel generator, and the sun. Put down solar
panels, mind the shade, keep the spare in batteries for the night, and the
village grows until the generator falls silent. Then there is another island.

It is a small game, drawn in a cel-shaded 3D style, on a grid.

```
npm run dev      # http://localhost:5180
npm test         # the rules of the game
npm run build    # a standalone build in dist/
```

(From the repo root: `npm run dev -w @dame-is/sunfarming`, and so on.)

## How it plays

Every island starts the same way: a few cottages, and an old generator on the
beach with a power line up to them. The lights are on from the first minute,
and every kilowatt-hour of it burns fuel.

- **The generator** fills whatever is short, up to what it can make (2 kW on
  most islands). Homes pay for the power they get, and the fuel (4 coins a
  kWh) comes out of that, so diesel power earns a little and sun power earns
  a lot. It is asked last, after the sun, the wind and the batteries.
- **Solar panels** (40) make up to 1 kW each along a half sine from dawn to
  dusk. **Things that touch share power**, so a panel against the old line is
  already wired in; **power lines** (4) cross a gap.
- **Shade is real.** A panel in the shadow of a tree, a home or a tall machine
  makes a quarter of what it would. The shadows on screen are the ones the
  rules use. With a panel in hand the ground shows a **sun map**: how much of
  the day's light each tile gets.
- **Batteries** (100) hold 8 kWh and fill on whatever the homes didn't need.
- **The village grows at dawn** after a day in which it got at least 90% of
  the power it asked for: a family moves onto the next plot, and up to two
  homes that have had enough good days move up a tier.
- **Each tier wants power at a harder time of day.** A cottage wants a little
  all the time. A house has an evening peak, after the sun has gone. A
  townhouse works by day, is busy all evening and charges overnight. Each
  pays more per kWh than the last.
- **New things to build turn up as the village grows**, and come with you to
  the next island: the **tracking panel** (85; follows the sun, so far more in
  the morning and evening), the **wind turbine** (160; blows at night and
  under cloud, best on the beach) and the **battery bank** (300; 28 kWh on one
  tile).
- **Weather and seasons.** Each day is clear, fair, cloudy or stormy, decided
  by the island's seed, so there is a forecast and it is always right. Cloud
  cuts the sun and brings wind. On islands with seasons a year is twelve
  days: summer days are long, winter days are short, weak and low, and winter
  shadows are long.
- **An island is finished** when every home is as far up as it can go and a
  whole day has passed with the generator silent. After the first such day
  the generator can be sent back on the boat.

The island answers: smoke over the generator while it runs, a fuel boat that
comes each morning for as long as fuel is burned, and flowers and gulls that
turn up as the sun takes over.

### The islands

Six of them, each opening when the one before runs on the sun, and each
leaning on one thing the others don't:

| island    | what is different                                    |
| --------- | ---------------------------------------------------- |
| Tern Rock | The first. Sunny, eight plots, homes stop at houses. |
| The Pines | Wooded nearly to the water. A shade puzzle.          |
| Windward  | More cloud than sun, and a lot of wind.              |
| Saltmarsh | A 16 × 16 grid with hardly any land.                 |
| Northing  | Seasons, starting in autumn.                         |
| Harbour   | 26 × 26, sixteen plots, all four seasons.            |

Once the first is done there are two more: **Today's island**, the same one
for everybody on a given day, with a result that can be copied and shared, and
**Free build**, with no purse, no goals and nothing locked. Every island keeps
its own save in `localStorage`.

### Controls

|                | mouse and keys                        | touch                                  |
| -------------- | ------------------------------------- | -------------------------------------- |
| Move the view  | drag with **Look**, or WASD / arrows  | drag (any tool but the power line)     |
| Turn the view  | right-drag, or Q / E                  | twist two fingers, or the turn buttons |
| Zoom           | ctrl + wheel (plain wheel standalone) | pinch                                  |
| Pick a tool    | 1 to 8; Esc for **Look**              | tap it                                 |
| Build / remove | click, or drag to paint               | tap; the power line is drawn by a drag |
| Read a tile    | hover, or click with **Look**         | tap with **Look**                      |
| Pause          | space                                 | the pause button                       |

Embedded in a page, a plain scroll wheel is left to the page.

The full screen button asks the browser for real full screen. Where there is
no such thing for an element (an iPhone), an embedded game is laid over the
whole window instead, and a game that already has the window doesn't show the
button.

## How it is built

Three layers, each knowing nothing about the one above it:

```
src/
  sim/        the rules. Plain data and plain functions: no DOM, no GPU,
              no wall clock. A week on the island can be played out in a test.
  view/       the picture. three.js. Reads a game, never changes one.
  sunfarm.js  the game running: the clock that steps the sim and redraws the
              view, the pointer and keys that turn into building, the save.
  audio/      the sound, synthesised: no files.
  ui/         the HUD, in React, reading a snapshot of the running game.
  Sunfarming.jsx   the one component a host renders.
  index.js    the package's front door.
```

**The rules** ([`src/sim/`](src/sim/)). [`catalog.js`](src/sim/catalog.js) is
every number the game is balanced on, in real units (kW, kWh, hours), and the
three tiers of home with their daily load.
[`islands.js`](src/sim/islands.js) is the archipelago: each island as a spec,
and what has been finished and unlocked across them.
[`island.js`](src/sim/island.js) grows the ground from a spec: a coast, a
beach, woods, the village's plots, and the generator on the shore with its
line. [`sun.js`](src/sim/sun.js) is the clock, the seasons and where the sun
stands; [`weather.js`](src/sim/weather.js) is each day's sky and the wind;
[`shade.js`](src/sim/shade.js) walks from a panel toward the sun to see what
is in the way, and draws the sun map.
[`network.js`](src/sim/network.js) finds which things are wired to which with
a flood fill. [`game.js`](src/sim/game.js) is the state and everything that
changes it: building, removing, and `step(game, hours)`, where each network
balances on its own (sun and wind feed homes, spare charges batteries, a
shortfall drains them, the generator makes up the rest, what nobody wants is
wasted), and the village grows at daybreak. It also serialises a game to JSON
and reads one back, refusing anything that isn't a save. The tests play whole
islands through with a scripted player, so a change that makes one
unfinishable fails.

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
the sun by day and the moon by night, placed by the same function the rules
use for shade, and dimmed by the day's cloud. [`world.js`](src/view/world.js)
keeps the models in step with the game by comparing, every frame, what is on
each tile with what it drew there, and animates what moves: smoke, the fuel
boat, turbine rotors, tracker heads, flowers and gulls.

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

| prop        | what it does                                                                                          |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| `fill`      | Take the whole window (what the standalone build does).                                               |
| `onExit`    | Show a way back out, and call this when it is pressed. For a host that gave the game the window.      |
| `exitLabel` | Where that leads, for the button: `"dame.is"` makes it "Back to dame.is".                             |
| `storage`   | Where the island is saved: `{ load, save, clear }`. Default: `localStorage`. `null` keeps nothing.    |
| `onReady`   | Called with the running game once it is up.                                                           |
| `className` | Added to the root element.                                                                            |
| `social`    | A way to post a finished island and read what others posted. See [Posting results](#posting-results). |

Two CSS custom properties can be set from outside: `--sunfarm-height` (how
tall it is when embedded) and `--sunfarm-font` (the HUD's typeface). Everything
else it brings itself, scoped under `.sunfarm`.

`@dame-is/sunfarming/meta` exports `TITLE`, `PITCH` and `SLUG` on their own, so
a host can name the game without loading it.

In development the standalone page puts the running game on the console as
`sunfarm`: `sunfarm.game` is the live state, to poke at or fast-forward.

## Sound

All of it is made in [`src/audio/sound.js`](src/audio/sound.js) from
oscillators and filtered noise; there are no audio files. One-shots answer
what just happened (each kind of building has its own, a goal is a short run
of notes, daybreak is two). The ambience runs all the time and follows the
island: the sea, the wind as strong as the wind is, crickets after dark, a
gull now and then once the island has earned them, and the generator's drone,
which is there so that the day it stops can be heard.

Nothing plays until the first press inside the game (a browser won't allow it
sooner), it stops while the game is hidden or scrolled out of view, and the
speaker button turns it off and remembers.

## On a phone

The layout turns on the game's own size, not the window's, so it is the same
embedded in a column as it is with the window to itself. The full HUD wants
about a thousand pixels across and a fair height. With less than that (a phone
either way up, a tablet held upright, a small window) the HUD keeps to the
edges: one row across the top, the five meters as a row of chips (tap them for
the readings in full), the goal on one line, the tools as icons, and the rest
behind a menu. The tool in hand says what it is just above the tools, since
nothing can be hovered.

A phone held upright stacks all of that in one column, and cards come up from
the bottom as sheets. A phone on its side has the width but very little
height, so there the chips sit beside the goal and the speeds, the tools and
the camera share one row along the bottom.

A finger does different things from a mouse. A tap builds. A one-finger drag
moves the view whatever tool is in hand, except the power line, which is
drawn with a drag. Two fingers pinch to zoom, twist to turn and drag to move.
With a mouse, a drag with any building tool paints.

## Posting results

The game doesn't know how a result is posted or where the results are kept.
A host that can do those hands it a `social` prop, and the game then shows a
"Post result" button and a board for each island. Without one it offers a line
of text to copy and a link to Bluesky's composer.

```js
social = {
  viewer,      // who is signed in: { did, handle, displayName, avatar }, or null
  restoring,   // true while a remembered sign-in is being picked back up
  busy,        // true while a post is on its way
  error,       // why the last post didn't go, in words, or null
  posted,      // { [board key]: days } for what this visit has posted
  returned,    // a result that was posted on the way back from signing in
  post(result, { handle }),  // signed out, `handle` is who to sign in as
  board(result),             // → { entries: [{ did, days, at, profile }], total, truncated }
  boardKey(result),          // the key of the board a result belongs on
  signOut(),
};
```

A result is `{ island, date, days }`, which is what `farm.result()` returns
once an island is finished. On dame.is this is atproto: a record on the
player's own PDS, and boards read from backlinks
([`lexicons/SUNFARMING.md`](../../lexicons/SUNFARMING.md)).

## What might come next

Some of what it doesn't do yet:

- **Lines with a limit.** Every power line carries anything. A cap on what one
  line can carry would make the layout of a big farm a puzzle of its own.
- **Cables between islands.** The islands are separate games. Linking a
  finished one to the next, and sending it surplus, is the obvious next step
  for the archipelago.
- **Clouds that pass.** A cloudy day dims the whole island evenly; cloud
  shadows that drift across it would make where things stand matter more.
- **Performance.** Every building is its own mesh. Past a few hundred, they
  should be instanced.
