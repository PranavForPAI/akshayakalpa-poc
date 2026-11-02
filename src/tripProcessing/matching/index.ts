import { resolveOsrmRegionalConfig, type PipelineConfig } from '../config.js';
import type { SegmentMatcher } from '../types.js';
import { NoopMatcher } from '../stages/6_matching.js';
import { RegionalOsrmMatcher } from './RegionalOsrmMatcher.js';
import { OsrmRegionRepository } from './regionRegistry.js';

/**
 * Selects the matcher from config. NoopMatcher stays the default; the regional OSRM matcher is
 * used only when mapMatching.enabled === true AND mapMatching.backend === 'osrm_regional'.
 */
export function createMatcher(config: PipelineConfig): SegmentMatcher {
  const mm: any = config.mapMatching ?? {};
  if (mm.enabled === true && mm.backend === 'osrm_regional') {
    return new RegionalOsrmMatcher({
      config: resolveOsrmRegionalConfig(config),
      regionSource: new OsrmRegionRepository(),
    });
  }
  return new NoopMatcher();
}

export { RegionalOsrmMatcher } from './RegionalOsrmMatcher.js';
export { OsrmRegionRepository, RegionCache } from './regionRegistry.js';
export type { OsrmRegion, RegionSource, RegisterRegionInput } from './regionRegistry.js';
export { RegionRouter } from './regionRouter.js';
export { OsrmClient } from './osrmClient.js';
export { RegionHealth } from './regionHealth.js';
export { stitch } from './stitch.js';
