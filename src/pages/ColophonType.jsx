import { useLayoutEffect, useRef, useState } from 'react';
import SectionHead from '../components/SectionHead.jsx';

// The scale (theme.css), smallest first. 11px is the floor: nothing on the
// public site is set smaller.
const STEPS = ['2xs', 'xs', 'meta', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'];

// The roles (theme.css), each with the place on the grid it lives.
const ROLES = [
  {
    role: 'title',
    home: 'Type area',
    uses: 'Page and essay titles. The one size that moves with the window.',
    sample: 'Why I started posting like it’s the 2000s again',
  },
  {
    role: 'reading',
    home: 'Text column',
    uses: 'Essays, works and every document LeafletDocument renders, through .reading.',
    sample: 'Back then, social media was a place you went to keep up with what your friends were actually doing.',
  },
  {
    role: 'body',
    home: 'Text column',
    uses: 'Posts in the ledger and interface copy.',
    sample: 'A post in the ledger, or a paragraph of interface copy, at the body size.',
  },
  {
    role: 'caption',
    home: 'Text column',
    uses: 'Figure captions, credits, quoted posts, hints under a field.',
    sample: '2007 facebook status updates',
  },
  {
    role: 'meta',
    home: 'Note column',
    uses: 'The ledger’s gerund and time, an essay’s facts, the reading marker.',
    sample: 'posting · 5:10 pm',
  },
  {
    role: 'label',
    home: 'Note column',
    uses: 'Small-caps labels and eyebrows, in the chrome and beside the text.',
    sample: 'Listening to',
    label: true,
  },
];

const LEADING = [
  ['--leading-reading', 'Long-form, inside .reading'],
  ['--leading', 'Body copy'],
  ['--leading-ui', 'Captions, hints, cards'],
  ['--leading-tight', 'The ledger’s post text'],
  ['--leading-heading', 'Headings'],
  ['--leading-display', 'Titles'],
  ['--leading-solid', 'Labels, figures and ornaments that set their own box'],
];

const px = (value) => `${Math.round(parseFloat(value) * 10) / 10}px`;

/**
 * The median number of characters on a full line of a document's paragraphs,
 * measured the way the typography audit measured the live site: each
 * character's rendered line, letters and spaces both counted, a paragraph's
 * last line left out. The drop-cap paragraph is skipped, since its first
 * three lines are short by design.
 */
function charsPerLine(doc) {
  const counts = [];
  const range = document.createRange();
  for (const p of doc.querySelectorAll('.leaflet-paragraph:not(.first-paragraph)')) {
    const half = parseFloat(getComputedStyle(p).lineHeight) / 2;
    const centres = [];
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let i = 0; i < node.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const box = range.getBoundingClientRect();
        if (box.height) centres.push(box.top + box.height / 2);
      }
    }
    centres.sort((a, b) => a - b);
    const lines = [];
    let top = null;
    for (const centre of centres) {
      if (top === null || centre - top > half) {
        lines.push(0);
        top = centre;
      }
      lines[lines.length - 1] += 1;
    }
    lines.pop();
    counts.push(...lines);
  }
  counts.sort((a, b) => a - b);
  return counts.length ? counts[counts.length >> 1] : null;
}

/**
 * The colophon's type: the scale, the roles and where each lives on the
 * grid, the reading setting, and the rules that keep them. Every size shown
 * is read back from the page as it renders, so this can't drift from
 * theme.css; the title's changes as the window does.
 */
export default function ColophonType() {
  const rootRef = useRef(null);
  const docRef = useRef(null);
  const [read, setRead] = useState(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const sizeOf = (el) => (el ? px(getComputedStyle(el).fontSize) : '');
        const styles = getComputedStyle(document.documentElement);
        const doc = docRef.current;
        const paragraph = doc?.querySelector('.leaflet-paragraph');
        setRead({
          steps: Object.fromEntries(
            [...root.querySelectorAll('[data-step]')].map((el) => [el.dataset.step, sizeOf(el)]),
          ),
          roles: Object.fromEntries(
            [...root.querySelectorAll('[data-role]')].map((el) => [el.dataset.role, sizeOf(el)]),
          ),
          leading: Object.fromEntries(LEADING.map(([name]) => [name, styles.getPropertyValue(name).trim()])),
          reading: paragraph
            ? {
                size: px(getComputedStyle(paragraph).fontSize),
                line: px(getComputedStyle(paragraph).lineHeight),
                width: Math.round(paragraph.getBoundingClientRect().width),
                chars: charsPerLine(doc),
              }
            : null,
          window: window.innerWidth,
        });
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    document.fonts?.ready?.then(measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const roleSize = (role) => read?.roles[role] ?? '';

  return (
    <section ref={rootRef} className="kit-type" aria-labelledby="kit-type-head">
      <SectionHead id="kit-type-head" title="Type" meta="Crimson Pro on the page grid" />

      <p className="kit-type-lead">
        One serif, in rem throughout. Long-form reads at 18px and everything else at 16px or below, so an essay
        sits one step above the posts around it. Only titles change with the window. There’s no size setting of
        the site’s own: browser zoom and a reader’s default font size scale the type and the grid together, and a
        line keeps its length.
      </p>

      <div className="kit-type-block">
        <h3 className="kit-type-block-title eyebrow">Roles, and where each lives</h3>
        <ul className="kit-type-roles">
          {ROLES.map(({ role, home, uses, sample, label }) => (
            <li key={role} className="kit-type-row">
              <div className="kit-type-key">
                <span className="kit-type-name">{role}</span>
                <span className="ident">--type-{role}</span>
                <span className="kit-type-figure">{roleSize(role)}</span>
              </div>
              <div className="kit-type-body">
                <p
                  className={`kit-type-sample${role === 'title' ? ' page-title' : ''}${label ? ' small-caps' : ''}`}
                  data-role={role}
                  style={role === 'title' ? undefined : { fontSize: `var(--type-${role})` }}
                >
                  {sample}
                </p>
                <p className="kit-type-note">
                  <span className="kit-type-home">{home}.</span> {uses}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="kit-type-aside">
          The title is {roleSize('title')} in this {read?.window ?? ''}px window: 36px on a 390px phone, growing to
          48px at 1028px, the narrowest window where the grid gains its wing columns, and holding there while the
          grid takes the extra room.
        </p>
      </div>

      <div className="kit-type-block">
        <h3 className="kit-type-block-title eyebrow">The reading setting</h3>
        <div className="kit-type-row kit-type-reading">
          <div className="kit-type-key">
            <span className="kit-type-name">.reading</span>
            <span className="kit-type-figure">
              {read?.reading ? `${read.reading.size} on ${read.reading.line}` : ''}
            </span>
            <span className="kit-type-figure">{read?.reading ? `${read.reading.width}px wide` : ''}</span>
            <span className="kit-type-figure">
              {read?.reading?.chars ? `${read.reading.chars} characters a line` : ''}
            </span>
          </div>
          <div ref={docRef} className="leaflet-doc reading">
            <p className="leaflet-paragraph first-paragraph">
              <span className="leaflet-lede">This is the</span> setting every document on the site is read in:
              essays, works, the About page’s body, anything LeafletDocument renders. It is eighteen pixels on a
              leading of 1.6, in the five-column text column, at every width.
            </p>
            <p className="leaflet-paragraph">
              The column is fixed in rem, so the reading size alone decides how many characters a line holds: about
              76 on a desk and 48 on a 390px phone. That is why body and reading text never grow with the window, and
              why the measure moves only if the grid does.
            </p>
            <p className="leaflet-paragraph">
              Lines are justified where the measure allows, with a slightly narrower word space and sparing
              hyphenation. On a phone they stay ragged, because forty-odd characters can’t be justified well by any
              method a browser offers.
            </p>
            <h2 className="leaflet-heading leaflet-heading-2">Headings follow the text</h2>
            <p className="leaflet-paragraph">
              Section heads are sized in em of the reading size: 1.5 for a section and 1.2, in italic, for a
              subsection. Printed, the same ladder sits over 11.5pt text without a rule of its own.
            </p>
            <h3 className="leaflet-heading leaflet-heading-3">Figures in running text</h3>
            <p className="leaflet-paragraph">
              Numbers in the text are oldstyle, so 2007 and 12,230 sit on the x-height the way the lowercase does,
              while headings, tables and captions keep lining figures.
            </p>
          </div>
        </div>
      </div>

      <div className="kit-type-block">
        <h3 className="kit-type-block-title eyebrow">The scale</h3>
        <ol className="kit-type-steps">
          {STEPS.map((step) => (
            <li key={step}>
              <span className="kit-type-step" data-step={step} style={{ fontSize: `var(--text-${step})` }}>
                Aa
              </span>
              <span className="ident">{step}</span>
              <span className="kit-type-figure">{read?.steps[step] ?? ''}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="kit-type-block">
        <h3 className="kit-type-block-title eyebrow">Leading</h3>
        <dl className="kit-type-leading">
          {LEADING.map(([name, use]) => (
            <div key={name}>
              <dt>
                <span className="ident">{name}</span>{' '}
                <span className="kit-type-figure">{read?.leading[name] ?? ''}</span>
              </dt>
              <dd>{use}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="kit-type-block">
        <h3 className="kit-type-block-title eyebrow">Rules</h3>
        <ul className="kit-type-rules">
          <li>
            Ask for a role, not a step. A role can be retuned in theme.css; a step used directly can’t be told
            apart from everything else at its size.
          </li>
          <li>
            Long-form goes in <span className="ident">.reading</span>. LeafletDocument adds it, so a new document
            page gets the setting by rendering through it.
          </li>
          <li>
            Only the title is fluid. Anything set in the text column keeps a fixed size, or its lines change length
            with the window.
          </li>
          <li>
            Tokens and their responsive values live in theme.css. A component’s stylesheet lands ahead of theme.css
            in the bundle, so a token it sets on a bare <span className="ident">:root</span> loses the tie, and{' '}
            <span className="ident">tokens.test.js</span> fails if one does. Re-size on your own class instead.
          </li>
          <li>
            A role resolves on <span className="ident">:root</span>. A scope that re-sizes steps (the admin’s{' '}
            <span className="ident">.wb</span>, résumé print) sets the role it relies on as well.
          </li>
          <li>
            Nothing on the public site goes below <span className="ident">--text-2xs</span>, 11px.
          </li>
        </ul>
      </div>
    </section>
  );
}
