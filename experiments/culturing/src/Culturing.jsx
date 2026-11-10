// <Culturing />: the whole experiment as one component. The bench, and under
// it the notes on which parts of it are borrowed from real microbiology.
//
// It reads and writes `?plate=…` in the address (a plate travels in a link),
// so it has to be rendered inside a react-router Router.

import Workbench from './Workbench.jsx';
import FieldNotes from './FieldNotes.jsx';

export default function Culturing() {
  return (
    <>
      <Workbench />
      <FieldNotes />
    </>
  );
}
