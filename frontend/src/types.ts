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

export type ViewMode = 'original' | 'improved' | 'compare';

export interface ProcessedPoint {
  lat: number;
  lon: number;
  ts: string;
  speed_mps: number;
  sigma_m: number;
  source: string;
  flags: string[];
}

export interface ProcessedStop {
  anchor_lat: number;
  anchor_lon: number;
  arrival_ts: string;
  departure_ts: string;
  dwell_s: number;
  radius_m: number;
  reason: string;
  absorbed_point_count: number;
}

export interface ProcessedSegment {
  segment_type: 'moving' | 'stop' | 'connector' | 'unmatched';
  start_ts: string;
  end_ts: string;
  coordinates: [number, number][] | [number, number];
  source: string;
  confidence: number;
}

export interface DistanceSummaryData {
  distance_final_m: number;
  distance_smoothed_m: number;
  distance_raw_filtered_m: number;
  distance_doppler_m: number;
  distance_odometer_m: number | null;
  error_odometer_pct: number | null;
  error_raw_vs_odometer_pct: number | null;
  n_raw: number;
  n_rejected: number;
  n_stop_points: number;
  n_chunks: number;
  trigger_reason: string | null;
  params_hash: string;
  simplified_polyline: string | null;
  processed_at: string;
}

export interface TripProcessedResponse {
  trip_id: string;
  pipeline_version: string;
  summary: DistanceSummaryData;
  stops: ProcessedStop[];
  segments: ProcessedSegment[];
  points: ProcessedPoint[];
}

