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

/** improved = RTS smoothed path; kalman = forward-only Kalman filter path (before RTS) */
export type ViewMode = 'original' | 'kalman' | 'improved' | 'matched' | 'compare';

export interface ProcessedPoint {
  lat: number;
  lon: number;
  ts: string;
  speed_mps: number;
  sigma_m: number;
  /** Forward-only Kalman estimate (null for trips processed before it was stored) */
  kf_lat?: number | null;
  kf_lon?: number | null;
  kf_sigma_m?: number | null;
  source: string;
  /** rejected | in_stop | gap_edge | accuracy_averaged */
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
  /** moving/stop/connector = smoothed path; matched/unmatched = map-matcher output (separate rows) */
  segment_type: 'moving' | 'stop' | 'connector' | 'matched' | 'unmatched';
  start_ts: string;
  end_ts: string;
  coordinates: [number, number][] | [number, number];
  source: string;
  confidence: number;
  /** OSRM region that produced (or was tried for) a matcher row */
  region_id?: string | null;
  /** OSM dataset version behind matched geometry */
  data_version?: string | null;
  /** Why an 'unmatched' row kept the smoothed path (e.g. low_confidence, no_region) */
  reject_reason?: string | null;
}

export interface MatchingSummaryData {
  backend: string;
  n_runs: number;
  n_matched: number;
  n_unmatched: number;
  /** Share of moving length covered by accepted road-matched geometry (0..1) */
  matched_share: number;
  regions_used: string[];
  reject_reasons: Record<string, number>;
  http_ms: number;
  matched_at: string;
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
  /** Present only when the map matcher ran for this trip */
  matching?: MatchingSummaryData | null;
  points: ProcessedPoint[];
}

