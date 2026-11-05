// Poe as an overlay widget: mounts atpota.to's potato (poe/mount.js) in the
// widget's box and starts it listening (poe/brain.js). Poe sits at the foot of
// its box, on the side the widget says, facing into the screen; its words
// rise above it, out of the box if they need to.
//
// It is mounted once per widget and changed in place after that (side, nap,
// volume), so moving Poe in the studio or saving a change on stream doesn't
// make it blink back into being.
//
// Noises only on stream (`live`): the studio's preview stays quiet.

import { useEffect, useRef } from 'react';
import { createSounds, SILENT } from './poe/life.js';
import { leftFaces, preloadFaces, RIGHT_FACES } from './poe/faces.js';
import { mountPoe } from './poe/mount.js';
import { startPoe } from './poe/brain.js';
import { ROWS } from '../lib/overlay.js';
import { ME_DID } from '../config.js';

export default function PoeWidget({ widget, demo = false, bus = null, live = false }) {
  const hostRef = useRef(null);
  const poeRef = useRef(null);
  const widgetRef = useRef(widget);
  widgetRef.current = widget;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    preloadFaces();
    const poe = mountPoe(host, { napMs: widgetRef.current.nap * 60_000 });
    poeRef.current = poe;
    const stop = startPoe(poe, { getWidget: () => widgetRef.current, bus, demo, streamer: ME_DID });
    return () => {
      stop();
      poe.destroy();
      poeRef.current = null;
    };
  }, [bus, demo]);

  // Facing into the screen: the drawings face left, so a Poe on the left side
  // wears them mirrored.
  useEffect(() => {
    const poe = poeRef.current;
    if (!poe) return undefined;
    let current = true;
    if (widget.side === 'left') {
      leftFaces().then((faces) => {
        if (current && poeRef.current === poe) poe.setFaces(faces);
      });
    } else poe.setFaces(RIGHT_FACES);
    return () => {
      current = false;
    };
  }, [widget.side, bus, demo]);

  useEffect(() => {
    poeRef.current?.setNap(widget.nap * 60_000);
  }, [widget.nap]);

  useEffect(() => {
    const poe = poeRef.current;
    if (!poe) return undefined;
    const sounds = live ? createSounds(widget.volume) : SILENT;
    poe.setSounds(sounds);
    return () => sounds.close();
  }, [widget.volume, live, bus, demo]);

  return (
    <div
      ref={hostRef}
      className="ov-poe"
      data-side={widget.side}
      // A Poe on the bottom row tucks its bottom under the edge of the screen,
      // as atpota.to's corner potato does.
      data-edge={widget.row + widget.rows - 1 >= ROWS ? '' : undefined}
    />
  );
}
