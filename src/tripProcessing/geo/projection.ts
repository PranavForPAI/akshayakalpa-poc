import proj4 from 'proj4';

export interface Transformer {
  zone: number;
  epsg: string;
  forward: (lon: number, lat: number) => [number, number];
  inverse: (x: number, y: number) => [number, number];
}

const transformerCache = new Map<number, Transformer>();

/**
 * Calculates northern-hemisphere UTM zone from longitude.
 * zone = floor((lon + 180) / 6) + 1
 */
export function getUtmZone(lon: number): number {
  const zone = Math.floor((lon + 180) / 6) + 1;
  return Math.min(60, Math.max(1, zone));
}

/**
 * Retrieves or initializes cached proj4 transformer for a given UTM zone (northern hemisphere).
 * Hotspots across India (e.g. UTM zone 43, 44, 45) will have their respective EPSG:326xx.
 */
export function getTransformer(zone: number): Transformer {
  let existing = transformerCache.get(zone);
  if (existing) {
    return existing;
  }

  const epsgCode = `EPSG:326${zone.toString().padStart(2, '0')}`;
  // Standard WGS84 to UTM Northern hemisphere projection definition
  const utmDef = `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
  const wgs84 = 'EPSG:4326';

  const forwardFn = (lon: number, lat: number): [number, number] => {
    const res = proj4(wgs84, utmDef, [lon, lat]);
    return [res[0], res[1]];
  };

  const inverseFn = (x: number, y: number): [number, number] => {
    const res = proj4(utmDef, wgs84, [x, y]);
    return [res[0], res[1]];
  };

  const transformer: Transformer = {
    zone,
    epsg: epsgCode,
    forward: forwardFn,
    inverse: inverseFn,
  };

  transformerCache.set(zone, transformer);
  return transformer;
}
