// /experimenting/culturing: a bench of petri dishes that aren't real.
//
// Pour a medium, put a culture on it, leave it in the incubator and watch
// what comes up. None of it is science. All of it is modelled on how real
// colonies and biofilms look and grow, and the page says which parts are
// borrowed from where (src/culturing/FieldNotes.jsx, and the notes on each
// culture and medium).
//
// It is an experiment, and lives under the bench where an experiment's
// record key would be (CULTURING_PATH in lib/experiments.js). The page is
// built into the site; what makes it an entry on the bench is an
// `is.dame.experiment` record whose "Try it" points here. When there is one,
// the page finds it by that address and offers the way to its reactions
// (components/ExperimentPage.jsx, which every built-in experiment shares).
//
// The workbench itself lives in src/culturing: a WebGL2 simulation
// (simulation.js, shaders/), a renderer (renderer.js), the shelf of
// cultures, media and additions, and the bench that ties them to a canvas
// (bench.js). This file is only the page around it.

import ExperimentPage from '../components/ExperimentPage.jsx';
import Workbench from '../culturing/Workbench.jsx';
import FieldNotes from '../culturing/FieldNotes.jsx';
import { CULTURING_PATH } from '../lib/experiments.js';

const TITLE = 'Culturing';
const INTRO =
  'A bench of petri dishes that aren’t real. Pour a medium, put a culture on it, leave it in the incubator and watch what comes up. None of it is science; all of it is modelled on how real colonies and biofilms look and grow.';

export default function Culturing() {
  return (
    <ExperimentPage path={CULTURING_PATH} title={TITLE} intro={INTRO}>
      <Workbench />
      <FieldNotes />
    </ExperimentPage>
  );
}
