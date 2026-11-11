// <Sunfarming />: the whole game as one React component.
//
// It is the only thing a host page has to render. The game itself is not
// React (src/sunfarm.js owns the canvas, the clock and the pointer); this
// mounts it into a div, lays the HUD over it, and takes it down again.
//
//   fill      take the whole window, as the standalone build does, instead
//             of sitting in a page at the height the stylesheet gives it
//   storage   where the island is saved: { load, save, clear }. Leave it out
//             for localStorage; pass null to keep nothing. Keep the same
//             object between renders, or the game restarts.
//   onReady   called with the running game (src/sunfarm.js's API) once it is
//             up: for a host that wants to drive it, or for the console.
//   onExit    give the game a way back out: a button that calls this. For a
//             host that has handed it the whole window (`fill`) and has
//             somewhere to return to. `exitLabel` names that somewhere
//             ("Back to <exitLabel>").
//   social    a way to post a finished island and read what others posted,
//             if the host has one (see README, "Posting results"). Without
//             it the game offers a line of text to copy and nothing more.

import { useEffect, useRef, useState } from 'react';
import { createSunfarm } from './sunfarm.js';
import Hud from './ui/Hud.jsx';
import { TITLE } from './meta.js';
import './sunfarming.css';

export default function Sunfarming({
  fill = false,
  storage,
  className = '',
  onReady,
  social = null,
  onExit,
  exitLabel,
}) {
  const hostRef = useRef(null);
  const [farm, setFarm] = useState(null);
  const [failed, setFailed] = useState(false);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    const host = hostRef.current;
    let made = null;
    try {
      made = createSunfarm({
        host,
        captureWheel: fill,
        ...(storage !== undefined ? { storage } : {}),
      });
      setFarm(made);
      setFailed(false);
      ready.current?.(made);
    } catch (error) {
      // No WebGL (an old browser, a blocked GPU): say so instead of a blank box.
      console.error(error);
      setFailed(true);
    }
    return () => {
      made?.destroy();
      setFarm(null);
    };
  }, [fill, storage]);

  return (
    <div
      ref={hostRef}
      className={`sunfarm${fill ? ' sunfarm--fill' : ''}${className ? ` ${className}` : ''}`}
      tabIndex={0}
      role="application"
      aria-label={TITLE}
    >
      {farm && (
        <Hud
          farm={farm}
          host={hostRef.current}
          fill={fill}
          social={social}
          onExit={onExit}
          exitLabel={exitLabel}
        />
      )}
      {failed && (
        <p className="sunfarm-failed">
          The island is drawn with WebGL, and this browser wouldn’t start it.
          Try another browser, or turn hardware acceleration back on.
        </p>
      )}
    </div>
  );
}
