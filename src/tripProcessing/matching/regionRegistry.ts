import RBush from 'rbush';
import prisma from '../../db/prisma.js';
import logger from '../../logger.js';
import { geojsonBBox, unwrapGeometry, type BBox } from './geoUtils.js';

export type RegionKind = 'hotspot' | 'backbone';

export interface OsrmRegion extends BBox {
  regionId: string;
  name: string;
  /** GeoJSON Polygon / MultiPolygon geometry */
  polygon: any;
  osrmUrl: string;
  /** OSRM profile name used in the URL (car | bike | custom) */
  profile: string;
  kind: RegionKind;
  dataVersion: string;
  enabled: boolean;
}

export interface RegisterRegionInput {
  regionId: string;
  name?: string;
  polygon: any;
  osrmUrl: string;
  profile: string;
  kind: RegionKind;
  dataVersion: string;
}

/** Read side used by the matcher (lets tests inject an in-memory source). */
export interface RegionSource {
  listEnabled(): Promise<OsrmRegion[]>;
}

const PROFILE_RE = /^[A-Za-z0-9_-]+$/;

/** Postgres-backed registry of OSRM regions (table osrm_region). */
export class OsrmRegionRepository implements RegionSource {
  async listEnabled(): Promise<OsrmRegion[]> {
    const rows = await prisma.osrmRegion.findMany({
      where: { enabled: true },
      orderBy: [{ kind: 'asc' }, { regionId: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async listAll(): Promise<OsrmRegion[]> {
    const rows = await prisma.osrmRegion.findMany({ orderBy: [{ regionId: 'asc' }] });
    return rows.map(toDomain);
  }

  async get(regionId: string): Promise<OsrmRegion | null> {
    const row = await prisma.osrmRegion.findUnique({ where: { regionId } });
    return row ? toDomain(row) : null;
  }

  /** Creates or replaces a region (re-registering re-enables it). */
  async register(input: RegisterRegionInput): Promise<OsrmRegion> {
    const geometry = unwrapGeometry(input.polygon);
    const bbox = geojsonBBox(geometry);
    if (input.kind !== 'hotspot' && input.kind !== 'backbone') {
      throw new Error(`kind must be 'hotspot' or 'backbone', got '${input.kind}'`);
    }
    if (!PROFILE_RE.test(input.profile)) {
      throw new Error(`profile must match ${PROFILE_RE}, got '${input.profile}'`);
    }
    const url = new URL(input.osrmUrl); // throws on invalid URL
    const data = {
      name: input.name ?? input.regionId,
      polygon: geometry as any,
      ...bbox,
      osrmUrl: url.toString().replace(/\/+$/, ''),
      profile: input.profile,
      kind: input.kind,
      dataVersion: input.dataVersion,
      enabled: true,
    };
    const row = await prisma.osrmRegion.upsert({
      where: { regionId: input.regionId },
      create: { regionId: input.regionId, ...data },
      update: data,
    });
    return toDomain(row);
  }

  async disable(regionId: string): Promise<boolean> {
    const res = await prisma.osrmRegion.updateMany({ where: { regionId }, data: { enabled: false } });
    return res.count > 0;
  }
}

function toDomain(row: any): OsrmRegion {
  return {
    regionId: row.regionId,
    name: row.name,
    polygon: row.polygon,
    minLon: row.minLon,
    minLat: row.minLat,
    maxLon: row.maxLon,
    maxLat: row.maxLat,
    osrmUrl: row.osrmUrl,
    profile: row.profile,
    kind: row.kind as RegionKind,
    dataVersion: row.dataVersion,
    enabled: row.enabled,
  };
}

export interface RegionBBoxItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  region: OsrmRegion;
}

export interface RegionSnapshot {
  regions: OsrmRegion[];
  tree: RBush<RegionBBoxItem>;
  loadedAt: number;
}

function buildSnapshot(regions: OsrmRegion[]): RegionSnapshot {
  const tree = new RBush<RegionBBoxItem>();
  tree.load(
    regions.map((r) => ({ minX: r.minLon, minY: r.minLat, maxX: r.maxLon, maxY: r.maxLat, region: r }))
  );
  return { regions, tree, loadedAt: Date.now() };
}

/**
 * In-memory cache of enabled regions with an rbush index over their bboxes.
 * The index is rebuilt whenever the list refreshes (TTL). On refresh failure the stale snapshot
 * is kept (or an empty one if none was ever loaded): the matcher then degrades to unmatched.
 */
export class RegionCache {
  private snapshot: RegionSnapshot | null = null;
  private inflight: Promise<RegionSnapshot> | null = null;

  constructor(
    private readonly source: RegionSource,
    private readonly ttlS: number,
    private readonly now: () => number = Date.now
  ) {}

  async get(): Promise<RegionSnapshot> {
    if (this.snapshot && this.now() - this.snapshot.loadedAt < this.ttlS * 1000) {
      return this.snapshot;
    }
    if (!this.inflight) {
      this.inflight = this.refresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  invalidate(): void {
    this.snapshot = null;
  }

  private async refresh(): Promise<RegionSnapshot> {
    try {
      const regions = (await this.source.listEnabled()).filter((r) => r.enabled);
      this.snapshot = { ...buildSnapshot(regions), loadedAt: this.now() };
    } catch (err: any) {
      logger.error('RegionCache: failed to load OSRM regions', { error: err?.message });
      if (!this.snapshot) this.snapshot = { ...buildSnapshot([]), loadedAt: this.now() };
    }
    return this.snapshot;
  }
}
