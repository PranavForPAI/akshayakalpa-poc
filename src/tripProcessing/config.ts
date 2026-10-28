import { z } from 'zod';

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
  if (process.env.MAP_MATCHING_ENABLED) {
    envConfig.mapMatching = { enabled: process.env.MAP_MATCHING_ENABLED === 'true' };
  }
  if (process.env.MM_TRIGGER_PCT) envConfig.mmTriggerPct = Number(process.env.MM_TRIGGER_PCT);
  if (process.env.MM_MIN_KM) envConfig.mmMinKm = Number(process.env.MM_MIN_KM);

  return pipelineConfigSchema.parse({
    ...envConfig,
    ...overrides,
  });
}

export const defaultPipelineConfig = loadPipelineConfig();
