import { haversineDistanceM } from '../geo/geodesic.js';

export type LonLat = [number, number];

export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Geodesic length of a [lon, lat] LineString (m). */
export function lineLengthM(coords: LonLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineDistanceM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return total;
}

export function distLonLatM(a: LonLat, b: LonLat): number {
  return haversineDistanceM(a[1], a[0], b[1], b[0]);
}

/**
 * Sub-line between two distances along a LineString (distances measured geodesically along
 * the line). Interpolates the cut vertices. Clamps to [0, length].
 */
export function sliceLineByDistance(coords: LonLat[], fromM: number, toM: number): LonLat[] {
  if (coords.length === 0) return [];
  if (coords.length === 1) return [coords[0]];
  const total = lineLengthM(coords);
  const a = Math.max(0, Math.min(fromM, total));
  const b = Math.max(a, Math.min(toM, total));

  const out: LonLat[] = [];
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const p = coords[i - 1];
    const q = coords[i];
    const seg = distLonLatM(p, q);
    const segStart = walked;
    const segEnd = walked + seg;
    const lerp = (d: number): LonLat => {
      const f = seg > 0 ? (d - segStart) / seg : 0;
      return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
    };
    if (out.length === 0 && a <= segEnd) out.push(lerp(a));
    if (out.length > 0) {
      if (b <= segEnd) {
        out.push(lerp(b));
        break;
      }
      out.push(q);
    }
    walked = segEnd;
  }
  if (out.length === 1) out.push(out[0]);
  return dedupeConsecutive(out);
}

export function dedupeConsecutive(coords: LonLat[], toleranceM = 0): LonLat[] {
  const out: LonLat[] = [];
  for (const c of coords) {
    if (out.length === 0 || distLonLatM(out[out.length - 1], c) > toleranceM) out.push(c);
  }
  // keep at least two vertices for a LineString when the input had them
  if (out.length === 1 && coords.length > 1) out.push(coords[coords.length - 1]);
  return out;
}

/** Bounding box of a GeoJSON Polygon / MultiPolygon geometry (or Feature wrapping one). */
export function geojsonBBox(geo: any): BBox {
  const geom = unwrapGeometry(geo);
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const rings: number[][][] =
    geom.type === 'Polygon' ? geom.coordinates : (geom.coordinates as number[][][][]).flat();
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLon, minLat, maxLon, maxLat };
}

/** Accepts a geometry, Feature, or single-feature FeatureCollection; returns a Polygon/MultiPolygon geometry. */
export function unwrapGeometry(geo: any): { type: 'Polygon' | 'MultiPolygon'; coordinates: any } {
  let g = geo;
  if (g?.type === 'FeatureCollection') {
    if (!Array.isArray(g.features) || g.features.length !== 1) {
      throw new Error('FeatureCollection must contain exactly one feature');
    }
    g = g.features[0];
  }
  if (g?.type === 'Feature') g = g.geometry;
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon') || !Array.isArray(g.coordinates)) {
    throw new Error('Region geometry must be a GeoJSON Polygon or MultiPolygon');
  }
  return g;
}

/** Heading in degrees [0, 360) from a velocity in a local metric frame (x east, y north). */
export function headingFromVelocityDeg(vx: number, vy: number): number {
  const deg = (Math.atan2(vx, vy) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function headingDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
