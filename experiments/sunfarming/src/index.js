// The package's front door. A host (dame.is, or anything else with React)
// imports the component from here and nothing from deeper in; the game's
// insides are free to move.

export { default, default as Sunfarming } from './Sunfarming.jsx';
export { SLUG, TITLE, PITCH } from './meta.js';
export { createSunfarm, browserStorage } from './sunfarm.js';
