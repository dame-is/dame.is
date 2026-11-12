import { SectionHead } from './host.js';

/** A source, named in the line it supports. */
function Ref({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

/**
 * What the bench is made of, and where it parts from the real sky. The
 * halos and the bow come out of the same physics the sky uses; the clouds
 * don't, and this is where the page says which is which.
 */
export default function FieldNotes() {
  return (
    <section className="atmo-notes" aria-labelledby="atmo-notes-h">
      <SectionHead id="atmo-notes-h" title="What is real here" />
      <p>
        The light is. No halo on the bench is drawn as an arc, and nothing in it
        knows what a sun dog is. A ray of sunlight meets an ice crystal, bends
        going in, bounces about inside and bends coming out, and where it ends
        up is one point of light in the sky. A few million of those are the
        picture. Which halos turn up depends only on the shape of the crystals
        and how they lie as they fall, which is how it goes in the sky too.
      </p>
      <ul className="atmo-rules">
        <li>
          <strong>Rays through crystals.</strong> This is how the people who
          study halos work them out.{' '}
          <Ref href="https://www.atoptics.co.uk/halo/halfeat.htm">
            HaloSim, by Les Cowley and Michael Schroeder
          </Ref>
          , traces “up to several million light rays through mathematical models
          of ice crystals”, and the bench does the same on a smaller scale: a
          hexagonal prism, Snell’s law at each face, and Fresnel’s equations for
          how much of the ray reflects there instead.
        </li>
        <li>
          <strong>How much ice bends light.</strong> By 1.3194 for violet at 400
          nm down to 1.3069 for red at 700 nm, from{' '}
          <Ref href="https://doi.org/10.1029/2007JD009744">
            Warren and Brandt’s 2008 table
          </Ref>
          . Every angle follows from that. Two side faces of a crystal are a 60°
          wedge, and the least a 60° wedge of ice can turn light is 22°; a side
          face and an end face are a 90° wedge, and that gives 46°. Red is
          turned least, so it is on the inside of the ring.
        </li>
        <li>
          <strong>How the crystals lie.</strong> The four on the shelf are
          tumbling, flat plates, columns on their sides, and columns that don’t
          roll (Parry’s). Plates give sun dogs and the circumzenithal arc;
          columns give the tangent arcs, which{' '}
          <Ref href="https://www.atoptics.co.uk/halo/column.htm">
            join into one circumscribed halo once the sun is above 29°
          </Ref>
          . The names on the shelf are only labels: the bench was not told which
          crystal makes which halo.
        </li>
        <li>
          <strong>Limits that come out by themselves.</strong> The
          circumzenithal arc needs the sun{' '}
          <Ref href="https://www.atoptics.co.uk/halo/czasalt.htm">
            below about 32°
          </Ref>
          , because above that the light can’t get out of the side of a plate.
          Raise the sun past it and the arc goes. The tests that run with the
          bench check this, and where the sun dogs sit, against angles worked
          out by hand.
        </li>
        <li>
          <strong>The rainbow.</strong> Rays across the face of one drop, each
          going in, bouncing once or twice and coming out, counted by the angle
          they leave at, the way Descartes did it. Water’s index is{' '}
          <Ref href="https://doi.org/10.1364/AO.46.003811">
            Daimon and Masumura’s 2007 measurement
          </Ref>{' '}
          at 20 °C. The first bow comes out 42° from the point opposite the sun
          and the second 51°, with a dark band between them that no ray of
          either kind reaches.
        </li>
        <li>
          <strong>Colour.</strong> Sunlight is split into bands from 400 to 700
          nm, each bent by its own amount and shown in the colour the eye gives
          that wavelength, by{' '}
          <Ref href="https://research.nvidia.com/publication/2013-07_simple-analytic-approximations-cie-xyz-color-matching-functions">
            Wyman, Sloan and Shirley’s fit to the standard observer
          </Ref>
          .
        </li>
      </ul>
      <h3 className="atmo-notes-sub">Liberties</h3>
      <ul className="atmo-rules">
        <li>
          The clouds are shapes, not weather. They are made of soft puffs
          arranged to look like each kind, they drift but don’t form or rain
          out, and the ice in the air has nothing to do with the cirrus on the
          bench. In the sky, halos are made in cirrus and cirrostratus.
        </li>
        <li>
          Light is treated as rays only. Real crystals are small enough for
          diffraction to soften every halo a little, and real drops show faint
          extra bands inside the rainbow (supernumeraries) and wash out to a
          white fogbow when they are tiny. None of that is here.
        </li>
        <li>
          Every crystal is a perfect hexagonal prism. There are no pyramid ends,
          so none of the odd-radius halos they make, and no Lowitz arcs. Light
          goes through one crystal and no more.
        </li>
        <li>
          Nothing below the horizon is drawn, so there is no subsun, though the
          tracer makes one.
        </li>
        <li>
          The sun on the bench is drawn about ten times wider than the real one,
          which is half a degree across. The halos are traced for the real one.
        </li>
        <li>
          Brightness is set by eye. The sky is darkened behind the halos the way
          a camera would be stopped down for them, and the exposure slider does
          what it says, but nothing is in real units.
        </li>
        <li>
          The ray table is flat. A crystal in the sky is met by light from every
          side at once, and a skew ray sees a steeper wedge, which is why sun
          dogs move outward as the sun climbs. On the table every ray is square
          to the crystal’s length.
        </li>
      </ul>
      <p className="atmo-notes-date">Sources read 12 November 2026.</p>
    </section>
  );
}
