/**
 * Great-circle distance helpers.
 *
 * Distances here are straight-line, not driving distance. They are good enough
 * for ranking and for an ETA fallback when no routing provider is configured.
 */

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Straight-line distance between two coordinates, in kilometres. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Minutes to cover a straight-line distance at an assumed average road speed.
 * 35 km/h matches the figure the dashboards already show, so the public
 * tracking page and the patient's own tracking view do not disagree.
 */
export const ASSUMED_ROAD_SPEED_KMPH = 35;

export function estimateMinutes(distanceKm: number, speedKmph = ASSUMED_ROAD_SPEED_KMPH): number {
  return Math.max(1, Math.round((distanceKm / speedKmph) * 60));
}
