# Atmospheric workbench

A sky on a bench. Shape a cloud on a turntable, put ice crystals in the air
and see which halos they make of the sun, and send light through a prism, a
crystal and a raindrop to see where the angles come from.

The halos and the rainbow are not drawn. Each halo is sunlight followed
through ice crystals a few million times, and the rainbow is rays counted
through one drop. The page says which parts are real and which aren't, in
"What is real here" at its foot.

```
npm run dev      # http://localhost:5182
npm test         # what can be checked without a GPU
npm run build    # a standalone build in dist/
```

(From the repo root: `npm run dev -w @dame-is/atmospheric-workbench`, and so
on.)

## The three benches

- **Clouds.** A sky of clouds seen from among them. Drag to look round, tap a
  cloud to pick it up, drag it to move it, double-tap it (or use the button)
  to put it on the turntable. On the turntable it can be changed to another
  kind (cumulus, stratus, cirrus, nimbus, lenticular), resized, made taller
  or fluffier, given more puffs, darkened, and made to rain and thunder; two
  brushes add puffs or poke them out. Released, it goes back to the sky at a
  height that suits its kind.
- **Halos and bows.** The same sky, stopped down like a camera, with ice in
  the air. Four kinds of crystal are on the shelf (tumbling, plates, columns
  and Parry columns), each with how much of it there is, its shape (length
  over width) and how much it wobbles. The sun's height is a slider. Ten
  skies to start from set the sun and the air for a known display (22° halo,
  sun dogs, circumzenithal arc, parhelic circle, tangent arcs, circumscribed
  halo, Parry arc, a cold morning with everything, circumhorizon arc,
  rainbow) and turn the view to it. Rain across from the sun makes the bow.
- **Rays.** One shape on a dark table (an ice crystal end on, the same
  crystal side on, a glass prism, a raindrop) with a beam of white light
  through it. Turn the shape, move the ray, or send rays all across it. A
  band round the edge of the table shows where the light lands when the
  shape is turned every way and lit all over, which is what a cloud of
  crystals does: its bright edge is the halo.

## How it is built

It carries three.js and a ray tracer, so wherever it is embedded it should be
its own chunk, loaded only by the page that shows it.

- **The tracer** ([`optics/halo.js`](src/optics/halo.js)). A crystal is a
  hexagonal prism in its own frame. For each ray: turn the crystal the way
  its kind lies (`settle`), pick the face the sun can see in proportion to
  how much of it shows, cross in by Snell's law, then at each face inside
  roll against Fresnel's reflectance to go out or bounce, and report where in
  the sky the leaving light is seen. A ray is one wavelength of 48, each bent
  by its own index. The sun is a disc half a degree wide, so every ray starts
  from a different point of it.
- **The picture** (`createSkyMap`, `expose`, `develop` in the same file). Rays
  are counted into a square map of the whole sky, the zenith in the middle
  and the horizon a circle near the edge (an all-sky camera's view), 1024
  across, or 768 on a phone. Developing it rolls the brightness off, so a sun
  dog burns out the way it does in a photograph, and bins it coarsely while
  it has few rays, so an early picture is soft and not speckled.
- **The darkroom** ([`optics/darkroom.js`](src/optics/darkroom.js),
  [`tracer.worker.js`](src/optics/tracer.worker.js),
  [`exposure.js`](src/optics/exposure.js)). Tracing runs in a worker in 30 ms
  slices and hands a better picture back as it goes, up to 16 million rays (5
  million on a phone). Where there are no workers it runs on the page in
  thinner slices. Changing the sun or the air starts again; changing the
  exposure only develops the same map again.
- **The rainbow** ([`optics/rainbow.js`](src/optics/rainbow.js)). A drop is a
  sphere, so everything is settled by how far off centre a ray goes in. Rays
  across the drop's face, one and two bounces inside, each polarisation
  followed separately, are counted by the angle they leave at into a table of
  brightness by angle from the point opposite the sun. The dome looks it up.
- **What light slows down in** ([`optics/media.js`](src/optics/media.js)).
  Ice from Warren and Brandt's 2008 table, water from Daimon and Masumura's
  2007 fit, flint glass (Schott F2) from the maker's. Colours from wavelength
  are in [`optics/spectrum.js`](src/optics/spectrum.js).
- **The shelf** ([`optics/displays.js`](src/optics/displays.js)). The four
  crystals and the ten skies to start from. A sky is only a sun height and
  amounts of crystal; the names of the halos are labels the tracer never
  reads.
- **The sky** ([`sky/engine.js`](src/sky/engine.js)) owns the canvas, the
  clock and the pointer, and knows nothing about React; the page reads a
  snapshot of it. A cloud is a few hundred soft, lit impostors drawn in one
  instanced batch and sorted back to front each frame
  ([`sky/puff.js`](src/sky/puff.js)); each kind is a generator whose puff _i_
  depends only on the seed and _i_, so a slider adds or removes puffs without
  reshuffling them ([`sky/clouds.js`](src/sky/clouds.js)). The sky's colours
  are four hand-painted skies pinned to the sun heights they were painted
  for, blended between ([`sky/palette.js`](src/sky/palette.js)). The dome's
  shader wears the halo picture and the rainbow table over the gradient.
- **The ray table** ([`raytable/trace.js`](src/raytable/trace.js),
  [`RayTable.jsx`](src/raytable/RayTable.jsx)). The same physics in two
  dimensions on a plain 2D canvas: a ray splits at every surface into what
  crosses and what reflects, each followed until it is too faint to draw. It
  needs no WebGL, so it still works where the sky can't start.
- **Keeping it.** The sky (its clouds, the sun, what is in the air) is saved
  to `localStorage` shortly after each change. Pass `storage={null}` to keep
  nothing, or your own `{ load, save }`.

The tests ([`optics/optics.test.js`](src/optics/optics.test.js),
[`raytable/trace.test.js`](src/raytable/trace.test.js),
[`sky/sky.test.js`](src/sky/sky.test.js)) hold the tracer to angles worked
out by hand: that tumbling crystals leave the sky dark inside 21° and light
it at 22° and again at 46°; that plates put sun dogs level with the sun, 22°
out when it is low and 37° of compass bearing out when it is 40° up; that the
circumzenithal arc sits 46° above a 20° sun and is gone above 32°; that the
rainbow's two bows are at 42° and 51° with nothing between; that no light is
lost on the ray table; and that the cloud generators keep their puffs when a
slider moves.

## What it borrows from the site

It is dressed in dame.is's kit, the way Culturing is, and leans on the repo
around it in two places, and only these two:

- [`src/host.js`](src/host.js) re-exports three of the site's components
  (`Button`, `Segmented`, `SectionHead`). Everything else under `src/`
  imports them from there.
- [`standalone/host.css`](standalone/host.css) imports the site's base
  stylesheets for the standalone page. Embedded in the site they are already
  on the page. [`src/atmospheric-workbench.css`](src/atmospheric-workbench.css)
  is written in those tokens, and answers to the site's stylelint guards
  (`npm run lint:css` at the root).

To take it out of the repo, those two files are the list of what has to come
with it.

## Embedding it

```jsx
import AtmosphericWorkbench from '@dame-is/atmospheric-workbench';

<AtmosphericWorkbench />;
```

On a page that has the site's base styles.
`@dame-is/atmospheric-workbench/meta` exports `TITLE`, `PITCH` and `SLUG` on
their own.

## Not done, and not checked

- Checked only under software WebGL in headless Chromium, at desktop and
  phone widths. Not seen on a real GPU, an iPhone or Safari, and frame rate
  was never measured.
- Light is rays only: no diffraction, so no supernumerary bows, no fogbow, no
  corona, no iridescence, no glory.
- Crystals are plain hexagonal prisms: no pyramidal ends (so no odd-radius
  halos) and no Lowitz orientation.
- Nothing below the horizon is drawn, though the tracer makes a subsun and
  subparhelia. The map could be made to reach under the horizon for a view
  from a mountain or a plane.
- The halos sit behind every cloud, and so does the rainbow, which in the
  sky is in front of the cloud that is raining.
- The ice in the air has nothing to do with the clouds on the bench. Tying a
  halo to a sheet of cirrostratus you put there would be the natural next
  step.
- There are no labels on the sky saying which arc is which.
- Nothing can be photographed or shared in a link yet.
