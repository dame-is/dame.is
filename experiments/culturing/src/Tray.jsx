import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Button, Segmented, Tag } from './host.js';
import { CULTURES, KINDS, cultureById } from './cultures.js';
import { AGAR_RANGE, MEDIA, NUTRIENT_RANGE, mediumById } from './media.js';
import { ADDITIONS, ADDITION_KINDS, additionById } from './additions.js';
import { RECIPES } from './recipes.js';
import { HUMIDITY_RANGE, TEMPERATURE_RANGE } from './recipe.js';
import { MEDIUM_LOOK_DEFAULTS, resolveCulture } from './pack.js';
import { DROPS } from './tools.js';
import { DETAILS, temperatureFactor } from './units.js';
import { describeEvent, describePour, formatHours } from './format.js';

const TABS = [
  { value: 'cultures', label: 'Cultures' },
  { value: 'media', label: 'Media' },
  { value: 'tray', label: 'Tray' },
  { value: 'incubator', label: 'Incubator' },
  { value: 'recipes', label: 'Recipes' },
  { value: 'record', label: 'Record' },
];

const LIGHT_OPTIONS = [
  { value: 'cycle', label: 'Day & night' },
  { value: 'on', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** A point somewhere on the gel, clear of the wall, for things put down
 *  without a pointer. */
function somewhere() {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * 28;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
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
 * The shelf: everything a tab has to pick from. Beside the stage it is a
 * list read down the column. On a phone it is a strip that scrolls sideways
 * under the picture (culturing.css), so picking from it never means losing
 * sight of the plate.
 */
function Shelf({ children }) {
  return <div className="cult-shelf">{children}</div>;
}

/** A row of the shelf: a swatch, a name, and what it is modelled on. */
function Item({ on, disabled, swatch, name, after, tag, onClick }) {
  return (
    <li>
      <button
        type="button"
        className={`cult-item${on ? ' is-on' : ''}`}
        aria-pressed={on}
        disabled={disabled}
        onClick={onClick}
      >
        {swatch}
        <span className="cult-item-name">{name}</span>
        <span className="cult-item-after">{after}</span>
        {tag && <Tag className="cult-item-tag">{tag}</Tag>}
      </button>
    </li>
  );
}

function cultureSwatch(culture) {
  const look = resolveCulture(culture).look;
  return (
    <span
      className="cult-swatch"
      style={{ '--swatch-rim': look.young, '--swatch-core': look.mature }}
      aria-hidden="true"
    />
  );
}

function mediumSwatch(medium) {
  const look = { ...MEDIUM_LOOK_DEFAULTS, ...medium.look };
  return (
    <span
      className="cult-swatch cult-swatch--gel"
      style={{ '--swatch-rim': look.color, '--swatch-core': look.color }}
      aria-hidden="true"
    />
  );
}

// ------------------------------------------------------------ cultures

/** The three drops, as keys. */
const DROP_KEYS = DROPS.map((d) => ({
  value: d.value,
  label: d.label,
  title: d.hint,
}));

function CulturesPanel({ bench, snap, compact }) {
  const plate = snap.dishes[snap.selected];
  const armed =
    snap.tool?.kind === 'culture' ? cultureById(snap.tool.id) : null;
  const drop = DROPS.find((d) => d.value === snap.drop) || DROPS[0];
  const across = drop.radius * 2;
  return (
    <>
      {armed ? (
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
              onChange={(value) => {
                bench.setDrop(value);
                const next = DROPS.find((d) => d.value === value);
                if (compact && next) bench.say(next.hint);
              }}
            />
            <p className="cult-field-hint">{drop.hint}</p>
          </div>
          <div className="cult-actions">
            <Button
              size="sm"
              onClick={() => {
                bench.enter(snap.selected);
                bench.spot(snap.selected, armed.id, 0, 0);
              }}
            >
              Drop it in the middle
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const { x, y } = somewhere();
                bench.enter(snap.selected);
                bench.spot(snap.selected, armed.id, x, y);
              }}
            >
              Drop one anywhere
            </Button>
            <Button
              size="sm"
              onClick={() => bench.spread(snap.selected, armed.id)}
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
      <Shelf>
        {KINDS.map((group) => {
          const members = CULTURES.filter((c) => c.kind === group.kind);
          if (!members.length) return null;
          return (
            <div key={group.kind} className="cult-group">
              <h3 className="eyebrow cult-group-head">{group.label}</h3>
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
                      onClick={() => {
                        const on = armed?.id === c.id;
                        bench.arm(on ? null : { kind: 'culture', id: c.id });
                        // On a phone the card that says this is under the
                        // strip, out of sight: the stage says it instead.
                        if (!on && compact) {
                          bench.say(
                            `${c.name}: touch the gel to leave a drop, drag to draw a streak.`,
                          );
                        }
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

function MediaPanel({ bench, snap }) {
  const plate = snap.dishes[snap.selected];
  const [pick, setPick] = useState(plate.medium);
  const [agar, setAgar] = useState(plate.agar);
  const [nutrient, setNutrient] = useState(plate.nutrient);
  // Looking at another plate shows that plate's medium.
  useEffect(() => {
    setPick(plate.medium);
    setAgar(plate.agar);
    setNutrient(plate.nutrient);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on which plate, not on its every tick
  }, [snap.selected, plate.medium]);

  const medium = mediumById(pick) || MEDIA[0];
  const choose = (m) => {
    setPick(m.id);
    setAgar(m.agar);
    setNutrient(m.nutrient);
  };
  const used = plate.events.length > 0;
  return (
    <>
      <div className="cult-card">
        <h3 className="cult-card-title">{medium.name}</h3>
        <p className="cult-card-after">after {medium.after}</p>
        <p className="cult-card-blurb">{medium.blurb}</p>
        <Slider
          label="Agar"
          value={agar}
          range={AGAR_RANGE}
          format={(v) => `${v.toFixed(1)} %`}
          onChange={setAgar}
          hint={agarHint(agar)}
        />
        <Slider
          label="Strength"
          value={nutrient}
          range={NUTRIENT_RANGE}
          format={(v) => `${Math.round(v * 100)} %`}
          onChange={setNutrient}
          hint="How much there is to eat, against a full-strength broth."
        />
        <div className="cult-actions">
          <Confirm
            sure={used}
            label={`Pour plate ${snap.selected + 1} with it`}
            confirmLabel="Discard what’s growing and pour"
            onConfirm={() =>
              bench.pour(snap.selected, medium.id, {
                agar: agar === medium.agar ? null : agar,
                nutrient: nutrient === medium.nutrient ? null : nutrient,
              })
            }
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
              tag={m.id === plate.medium ? 'poured' : null}
              onClick={() => choose(m)}
            />
          ))}
        </ul>
      </Shelf>
    </>
  );
}

// ---------------------------------------------------------------- tray

function additionSwatch(item) {
  const colour = item.drop?.dye || (item.kind === 'disc' ? '#dcd8c8' : null);
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

function TrayPanel({ bench, snap, compact }) {
  const armed =
    snap.tool?.kind === 'addition' ? additionById(snap.tool.id) : null;
  const dragged = armed && (armed.cut || armed.scrape);
  return (
    <>
      {armed ? (
        <div className="cult-card">
          <h3 className="cult-card-title">{armed.name}</h3>
          <p className="cult-card-after">after {armed.after}</p>
          <p className="cult-card-blurb">{armed.blurb}</p>
          <p className="cult-hint">
            {dragged
              ? 'Drag it across the gel.'
              : 'Touch the gel where it should go.'}
          </p>
          <div className="cult-actions">
            {!dragged && (
              <Button
                size="sm"
                onClick={() => {
                  const { x, y } = somewhere();
                  bench.enter(snap.selected);
                  bench.put(snap.selected, armed.id, x, y);
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
          Things that aren’t alive: discs, drops, dyes and two tools. Pick one
          up and touch the gel.
        </p>
      )}
      <Shelf>
        {ADDITION_KINDS.map((group) => (
          <div key={group.kind} className="cult-group">
            <h3 className="eyebrow cult-group-head">{group.label}</h3>
            <ul className="cult-list">
              {ADDITIONS.filter((a) => a.kind === group.kind).map((a) => (
                <Item
                  key={a.id}
                  on={armed?.id === a.id}
                  swatch={additionSwatch(a)}
                  name={a.name}
                  after={a.after}
                  onClick={() => {
                    const on = armed?.id === a.id;
                    bench.arm(on ? null : { kind: 'addition', id: a.id });
                    if (!on && compact) {
                      bench.say(
                        a.cut || a.scrape
                          ? `${a.name}: drag it across the gel.`
                          : `${a.name}: touch the gel where it should go.`,
                      );
                    }
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

function IncubatorPanel({ bench, snap }) {
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
            Twelve hours on, twelve off, unless told otherwise. Only some moulds
            care.
          </p>
        </div>
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

function RecipesPanel({ bench, snap, compact }) {
  const plate = snap.dishes[snap.selected];
  const used = plate.events.length > 0;
  // On a phone one recipe is read at a time: the one this plate was grown
  // from, until another is picked off the strip.
  const [pick, setPick] = useState(plate.recipe || RECIPES[0].id);
  useEffect(() => {
    if (plate.recipe) setPick(plate.recipe);
  }, [snap.selected, plate.recipe]);

  const grow = (recipe) => (
    <Confirm
      sure={used && plate.recipe !== recipe.id}
      label={
        plate.recipe === recipe.id
          ? 'Start it again'
          : `Grow it on plate ${snap.selected + 1}`
      }
      confirmLabel="Discard what’s growing and start it"
      onConfirm={() => bench.loadRecipe(snap.selected, recipe.id)}
    />
  );
  const hint = (
    <p className="cult-hint">
      Plates that show one thing each. Nothing on them is drawn: it is what
      these cultures do on that medium, started a few hours in.
    </p>
  );

  if (compact) {
    const recipe = RECIPES.find((r) => r.id === pick) || RECIPES[0];
    return (
      <>
        <div className="cult-card">
          <h3 className="cult-card-title">{recipe.name}</h3>
          <p className="cult-card-blurb">{recipe.watch}</p>
          <div className="cult-actions">{grow(recipe)}</div>
        </div>
        {hint}
        <Shelf>
          <ul className="cult-list">
            {RECIPES.map((r) => (
              <Item
                key={r.id}
                on={r.id === recipe.id}
                name={r.name}
                tag={plate.recipe === r.id ? 'on plate' : null}
                onClick={() => setPick(r.id)}
              />
            ))}
          </ul>
        </Shelf>
      </>
    );
  }

  return (
    <>
      {hint}
      <ul className="cult-recipes">
        {RECIPES.map((recipe) => (
          <li
            key={recipe.id}
            className={`cult-recipe${plate.recipe === recipe.id ? ' is-current' : ''}`}
          >
            <h3 className="cult-recipe-name">{recipe.name}</h3>
            <p className="cult-recipe-watch">{recipe.watch}</p>
            {grow(recipe)}
          </li>
        ))}
      </ul>
    </>
  );
}

// -------------------------------------------------------------- record

function RecordPanel({ bench, snap }) {
  const plate = snap.dishes[snap.selected];
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
      <div className="cult-actions cult-actions--bench">
        <Button
          size="sm"
          disabled={!snap.canAdd}
          onClick={() => bench.addDish()}
        >
          Add a plate
        </Button>
        <Confirm
          label="Throw this plate away"
          confirmLabel={`Throw plate ${snap.selected + 1} away`}
          disabled={!snap.canRemove}
          onConfirm={() => bench.removeDish(snap.selected)}
        />
        <Confirm
          label="Start the bench over"
          confirmLabel="Throw every plate away and start over"
          onConfirm={bench.resetBench}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- tray

const PANELS = {
  cultures: CulturesPanel,
  media: MediaPanel,
  tray: TrayPanel,
  incubator: IncubatorPanel,
  recipes: RecipesPanel,
  record: RecordPanel,
};

export default function Tray({ bench, snap, compact = false }) {
  const [tab, setTab] = useState('cultures');
  const Panel = PANELS[tab];
  return (
    <div className="cult-tray">
      <nav className="cult-plates" aria-label="Plates">
        {snap.dishes.map((dish, i) => {
          const medium = mediumById(dish.medium);
          const on = i === snap.selected;
          return (
            <button
              key={i}
              type="button"
              className={`cult-plate${on ? ' is-on' : ''}`}
              aria-pressed={on}
              aria-label={`Plate ${i + 1}: ${medium?.name || 'agar'}, ${formatHours(dish.hours)}`}
              title={`${medium?.name || 'Agar'}, ${formatHours(dish.hours)}`}
              onClick={() => bench.enter(i)}
            >
              {mediumSwatch(medium || MEDIA[0])}
              {i + 1}
            </button>
          );
        })}
      </nav>
      <Segmented
        className="cult-tabs"
        label="What to work with"
        options={TABS}
        value={tab}
        onChange={(next) => {
          // Leaving the shelf puts down whatever was picked up from it.
          if (snap.tool && next !== tab) bench.arm(null);
          setTab(next);
        }}
      />
      <div className="cult-panel">
        <Panel bench={bench} snap={snap} compact={compact} />
      </div>
    </div>
  );
}
