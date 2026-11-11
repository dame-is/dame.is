// The one place this experiment reaches outside its own folder.
//
// The workbench was built as a page of dame.is and is dressed in the site's
// kit: its buttons, its segmented switch, its tags and section heads, and the
// stylesheets behind them. Those belong to the site, so they are borrowed
// from it here, in one file, instead of from wherever they happen to be
// used. Everything else under src/ imports only from this folder and from
// the packages in package.json.
//
// To take the experiment out of the repo, this file is the list of what has
// to come with it or be replaced: these four small components, and the
// stylesheets named in standalone/host.css.

export { default as Button } from '../../../src/components/Button.jsx';
export { default as Segmented } from '../../../src/components/Segmented.jsx';
export { default as Tag } from '../../../src/components/Tag.jsx';
export { default as SectionHead } from '../../../src/components/SectionHead.jsx';
