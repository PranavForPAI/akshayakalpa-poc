const EARTH_RADIUS_METERS = 6371008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculates geodesic distance between two WGS84 points in meters using Haversine formula.
 */
export function haversineDistanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const rLat1 = toRadians(lat1);
  const rLat2 = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Computes cumulative geodesic path length in meters for a sequence of [lat, lon] points.
 */
export function pathLengthM(points: Array<{ latitude: number; longitude: number }>): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistanceM(
      points[i - 1].latitude,
      points[i - 1].longitude,
      points[i].latitude,
      points[i].longitude
    );
  }
  return total;
}

/**
 * Encodes an array of [lat, lon] coordinates into a standard Google polyline string.
 */
export function encodePolyline(coords: Array<[number, number]>): string {
  let output = '';
  let prevLat = 0;
  let prevLng = 0;

  for (const [lat, lng] of coords) {
    const latInt = Math.round(lat * 1e5);
    const lngInt = Math.round(lng * 1e5);

    const dLat = latInt - prevLat;
    const dLng = lngInt - prevLng;

    prevLat = latInt;
    prevLng = lngInt;

    output += encodeSignedNumber(dLat);
    output += encodeSignedNumber(dLng);
  }

  return output;
}

function encodeSignedNumber(num: number): string {
  let sgnNum = num << 1;
  if (num < 0) {
    sgnNum = ~sgnNum;
  }
  let encodeString = '';
  while (sgnNum >= 0x20) {
    encodeString += String.fromCharCode((0x20 | (sgnNum & 0x1f)) + 63);
    sgnNum >>= 5;
  }
  encodeString += String.fromCharCode(sgnNum + 63);
  return encodeString;
}

/**
 * Perpendicular distance in meters from point P to line segment AB.
 */
function perpendicularDistanceM(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const dAB = haversineDistanceM(a[0], a[1], b[0], b[1]);
  if (dAB === 0) {
    return haversineDistanceM(p[0], p[1], a[0], a[1]);
  }
  const dAP = haversineDistanceM(a[0], a[1], p[0], p[1]);
  const dBP = haversineDistanceM(b[0], b[1], p[0], p[1]);
  // Heron's formula for area of triangle APB
  const s = (dAB + dAP + dBP) / 2;
  const area = Math.sqrt(Math.max(0, s * (s - dAB) * (s - dAP) * (s - dBP)));
  return (2 * area) / dAB;
}

/**
 * Ramer-Douglas-Peucker polyline simplification.
 * Intended ONLY for creating lightweight display polylines (never used for distance calculations).
 */
export function simplifyCoordinates(
  coords: Array<[number, number]>,
  toleranceM: number = 5.0
): Array<[number, number]> {
  if (coords.length <= 2) return coords;

  let maxDist = 0;
  let index = 0;
  const last = coords.length - 1;

  for (let i = 1; i < last; i++) {
    const dist = perpendicularDistanceM(coords[i], coords[0], coords[last]);
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > toleranceM) {
    const left = simplifyCoordinates(coords.slice(0, index + 1), toleranceM);
    const right = simplifyCoordinates(coords.slice(index), toleranceM);
    return [...left.slice(0, -1), ...right];
  }

  return [coords[0], coords[last]];
}
