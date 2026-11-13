// The workbench on its own: one page, no site around it.
//
// This file, host.css beside it and ../index.html are all that the
// standalone build adds. A host site never loads them; it imports the
// component from ../src/index.js.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './host.css';
import Culturing from '../src/index.js';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* A plate travels in the address as ?plate=…, which the bench reads and
        writes through the router. The bench has the whole window. */}
    <BrowserRouter>
      <Culturing fill />
    </BrowserRouter>
  </StrictMode>,
);
