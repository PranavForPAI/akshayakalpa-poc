import { Router } from 'express';
import { FrappeController } from '../controllers/frappe.controller.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { parseOdometerFormData } from '../middlewares/multipart.middleware.js';
import {
  registerDeviceRequestSchema,
  startTrackingRequestSchema,
  stopTrackingRequestSchema,
  telemetryIngestSchema,
} from '../schemas/frappe.schema.js';

export const createFrappeRouter = (
  controller: FrappeController = new FrappeController()
): Router => {
  const router = Router();

  // 6.2 Register device with Frappe (returns sanitised telemetry config — no api_key)
  router.post(
    '/register-device',
    validateBody(registerDeviceRequestSchema),
    controller.registerDevice
  );

  // 6.3 Start trip / tracking via Frappe (supports multipart/form-data with odometer_photo file or JSON)
  router.post(
    '/start-tracking',
    parseOdometerFormData,
    validateBody(startTrackingRequestSchema),
    controller.startTracking
  );

  // 6.5 Stop trip / tracking via Frappe (supports multipart/form-data with odometer_photo file or JSON)
  router.post(
    '/stop-tracking',
    parseOdometerFormData,
    validateBody(stopTrackingRequestSchema),
    controller.stopTracking
  );

  // 6.4 Telemetry ingest proxy
  // Mobile sends X-Device-ID + Idempotency-Key headers; backend attaches the api_key
  router.post(
    '/ingest',
    validateBody(telemetryIngestSchema),
    controller.ingest
  );

  return router;
};

export const frappeRouter = createFrappeRouter();
