export type TripStatus = 'In Transit' | 'Completed';

export interface Trip {
  trip_id: string;
  status: TripStatus;
  driver: string | null;
  vehicle: string | null;
  route: string | null;
  device: string | null;
  device_id: string;
  assignment: string | null;
  started_at: string | null;
  stopped_at: string | null;
  point_count: number;
}

export interface TripPoint {
  id: number;
  tripId: string;
  deviceId: string;
  sequence: number;
  hasGps: boolean;
  latitude: number | null;
  longitude: number | null;
  speedKph: number | null;
  headingDegrees: number | null;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  batteryPercent: number | null;
  isMock: boolean;
  deviceTime: string;
  captureSource: string | null;
  appState: string | null;
  networkType: string | null;
  internetAvailable: boolean | null;
  locationServiceOn: boolean | null;
  locationPermission: string | null;
  wasForwarded: boolean;
  serverReceivedAt: string;
}

/** A point guaranteed to have coordinates — what the map can plot. */
export type PlottablePoint = TripPoint & { latitude: number; longitude: number };

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TripPointsResponse {
  trip_id: string;
  count: number;
  points: TripPoint[];
}

export interface TripExport {
  exported_at: string;
  trip: Trip;
  point_count: number;
  points: TripPoint[];
}

export interface TripFilters {
  page: number;
  pageSize: number;
  status?: TripStatus;
  search?: string;
}
