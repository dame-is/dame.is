// The lazy pages' stylesheets, loaded eagerly, in the order the pages used
// to import them.
//
// The pages themselves are lazy chunks now (see App.jsx), but their CSS
// can't simply follow them. A lazy chunk's stylesheet is appended to <head>
// when the chunk loads — after every sheet in the entry — whereas these
// rules used to sit in the entry ahead of the global styles main.jsx
// imports (typography.css, app.css). Wherever a page rule and a global rule
// tie on specificity, the global one has always won; loaded late, the page
// rule would win instead. Measured before this file existed: the
// `.small-caps` labels on the résumé, mothing and album pages picked up
// their pages' wider letter-spacing, and comment timestamps grew from the
// `.gutter` size to their own. So the CSS stays in the entry, exactly where
// it was, and only the JavaScript is split — which is where the cost was.
//
// App.jsx imports this right after Home, which is where the first lazy page
// used to be imported. The list is every stylesheet the lazy pages reach
// that Home hasn't already, in import order; src/lib/pageStyles.test.js
// recomputes it from the source and fails, printing the list, when a page
// gains or loses a stylesheet.

import '../components/ScrollFrame.css';
import '../components/RatioedHandle.css';
import '../components/blocks/RatioedBlock.css';
import '../components/LeafletDocument.css';
import '../pages/About.css';
import '../components/QueryNote.css';
import '../components/StateStats.css';
import '../components/ListeningStats.css';
import '../pages/Albums.css';
import '../pages/Blogging.css';
import '../components/WaypointsSheet.css';
import '../components/Comments.css';
import '../components/SequenceFoot.css';
import '../components/Fleuron.css';
import '../pages/Creating.css';
import '../components/RatioedStats.css';
import '../components/RatioedChip.css';
import '../components/RatioedLive.css';
import '../components/RatioedReplay.css';
import '../components/RatioedFaces.css';
import '../components/RatioedClock.css';
import '../components/RatioedRecord.css';
import '../pages/RatioedPiece.css';
import '../pages/RatioedParticipant.css';
import '../pages/RatioedParticipants.css';
import '../pages/Curating.css';
import '../pages/Resume.css';
import '../components/ActionDock.css';
import '../components/Figures.css';
import '../pages/Mothing.css';
import '../pages/Guestbook.css';
import '../pages/Record.css';
