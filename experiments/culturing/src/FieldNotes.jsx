import { SectionHead } from './host.js';

/** A paper, named in the line it supports. */
function Ref({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

/**
 * What the bench is made of, and where it parts from the real thing. The
 * page promises that nothing here is science and everything here is
 * modelled on how real plates look; this is the second half of that
 * promise, set down where it can be checked.
 */
export default function FieldNotes() {
  return (
    <section className="cult-fieldnotes" aria-labelledby="cult-fieldnotes-h">
      <SectionHead id="cult-fieldnotes-h" title="What is real here" />
      <p>
        Nothing on the bench is an organism and nothing that grows on it is a
        result. Each culture is a handful of numbers fed to one small model. The
        model, though, is put together from the rules people who study colonies
        arrived at, and its numbers are in millimetres and hours so that they
        can be held against what has been measured. No pattern is drawn: every
        branch, ring, wrinkle and sector is what those rules do when they meet.
      </p>
      <ul className="cult-rules">
        <li>
          <strong>Two populations.</strong> Every culture is a thin layer that
          travels and a film that stays, each turning into the other. It is the
          split between active and inactive cells, or swarmers and the rest,
          that the{' '}
          <Ref href="https://arxiv.org/abs/cond-mat/9807088">
            colony-pattern models
          </Ref>{' '}
          are built on.
        </li>
        <li>
          <strong>Food that runs short.</strong> Growth eats a nutrient that has
          to diffuse through the gel to reach it. A front that outruns its food
          is unstable: whatever gets ahead reaches more, the gaps starve, and
          the edge breaks into{' '}
          <Ref href="https://arxiv.org/abs/cond-mat/9904367">
            branches, the way it does on a lean plate
          </Ref>
          .
        </li>
        <li>
          <strong>A film that creeps and thickens.</strong> A biofilm spreads
          like a viscous drop,{' '}
          <Ref href="https://web.mae.ufl.edu/t.e.angelini/publications/seminara_PNAS_2012.pdf">
            swelling with water its matrix draws from the agar
          </Ref>
          , and gets taller by{' '}
          <Ref href="https://par.nsf.gov/servlets/purl/10417019">
            a growing layer of fixed depth
          </Ref>
          , which is why a colony is domed.
        </li>
        <li>
          <strong>Buckling.</strong> A growing film stuck to a softer gel goes
          into compression and wrinkles at a width set by{' '}
          <Ref href="https://elifesciences.org/articles/43920">
            its thickness and the gel’s stiffness
          </Ref>
          : a maze where it is squeezed evenly, spokes{' '}
          <Ref href="https://pmc.ncbi.nlm.nih.gov/articles/PMC7148565">
            where it is squeezed round its rim
          </Ref>
          . The film goes on thickening for days, so the width a fold wants goes
          on growing: ridges that come up fine at the rim run together into
          heavy veins toward the middle, and the drop the colony was started
          from, which was never squeezed the same way, keeps a character of its
          own. Some colonies are smooth for days and only then fold, and their
          folds set where they first came up.
        </li>
        <li>
          <strong>Ground that is held.</strong> Two cultures on one patch of
          agar each slow the other, so whichever has more of it keeps it. Put
          down in one drop they settle into patches, and since only the cells at
          the very edge found new ground,{' '}
          <Ref href="https://pmc.ncbi.nlm.nih.gov/articles/PMC2148399/">
            each patch at the rim becomes a sector
          </Ref>
          : wide where its culture keeps pace, pinched out where it can’t.
        </li>
        <li>
          <strong>A film that is pulled.</strong> A swarm on its own surfactant
          is a film of liquid, pulled outward because the surface is slacker
          where there is more surfactant, and{' '}
          <Ref href="https://uni-muenster.de/Physik.TP/~thiele/Paper/TrJT2018sm.pdf">
            a flow driven that way breaks a round front into fingers
          </Ref>
          . Here it is one rule: the thicker the layer lies, the faster it is
          carried. A stretch that gets ahead comes to fresh agar first, thickens
          and pulls away, and the thin stretches between are left behind as the
          gaps.
        </li>
        <li>
          <strong>Swarming by turns.</strong> Swarmer cells are made only inside
          a window of density and move only in company. That is the whole of{' '}
          <Ref href="https://arxiv.org/abs/physics/0007087">
            the smallest model that gives rings
          </Ref>
          , and the reason a ring keeps time with the doubling time and not with
          the agar.
        </li>
        <li>
          <strong>Chemistry in the gel.</strong> Antibiotics, quorum signals,
          acid, enzymes and pigments leave the colonies and spread,{' '}
          <Ref href="https://pmc.ncbi.nlm.nih.gov/articles/PMC148055/">
            at about the rates measured for molecules their size
          </Ref>
          . A zone of inhibition, a violet halo and a turned indicator are all
          the same diffusion, read by something different.
        </li>
        <li>
          <strong>Vessels and gradients.</strong> A{' '}
          <Ref href="https://www.thermofisher.com/order/catalog/product/R02066">
            bi-plate
          </Ref>{' '}
          is a dish walled in two, with a medium each side, so that two can be
          read against each other on one plate. A{' '}
          <Ref href="https://fgsc.net/neurosporaprotocols/How%20to%20prepare%20and%20use%20gradient%20plates.pdf">
            gradient plate
          </Ref>{' '}
          is poured as a wedge and then level with something added to the top
          layer, which spreads down through the wedge until there is more of it
          toward one side. Szybalski described it in 1952, for finding which
          bacteria could stand how much of a drug.
        </li>
        <li>
          <strong>Stains that are taken up.</strong> A dye from the tray spreads
          through the gel, under colonies as freely as anywhere, and the cells
          it reaches take it up and keep it. So a colony stains from the side
          the dye comes from, and the gel beside it pales. Tetrazolium is turned
          red only by cells that are still feeding, and calcofluor sticks only
          to chitin and cellulose.
        </li>
      </ul>
      <SectionHead as="h3" title="Liberties taken" />
      <ul className="cult-liberties">
        <li>
          Time runs fast. A branching colony that takes a real plate a month
          crosses this one in a week, a film spreads two or three times as far
          in four days as it would, and the swarmers are slower than life
          because the grid can only carry them so far in a step.
        </li>
        <li>
          Height is stretched. A colony is a few tenths of a millimetre thick on
          a dish 86 mm across; the relief is drawn three times taller unless you
          say otherwise.
        </li>
        <li>
          On the lean plate the limiting nutrient diffuses about ten times more
          slowly than a sugar really does. The published models need the same
          thing to draw branches at the width real plates show, and say so less
          loudly.
        </li>
        <li>
          A swarm’s tendrils come from one borrowed rule and not from the whole
          of how a liquid film flows. Here a tip stays thick by feeding on fresh
          agar. On a real plate the liquid does that work, and the people who
          model it say food is not what decides it.
        </li>
        <li>
          Colours are estimates from descriptions and photographs of real
          plates, not measurements. Two toxins stand for every antibiotic and
          one signal for every autoinducer.
        </li>
        <li>
          Every culture takes up a dye at the same rate. How much a culture has
          for calcofluor to stick to is guessed from what kind of thing it is: a
          mould or a yeast has plenty, a film less, a plain colony very little.
          Real tetrazolium also holds some bacteria back, and here it doesn’t.
        </li>
        <li>
          Darkroom answers to the incubator’s light, whatever its colour, where
          the real one answers to red, and the dye it blackens is taken to be in
          whatever it is poured on. The real one needs it put in the plate.
        </li>
        <li>
          The six-well plate is two thirds the size of a real one, so that it
          can be worked out on the same grid as a dish. Every compartment of a
          vessel is poured from one gel: the media differ in what is dissolved
          in them, not in how firm they are.
        </li>
        <li>
          On the chromogenic plate only the cultures the maker’s chart names
          change colour. Everything else on the shelf shows as it would on
          broth, which is a guess: the chart doesn’t say.
        </li>
        <li>
          More of the colonies fold with age here than would on a real bench.
          The golden one does on{' '}
          <Ref href="https://pmc.ncbi.nlm.nih.gov/articles/PMC5595439">
            a plate with extra magnesium
          </Ref>
          , the luminous one{' '}
          <Ref href="https://pmc.ncbi.nlm.nih.gov/articles/PMC1852533">
            when its biofilm genes are turned up
          </Ref>
          , and the pink yeast{' '}
          <Ref href="https://mycology.adelaide.edu.au/fungal-descriptions-and-antifungal-susceptibility/yeast-like-fungi/rhodotorula">
            sometimes
          </Ref>
          . Crimson and Violet fold because the plate is better for it.
        </li>
        <li>
          A plate holds four cultures, and it is remembered as its recipe: grown
          twice, it comes out alike but not the same.
        </li>
        <li>
          Two things are drawn and not grown, because they are smaller than the
          grid a plate is worked out on: the tufts a mould fruits in, which are
          placed by chance, and a little fraying of a colony’s edge when you
          look at it closely.
        </li>
      </ul>
    </section>
  );
}
