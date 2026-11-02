import { z } from 'zod';

/** Options for the regional OSRM matcher (mapMatching.backend = 'osrm_regional'). */
export const osrmRegionalConfigSchema = z.object({
  /** TTL of the in-memory region list / rbush index (seconds) */
  regionCacheTtlS: z.number().positive().default(60),
  /** If the best region covers at least this fraction of a chunk, the whole chunk goes there */
  regionMinCoverage: z.number().min(0).max(1).default(0.95),
  /** Runs shorter than this (points) are merged into a neighbouring run when that run's region covers them */
  minRunPoints: z.number().int().positive().default(10),
  /** Points of overlap added on each side of a run / request window */
  overlapPoints: z.number().int().min(0).default(5),
  /** A join gap between consecutive pieces above this breaks the segment instead of connecting (m) */
  stitchMaxGapM: z.number().positive().default(50),
  /** Join gaps at or below this are treated as the same vertex (m) */
  stitchJoinToleranceM: z.number().min(0).default(1),
  /** Per-point OSRM radius = smoothed sigmaM clamped to [radiusMinM, radiusMaxM] */
  radiusMinM: z.number().positive().default(10),
  radiusMaxM: z.number().positive().default(40),
  /** Target spacing of points sent to OSRM (seconds) */
  downsampleIntervalS: z.number().positive().default(5),
  /** Heading change (deg) vs last kept point above which a point is always kept */
  turnAngleDeg: z.number().positive().default(30),
  /** Max coordinates per /match request; must be <= osrm-routed --max-matching-size */
  maxPointsPerRequest: z.number().int().min(2).default(90),
  /** Switch coordinates to polyline6 encoding when the GET URL would exceed this length */
  maxUrlLength: z.number().int().positive().default(4000),
  /** Per-attempt HTTP timeout for /match (ms) */
  requestTimeoutMs: z.number().int().positive().default(10000),
  /** Retries for transient failures (timeouts, 5xx, network) */
  retries: z.number().int().min(0).default(1),
  retryBaseDelayMs: z.number().int().min(0).default(200),
  /** Parallel /match requests per trip */
  concurrency: z.number().int().positive().default(4),
  /** Acceptance: minimum sub-matching confidence */
  mmMinConfidence: z.number().min(0).max(1).default(0.6),
  /** Acceptance: matchedLength / smoothedLength must lie in [mmMinRatio, mmMaxRatio] */
  mmMinRatio: z.number().positive().default(0.85),
  mmMaxRatio: z.number().positive().default(1.15),
  /** Ratio check is skipped for windows whose smoothed core is shorter than this (m) */
  ratioMinBaseM: z.number().min(0).default(25),
  /** Acceptance: no sent point may snap further than this from its smoothed position (m) */
  maxSnapDistanceM: z.number().positive().default(60),
  /** Acceptance: max fraction of sent core points OSRM may drop as outliers */
  maxDroppedPointFrac: z.number().min(0).max(1).default(0.3),
  /** Health: how long a successful ping is trusted (s) */
  healthTtlS: z.number().positive().default(30),
  /** Health: how long a failing region is skipped (s) */
  healthCooldownS: z.number().positive().default(120),
  /** Health: ping timeout (ms) */
  healthTimeoutMs: z.number().int().positive().default(2000),
});

export type OsrmRegionalConfig = z.infer<typeof osrmRegionalConfigSchema>;

/** Resolves regional OSRM options with defaults (configs may be hand-built and omit them). */
export function resolveOsrmRegionalConfig(config: {
  mapMatching?: { osrm?: Partial<OsrmRegionalConfig> };
}): OsrmRegionalConfig {
  return osrmRegionalConfigSchema.parse(config.mapMatching?.osrm ?? {});
}

/**
 * Config view used for params hashing. When matching is disabled, matcher options cannot
 * affect outputs, so they are excluded: the hash stays identical to pre-matcher versions.
 */
export function effectiveConfigForHash(config: PipelineConfig): unknown {
  if (config.mapMatching?.enabled) return config;
  return { ...config, mapMatching: { enabled: false } };
}

export const pipelineConfigSchema = z.object({
  pipelineVersion: z.string().default('v1.0.0'),
  /** Time gap in seconds beyond which moving track is split into separate chunks */
  gapSplitS: z.number().positive().default(30),
  /** Maximum stationary jitter displacement radius in meters */
  stopRadiusM: z.number().positive().default(25),
  /** Minimum dwell time in seconds to enter stop state */
  stopMinDwellS: z.number().positive().default(90),
  /** Speed threshold below which movement is considered stopped (m/s) */
  stopSpeedMps: z.number().positive().default(1.0),
  /** Minimum tortuosity (path length / net displacement) to confirm jitter */
  tortuosityMin: z.number().positive().default(3),
  /** Distance from stop anchor required to begin hysteresis exit (m) */
  exitRadiusM: z.number().positive().default(40),
  /** Minimum speed required for exit hysteresis points (m/s) */
  exitSpeedMps: z.number().positive().default(2.0),
  /** Kalman continuous-time acceleration process noise standard deviation (m/s^2) */
  kfQ: z.number().positive().default(1.5),
  /** Minimum position measurement noise standard deviation in meters */
  minSigmaM: z.number().positive().default(3.0),
  /** Innovation gating threshold (Mahalanobis distance squared, chi-squared 2 DOF) */
  chi2Gate: z.number().positive().default(9.21),
  /** Number of consecutive innovation rejects before reinitializing Kalman filter */
  maxConsecutiveRejects: z.number().int().positive().default(5),
  /** Map matching trigger and options */
  mapMatching: z
    .object({
      enabled: z.boolean().default(false),
      /** Matcher backend: 'noop' (default) or 'osrm_regional' (OSRM sharded by region) */
      backend: z.enum(['noop', 'osrm_regional']).default('noop'),
      /** Options for the regional OSRM matcher (ignored by other backends) */
      osrm: osrmRegionalConfigSchema.default({}),
    })
    .default({ enabled: false }),
  /** Percentage error threshold vs odometer to trigger map matching */
  mmTriggerPct: z.number().positive().default(3),
  /** Minimum smoothed trip length in km to allow map matching trigger */
  mmMinKm: z.number().positive().default(3),
  /** Filter out points with accuracy worse than this threshold (meters) */
  maxAccuracyM: z.number().positive().default(30),
  /** Filter out points with speed / implied speed higher than this threshold (km/h) */
  maxSpeedKph: z.number().positive().default(100),
});

export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;

export function loadPipelineConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  const envConfig: Partial<Record<keyof PipelineConfig, any>> = {};

  if (process.env.PIPELINE_VERSION) envConfig.pipelineVersion = process.env.PIPELINE_VERSION;
  if (process.env.GAP_SPLIT_S) envConfig.gapSplitS = Number(process.env.GAP_SPLIT_S);
  if (process.env.STOP_RADIUS_M) envConfig.stopRadiusM = Number(process.env.STOP_RADIUS_M);
  if (process.env.STOP_MIN_DWELL_S) envConfig.stopMinDwellS = Number(process.env.STOP_MIN_DWELL_S);
  if (process.env.STOP_SPEED_MPS) envConfig.stopSpeedMps = Number(process.env.STOP_SPEED_MPS);
  if (process.env.TORTUOSITY_MIN) envConfig.tortuosityMin = Number(process.env.TORTUOSITY_MIN);
  if (process.env.EXIT_RADIUS_M) envConfig.exitRadiusM = Number(process.env.EXIT_RADIUS_M);
  if (process.env.EXIT_SPEED_MPS) envConfig.exitSpeedMps = Number(process.env.EXIT_SPEED_MPS);
  if (process.env.KF_Q) envConfig.kfQ = Number(process.env.KF_Q);
  if (process.env.MIN_SIGMA_M) envConfig.minSigmaM = Number(process.env.MIN_SIGMA_M);
  if (process.env.CHI2_GATE) envConfig.chi2Gate = Number(process.env.CHI2_GATE);
  if (process.env.MAX_CONSECUTIVE_REJECTS)
    envConfig.maxConsecutiveRejects = Number(process.env.MAX_CONSECUTIVE_REJECTS);
  if (process.env.MAP_MATCHING_ENABLED || process.env.MAP_MATCHING_BACKEND) {
    envConfig.mapMatching = {
      enabled: process.env.MAP_MATCHING_ENABLED === 'true',
      ...(process.env.MAP_MATCHING_BACKEND ? { backend: process.env.MAP_MATCHING_BACKEND } : {}),
    };
  }
  if (process.env.MM_TRIGGER_PCT) envConfig.mmTriggerPct = Number(process.env.MM_TRIGGER_PCT);
  if (process.env.MM_MIN_KM) envConfig.mmMinKm = Number(process.env.MM_MIN_KM);

  return pipelineConfigSchema.parse({
    ...envConfig,
    ...overrides,
  });
}

export const defaultPipelineConfig = loadPipelineConfig();
