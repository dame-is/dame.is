// <Culturing />: the whole experiment as one component. The bench, with
// everything that works it laid over the picture, and in it the notes on
// which parts are borrowed from real microbiology.
//
// It reads and writes `?plate=…` in the address (a plate travels in a link),
// so it has to be rendered inside a react-router Router.
//
// `fill` gives it the whole window, as the site and the standalone build do;
// without it, it is a block of a page and offers to go full screen.
// `onExit` and `exitLabel` are the way back out, and `reactHref` where to
// say what you made of it, when the page round it has them.

import Workbench from './Workbench.jsx';

export default function Culturing({
  fill = false,
  onExit = null,
  exitLabel,
  reactHref = null,
}) {
  return (
    <Workbench
      fill={fill}
      onExit={onExit}
      exitLabel={exitLabel}
      reactHref={reactHref}
    />
  );
}
