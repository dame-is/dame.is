// /experimenting/atmospheric-workbench: a sky on a bench.
//
// Three benches share one stage. On the first there are clouds to pick up
// and reshape on a turntable. On the second there is ice in the air and
// rain across from the sun, and the halos and bows they make are traced a
// ray at a time. On the third is one prism, crystal or raindrop with a beam
// of light through it, which is where the angles in the sky come from.
//
// It is an experiment, and lives under the bench where an experiment's
// record key would be (ATMOSPHERIC_WORKBENCH_PATH in lib/experiments.js).
// What makes it an entry on the bench is an `is.dame.experiment` record whose
// "Try it" points here; when there is one, the page finds it by that address
// and offers the way to its reactions (components/ExperimentPage.jsx).
//
// The workbench itself is a package of its own,
// experiments/atmospheric-workbench. This file is only the page around it.
// See experiments/README.md.

import AtmosphericWorkbench, {
  PITCH,
  TITLE,
} from '@dame-is/atmospheric-workbench';
import ExperimentPage from '../components/ExperimentPage.jsx';
import { ATMOSPHERIC_WORKBENCH_PATH } from '../lib/experiments.js';

export default function AtmosphericWorkbenchPage() {
  return (
    <ExperimentPage
      path={ATMOSPHERIC_WORKBENCH_PATH}
      title={TITLE}
      intro={PITCH}
    >
      <AtmosphericWorkbench />
    </ExperimentPage>
  );
}
