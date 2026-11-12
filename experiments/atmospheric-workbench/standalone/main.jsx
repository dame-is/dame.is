// The workbench on its own: one page, no site around it.
//
// This file, host.css beside it and ../index.html are all that the
// standalone build adds. A host site never loads them; it imports the
// component from ../src/index.js.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './host.css';
import AtmosphericWorkbench, { PITCH, TITLE } from '../src/index.js';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <main className="solo">
      <article className="page">
        <h1 className="page-title">{TITLE}</h1>
        <p className="page-intro">{PITCH}</p>
        <AtmosphericWorkbench />
      </article>
    </main>
  </StrictMode>,
);
