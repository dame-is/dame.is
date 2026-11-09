// /culturing: a bench of petri dishes that aren't real.
//
// Pour a medium, put a culture on it, leave it in the incubator and watch
// what comes up. None of it is science. All of it is modelled on how real
// colonies and biofilms look and grow, and the page says which parts are
// borrowed from where (src/culturing/FieldNotes.jsx, and the notes on each
// culture and medium).
//
// The workbench itself lives in src/culturing: a WebGL2 simulation
// (simulation.js, shaders/), a renderer (renderer.js), the shelf of
// cultures, media and additions, and the bench that ties them to a canvas
// (bench.js). This file is only the page around it.

import PageShell from '../components/PageShell.jsx';
import Workbench from '../culturing/Workbench.jsx';
import FieldNotes from '../culturing/FieldNotes.jsx';
import { usePageContent } from '../hooks/usePageContent.js';

export default function Culturing() {
  // Title and intro resolve from `is.dame.page/culturing` when the owner
  // has written one, and from the page registry until then.
  const { title, intro } = usePageContent('culturing');
  return (
    <PageShell title={title} intro={intro} headTitle="dame.is culturing">
      <Workbench />
      <FieldNotes />
    </PageShell>
  );
}
