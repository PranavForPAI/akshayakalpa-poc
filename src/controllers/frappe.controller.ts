import { Request, Response } from 'express';
import {
  FrappeService,
  FrappeAuthError,
  FrappeValidationError,
  FrappeNotFoundError,
  FrappeServerError,
  DeviceKeyNotFoundError,
} from '../services/frappe.service.js';
import {
  RegisterDeviceRequest,
  StartTrackingRequest,
  StopTrackingRequest,
  TelemetryIngestDto,
} from '../schemas/frappe.schema.js';
import logger from '../logger.js';

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
    } catch (error) {
      this.handleError(res, error);
    }
  };

  // ---------------------------------------------------------------------------
  // POST /api/frappe/ingest  — telemetry proxy
  //
  // Mobile app sends:
  //   Header:  X-Device-ID        (required) — which device this is
  //   Header:  Idempotency-Key    (required) — stable batch UUID; reuse on retry
  //   Header:  X-Correlation-ID  (optional)
  //   Body:    { data: [...readings] }
  //
  // Backend looks up the api_key from DB and forwards to the real endpoint.
  // ---------------------------------------------------------------------------

  ingest = async (
    req: Request<{}, {}, TelemetryIngestDto>,
    res: Response
  ): Promise<void> => {
    const deviceId = req.headers['x-device-id'] as string | undefined;
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    const correlationId = req.headers['x-correlation-id'] as string | undefined;

    if (!deviceId) {
      res.status(400).json({ error: 'Missing required header: X-Device-ID' });
      return;
    }
    if (!idempotencyKey) {
      res.status(400).json({ error: 'Missing required header: Idempotency-Key' });
      return;
    }

    try {
      const { status, body } = await this.frappeService.proxyTelemetryIngest(
        deviceId,
        req.body,
        idempotencyKey,
        correlationId
      );
      // Forward the telemetry service's status code (202, 409, 413, 429, etc.) verbatim
      res.status(status).json(body);
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
        error: 'Authentication or authorisation failed. Verify mobile number and PIN.',
      });
      return;
    }
    if (error instanceof FrappeValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof FrappeNotFoundError) {
      res.status(404).json({
        error: 'Frappe API or resource not found. Check integration configuration.',
      });
      return;
    }
    if (error instanceof FrappeServerError) {
      res.status(502).json({
        error: 'Upstream service is temporarily unavailable. Retry with backoff.',
        details: error.message,
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
