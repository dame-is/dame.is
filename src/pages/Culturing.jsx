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
// this page finds it by that address and offers the way to its reactions.
//
// The workbench itself lives in src/culturing: a WebGL2 simulation
// (simulation.js, shaders/), a renderer (renderer.js), the shelf of
// cultures, media and additions, and the bench that ties them to a canvas
// (bench.js). This file is only the page around it.

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import Workbench from '../culturing/Workbench.jsx';
import FieldNotes from '../culturing/FieldNotes.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import {
  CULTURING_PATH,
  EXPERIMENTING_PATH,
  experimentForPage,
  experimentPath,
} from '../lib/experiments.js';
import { fetchExperimentRecords } from '../lib/experimentReactions.js';

const TITLE = 'Culturing';
const INTRO =
  'A bench of petri dishes that aren’t real. Pour a medium, put a culture on it, leave it in the incubator and watch what comes up. None of it is science; all of it is modelled on how real colonies and biofilms look and grow.';

export default function Culturing() {
  // The same read the bench itself makes: the build's snapshot, confirmed
  // against the PDS. Only the record that points here is wanted from it.
  const { items: records } = useLiveFeed({
    name: 'experimenting',
    strategy: 'snapshot-first',
    fetchLive: async () => ({ experiments: await fetchExperimentRecords() }),
    mapItems: (data) =>
      Array.isArray(data?.experiments) ? data.experiments : null,
  });
  const record = useMemo(
    () => experimentForPage(records, CULTURING_PATH),
    [records],
  );

  return (
    <PageShell
      title={TITLE}
      intro={INTRO}
      facts={
        <>
          <span>
            <Link to={EXPERIMENTING_PATH}>An experiment</Link>
          </span>
          {record && (
            <span>
              <span aria-hidden="true"> · </span>
              <Link to={`${experimentPath(rkeyFromAtUri(record.uri))}#react`}>
                Say what you make of it
              </Link>
            </span>
          )}
        </>
      }
      headTitle={`${TITLE} — dame.is experimenting`}
    >
      <Workbench />
      <FieldNotes />
    </PageShell>
  );
}
