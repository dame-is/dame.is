// A wavelength as a colour on a screen.
//
// The colour-matching functions are the analytic fit of Wyman, Sloan and
// Shirley, "Simple analytic approximations to the CIE XYZ color matching
// functions", JCGT 2(2), 2013. A screen can't show a pure spectral colour, so
// what falls outside sRGB is clipped, and the channels are scaled so that
// every wavelength added together is white: sunlight in, white light out.

const lobe = (x, mu, s1, s2) => {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
};

function xyz(nm) {
  return [
    1.056 * lobe(nm, 599.8, 37.9, 31.0) +
      0.362 * lobe(nm, 442.0, 16.0, 26.7) -
      0.065 * lobe(nm, 501.1, 20.4, 26.2),
    0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1),
    1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8),
  ];
}

function rawRgb(nm) {
  const [x, y, z] = xyz(nm);
  return [
    Math.max(0, 3.2406 * x - 1.5372 * y - 0.4986 * z),
    Math.max(0, -0.9689 * x + 1.8758 * y + 0.0415 * z),
    Math.max(0, 0.0557 * x - 0.204 * y + 1.057 * z),
  ];
}

/** The ends of what is traced. Past them the eye sees very little. */
export const VIOLET = 400;
export const RED = 700;

/**
 * `count` wavelengths spread evenly from violet to red, each with its colour.
 * The colours average to white, so a tracer that picks among them at random
 * and adds what it finds needs no other weighting.
 */
export function spectrum(count) {
  const out = [];
  const mean = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const nm = VIOLET + ((i + 0.5) / count) * (RED - VIOLET);
    const rgb = rawRgb(nm);
    for (let c = 0; c < 3; c++) mean[c] += rgb[c] / count;
    out.push({ nm, rgb });
  }
  for (const band of out) {
    band.rgb = band.rgb.map((v, c) => v / mean[c]);
  }
  return out;
}
