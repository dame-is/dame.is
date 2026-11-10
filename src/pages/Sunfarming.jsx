// /experimenting/sunfarming: a small game about building a solar farm.
//
// An island on a grid, a village on it, and the sun going over. Put down
// panels, wire them to the houses, keep the spare in batteries for the night,
// and the village grows. It is the beginnings of a game, posted to find out
// whether it should become one.
//
// Nothing of the game is in this file, or anywhere under src/. It is a
// package of its own in experiments/sunfarming, with its own dependencies
// (three.js), its own stylesheet and its own standalone build, and the site
// reaches it only through the package's front door. This file is the page
// round it: the site's title, pitch and links (ExperimentPage), and a frame
// for the game to sit in. See experiments/README.md.

import Sunfarming, { PITCH, TITLE } from '@dame-is/sunfarming';
import ExperimentPage from '../components/ExperimentPage.jsx';
import { useSunfarmingSocial } from '../hooks/useSunfarmingSocial.js';
import { SUNFARMING_PATH } from '../lib/experiments.js';

export default function SunfarmingPage() {
  // The one thing the site adds to the game itself: a way to post a finished
  // island with an atproto account, and to read what others posted. The game
  // only offers either when it is handed this (see lexicons/SUNFARMING.md).
  const social = useSunfarmingSocial();
  return (
    <ExperimentPage path={SUNFARMING_PATH} title={TITLE} intro={PITCH}>
      {/* The frame sets the height (Experimenting.css); the game fills it. */}
      <div className="experiment-stage" style={{ '--sunfarm-height': '100%' }}>
        <Sunfarming social={social} />
      </div>
    </ExperimentPage>
  );
}
