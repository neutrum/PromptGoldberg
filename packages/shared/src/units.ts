// Simulation units: distance in AU, time in years, mass in solar masses.
// In these units G = 4π² (Kepler's third law: P² = a³ for a 1 M☉ star).
export const G = 4 * Math.PI * Math.PI;

export const DAY = 1 / 365.25;
export const KM_PER_S = 1 / 4.740470463; // 1 km/s in AU/yr

export const EARTH_MASS = 3.003489e-6;
export const JUPITER_MASS = 9.547919e-4;
export const MOON_MASS = 3.69432e-8;

export const SUN_RADIUS = 4.65047e-3;
export const JUPITER_RADIUS = 4.77895e-4;
export const EARTH_RADIUS = 4.26352e-5;
export const MOON_RADIUS = 1.16138e-5;

export const DEG = Math.PI / 180;

/** Orbital period (yr) for semi-major axis a (AU) around a total mass (M☉). */
export function orbitalPeriod(a: number, mass: number): number {
  return 2 * Math.PI * Math.sqrt((a * a * a) / (G * mass));
}

/** Semi-major axis (AU) that gives the requested period (yr) around mass (M☉). */
export function semiMajorAxisForPeriod(period: number, mass: number): number {
  return Math.cbrt((G * mass * period * period) / (4 * Math.PI * Math.PI));
}
