/**
 * debug-db.repository.ts
 *
 * All writes are gated on the DEBUG_MODE=true environment variable.
 * Every method is fire-and-forget safe — it catches its own errors and
 * logs them via Winston rather than propagating, so a DB failure never
 * affects the HTTP response path.
 *
 * Tables written:
 *   device_keys  — upserted on register-device / start-tracking / stop-tracking
 *   trips        — upserted on start-tracking / stop-tracking; auto-created on ingest
 *   coordinates  — bulk-inserted on every successful ingest (all readings, incl. no-GPS)
 *
 * Deduplication for ingest retries is handled by the unique constraint
 * (idempotency_key, batch_index) on the coordinates table — createMany
 * with skipDuplicates:true is idempotent.
 */

import prisma from '../db/prisma.js';
import logger from '../logger.js';
import type { TelemetryReadingDto } from '../schemas/frappe.schema.js';
import type {
  SanitisedRegisterDeviceResponse,
  SanitisedStartTrackingResponse,
  SanitisedStopTrackingResponse,
} from '../services/frappe.service.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shared device-key upsert payload builder (same shape for register + start). */
function deviceKeyData(response: SanitisedRegisterDeviceResponse | SanitisedStartTrackingResponse) {
  return {
    driver: response.driver,
    vehicle: response.vehicle,
    route: response.route,
    deviceName: response.device,
    assignment: response.assignment,
    captureIntervalSecs: response.telemetry.capture_interval_seconds,
    uploadIntervalSecs: response.telemetry.upload_interval_seconds,
    maxRecordsPerRequest: response.telemetry.max_records_per_request,
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

class DebugDbRepository {
  /** Returns true only when DEBUG_MODE env var is exactly 'true'. */
  private get enabled(): boolean {
    return process.env.DEBUG_MODE === 'true';
  }

  // -------------------------------------------------------------------------
  // register-device success
  // -------------------------------------------------------------------------

  async upsertFromRegisterDevice(
    deviceId: string,
    response: SanitisedRegisterDeviceResponse
  ): Promise<void> {
    if (!this.enabled) return;
    try {
      const data = deviceKeyData(response);
      await prisma.deviceKey.upsert({
        where: { deviceId },
        create: { deviceId, ...data },
        update: data,
      });
      logger.debug('DebugDb: device key upserted (register-device)', { deviceId });
    } catch (err: any) {
      logger.error('DebugDb: upsertFromRegisterDevice failed', {
        deviceId,
        error: err?.message ?? String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // start-tracking success
  // -------------------------------------------------------------------------

  async upsertFromStartTracking(
    deviceId: string,
    response: SanitisedStartTrackingResponse
  ): Promise<void> {
    if (!this.enabled) return;
    try {
      // 1. Upsert device key (ensure row exists for FK on trips)
      const dkData = deviceKeyData(response);
      await prisma.deviceKey.upsert({
        where: { deviceId },
        create: { deviceId, ...dkData },
        update: dkData,
      });

      // 2. Upsert trip
      const tripCreate = {
        tripId: response.trip_id,
        deviceId,
        status: response.status,
        startedAt: response.started_at ? new Date(response.started_at) : undefined,
        driver: response.driver,
        vehicle: response.vehicle,
        route: response.route,
        assignment: response.assignment,
      };
      await prisma.trip.upsert({
        where: { tripId: response.trip_id },
        create: tripCreate,
        update: {
          status: response.status,
          startedAt: response.started_at ? new Date(response.started_at) : undefined,
        },
      });

      logger.debug('DebugDb: device key + trip upserted (start-tracking)', {
        deviceId,
        tripId: response.trip_id,
      });
    } catch (err: any) {
      logger.error('DebugDb: upsertFromStartTracking failed', {
        deviceId,
        tripId: response.trip_id,
        error: err?.message ?? String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // stop-tracking success
  // -------------------------------------------------------------------------

  async upsertFromStopTracking(
    deviceId: string,
    response: SanitisedStopTrackingResponse
  ): Promise<void> {
    if (!this.enabled) return;
    try {
      // Ensure device key row exists (trip has FK → device_keys)
      await prisma.deviceKey.upsert({
        where: { deviceId },
        create: { deviceId },
        update: {},
      });

      await prisma.trip.upsert({
        where: { tripId: response.trip_id },
        create: {
          tripId: response.trip_id,
          deviceId,
          status: response.status,
          startedAt: response.started_at ? new Date(response.started_at) : undefined,
          stoppedAt: response.stopped_at ? new Date(response.stopped_at) : undefined,
          driver: response.driver,
          vehicle: response.vehicle,
          route: response.route,
          assignment: response.assignment,
        },
        update: {
          status: response.status,
          stoppedAt: response.stopped_at ? new Date(response.stopped_at) : undefined,
        },
      });

      logger.debug('DebugDb: trip updated to Completed (stop-tracking)', {
        deviceId,
        tripId: response.trip_id,
      });
    } catch (err: any) {
      logger.error('DebugDb: upsertFromStopTracking failed', {
        deviceId,
        tripId: response.trip_id,
        error: err?.message ?? String(err),
      });
    }
  }

  // -------------------------------------------------------------------------
  // ingest success — store ALL readings (incl. no-GPS) with full metadata
  // -------------------------------------------------------------------------

  async saveIngestBatch(options: {
    /** Trip ID from the first reading (all readings in a batch share the same trip). */
    tripId: string;
    deviceId: string;
    /** Complete set of readings as received from the mobile (including no-GPS). */
    readings: TelemetryReadingDto[];
    idempotencyKey: string;
    /** HTTP status the upstream returned (null when all readings were no-GPS / not forwarded). */
    upstreamStatus: number | null;
    /** accepted field from upstream response body (null when not forwarded). */
    upstreamAccepted: boolean | null;
    /** How many readings were actually forwarded upstream (those with lat+lng). */
    forwardedCount: number;
  }): Promise<void> {
    if (!this.enabled) return;
    const { tripId, deviceId, readings, idempotencyKey, upstreamStatus, upstreamAccepted, forwardedCount } =
      options;
    try {
      // 1. Ensure device_keys row exists (FK root for trips)
      await prisma.deviceKey.upsert({
        where: { deviceId },
        create: { deviceId },
        update: {},
      });

      // 2. Ensure trip row exists (FK root for coordinates)
      await prisma.trip.upsert({
        where: { tripId },
        create: { tripId, deviceId, status: 'In Transit' },
        update: {},
      });

      // 3. Bulk-insert all readings (idempotent via unique constraint on retry)
      //    wasForwarded = true for readings that had GPS and were sent upstream
      let forwardedSoFar = 0;
      const rows = readings.map((r, index) => {
        const hasGps = r.latitude !== undefined && r.longitude !== undefined;
        // A reading was forwarded if it had GPS and its position in the forwarded
        // subset is within the upstream call count.
        const wasForwarded = hasGps && forwardedSoFar++ < forwardedCount;
        return {
          tripId,
          deviceId: r.deviceId,
          hasGps,
          latitude: r.latitude ?? null,
          longitude: r.longitude ?? null,
          speedKph: r.speedKph ?? null,
          headingDegrees: r.headingDegrees ?? null,
          accuracyMeters: r.accuracyMeters ?? null,
          altitudeMeters: r.altitudeMeters ?? null,
          batteryPercent: r.batteryPercent ?? null,
          isMock: r.isMock ?? false,
          deviceTime: new Date(r.deviceTime),
          captureSource: r.captureSource ?? null,
          appState: r.appState ?? null,
          networkType: r.networkType ?? null,
          internetAvailable: r.internetAvailable ?? null,
          locationServiceOn: r.locationServiceOn ?? null,
          locationPermission: r.locationPermission ?? null,
          wasForwarded,
          upstreamStatus: wasForwarded ? upstreamStatus : null,
          upstreamAccepted: wasForwarded ? upstreamAccepted : null,
          idempotencyKey,
          batchIndex: index,
        };
      });

      const result = await prisma.coordinate.createMany({
        data: rows,
        skipDuplicates: true, // idempotent on retry
      });

      logger.debug('DebugDb: ingest batch saved', {
        tripId,
        deviceId,
        totalReadings: readings.length,
        forwardedCount,
        insertedRows: result.count,
        skippedDuplicates: readings.length - result.count,
      });
    } catch (err: any) {
      logger.error('DebugDb: saveIngestBatch failed', {
        tripId,
        deviceId,
        error: err?.message ?? String(err),
      });
    }
  }
}

export const debugDbRepo = new DebugDbRepository();
export default debugDbRepo;
