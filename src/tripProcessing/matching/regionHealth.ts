import logger from '../../logger.js';
import type { OsrmRegionalConfig } from '../config.js';
import type { OsrmRegion } from './regionRegistry.js';
import { fetchWithTimeout } from './retry.js';

interface HealthEntry {
  ok: boolean;
  checkedAt: number;
  cooldownUntil: number;
}

/**
 * Cached liveness per region using a lightweight `/nearest` ping at the region's bbox centre.
 * - Healthy results are trusted for `healthTtlS`.
 * - A failing ping (or a transient /match failure reported via markFailed) puts the region in
 *   cool-down for `healthCooldownS`; during that time it is skipped without any HTTP call.
 * Concurrent checks for the same region share one in-flight ping.
 */
export class RegionHealth {
  private readonly entries = new Map<string, HealthEntry>();
  private readonly inflight = new Map<string, Promise<boolean>>();

  constructor(
    private readonly cfg: Pick<OsrmRegionalConfig, 'healthTtlS' | 'healthCooldownS' | 'healthTimeoutMs'>,
    private readonly now: () => number = Date.now
  ) {}

  async isHealthy(region: OsrmRegion): Promise<boolean> {
    const e = this.entries.get(region.regionId);
    const t = this.now();
    if (e && !e.ok && t < e.cooldownUntil) return false;
    if (e && e.ok && t - e.checkedAt < this.cfg.healthTtlS * 1000) return true;

    let p = this.inflight.get(region.regionId);
    if (!p) {
      p = this.ping(region).finally(() => this.inflight.delete(region.regionId));
      this.inflight.set(region.regionId, p);
    }
    return p;
  }

  markFailed(region: OsrmRegion, reason: string): void {
    const t = this.now();
    this.entries.set(region.regionId, { ok: false, checkedAt: t, cooldownUntil: t + this.cfg.healthCooldownS * 1000 });
    logger.warn('RegionHealth: region marked unavailable', {
      regionId: region.regionId,
      reason,
      cooldownS: this.cfg.healthCooldownS,
    });
  }

  private async ping(region: OsrmRegion): Promise<boolean> {
    const lon = (region.minLon + region.maxLon) / 2;
    const lat = (region.minLat + region.maxLat) / 2;
    const url = `${region.osrmUrl.replace(/\/+$/, '')}/nearest/v1/${encodeURIComponent(region.profile)}/${lon.toFixed(6)},${lat.toFixed(6)}?number=1`;
    let ok = false;
    let detail = '';
    try {
      const resp = await fetchWithTimeout(url, this.cfg.healthTimeoutMs);
      const body: any = await resp.json().catch(() => null);
      ok = resp.ok && body?.code === 'Ok';
      if (!ok) detail = `HTTP ${resp.status} code=${body?.code ?? 'n/a'}`;
    } catch (err: any) {
      detail = err?.message ?? String(err);
    }
    if (ok) {
      this.entries.set(region.regionId, { ok: true, checkedAt: this.now(), cooldownUntil: 0 });
    } else {
      this.markFailed(region, `ping failed: ${detail}`);
    }
    return ok;
  }
}
