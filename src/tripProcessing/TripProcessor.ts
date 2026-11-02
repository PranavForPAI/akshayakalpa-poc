import { preprocessStage } from './stages/1_preprocess.js';
import { stopDetectionStage } from './stages/2_stopDetection.js';
import { kalmanRtsStage } from './stages/3_kalmanRts.js';
import { segmentAssemblyStage } from './stages/4_segmentAssembly.js';
import { distanceStage } from './stages/5_distance.js';
import { matchingStage } from './stages/6_matching.js';
import { createMatcher } from './matching/index.js';
import { persistStage } from './stages/7_persist.js';
import { publishStage } from './stages/8_publish.js';
import { defaultPipelineConfig, type PipelineConfig } from './config.js';
import type { TripContext, RawPoint, PremiseGeofenceData, SegmentMatcher } from './types.js';
import logger from '../logger.js';

export interface TripProcessorOptions {
  config?: PipelineConfig;
  matcher?: SegmentMatcher;
  skipPersist?: boolean;
  skipPublish?: boolean;
  /**
   * Run the matcher even when the odometer-discrepancy trigger did not fire
   * (manual / debugging runs). Requires mapMatching.enabled; never used by the worker.
   */
  forceMatching?: boolean;
}

export class TripProcessor {
  private readonly config: PipelineConfig;
  private readonly matcher: SegmentMatcher;

  constructor(private readonly options: TripProcessorOptions = {}) {
    this.config = options.config ?? defaultPipelineConfig;
    // Built once per processor so region cache / health state persist across trips in the worker
    this.matcher = options.matcher ?? createMatcher(this.config);
  }

  /**
   * Runs the full offline path smoothing and distance pipeline for a trip:
   * preprocess -> stopDetection -> kalmanRts -> segmentAssembly -> distance -> matching -> persist -> publish
   */
  async processTrip(
    tripId: string,
    rawPoints: RawPoint[],
    tripMetadata?: {
      odometerStartKm?: number | null;
      odometerEndKm?: number | null;
      premiseGeofences?: PremiseGeofenceData[];
    }
  ): Promise<TripContext> {
    const startMs = Date.now();
    logger.info(`TripProcessor: starting pipeline for trip ${tripId}`, {
      tripId,
      rawPointCount: rawPoints.length,
      pipelineVersion: this.config.pipelineVersion,
    });

    let ctx: TripContext = {
      tripId,
      config: this.config,
      rawPoints,
      odometerStartKm: tripMetadata?.odometerStartKm,
      odometerEndKm: tripMetadata?.odometerEndKm,
      premiseGeofences: tripMetadata?.premiseGeofences,
    };

    // 1. Preprocess: chronological sort, deduplicate, drop mocks & speed/acc outliers
    ctx = preprocessStage(ctx);

    // 2. Stop Detection: stationary jitter rolling window & premise geofence stops
    ctx = stopDetectionStage(ctx);

    // 3. Kalman & RTS Smoother: UTM projection per chunk, metric Kalman filter + backward pass
    ctx = kalmanRtsStage(ctx);

    // 4. Segment Assembly: ordered moving chunks, stops, and connectors
    ctx = segmentAssemblyStage(ctx);

    // 5. Distance & Diagnostics: smoothed geodesic length, odometer comparisons, trigger checks
    ctx = distanceStage(ctx);

    // 6. Matching: run SegmentMatcher if enabled and triggered
    ctx = await matchingStage(ctx, this.matcher, { force: this.options.forceMatching });

    // 7. Persist: atomic database transaction (delete + bulk insert)
    if (!this.options.skipPersist) {
      ctx = await persistStage(ctx);
    }

    // 8. Publish: outbound client notification with retries
    if (!this.options.skipPublish) {
      ctx = await publishStage(ctx);
    }

    const elapsedMs = Date.now() - startMs;
    logger.info(`TripProcessor: completed pipeline for trip ${tripId} in ${elapsedMs}ms`, {
      tripId,
      distanceFinalM: ctx.distances?.distanceFinalM,
      distanceSmoothedM: ctx.distances?.distanceSmoothedM,
      nRaw: ctx.distances?.nRaw,
      nStops: ctx.stops?.length,
      nChunks: ctx.chunks?.length,
      elapsedMs,
    });

    return ctx;
  }
}
