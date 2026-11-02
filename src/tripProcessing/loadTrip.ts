import prisma from '../db/prisma.js';
import type { RawPoint, PremiseGeofenceData } from './types.js';

export interface TripInput {
  tripExists: boolean;
  rawPoints: RawPoint[];
  metadata: {
    odometerStartKm?: number | null;
    odometerEndKm?: number | null;
    premiseGeofences: PremiseGeofenceData[];
  };
}

/**
 * Loads everything the pipeline needs for one trip: GPS coordinates (chronological),
 * odometer readings and premise geofences. Shared by the worker and the CLI.
 */
export async function loadTripInput(tripId: string): Promise<TripInput> {
  const [coordinates, trip, geofenceRows] = await Promise.all([
    prisma.coordinate.findMany({
      where: {
        tripId,
        hasGps: true,
        latitude: { not: null },
        longitude: { not: null },
      },
      orderBy: [{ deviceTime: 'asc' }, { id: 'asc' }],
    }),
    prisma.trip.findUnique({
      where: { tripId },
      select: { odometerStartKm: true, odometerEndKm: true },
    }),
    prisma.premiseGeofence.findMany(),
  ]);

  const premiseGeofences: PremiseGeofenceData[] = geofenceRows.map((g) => ({
    id: g.id,
    name: g.name,
    polygon: g.polygon,
    minLat: g.minLat,
    minLon: g.minLon,
    maxLat: g.maxLat,
    maxLon: g.maxLon,
  }));

  const rawPoints: RawPoint[] = coordinates.map((c) => ({
    id: c.id,
    latitude: c.latitude!,
    longitude: c.longitude!,
    deviceTime: c.deviceTime,
    accuracyMeters: c.accuracyMeters,
    speedMps: c.speedMps !== null ? c.speedMps : c.speedKph !== null ? c.speedKph / 3.6 : null,
    speedAccuracyMps: c.speedAccuracyMps,
    headingDegrees: c.headingDegrees,
    isMock: c.isMock,
  }));

  return {
    tripExists: trip !== null,
    rawPoints,
    metadata: {
      odometerStartKm: trip?.odometerStartKm,
      odometerEndKm: trip?.odometerEndKm,
      premiseGeofences,
    },
  };
}
