// The game on its own: the whole window, no site around it.
//
// This file and ../index.html are all that the standalone build adds. A host
// site never loads them; it imports the component from ../src/index.js.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Sunfarming from '../src/index.js';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sunfarming
      fill
      onReady={(farm) => {
        // In development the running game is on the console as `sunfarm`:
        // sunfarm.game is the live state, to poke at or fast-forward.
        if (import.meta.env.DEV) window.sunfarm = farm;
      }}
    />
  </StrictMode>,
);
