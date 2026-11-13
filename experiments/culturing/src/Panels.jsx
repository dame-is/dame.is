// What the bench's menus open (Workbench.jsx): the cultures, the media, the
// tray, the incubator, the recipes, a plate's record, and the plates
// themselves. Each is a panel that knows nothing of where it is shown. On a
// wide window it drops from the menu bar; on a phone it is a sheet pulled up
// over the bench. `onPick` is called when something has been picked up, and
// `onDone` when the panel has done what it was opened for, so whatever shows
// it can get out of the way of the plate.

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Button, Segmented, Tag } from './host.js';
import { CULTURES, KINDS, cultureById } from './cultures.js';
import {
  AGAR_RANGE,
  GRADIENTS,
  MEDIA,
  NUTRIENT_RANGE,
  mediumById,
} from './media.js';
import {
  compartmentNames,
  middleOf,
  somewhereIn,
  VESSELS,
  vesselById,
} from './vessels.js';
import { ADDITIONS, ADDITION_KINDS, additionById } from './additions.js';
import { RECIPES } from './recipes.js';
import {
  cleanLid,
  HUMIDITY_RANGE,
  LID_LENGTH,
  TEMPERATURE_RANGE,
} from './recipe.js';
import { MEDIUM_LOOK_DEFAULTS, resolveCulture } from './pack.js';
import { DROPS } from './tools.js';
import { BENCHES } from './bench.js';
import { DETAILS, temperatureFactor } from './units.js';
import { describeEvent, describePour, formatHours } from './format.js';
import { saveBlob } from './save.js';

const LIGHT_OPTIONS = [
  { value: 'cycle', label: 'Day & night' },
  { value: 'on', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** A point somewhere on a plate's gel, clear of its walls, for things put
 *  down without a pointer: in any of its compartments. */
function somewhere(plate) {
  const count = vesselById(plate.vessel)?.compartments || 1;
  return somewhereIn(plate.vessel, Math.floor(Math.random() * count));
}

/** What is known to be true of a thing, each with where to read it. */
function Notes({ notes }) {
  if (!notes || !notes.length) return null;
  return (
    <ul className="cult-notes">
      {notes.map((note, i) => (
        <li key={i}>
          {note.text}
          {note.href && (
            <>
              {' '}
              <a
                className="cult-source"
                href={note.href}
                target="_blank"
                rel="noreferrer noopener"
              >
                source
                <ArrowUpRight size={11} aria-hidden="true" />
              </a>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * A button that asks once more before it throws something away: the first
 * press arms it for a few seconds, the second does it. `sure` is false for
 * anything with nothing to lose, which goes through on the first.
 */
function Confirm({ label, confirmLabel, onConfirm, sure = true, ...rest }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  if (!sure) {
    return (
      <Button size="sm" onClick={onConfirm} {...rest}>
        {label}
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant={armed ? 'danger' : 'quiet'}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        setArmed(false);
        onConfirm();
      }}
      {...rest}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}

/**
 * Whether a pointer can rest on a thing without pressing it. Only then is
 * a shelf item's card shown before it is picked: on a touch screen the
 * focus that comes with a tap would put the card in, move the shelf, and
 * send the tap's click somewhere else.
 */
function canHover() {
  return (
    typeof matchMedia === 'function' && matchMedia('(hover: hover)').matches
  );
}

/** The shelf: everything a panel has to pick from. `onLeave` is told when
 *  the pointer leaves it, to stop showing what it was over. */
function Shelf({ children, onLeave }) {
  return (
    <div className="cult-shelf" onMouseLeave={onLeave}>
      {children}
    </div>
  );
}

/** A row of the shelf: a swatch, a name, and what it is modelled on.
 *  `onPeek` is told when the pointer or the focus comes to it. */
function Item({ on, disabled, swatch, name, after, tag, onClick, onPeek }) {
  return (
    <li>
      <button
        type="button"
        className={`cult-item${on ? ' is-on' : ''}`}
        aria-pressed={on}
        // Not `disabled`: one that can't be picked can still be read about.
        aria-disabled={disabled || undefined}
        onClick={disabled ? undefined : onClick}
        onMouseEnter={onPeek}
        onFocus={onPeek}
      >
        {swatch}
        <span className="cult-item-name">{name}</span>
        <span className="cult-item-after">{after}</span>
        {tag && <Tag className="cult-item-tag">{tag}</Tag>}
      </button>
    </li>
  );
}

export function cultureSwatch(culture) {
  const look = resolveCulture(culture).look;
  return (
    <span
      className="cult-swatch"
      style={{ '--swatch-rim': look.young, '--swatch-core': look.mature }}
      aria-hidden="true"
    />
  );
}

export function mediumSwatch(medium, tint = null) {
  const look = { ...MEDIUM_LOOK_DEFAULTS, ...medium.look };
  const colour = tint || look.color;
  return (
    <span
      className="cult-swatch cult-swatch--gel"
      style={{ '--swatch-rim': colour, '--swatch-core': colour }}
      aria-hidden="true"
    />
  );
}

/**
 * The card for something on a shelf that the pointer is over but the hand
 * isn't holding: what it is, where it comes from, and how to use it.
 */
function PeekCard({ item, hint }) {
  return (
    <div className="cult-card cult-card--peek">
      <h3 className="cult-card-title">{item.name}</h3>
      <p className="cult-card-after">after {item.after}</p>
      <p className="cult-card-blurb">{item.blurb}</p>
      <p className="cult-hint">{hint}</p>
      <Notes notes={item.notes} />
    </div>
  );
}

/**
 * A colour picked by hand: the system's own picker, and a way back to
 * whatever it was before. `value` is '#rrggbb' or null for "its own".
 */
function ColourField({ id, label, value, own, onChange, ownLabel, hint }) {
  return (
    <div className="cult-field">
      <label className="cult-field-label" htmlFor={id}>
        {label}
      </label>
      <output className="cult-field-value" htmlFor={id}>
        {value ? value : 'its own'}
      </output>
      <div className="cult-colour">
        <input
          id={id}
          type="color"
          value={value || own}
          onChange={(e) => onChange(e.target.value)}
        />
        {ownLabel && value && (
          <Button size="sm" variant="text" onClick={() => onChange(null)}>
            {ownLabel}
          </Button>
        )}
      </div>
      {hint && <p className="cult-field-hint">{hint}</p>}
    </div>
  );
}

// ------------------------------------------------------------ cultures

/** The three drops, as keys. */
const DROP_KEYS = DROPS.map((d) => ({
  value: d.value,
  label: d.label,
  title: d.hint,
}));

export function CulturesPanel({ bench, snap, onPick, onDone }) {
  const plate = snap.dishes[snap.selected];
  const armed =
    snap.tool?.kind === 'culture' ? cultureById(snap.tool.id) : null;
  const drop = DROPS.find((d) => d.value === snap.drop) || DROPS[0];
  const across = drop.radius * 2;
  // The one the pointer is over, read before it is picked up.
  const [peek, setPeek] = useState(null);
  const peeked = peek && peek !== armed?.id ? cultureById(peek) : null;
  return (
    <>
      {peeked ? (
        <PeekCard
          item={peeked}
          hint={
            plate.full && !plate.slots.includes(peeked.id)
              ? 'This plate holds four cultures already.'
              : 'Pick it up, then touch the gel: a tap leaves a drop, a drag draws a streak.'
          }
        />
      ) : armed ? (
        <div className="cult-card">
          <h3 className="cult-card-title">{armed.name}</h3>
          <p className="cult-card-after">after {armed.after}</p>
          <p className="cult-card-blurb">{armed.blurb}</p>
          <p className="cult-hint">
            Touch the gel to leave a drop of it, or drag to draw a streak, which
            thins out as the loop empties. The mark shows the middle of the
            plate. A drop put into another culture’s while that is still wet
            mixes with it, and the two grow out from one place.
          </p>
          <div className="cult-field">
            <span className="cult-field-label" id="cult-drop-label">
              Drop
            </span>
            <output className="cult-field-value">
              {Number.isInteger(across) ? across : across.toFixed(1)} mm across
            </output>
            <Segmented
              label="How big a drop to leave"
              options={DROP_KEYS}
              value={drop.value}
              onChange={bench.setDrop}
            />
            <p className="cult-field-hint">{drop.hint}</p>
          </div>
          <div className="cult-actions">
            <Button
              size="sm"
              onClick={() => {
                bench.enter(snap.selected);
                // On a plate of several, one in the middle of each.
                const count = vesselById(plate.vessel)?.compartments || 1;
                for (let i = 0; i < count; i += 1) {
                  const { x, y } = middleOf(plate.vessel, i);
                  bench.spot(snap.selected, armed.id, x, y);
                }
                onDone?.();
              }}
            >
              {plate.vessel === 'wells'
                ? 'Drop one in each well'
                : plate.vessel === 'split'
                  ? 'Drop one in each half'
                  : 'Drop it in the middle'}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const { x, y } = somewhere(plate);
                bench.enter(snap.selected);
                bench.spot(snap.selected, armed.id, x, y);
                onDone?.();
              }}
            >
              Drop one anywhere
            </Button>
            <Button
              size="sm"
              onClick={() => {
                bench.spread(snap.selected, armed.id);
                onDone?.();
              }}
            >
              Spread a lawn
            </Button>
            <Button size="sm" variant="text" onClick={() => bench.arm(null)}>
              Put it down
            </Button>
          </div>
          <Notes notes={armed.notes} />
        </div>
      ) : (
        <p className="cult-hint">
          Pick a culture up, then touch the gel with it: a tap leaves a drop, a
          drag draws a streak. Put two in the middle and they grow out from it
          together. A plate holds four.
        </p>
      )}
      <Shelf onLeave={() => setPeek(null)}>
        {KINDS.map((group) => {
          const members = CULTURES.filter((c) => c.kind === group.kind);
          if (!members.length) return null;
          return (
            <div key={group.kind} className="cult-group">
              <h3 className="cult-group-head">{group.label}</h3>
              <ul className="cult-list">
                {members.map((c) => {
                  const here = plate.slots.includes(c.id);
                  return (
                    <Item
                      key={c.id}
                      on={armed?.id === c.id}
                      disabled={plate.full && !here}
                      swatch={cultureSwatch(c)}
                      name={c.name}
                      after={c.after}
                      tag={here ? 'on plate' : null}
                      onPeek={canHover() ? () => setPeek(c.id) : undefined}
                      onClick={() => {
                        const on = armed?.id === c.id;
                        bench.arm(on ? null : { kind: 'culture', id: c.id });
                        if (!on) onPick?.();
                      }}
                    />
                  );
                })}
              </ul>
            </div>
          );
        })}
      </Shelf>
    </>
  );
}

// --------------------------------------------------------------- media

function Slider({ label, value, range, format, onChange, onCommit, hint }) {
  const id = `cult-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <div className="cult-field">
      <label htmlFor={id} className="cult-field-label">
        {label}
      </label>
      <output htmlFor={id} className="cult-field-value">
        {format(value)}
      </output>
      <input
        id={id}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
      />
      {hint && <p className="cult-field-hint">{hint}</p>}
    </div>
  );
}

function agarHint(percent) {
  if (percent <= 0.4) return 'Barely set: cells swim through it.';
  if (percent <= 0.8) return 'Soft and wet on top: swarmers travel.';
  if (percent < 1.3) return 'Firmish: only the strongest swarmers move.';
  if (percent <= 1.8)
    return 'The standard firm plate. Nearly everything stays put.';
  return 'Hard and dry: fine wrinkles, and nothing moves.';
}

const VESSEL_KEYS = VESSELS.map((v) => ({
  value: v.id,
  label: v.name,
  title: v.hint,
}));

const GRADIENT_KEYS = [
  { value: 'none', label: 'None', title: 'The same all over.' },
  ...GRADIENTS.map((g) => ({ value: g.value, label: g.label, title: g.hint })),
];

/** A plate's media, one per compartment of a vessel, as far as they go. */
function fill(media, count) {
  return Array.from({ length: count }, (_, i) => media[i] || media[0]);
}

export function MediaPanel({ bench, snap, onDone }) {
  const plate = snap.dishes[snap.selected];
  const cardRef = useRef(null);
  const [vessel, setVessel] = useState(plate.vessel);
  const [parts, setParts] = useState(plate.media);
  const [part, setPart] = useState(0);
  const [agar, setAgar] = useState(plate.agar);
  const [nutrient, setNutrient] = useState(plate.nutrient);
  const [gradient, setGradient] = useState(plate.gradient || 'none');
  const [tints, setTints] = useState(plate.tints || []);
  // Looking at another plate shows that plate's media.
  useEffect(() => {
    setVessel(plate.vessel);
    setParts(plate.media);
    setPart(0);
    setAgar(plate.agar);
    setNutrient(plate.nutrient);
    setGradient(plate.gradient || 'none');
    setTints(plate.tints || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on which plate, not on its every tick
  }, [snap.selected, plate.medium, plate.vessel, plate.gradient, plate.tints]);

  const shape = vesselById(vessel) || VESSELS[0];
  const several = shape.compartments > 1;
  const names = compartmentNames(shape.id);
  const wells = shape.id === 'wells';
  const here = Math.min(part, shape.compartments - 1);
  const medium = mediumById(parts[here]) || MEDIA[0];
  const choose = (m) => {
    setParts(
      fill(parts, shape.compartments).map((id, i) => (i === here ? m.id : id)),
    );
    // The vessel is poured from the first compartment's gel.
    if (here === 0) {
      setAgar(m.agar);
      setNutrient(m.nutrient);
    }
    // On a phone the card is above the shelf, out of sight once the shelf
    // has been scrolled to: bring it back, with Pour on it.
    cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const used = plate.events.length > 0;
  const gradientHint = GRADIENTS.find((g) => g.value === gradient)?.hint;
  return (
    <>
      <div className="cult-card" ref={cardRef}>
        <div className="cult-field">
          <span className="cult-field-label">Poured into</span>
          <Segmented
            label="What to pour it into"
            options={VESSEL_KEYS}
            value={shape.id}
            onChange={(value) => {
              const next = vesselById(value);
              if (!next) return;
              setVessel(next.id);
              setParts(fill(parts, next.compartments));
              setPart(0);
            }}
          />
          <p className="cult-field-hint">{shape.hint}</p>
        </div>
        {several && (
          <div className="cult-field">
            <span className="cult-field-label">
              {wells ? 'Wells' : 'Sides'}
            </span>
            <div
              className="cult-plates"
              role="group"
              aria-label={wells ? 'Wells' : 'Sides'}
            >
              {fill(parts, shape.compartments).map((id, i) => {
                const m = mediumById(id) || MEDIA[0];
                const name = wells ? `Well ${names[i]}` : `${names[i]} side`;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`cult-plate${i === here ? ' is-on' : ''}`}
                    aria-pressed={i === here}
                    aria-label={`${name}: ${m.name}`}
                    title={m.name}
                    onClick={() => setPart(i)}
                  >
                    {mediumSwatch(m, tints[i])}
                    {names[i]}
                  </button>
                );
              })}
            </div>
            <p className="cult-field-hint">
              Pick a medium below for{' '}
              {wells
                ? `well ${names[here]}`
                : `the ${names[here].toLowerCase()} side`}
              . The agar is the same throughout.
            </p>
          </div>
        )}
        <h3 className="cult-card-title">{medium.name}</h3>
        <p className="cult-card-after">after {medium.after}</p>
        <p className="cult-card-blurb">{medium.blurb}</p>
        <ColourField
          id="cult-tint"
          label="Colour"
          value={tints[here] || null}
          own={{ ...MEDIUM_LOOK_DEFAULTS, ...medium.look }.color}
          ownLabel="Its own colour"
          onChange={(colour) =>
            setTints(
              Array.from({ length: shape.compartments }, (_, i) =>
                i === here ? colour : tints[i] || null,
              ),
            )
          }
          hint="A few drops of food colouring in the pour. It changes nothing but the colour: an indicator still turns, and a clearing still clears."
        />
        <Slider
          label="Agar"
          value={agar}
          range={AGAR_RANGE}
          format={(v) => `${v.toFixed(1)} %`}
          onChange={setAgar}
          hint={agarHint(agar)}
        />
        {!several && (
          <Slider
            label="Strength"
            value={nutrient}
            range={NUTRIENT_RANGE}
            format={(v) => `${Math.round(v * 100)} %`}
            onChange={setNutrient}
            hint="How much there is to eat, against a full-strength broth."
          />
        )}
        <div className="cult-field">
          <span className="cult-field-label">Gradient</span>
          <Segmented
            label="A gradient across the plate"
            options={GRADIENT_KEYS}
            value={gradient}
            onChange={setGradient}
          />
          <p className="cult-field-hint">
            {gradientHint ||
              'Poured as a wedge, a gradient puts more of something toward one side.'}
          </p>
        </div>
        <div className="cult-actions">
          <Confirm
            sure={used}
            label={`Pour plate ${snap.selected + 1}`}
            confirmLabel="Discard what’s growing and pour"
            onConfirm={() => {
              const media = fill(parts, shape.compartments);
              const first = mediumById(media[0]) || MEDIA[0];
              bench.pour(snap.selected, first.id, {
                agar: agar === first.agar ? null : agar,
                nutrient:
                  several || nutrient === first.nutrient ? null : nutrient,
                vessel: shape.id,
                media: several ? media : null,
                gradient: gradient === 'none' ? null : gradient,
                tints: Array.from(
                  { length: shape.compartments },
                  (_, i) => tints[i] || null,
                ),
              });
              onDone?.();
            }}
          />
        </div>
        <Notes notes={medium.notes} />
      </div>
      <Shelf>
        <ul className="cult-list">
          {MEDIA.map((m) => (
            <Item
              key={m.id}
              on={m.id === medium.id}
              swatch={mediumSwatch(m)}
              name={m.name}
              after={m.after}
              tag={plate.media.includes(m.id) ? 'poured' : null}
              onClick={() => choose(m)}
            />
          ))}
        </ul>
      </Shelf>
    </>
  );
}

// ---------------------------------------------------------------- tray

export function additionSwatch(item, chosen = null) {
  const colour =
    chosen || item.drop?.dye || (item.kind === 'disc' ? '#dcd8c8' : null);
  return (
    <span
      className={`cult-swatch cult-swatch--${item.kind}`}
      style={
        colour ? { '--swatch-rim': colour, '--swatch-core': colour } : undefined
      }
      aria-hidden="true"
    />
  );
}

/** What the hand does with something off the tray, in a sentence. */
export function handling(item) {
  if (item.print) {
    return `Take a print of another plate as it stands, and put it down on this one.`;
  }
  if (item.cut || item.scrape) return 'Drag it across the gel.';
  if (item.strip) {
    return 'Touch the gel to lay it along the radius, strong end inward, or drag from where the strong end should go.';
  }
  if (item.kind === 'disc') {
    return 'Touch the gel to set a disc down, or drag to lay a ribbon of soaked paper.';
  }
  return 'Touch the gel to leave a drop, or drag to draw a line of it.';
}

/** The plates a velvet can take a print from: the others with something
 *  growing on them. */
function PrintFrom({ bench, snap, onDone }) {
  const sources = snap.dishes
    .map((dish, i) => ({ dish, i }))
    .filter(({ dish, i }) => i !== snap.selected && dish.slots.length > 0);
  if (!sources.length) {
    return (
      <p className="cult-hint">
        No other plate has anything growing on it to take a print of.
      </p>
    );
  }
  return (
    <div className="cult-actions">
      {sources.map(({ dish, i }) => (
        <Button
          key={i}
          size="sm"
          title={`Press it onto plate ${i + 1}, then onto plate ${snap.selected + 1}`}
          onClick={() => {
            bench.enter(snap.selected);
            bench.print(i, snap.selected);
            onDone?.();
          }}
        >
          {mediumSwatch(mediumById(dish.medium) || MEDIA[0])}
          From plate {i + 1}
        </Button>
      ))}
    </div>
  );
}

export function TrayPanel({ bench, snap, onPick, onDone }) {
  const armed =
    snap.tool?.kind === 'addition' ? additionById(snap.tool.id) : null;
  const dragged = armed && (armed.cut || armed.scrape || armed.print);
  // The one the pointer is over, read before it is picked up.
  const [peek, setPeek] = useState(null);
  const peeked = peek && peek !== armed?.id ? additionById(peek) : null;
  return (
    <>
      {peeked ? (
        <PeekCard item={peeked} hint={handling(peeked)} />
      ) : armed ? (
        <div className="cult-card">
          <h3 className="cult-card-title">{armed.name}</h3>
          <p className="cult-card-after">after {armed.after}</p>
          <p className="cult-card-blurb">{armed.blurb}</p>
          <p className="cult-hint">{handling(armed)}</p>
          {armed.print && (
            <PrintFrom bench={bench} snap={snap} onDone={onDone} />
          )}
          {armed.pick && (
            <ColourField
              id="cult-food"
              label="Colour"
              value={snap.tool.color || armed.pick}
              own={armed.pick}
              onChange={(colour) =>
                bench.arm({ ...snap.tool, color: colour || armed.pick })
              }
            />
          )}
          <div className="cult-actions">
            {!dragged && (
              <Button
                size="sm"
                onClick={() => {
                  const { x, y } = somewhere(snap.dishes[snap.selected]);
                  bench.enter(snap.selected);
                  bench.put(snap.selected, armed.id, x, y, snap.tool.color);
                  onDone?.();
                }}
              >
                Set one down anywhere
              </Button>
            )}
            <Button size="sm" variant="text" onClick={() => bench.arm(null)}>
              Put it down
            </Button>
          </div>
          <Notes notes={armed.notes} />
        </div>
      ) : (
        <p className="cult-hint">
          Things that aren’t alive: discs, drops, dyes, stains and two tools.
          Pick one up and touch the gel, or drag across it.
        </p>
      )}
      <Shelf onLeave={() => setPeek(null)}>
        {ADDITION_KINDS.map((group) => (
          <div key={group.kind} className="cult-group">
            <h3 className="cult-group-head">{group.label}</h3>
            <ul className="cult-list">
              {ADDITIONS.filter((a) => a.kind === group.kind).map((a) => (
                <Item
                  key={a.id}
                  on={armed?.id === a.id}
                  swatch={additionSwatch(
                    a,
                    a.pick && armed?.id === a.id ? snap.tool.color : null,
                  )}
                  name={a.name}
                  after={a.after}
                  onPeek={canHover() ? () => setPeek(a.id) : undefined}
                  onClick={() => {
                    const on = armed?.id === a.id;
                    bench.arm(on ? null : { kind: 'addition', id: a.id });
                    if (!on) onPick?.();
                  }}
                />
              ))}
            </ul>
          </div>
        ))}
      </Shelf>
    </>
  );
}

// ----------------------------------------------------------- incubator

/** How each culture on the plate takes the temperature it is at. */
function TemperatureNote({ slots, temperature }) {
  if (!slots.length) return null;
  return (
    <ul className="cult-suits">
      {slots.map((id) => {
        const culture = resolveCulture(cultureById(id));
        const factor = temperatureFactor(temperature, culture.temp);
        const cold = culture.pigment.tempMax;
        return (
          <li key={id}>
            <span>{culture.name}</span>
            <span className="cult-suits-value">
              {factor <= 0
                ? 'won’t grow'
                : `${Math.round(factor * 100)} % of its best`}
              {cold != null && temperature > cold ? ', no pigment' : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A word masked on the lid: black letters on a clear sheet, which keep the
 * incubator's light off the plate under them. Only a culture that cares
 * about light shows it.
 */
function LidField({ lid, onSet }) {
  const [text, setText] = useState(lid);
  useEffect(() => setText(lid), [lid]);
  const word = cleanLid(text);
  return (
    <div className="cult-field">
      <label className="cult-field-label" htmlFor="cult-lid">
        Lid
      </label>
      <output className="cult-field-value" htmlFor="cult-lid">
        {lid ? `masked: “${lid}”` : 'clear'}
      </output>
      <form
        className="cult-lid"
        onSubmit={(e) => {
          e.preventDefault();
          if (word && word !== lid) onSet(word);
        }}
      >
        <input
          id="cult-lid"
          className="cult-lid-input"
          type="text"
          maxLength={LID_LENGTH}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          placeholder="a word to mask it with"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button size="sm" type="submit" disabled={!word || word === lid}>
          Mask the lid
        </Button>
        {lid && (
          <Button size="sm" variant="text" onClick={() => onSet('')}>
            Clear it
          </Button>
        )}
      </form>
      <p className="cult-field-hint">
        Black letters over the lid keep the light off what is under them. A lawn
        of Darkroom goes black there; Day rings fruits everywhere else. Keep the
        light on, or the night develops the whole plate.
      </p>
    </div>
  );
}

export function IncubatorPanel({ bench, snap }) {
  const plate = snap.dishes[snap.selected];
  const { env } = plate;
  const set = (patch) => bench.setEnv(snap.selected, patch);
  return (
    <>
      <div className="cult-card">
        <h3 className="cult-card-title">
          Plate {snap.selected + 1}’s incubator
        </h3>
        <Slider
          label="Temperature"
          value={env.temperature}
          range={TEMPERATURE_RANGE}
          format={(v) => `${v} °C`}
          onChange={(v) => set({ temperature: v })}
        />
        <TemperatureNote slots={plate.slots} temperature={env.temperature} />
        <Slider
          label="Humidity"
          value={env.humidity}
          range={HUMIDITY_RANGE}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={(v) => set({ humidity: v })}
          hint="A plate dries from the hour it is poured: slowly in damp air, in a day or two in dry. A dry surface stops a swarm and tightens a film’s wrinkles."
        />
        <div className="cult-field">
          <span className="cult-field-label" id="cult-light-label">
            Light
          </span>
          <Segmented
            label="Light in the incubator"
            options={LIGHT_OPTIONS}
            value={env.light}
            onChange={(v) => set({ light: v })}
          />
          <p className="cult-field-hint">
            Twelve hours on, twelve off, unless told otherwise. Only some
            cultures care.
          </p>
        </div>
        <LidField lid={env.lid || ''} onSet={(lid) => set({ lid })} />
        <div className="cult-actions">
          <Button
            size="sm"
            on={plate.held}
            aria-pressed={plate.held}
            onClick={() => bench.setHeld(snap.selected, !plate.held)}
          >
            {plate.held ? 'In the fridge: stopped' : 'Put it in the fridge'}
          </Button>
        </div>
      </div>
      <div className="cult-card">
        <h3 className="cult-card-title">Looking</h3>
        <Slider
          label="Relief"
          value={snap.stretch}
          range={{ min: 1, max: 8, step: 0.5 }}
          format={(v) => (v === 1 ? 'true to life' : `${v}× taller than life`)}
          onChange={bench.setStretch}
          hint="A colony is a fraction of a millimetre thick on a dish 86 mm across. The vertical is stretched, the way a raking light stretches it in a photograph."
        />
        <div className="cult-field">
          <span className="cult-field-label">Grid</span>
          <output className="cult-field-value">
            {snap.size} points across
          </output>
          <Segmented
            label="How finely the plates are worked out"
            options={DETAILS}
            value={snap.detail}
            onChange={bench.setDetail}
          />
          <p className="cult-field-hint">
            A finer grid shows finer folds and sharper edges, and takes about
            three times the work for every hour grown. Changing it grows every
            plate again from its record.
          </p>
        </div>
        <div className="cult-field">
          <span className="cult-field-label">Under the plates</span>
          <div className="cult-colour">
            <Segmented
              label="What the plates sit on"
              options={BENCHES}
              value={snap.bench}
              onChange={bench.setBench}
            />
            <input
              type="color"
              aria-label="Any colour to set the plates on"
              value={snap.bench}
              onChange={(e) => bench.setBench(e.target.value)}
            />
          </div>
          <p className="cult-field-hint">
            Colonies are photographed on black to show their relief and on white
            to show their colour. Through a clear gel, it is all you see.
          </p>
        </div>
        <Slider
          label="Lamp, round the bench"
          value={snap.lampAz}
          range={{ min: 0, max: 355, step: 5 }}
          format={(v) => `${v}°`}
          onChange={(v) => bench.setLamp({ az: v })}
        />
        <Slider
          label="Lamp, height"
          value={snap.lampEl}
          range={{ min: 8, max: 80, step: 2 }}
          format={(v) => `${v}°`}
          onChange={(v) => bench.setLamp({ el: v })}
          hint="Low, and every ridge throws a shadow. High, and the surface flattens out."
        />
      </div>
    </>
  );
}

// ------------------------------------------------------------- recipes

export function RecipesPanel({ bench, snap, onDone }) {
  const plate = snap.dishes[snap.selected];
  const used = plate.events.length > 0;
  return (
    <>
      <p className="cult-hint">
        Plates that show one thing each. Nothing on them is drawn: it is what
        these cultures do on that medium, started a few hours in.
      </p>
      <ul className="cult-recipes">
        {RECIPES.map((recipe) => (
          <li
            key={recipe.id}
            className={`cult-recipe${plate.recipe === recipe.id ? ' is-current' : ''}`}
          >
            <h3 className="cult-recipe-name">{recipe.name}</h3>
            <p className="cult-recipe-watch">{recipe.watch}</p>
            <Confirm
              sure={used && plate.recipe !== recipe.id}
              label={
                plate.recipe === recipe.id
                  ? 'Start it again'
                  : `Grow it on plate ${snap.selected + 1}`
              }
              confirmLabel="Discard what’s growing and start it"
              onConfirm={() => {
                bench.loadRecipe(snap.selected, recipe.id);
                bench.enter(snap.selected);
                onDone?.();
              }}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

// -------------------------------------------------------------- record

/** Pick the plate up, and give the camera a moment to get there. */
async function inView(bench, snap) {
  if (snap.mode === 'plate') return;
  bench.enter(snap.selected);
  await new Promise((resolve) => setTimeout(resolve, 800));
}

export function RecordPanel({ bench, snap }) {
  const plate = snap.dishes[snap.selected];
  const name = `plate-${snap.selected + 1}-${Math.round(plate.goal)}h`;
  const fourLights = async () => {
    await inView(bench, snap);
    const blob = await bench.photoLights();
    if (blob) saveBlob(blob, `${name}-four-lights.png`);
  };
  const film = async () => {
    await inView(bench, snap);
    const video = await bench.filmReplay(snap.selected);
    if (video) saveBlob(video.blob, `${name}.${video.extension}`);
  };
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(id);
  }, [copied]);
  const copyLink = async () => {
    const link = bench.shareLink(snap.selected);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      window.prompt('A link to this plate:', link);
    }
  };
  return (
    <>
      <p className="cult-hint">
        A plate is kept as this record, not as a picture. Leave and come back,
        or send someone the link, and it is grown again from here: the same
        recipe, never quite the same plate.
      </p>
      <ol className="cult-record">
        <li>
          <span className="cult-record-at">0 h</span>
          <span>{describePour(plate)}</span>
        </li>
        {plate.events.map((event, i) => (
          <li
            key={i}
            className={event.at > plate.hours ? 'is-pending' : undefined}
          >
            <span className="cult-record-at">{formatHours(event.at)}</span>
            <span>
              {describeEvent(event)}
              {event.at > plate.hours ? ' (still to come)' : ''}
            </span>
          </li>
        ))}
      </ol>
      <div className="cult-actions">
        <Button
          size="sm"
          disabled={!plate.events.length}
          onClick={() => bench.undo(snap.selected)}
        >
          Take back the last
        </Button>
        <Button size="sm" onClick={copyLink}>
          {copied ? 'Link copied' : 'Copy a link to this plate'}
        </Button>
      </div>
      <div className="cult-actions">
        <Button size="sm" onClick={fourLights}>
          Photograph it under all four lights
        </Button>
        <Button
          size="sm"
          on={snap.filming}
          disabled={!plate.events.length || snap.filming}
          onClick={film}
        >
          {snap.filming ? 'Filming the replay…' : 'Save the replay as a video'}
        </Button>
      </div>
    </>
  );
}

// -------------------------------------------------------------- plates

/** What a plate is doing, if anything worth saying beside its hour. */
function plateState(dish) {
  if (dish.replaying) return 'replaying';
  if (dish.catching) return 're-growing';
  if (dish.held) return 'in the fridge';
  return null;
}

/**
 * The plates on the bench, to pick one up from, and what is done to the
 * bench as a whole: another plate, a plate thrown away, a bench dealt by
 * chance or started over.
 */
export function PlatesPanel({ bench, snap, onDone }) {
  const any = snap.dishes.some((d) => d.touched);
  return (
    <>
      <ul className="cult-list cult-plate-list">
        {snap.dishes.map((dish, i) => {
          const medium = mediumById(dish.medium) || MEDIA[0];
          const on = snap.mode === 'plate' && i === snap.selected;
          const state = plateState(dish);
          return (
            <li key={i}>
              <button
                type="button"
                className={`cult-item${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => {
                  bench.enter(i);
                  onDone?.();
                }}
              >
                {mediumSwatch(medium, dish.tints?.[0])}
                <span className="cult-item-name">Plate {i + 1}</span>
                <span className="cult-item-after">
                  {medium.name}, {formatHours(dish.hours)}
                  {state ? `, ${state}` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="cult-actions">
        <Button
          size="sm"
          on={snap.mode === 'bench'}
          onClick={() => {
            bench.leave();
            onDone?.();
          }}
        >
          All plates
        </Button>
        <Button
          size="sm"
          disabled={!snap.canAdd}
          onClick={() => {
            bench.addDish();
            onDone?.();
          }}
        >
          Add a plate
        </Button>
      </div>
      <div className="cult-actions cult-actions--bench">
        <Confirm
          label={`Throw plate ${snap.selected + 1} away`}
          confirmLabel={`Throw plate ${snap.selected + 1} away for good`}
          disabled={!snap.canRemove}
          onConfirm={() => bench.removeDish(snap.selected)}
        />
        <Confirm
          sure={any}
          label="Randomize every plate"
          confirmLabel="Throw them all away and randomize"
          onConfirm={() => {
            bench.randomizeBench();
            onDone?.();
          }}
        />
        <Confirm
          label="Start the bench over"
          confirmLabel="Throw every plate away and start over"
          onConfirm={() => {
            bench.resetBench();
            onDone?.();
          }}
        />
      </div>
    </>
  );
}
