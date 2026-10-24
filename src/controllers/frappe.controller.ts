import { Request, Response } from 'express';
import {
  FrappeService,
  FrappeAuthError,
  FrappeValidationError,
  FrappeNotFoundError,
  FrappeServerError,
  DeviceKeyNotFoundError,
  TelemetryReading,
} from '../services/frappe.service.js';
import {
  RegisterDeviceRequest,
  StartTrackingRequest,
  StopTrackingRequest,
  TelemetryIngestDto,
  TelemetryReadingDto,
} from '../schemas/frappe.schema.js';
import logger from '../logger.js';
import { debugDbRepo } from '../repositories/debug-db.repository.js';

// ---------------------------------------------------------------------------
// Helper: type predicate — narrows a reading to one that has valid GPS coords
// ---------------------------------------------------------------------------

function hasGps(
  r: TelemetryReadingDto
): r is TelemetryReadingDto & { latitude: number; longitude: number } {
  return r.latitude !== undefined && r.longitude !== undefined;
}

// ---------------------------------------------------------------------------
// Helper: map a full DTO reading to the upstream telemetry format.
// Strips every field the upstream doesn't understand (captureSource, appState…).
// ---------------------------------------------------------------------------

function toUpstreamReading(r: TelemetryReadingDto & { latitude: number; longitude: number }): TelemetryReading {
  const reading: TelemetryReading = {
    tripId: r.tripId,
    deviceId: r.deviceId,
    latitude: r.latitude,
    longitude: r.longitude,
    deviceTime: r.deviceTime,
  };
  if (r.speedKph !== undefined) reading.speedKph = r.speedKph;
  if (r.headingDegrees !== undefined) reading.headingDegrees = r.headingDegrees;
  if (r.accuracyMeters !== undefined) reading.accuracyMeters = r.accuracyMeters;
  if (r.altitudeMeters !== undefined) reading.altitudeMeters = r.altitudeMeters;
  if (r.batteryPercent !== undefined) reading.batteryPercent = r.batteryPercent;
  if (r.isMock !== undefined) reading.isMock = r.isMock;
  return reading;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

export class FrappeController {
  constructor(private readonly frappeService: FrappeService = new FrappeService()) {}

  // ---------------------------------------------------------------------------
  // POST /api/frappe/register-device
  // ---------------------------------------------------------------------------

  registerDevice = async (
    req: Request<{}, {}, RegisterDeviceRequest>,
    res: Response
  ): Promise<void> => {
    try {
      const result = await this.frappeService.registerDevice(req.body, req.hostname);
      res.status(200).json({ message: result });

      // Fire-and-forget: persist device metadata to Postgres (DEBUG_MODE only)
      setImmediate(() => {
        debugDbRepo
          .upsertFromRegisterDevice(req.body.device_id, result)
          .catch((err) =>
            logger.error('DebugDb fire-and-forget failed (register-device)', {
              error: err?.message,
            })
          );
      });
    } catch (error) {
      this.handleError(res, error);
    }
  };

  // ---------------------------------------------------------------------------
  // POST /api/frappe/start-tracking
  // ---------------------------------------------------------------------------

  startTracking = async (
    req: Request<{}, {}, StartTrackingRequest>,
    res: Response
  ): Promise<void> => {
    try {
      const result = await this.frappeService.startTracking(req.body, req.hostname);
      res.status(200).json({ message: result });

      // Fire-and-forget: persist device key + trip to Postgres (DEBUG_MODE only)
      setImmediate(() => {
        debugDbRepo
          .upsertFromStartTracking(result.device_id, result)
          .catch((err) =>
            logger.error('DebugDb fire-and-forget failed (start-tracking)', {
              error: err?.message,
            })
          );
      });
    } catch (error) {
      this.handleError(res, error);
    }
  };

  // ---------------------------------------------------------------------------
  // POST /api/frappe/stop-tracking
  // ---------------------------------------------------------------------------

  stopTracking = async (
    req: Request<{}, {}, StopTrackingRequest>,
    res: Response
  ): Promise<void> => {
    try {
      const result = await this.frappeService.stopTracking(req.body, req.hostname);
      res.status(200).json({ message: result });

      // Fire-and-forget: update trip status in Postgres (DEBUG_MODE only)
      setImmediate(() => {
        debugDbRepo
          .upsertFromStopTracking(result.device_id, result)
          .catch((err) =>
            logger.error('DebugDb fire-and-forget failed (stop-tracking)', {
              error: err?.message,
            })
          );
      });
    } catch (error) {
      this.handleError(res, error);
    }
  };

  // ---------------------------------------------------------------------------
  // POST /api/frappe/ingest  — telemetry proxy
  //
  // Mobile app sends:
  //   Header:  Authorization       (Bearer token — accepted, not validated here)
  //   Header:  X-Device-ID        (required) — which device this is
  //   Header:  Idempotency-Key    (required) — stable batch UUID; reuse on retry
  //   Header:  X-Correlation-ID  (optional)
  //   Body:    { data: [...readings] }
  //
  // Readings may have no latitude/longitude (captureSource: skipped|failed).
  // The proxy strips those before forwarding; all readings are stored in Postgres.
  // ---------------------------------------------------------------------------

  ingest = async (
    req: Request<{}, {}, TelemetryIngestDto>,
    res: Response
  ): Promise<void> => {
    const deviceId = req.headers['x-device-id'] as string | undefined;
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    const correlationId = req.headers['x-correlation-id'] as string | undefined;
    // Authorization header is accepted but not validated at this layer.

    if (!deviceId) {
      res.status(400).json({ error: 'Missing required header: X-Device-ID' });
      return;
    }
    if (!idempotencyKey) {
      res.status(400).json({ error: 'Missing required header: Idempotency-Key' });
      return;
    }

    const allReadings: TelemetryReadingDto[] = req.body?.data ?? [];

    // -----------------------------------------------------------------------
    // Split: readings with valid GPS coords vs. those without
    // -----------------------------------------------------------------------
    const gpsReadings = allReadings.filter(hasGps);
    const filteredCount = allReadings.length - gpsReadings.length;

    if (filteredCount > 0) {
      logger.info('Filtered no-GPS readings before upstream forward', {
        type: 'ingest_filter',
        tripId: allReadings[0]?.tripId,
        deviceId,
        idempotencyKey,
        totalReceived: allReadings.length,
        forwarded: gpsReadings.length,
        filtered: filteredCount,
      });
    }

    try {
      let upstreamStatus: number;
      let upstreamBody: any;

      if (gpsReadings.length > 0) {
        // Forward only the GPS-valid readings, mapped to the upstream format
        // (strips captureSource, appState, networkType, etc.)
        const upstreamPayload = { data: gpsReadings.map(toUpstreamReading) };
        const result = await this.frappeService.proxyTelemetryIngest(
          deviceId,
          upstreamPayload,
          idempotencyKey,
          correlationId
        );
        upstreamStatus = result.status;
        upstreamBody = result.body;
      } else {
        // All readings were no-GPS — skip the upstream call entirely
        // and return a synthetic 202 so the mobile marks the batch as sent.
        logger.info('All readings lacked GPS coords; upstream call skipped', {
          type: 'ingest_no_gps',
          tripId: allReadings[0]?.tripId,
          deviceId,
          idempotencyKey,
          totalReadings: allReadings.length,
        });
        upstreamStatus = 202;
        upstreamBody = {
          accepted: true,
          duplicate: false,
          record_count: 0,
          body_bytes: 0,
          idempotency_key: idempotencyKey,
        };
      }


      // -----------------------------------------------------------------------
      // Fire-and-forget: Postgres debug write — only if DEBUG_MODE=true
      // and only when the upstream call succeeded (2xx or synthetic 202)
      // -----------------------------------------------------------------------
      if (upstreamStatus >= 200 && upstreamStatus < 300 && allReadings.length > 0) {
        setImmediate(() => {
          debugDbRepo
            .saveIngestBatch({
              tripId: allReadings[0].tripId,
              deviceId,
              readings: allReadings,
              idempotencyKey,
              upstreamStatus,
              upstreamAccepted:
                typeof upstreamBody?.accepted === 'boolean' ? upstreamBody.accepted : null,
              forwardedCount: gpsReadings.length,
            })
            .catch((err) =>
              logger.error('DebugDb fire-and-forget failed (ingest)', { error: err?.message })
            );
        });
      }

      // Forward the upstream status code verbatim (202, 409, 413, 429, etc.)
      res.status(upstreamStatus).json(upstreamBody);
    } catch (error) {
      this.handleError(res, error);
    }
  };

  // ---------------------------------------------------------------------------
  // Centralised error handler
  // ---------------------------------------------------------------------------

  private handleError(res: Response, error: any): void {
    if (error instanceof DeviceKeyNotFoundError) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof FrappeAuthError) {
      res.status(403).json({
        error: error.message || 'Authentication or authorisation failed. Verify mobile number and PIN.',
        details: error.responseBody ?? undefined,
      });
      return;
    }
    if (error instanceof FrappeValidationError) {
      res.status(400).json({
        error: error.message,
        details: error.responseBody ?? undefined,
      });
      return;
    }
    if (error instanceof FrappeNotFoundError) {
      res.status(404).json({
        error: error.message || 'Frappe API or resource not found. Check integration configuration.',
        details: error.responseBody ?? undefined,
      });
      return;
    }
    if (error instanceof FrappeServerError) {
      res.status(502).json({
        error: error.message || 'Upstream service is temporarily unavailable. Retry with backoff.',
        details: error.responseBody ?? error.message,
      });
      return;
    }

    logger.error('Unhandled FrappeController Error', {
      error: error?.message ?? String(error),
      stack: error?.stack,
    });
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
