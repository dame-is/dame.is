// Harness entry. Mirrors src/main.jsx's pre-paint setup so the admin renders in
// the same palette and type mode the real site uses, then mounts the real App.
//
// Two deliberate differences from src/main.jsx:
//   - no StrictMode, so effects run once and screenshots are stable
//   - the sky hour can be pinned with ?hour=NN, so screenshots don't drift
//     with the wall clock
//
// Nothing here ships; see harness/README.md.

import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from '../src/App.jsx';
import { applySkyTheme, easternHour } from '../src/lib/skyTheme.js';
import '../src/styles/reset.css';
import '../src/styles/theme.css';
import '../src/styles/typography.css';
import '../src/styles/app.css';
import '../src/styles/paper.css';

const params = new URLSearchParams(window.location.search);
const pinnedHour = params.has('hour') ? Number(params.get('hour')) : null;
const hour = Number.isInteger(pinnedHour) && pinnedHour >= 0 && pinnedHour <= 23 ? pinnedHour : easternHour();

document.documentElement.setAttribute('data-theme', 'sky');
applySkyTheme(hour);
document.documentElement.setAttribute('data-paper', 'blank');
document.documentElement.setAttribute('data-font', 'serif');

// Flag the harness on the root element so a screenshot is never mistaken for
// the real site, and so anything that wants to know can ask.
document.documentElement.setAttribute('data-harness', '1');

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
