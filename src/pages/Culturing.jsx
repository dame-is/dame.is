// /experimenting/culturing: a bench of petri dishes that aren't real.
//
// Pour a medium, put a culture on it, leave it in the incubator and watch
// what comes up. None of it is science. All of it is modelled on how real
// colonies and biofilms look and grow, and the bench says which parts are
// borrowed from where (its notes, and the card on each culture and medium).
//
// It is an experiment, and lives under the bench where an experiment's
// record key would be (CULTURING_PATH in lib/experiments.js). What makes it
// an entry on the bench is an `is.dame.experiment` record whose "Try it"
// points here. When there is one, this finds it by that address and offers
// the way to its reactions.
//
// The workbench itself is a package of its own, experiments/culturing: a
// WebGL2 simulation, a renderer, the menus of cultures, media and additions,
// and the bench that ties them to a canvas. See experiments/README.md.
//
// A bench is worked with its tools laid over it, so this is not a page with
// a bench on it: the bench has the whole window. The site's bars, dock and
// inspect layer are not drawn here (App.jsx, on isImmersiveExperimentPath),
// and what the site adds is what the bench can't know: where "out" is, and
// where to say what you made of it.

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Culturing, { TITLE } from '@dame-is/culturing';
import AtUriHead from '../components/AtUriHead.jsx';
import { useExperimentForPage } from '../hooks/useExperimentForPage.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import {
  CULTURING_PATH,
  EXPERIMENTING_PATH,
  experimentPath,
} from '../lib/experiments.js';

export default function CulturingPage() {
  const record = useExperimentForPage(CULTURING_PATH);
  const navigate = useNavigate();
  // The way back out goes to the bench of experiments; the experiment's own
  // page, once there is one, is where to say what you made of it.
  const exit = useCallback(() => navigate(EXPERIMENTING_PATH), [navigate]);
  const react = record
    ? `${experimentPath(rkeyFromAtUri(record.uri))}#react`
    : null;

  return (
    <>
      <AtUriHead title={`${TITLE} — dame.is experimenting`} />
      <Culturing fill onExit={exit} exitLabel="dame.is" reactHref={react} />
    </>
  );
}
