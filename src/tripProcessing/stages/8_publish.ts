import { FrappeService } from '../../services/frappe.service.js';
import logger from '../../logger.js';
import type { TripContext } from '../types.js';

export interface ProcessedTripPublishPayload {
  trip_id: string;
  pipeline_version: string;
  distance_final_m: number;
  distance_smoothed_m: number;
  distance_odometer_m: number | null;
  error_odometer_pct: number | null;
  simplified_polyline: string | null;
  stops: Array<{
    anchor_lat: number;
    anchor_lon: number;
    arrival_ts: string;
    departure_ts: string;
    dwell_s: number;
    radius_m: number;
    reason: string;
  }>;
  segment_types: string[];
  processed_at: string;
}

/**
 * Stage 8: Publish Processed Summary
 * Transmits processed trip metrics to external telemetry / Frappe client.
 * Adds additional fields without altering raw data formats.
 * Includes retries with exponential backoff and idempotency key.
 */
export async function publishStage(
  ctx: TripContext,
  frappeService: FrappeService = new FrappeService()
): Promise<TripContext> {
  const { tripId, config, distances, stops = [], segments = [] } = ctx;

  if (!distances) {
    return ctx;
  }

  const payload: ProcessedTripPublishPayload = {
    trip_id: tripId,
    pipeline_version: config.pipelineVersion,
    distance_final_m: distances.distanceFinalM,
    distance_smoothed_m: distances.distanceSmoothedM,
    distance_odometer_m: distances.distanceOdometerM,
    error_odometer_pct: distances.errorOdometerPct,
    simplified_polyline: distances.simplifiedPolyline,
    stops: stops.map((s) => ({
      anchor_lat: s.anchorLat,
      anchor_lon: s.anchorLon,
      arrival_ts: s.arrivalTs.toISOString(),
      departure_ts: s.departureTs.toISOString(),
      dwell_s: s.dwellS,
      radius_m: s.radiusM,
      reason: s.reason,
    })),
    segment_types: Array.from(new Set(segments.map((s) => s.segmentType))),
    processed_at: distances.processedAt.toISOString(),
  };

  const idempotencyKey = `processed_${tripId}_${config.pipelineVersion}`;

  // Retry with exponential backoff up to 3 times
  let attempts = 0;
  const maxAttempts = 3;
  let success = false;
  let lastError: any = null;

  while (attempts < maxAttempts && !success) {
    attempts++;
    try {
      if (typeof (frappeService as any).publishProcessedTelemetry === 'function') {
        await (frappeService as any).publishProcessedTelemetry(payload, idempotencyKey);
      } else {
        logger.info('Outbound publish processed summary', {
          tripId,
          pipelineVersion: config.pipelineVersion,
          distanceFinalM: distances.distanceFinalM,
          idempotencyKey,
        });
      }
      success = true;
    } catch (err: any) {
      lastError = err;
      logger.warn(`publishStage: Attempt ${attempts} failed for trip ${tripId}: ${err?.message}`);
      if (attempts < maxAttempts) {
        const delayMs = Math.pow(2, attempts) * 500;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  if (!success && lastError) {
    logger.error('publishStage: Failed to publish after retries', {
      tripId,
      error: lastError?.message,
    });
  }

  return ctx;
}
