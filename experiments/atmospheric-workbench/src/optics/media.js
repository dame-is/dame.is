// What light slows down in: ice, water and glass, by wavelength.
//
// Every angle on the bench comes out of these numbers. The 22° halo is 22°
// because ice bends light by 1.31; its inner edge is red because red light
// is bent a little less than blue.

/** Air at sea level. The indices below are against a vacuum; what a ray
 *  crossing from air into a drop feels is the ratio. */
export const N_AIR = 1.00028;

// Ice Ih at −7 °C, 390 to 750 nm in steps of 10. Warren & Brandt, "Optical
// constants of ice from the ultraviolet to the microwave: a revised
// compilation", J. Geophys. Res. 113, D14220 (2008), as tabulated at
// refractiveindex.info (read 2026-11-12).
const ICE_FROM = 390;
const ICE_STEP = 10;
const ICE = [
  1.3203, 1.3194, 1.3185, 1.3177, 1.317, 1.3163, 1.3157, 1.3151, 1.3145, 1.314,
  1.3135, 1.313, 1.3126, 1.3121, 1.3117, 1.3114, 1.311, 1.3106, 1.3103, 1.31,
  1.3097, 1.3094, 1.3091, 1.3088, 1.3085, 1.3083, 1.308, 1.3078, 1.3076, 1.3073,
  1.3071, 1.3069, 1.3067, 1.3065, 1.3062, 1.306, 1.3059,
];

/** Ice, for a wavelength in nanometres. */
export function iceIndex(nm) {
  const at = Math.min(ICE.length - 1, Math.max(0, (nm - ICE_FROM) / ICE_STEP));
  const i = Math.min(ICE.length - 2, Math.floor(at));
  return (ICE[i] + (ICE[i + 1] - ICE[i]) * (at - i)) / N_AIR;
}

// n² − 1 = Σ B λ² / (λ² − C), λ in micrometres.
function sellmeier(nm, terms) {
  const l2 = (nm / 1000) ** 2;
  let sum = 0;
  for (const [b, c] of terms) sum += (b * l2) / (l2 - c);
  return Math.sqrt(1 + sum);
}

// Distilled water at 20 °C. Daimon & Masumura, Appl. Opt. 46, 3811 (2007),
// the fit given at refractiveindex.info (read 2026-11-12).
const WATER = [
  [5.684027565e-1, 5.101829712e-3],
  [1.726177391e-1, 1.821153936e-2],
  [2.086189578e-2, 2.620722293e-2],
  [1.130748688e-1, 1.069792721e1],
];

/** Liquid water, for a wavelength in nanometres. */
export function waterIndex(nm) {
  return sellmeier(nm, WATER) / N_AIR;
}

// Schott F2, a flint glass: more dispersion than window glass, so a prism of
// it throws a wide spectrum. The maker's Sellmeier fit, which is already
// against air.
const FLINT = [
  [1.34533359, 0.00997743871],
  [0.209073176, 0.0470450767],
  [0.937357162, 111.886764],
];

/** Flint glass, for a wavelength in nanometres. */
export function glassIndex(nm) {
  return sellmeier(nm, FLINT);
}

/**
 * Fresnel reflectance of unpolarised light: the share that bounces off a
 * surface instead of crossing it. `cosI` is the cosine of the angle of
 * incidence, `n1` the index on the side the ray is coming from and `n2` on
 * the far side. Past the critical angle it is 1 (total internal reflection).
 */
export function fresnel(cosI, n1, n2) {
  const sinT2 = ((n1 * n1) / (n2 * n2)) * (1 - cosI * cosI);
  if (sinT2 >= 1) return 1;
  const cosT = Math.sqrt(1 - sinT2);
  const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
  const rp = (n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI);
  return (rs * rs + rp * rp) / 2;
}

/** The two polarisations of the same, for a path that meets the same angle
 *  more than once (a raindrop): they have to be followed separately. */
export function fresnelParts(cosI, n1, n2) {
  const sinT2 = ((n1 * n1) / (n2 * n2)) * (1 - cosI * cosI);
  if (sinT2 >= 1) return [1, 1];
  const cosT = Math.sqrt(1 - sinT2);
  const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
  const rp = (n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI);
  return [rs * rs, rp * rp];
}

/**
 * The least a prism can turn a ray: light crossing two faces that meet at
 * `apex` degrees, in a material of index `n`, in degrees. It is where the
 * light piles up as crystals tumble, which is why a halo has a sharp inner
 * edge. Null when the wedge is too steep to let any light through.
 */
export function minimumDeviation(n, apex) {
  const s = n * Math.sin((apex * Math.PI) / 360);
  if (s >= 1) return null;
  return (2 * Math.asin(s) * 180) / Math.PI - apex;
}
