// The darkroom, off the page's own thread, so tracing never makes the sky
// stutter. See darkroom.js.

import { createDarkroom } from './darkroom.js';

const room = createDarkroom((message) =>
  self.postMessage(message, [message.image.buffer]),
);

self.onmessage = ({ data }) => {
  if (data.type === 'start') room.start(data.spec);
  else if (data.type === 'gain') room.setGain(data.gain);
  else if (data.type === 'stop') room.stop();
};
