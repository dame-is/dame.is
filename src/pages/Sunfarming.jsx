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
// reaches it only through the package's front door. See experiments/README.md.
//
// A game wants the whole window, so this is not a page with a game on it: the
// game is all there is. The site's bars, dock and inspect layer are not drawn
// here at all (App.jsx, on isImmersiveExperimentPath), and what the site adds
// is the two things the game can't know: where "out" is, and how a result is
// posted.

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Sunfarming, { TITLE } from '@dame-is/sunfarming';
import AtUriHead from '../components/AtUriHead.jsx';
import { useExperimentForPage } from '../hooks/useExperimentForPage.js';
import { useSunfarmingSocial } from '../hooks/useSunfarmingSocial.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import {
  EXPERIMENTING_PATH,
  SUNFARMING_PATH,
  experimentPath,
} from '../lib/experiments.js';

export default function SunfarmingPage() {
  // A way to post a finished island with an atproto account, and to read what
  // others posted. The game only offers either when it is handed this (see
  // lexicons/SUNFARMING.md).
  const social = useSunfarmingSocial();

  // The way back out. It goes to the experiment's own page, where the idea is
  // written up and there is somewhere to say what you made of it; until a
  // record has been posted for the game, to the bench.
  const record = useExperimentForPage(SUNFARMING_PATH);
  const navigate = useNavigate();
  const out = record
    ? experimentPath(rkeyFromAtUri(record.uri))
    : EXPERIMENTING_PATH;
  const exit = useCallback(() => navigate(out), [navigate, out]);

  return (
    <>
      <AtUriHead title={`${TITLE} — dame.is experimenting`} />
      <Sunfarming fill social={social} onExit={exit} exitLabel="dame.is" />
    </>
  );
}
