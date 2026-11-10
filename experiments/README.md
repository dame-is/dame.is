# Experiments

Each folder here is one experiment from [`/experimenting`](../README.md#experimenting),
kept as a small project of its own: its own `package.json`, its own
dependencies, its own README, its own tests, and its own standalone build. The
site embeds an experiment by importing it like any other package. Nothing an
experiment needs lives under the site's `src/`, and nothing in the site reaches
into an experiment past its front door.

The point is that an experiment can leave. If one turns out to be good enough
to be a project, its folder is already the project: copy it out, `npm install`,
and it runs.

| folder                       | what it is                                             | on the site                    |
| ---------------------------- | ------------------------------------------------------ | ------------------------------ |
| [`sunfarming/`](sunfarming/) | A small cel-shaded game about building a solar farm.   | `/experimenting/sunfarming`    |

## How it fits together

The repo root is an npm workspace (`"workspaces": ["experiments/*"]` in the
root `package.json`). One `npm install` at the root installs the site's
dependencies and every experiment's, and links each experiment into
`node_modules` under its package name, so the site can write:

```js
import Sunfarming, { TITLE, PITCH } from '@dame-is/sunfarming';
```

An experiment's folder looks like this:

```
experiments/<name>/
  package.json        its name (@dame-is/<name>), dependencies and scripts
  README.md           what it is, how it works, what might come next
  index.html          the standalone page
  standalone/         the standalone entry: mounts the experiment full-window
  vite.config.js      the standalone build
  src/
    index.js          the front door: what a host may import
    meta.js           its title and pitch, importable without loading the rest
    …                 everything else, private to the experiment
```

Two rules keep a folder portable:

- **The site imports only what `package.json`'s `exports` offers.** That is
  the component, and `meta` (plain strings, so a route table or a page head can
  read them without pulling in a 3D engine).
- **The experiment imports nothing from outside its folder** except what its
  own `package.json` lists. It brings its own styles and reads none of the
  site's tokens or fonts, so it looks the same embedded as it does alone.

## Working on one

From the repo root:

```
npm run dev -w @dame-is/sunfarming      # the experiment alone, on :5180
npm test -w @dame-is/sunfarming         # its own tests
npm run build -w @dame-is/sunfarming    # standalone build, into its dist/
npm run dev                              # the site, with every experiment embedded
```

Or `cd` into the folder and use `npm run dev`, `npm test` and `npm run build`
directly. The root's `npm test` and `npm run lint` cover the experiments too.

## Adding one

1. **Make the folder.** Copy the shape above. Name the package
   `@dame-is/<name>`, list what it depends on, and export a React component
   from `src/index.js` and a `TITLE` and `PITCH` from `src/meta.js`.
2. **Install.** Add `"@dame-is/<name>": "*"` to the root `package.json`'s
   dependencies and run `npm install` at the root, which links it and updates
   the lockfile.
3. **Give it a page on the site.** A file in `src/pages/` that wraps the
   component in [`ExperimentPage`](../src/components/ExperimentPage.jsx), the
   way [`src/pages/Sunfarming.jsx`](../src/pages/Sunfarming.jsx) does, and a
   lazy route for it in `src/App.jsx`.
4. **Register the address.** A built-in experiment lives at
   `/experimenting/<name>`, where an experiment's record key would otherwise
   be, so the router and the edge have to be told it is a page. The list is in
   [`lexicons/EXPERIMENTING.md`](../lexicons/EXPERIMENTING.md#experiments-built-into-the-site);
   a test in `src/lib/experiments.test.js` fails until every part of it is
   done.
5. **Put it on the bench.** Post an `is.dame.experiment` record whose `url` is
   the page's full address (`https://dame.is/experimenting/<name>`). That
   record is what lists it at `/experimenting` and collects its reactions.

## Taking one out

To make an experiment its own repository:

```
cp -r experiments/sunfarming ../sunfarming
cd ../sunfarming
npm install
npm run dev
```

That is all of it: the folder has no dependency on this repo. (It will write
its own lockfile on that first install; inside this repo it shares the root's.)

To deploy one on its own without moving it, point a host at the folder. On
Vercel that is a second project on this same repository with **Root Directory**
set to `experiments/<name>`, the Vite preset, and `dist` as the output. The
standalone build uses relative asset paths, so its `dist/` can also be dropped
under any path of any static host.

Once an experiment has moved out, the site can keep its page by depending on
the published package instead of the workspace one, or drop the page and point
the experiment's record at the new address.
