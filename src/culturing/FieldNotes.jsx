import SectionHead from '../components/SectionHead.jsx';

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
          .
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
      </ul>
      <SectionHead as="h3" title="Liberties taken" />
      <ul className="cult-liberties">
        <li>
          Time runs fast. A branching colony that takes a real plate a month
          crosses this one in a week, and the swarmers are slower than life
          because the grid can only carry them so far in a step.
        </li>
        <li>
          Height is stretched. A colony is a few tenths of a millimetre thick on
          a dish 86 mm across; the relief is drawn three times taller unless you
          say otherwise.
        </li>
        <li>
          On the lean plate the limiting nutrient diffuses about a hundred times
          more slowly than any sugar really does. The published models need the
          same thing to draw branches at the width real plates show, and say so
          less loudly.
        </li>
        <li>
          Colours are estimates from descriptions and photographs of real
          plates, not measurements. Two toxins stand for every antibiotic and
          one signal for every autoinducer.
        </li>
        <li>
          A plate holds four cultures, and it is remembered as its recipe: grown
          twice, it comes out alike but not the same.
        </li>
      </ul>
    </section>
  );
}
