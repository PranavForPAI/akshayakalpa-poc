import type { PipelineConfig } from './config.js';

export interface RawPoint {
  id?: number;
  latitude: number;
  longitude: number;
  deviceTime: Date;
  accuracyMeters: number | null;
  speedMps: number | null;
  speedAccuracyMps: number | null;
  headingDegrees: number | null;
  isMock?: boolean;
}

export interface MetricCoord {
  x: number;
  y: number;
}

export interface ProjectedPoint extends RawPoint {
  x: number;
  y: number;
  utmZone: number;
  tsSec: number;
  dtSec: number;
}

export interface MovingChunk {
  chunkIndex: number;
  utmZone: number;
  epsg: string;
  points: ProjectedPoint[];
}

export interface Stop {
  anchorLat: number;
  anchorLon: number;
  arrivalTs: Date;
  departureTs: Date;
  dwellS: number;
  nPoints: number;
  radiusM: number;
  reason: 'jitter' | 'geofence';
  absorbedRawIds: number[];
}

export type PointFlag = 'rejected' | 'in_stop' | 'gap_edge';

export interface SmoothedPoint {
  rawPointId?: number;
  latitude: number;
  longitude: number;
  deviceTime: Date;
  x: number;
  y: number;
  vx: number;
  vy: number;
  sigmaM: number;
  speedMps: number;
  source: 'smoothed' | 'stop_anchor' | 'raw_fallback';
  flags: PointFlag[];
  chunkIndex?: number;
}

export type SegmentType = 'moving' | 'stop' | 'connector' | 'unmatched';
export type SegmentSource = 'smoothed' | 'stop_anchor' | 'matched';

export interface Segment {
  segmentType: SegmentType;
  startTs: Date;
  endTs: Date;
  /** GeoJSON LineString or Point geometry coordinates [lon, lat] */
  coordinates: [number, number][] | [number, number];
  source: SegmentSource;
  confidence: number;
  dataVersion?: string | null;
}

export interface MatchedSegment {
  segmentType: SegmentType;
  coordinates: [number, number][];
  confidence: number;
  lengthM: number;
  matchedEdgeId?: string;
}

export interface SegmentMatcher {
  match(ctx: TripContext): Promise<MatchedSegment[]>;
}

export interface PremiseGeofenceData {
  id: number;
  name: string;
  polygon: any; // GeoJSON Polygon
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export interface TripDiagnostics {
  nRaw: number;
  nFiltered: number;
  nRejected: number;
  nStopPoints: number;
  nChunks: number;
  triggerReason: string | null;
  paramsHash: string;
}

export interface DistanceSummary {
  distanceFinalM: number;
  distanceSmoothedM: number;
  distanceRawFilteredM: number;
  distanceDopplerM: number;
  distanceOdometerM: number | null;
  errorOdometerPct: number | null;
  errorRawVsOdometerPct: number | null;
  nRaw: number;
  nRejected: number;
  nStopPoints: number;
  nChunks: number;
  triggerReason: string | null;
  paramsHash: string;
  simplifiedPolyline: string | null;
  processedAt: Date;
  pipelineVersion: string;
}

export interface TripContext {
  tripId: string;
  config: PipelineConfig;
  rawPoints: RawPoint[];
  odometerStartKm?: number | null;
  odometerEndKm?: number | null;
  premiseGeofences?: PremiseGeofenceData[];
  
  // Pipeline intermediate outputs
  filteredPoints?: RawPoint[];
  chunks?: MovingChunk[];
  stops?: Stop[];
  absorbedPointIds?: Set<number>;
  smoothedPoints?: SmoothedPoint[];
  segments?: Segment[];
  distances?: DistanceSummary;
  diagnostics?: TripDiagnostics;
  matchedSegments?: MatchedSegment[];
}
