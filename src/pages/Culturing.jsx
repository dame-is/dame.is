// /experimenting/culturing: a bench of petri dishes that aren't real.
//
// Pour a medium, put a culture on it, leave it in the incubator and watch
// what comes up. None of it is science. All of it is modelled on how real
// colonies and biofilms look and grow, and the page says which parts are
// borrowed from where (the field notes under the bench, and the notes on
// each culture and medium).
//
// It is an experiment, and lives under the bench where an experiment's
// record key would be (CULTURING_PATH in lib/experiments.js). What makes it
// an entry on the bench is an `is.dame.experiment` record whose "Try it"
// points here. When there is one, the page finds it by that address and
// offers the way to its reactions (components/ExperimentPage.jsx, which
// every built-in experiment shares).
//
// The workbench itself is a package of its own, experiments/culturing: a
// WebGL2 simulation, a renderer, the shelf of cultures, media and additions,
// and the bench that ties them to a canvas. This file is only the page
// around it. See experiments/README.md.

import Culturing, { PITCH, TITLE } from '@dame-is/culturing';
import ExperimentPage from '../components/ExperimentPage.jsx';
import { CULTURING_PATH } from '../lib/experiments.js';

export default function CulturingPage() {
  return (
    <ExperimentPage path={CULTURING_PATH} title={TITLE} intro={PITCH}>
      <Culturing />
    </ExperimentPage>
  );
}
