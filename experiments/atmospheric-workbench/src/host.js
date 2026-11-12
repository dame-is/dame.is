// The one place this experiment reaches outside its own folder.
//
// The workbench is dressed in dame.is's kit: its buttons, its segmented
// switch and its section heads, and the stylesheets behind them. Those
// belong to the site, so they are borrowed from it here, in one file,
// instead of from wherever they happen to be used. Everything else under
// src/ imports only from this folder and from the packages in package.json.
//
// To take the experiment out of the repo, this file is the list of what has
// to come with it or be replaced: these three small components, and the
// stylesheets named in standalone/host.css.

export { default as Button } from '../../../src/components/Button.jsx';
export { default as Segmented } from '../../../src/components/Segmented.jsx';
export { default as SectionHead } from '../../../src/components/SectionHead.jsx';
