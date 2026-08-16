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

// Pinning the hour by calling applySkyTheme() here alone did NOTHING, and had
// not done anything for as long as the flag has existed. ThemeProvider's mount
// effect runs `applySkyTheme(skyHour ?? easternHour())` (useTheme.jsx:26) a beat
// later and overwrites every --sky-* variable with the wall clock's palette, and
// AdminTopBar's hour chip formats `new Date()` independently. Verified before
// fixing: at ?hour=3, ?hour=14 and ?hour=21 the inline --sky-tan was #227da0 all
// three times and the chip read the real "12PM" all three times. Every colour
// claim made from a harness screenshot was therefore a claim about whatever hour
// the machine happened to be in — which is expensive, because this harness is
// how the admin gets looked at.
//
// The clock is the thing both readers agree on, so the pin moves there: while
// ?hour= is set, "now" is a fixed instant whose Eastern hour is the pinned one.
// ThemeProvider seeds `liveHour` from easternHour(), its top-of-hour timer
// re-reads the same frozen clock, and the chip formats the same frozen Date — so
// the palette, the avatar frame and the chip all agree and none of them drift
// while the page is open. Frozen rather than merely offset for that last reason:
// an offset clock rolls over at the real hour boundary and quietly un-pins
// itself, which is the bug this is fixing.
//
// Scope of the lie: `Date.now()` and the no-argument `new Date()`. Every other
// constructor form and every static (Date.parse, Date.UTC) is the real one, so
// record timestamps, `localSlot()` and the fixture repo's fixed 2026-04-02 clock
// are untouched. Nothing in the app spin-waits on Date.now(); React's scheduler
// uses performance.now(). Installed ONLY when ?hour= is present, so the default
// harness run still tracks the wall clock exactly as it always has.
if (Number.isInteger(pinnedHour) && pinnedHour >= 0 && pinnedHour <= 23) {
  const RealDate = Date;
  // Walk whole hours until the Eastern hour matches. One step normally does it;
  // the loop is for the DST boundaries, where a 1h jump can land an hour off.
  let frozen = RealDate.now();
  for (let i = 0; i < 4; i += 1) {
    const delta = hour - easternHour(new RealDate(frozen));
    if (delta === 0) break;
    frozen += delta * 3_600_000;
  }
  const FROZEN = frozen;
  class PinnedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(FROZEN);
      else super(...args);
    }

    static now() {
      return FROZEN;
    }
  }
  window.Date = PinnedDate;
}

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
