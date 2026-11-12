// The package's front door. A host (dame.is, or anything else with React)
// imports the component from here and nothing from deeper in; the bench's
// insides are free to move.

export {
  default,
  default as AtmosphericWorkbench,
} from './AtmosphericWorkbench.jsx';
export { SLUG, TITLE, PITCH } from './meta.js';
