// Two widgets made of characters: your own words (text), and the time as an
// atproto TID (tid).
//
// Text sets its first line in the chosen voice and any after it as the line
// under, the way a lower third reads: a name, then what they're doing. As a
// ticker its lines run along one line, round and round, set apart by the
// site's fleuron (❧).
//
// The TID clock ticks every 50ms, so it writes its characters straight into
// the DOM rather than through React: twenty renders a second of the whole
// widget for thirteen characters would be most of the overlay's work. The
// characters that just changed glow in the accent, as atpota.to's do.

import { useEffect, useMemo, useRef, useState } from 'react';
import { getRepoRev } from '../lib/atproto.js';
import { relativeTime } from '../lib/time.js';
import { subscribeRefreshTick } from '../lib/refreshTick.js';
import { TICK_MS, createTidClock, readTid, tidDateText, tidTimeText } from '../lib/tid.js';
import { ME_DID } from '../config.js';
import { DASH, Label } from './parts.jsx';

/* --- text ------------------------------------------------------------------- */

/** How long a ticker takes to go round once: steady reading speed, whatever its length. */
export function tickerSeconds(text) {
  return Math.max(12, Math.round([...text].length * 0.32));
}

export function TextWidget({ widget }) {
  const lines = (widget.lines || []).map((l) => l.trim()).filter(Boolean);
  if (widget.ticker) {
    const run = lines.length ? lines.join('  ❧  ') : DASH;
    return (
      <>
        <Label widget={widget} />
        <div className={`ov-ticker ov-voice-${widget.voice}`} style={{ '--ov-ticker-s': `${tickerSeconds(run)}s` }}>
          {/* Twice over, so the second copy is coming in as the first goes out. */}
          <p className="ov-ticker-track">
            <span>{run}</span>
            <span aria-hidden="true">{run}</span>
          </p>
        </div>
      </>
    );
  }
  const [first, ...rest] = lines;
  return (
    <>
      <Label widget={widget} />
      <p className={`ov-text ov-voice-${widget.voice}`}>{first || DASH}</p>
      {rest.map((line, i) => (
        <p key={i} className="ov-text-under">
          {line}
        </p>
      ))}
    </>
  );
}

/* --- the TID clock ------------------------------------------------------------ */

/** dame's repo's latest revision, re-read on the shared 30s tick. */
function useRepoRev(on) {
  const [rev, setRev] = useState(null);
  useEffect(() => {
    if (!on) return undefined;
    let cancelled = false;
    const read = () =>
      getRepoRev(ME_DID)
        .then((r) => {
          if (!cancelled && r) setRev(r);
        })
        .catch(() => {});
    read();
    const off = subscribeRefreshTick(read);
    return () => {
      cancelled = true;
      off();
    };
  }, [on]);
  return rev;
}

export function TidWidget({ widget }) {
  const charsRef = useRef([]);
  const timeRef = useRef(null);
  const dateRef = useRef(null);
  const boxRef = useRef(null);
  const next = useMemo(() => createTidClock(), []);
  const ticking = widget.style !== 'mini';
  const zone = widget.zone || 'eastern';

  useEffect(() => {
    let was = '';
    let day = '';
    const tick = () => {
      const { tid, us } = next();
      const chars = charsRef.current;
      for (let i = 0; i < 13; i += 1) {
        const c = chars[i];
        if (!c) continue;
        const changed = was[i] !== tid[i];
        if (changed) c.textContent = tid[i];
        c.classList.toggle('is-new', changed && was !== '');
      }
      was = tid;
      boxRef.current?.setAttribute('aria-label', tid);
      if (timeRef.current) timeRef.current.textContent = tidTimeText(us, zone);
      const today = tidDateText(us, zone);
      if (dateRef.current && today !== day) {
        day = today;
        dateRef.current.textContent = today;
      }
    };
    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [next, zone, ticking]);

  const rev = useRepoRev(widget.repo);
  const revAt = rev ? readTid(rev) : null;

  return (
    <>
      <Label widget={widget} />
      <p className="ov-tid" ref={boxRef} translate="no">
        {Array.from({ length: 13 }, (_, i) => (
          <span
            key={i}
            className={i < 11 ? 'ov-tid-c' : 'ov-tid-c ov-tid-clock'}
            ref={(el) => {
              charsRef.current[i] = el;
            }}
          />
        ))}
      </p>
      {ticking ? (
        <p className="ov-meta ov-tid-when">
          <span ref={timeRef} /> <span className="ov-tid-sep">·</span> <span ref={dateRef} />
        </p>
      ) : null}
      {widget.repo ? (
        <p className="ov-meta ov-tid-repo">
          dame’s repo last moved <span className="ov-tid-rev">{rev || DASH}</span>
          {revAt ? ` · ${relativeTime(new Date(Math.floor(revAt.us / 1000)))}` : ''}
        </p>
      ) : null}
    </>
  );
}
