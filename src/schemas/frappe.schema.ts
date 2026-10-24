import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared sub-schemas
// ---------------------------------------------------------------------------

export const deviceDetailsSchema = z.object({
  platform: z.string().optional(),
  manufacturer: z.string().optional(),
  device_model: z.string().optional(),
  os_version: z.string().optional(),
  app_version: z.string().optional(),
});

// ---------------------------------------------------------------------------
// 6.2 Register Device
// ---------------------------------------------------------------------------

export const registerDeviceRequestSchema = z.object({
  /** 10-digit Indian mobile number; +91 prefix accepted */
  mobile_number: z
    .string()
    .min(10, 'mobile_number must be at least 10 digits')
    .regex(/^\+?91?\d{10}$|^\d{10}$/, 'Invalid Indian mobile number format'),
  /** Predefined 4–8 digit PIN */
  pin: z
    .string()
    .min(4, 'pin must be 4–8 digits')
    .max(8, 'pin must be 4–8 digits')
    .regex(/^\d+$/, 'pin must be numeric'),
  /** Stable app/device identifier (not IMEI) */
  device_id: z.string().min(1, 'device_id is required'),
  device_details: deviceDetailsSchema.optional(),
});

export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;

export interface TelemetryConfig {
  source: string;
  endpoint: string;
  api_key: string;
  capture_interval_seconds: number;
  upload_interval_seconds: number;
  max_records_per_request: number;
}

export interface RegisterDeviceResponse {
  driver: string;
  vehicle: string;
  route: string;
  device: string;
  device_id: string;
  assignment: string;
  telemetry: TelemetryConfig;
}

// ---------------------------------------------------------------------------
// 6.3 Start Tracking
// ---------------------------------------------------------------------------

export const startTrackingRequestSchema = z.object({
  mobile_number: z
    .string()
    .min(10, 'mobile_number must be at least 10 digits')
    .regex(/^\+?91?\d{10}$|^\d{10}$/, 'Invalid Indian mobile number format'),
  pin: z
    .string()
    .min(4, 'pin must be 4–8 digits')
    .max(8, 'pin must be 4–8 digits')
    .regex(/^\d+$/, 'pin must be numeric'),
  device_id: z.string().min(1, 'device_id is required'),
  /** Stable 8–80 character idempotency key for this Start; reuse on every retry */
  request_id: z
    .string()
    .min(8, 'request_id must be 8–80 characters')
    .max(80, 'request_id must be 8–80 characters'),
  /** Actual UTC time when the delivery boy tapped Start */
  started_at: z.string().datetime({ message: 'started_at must be an ISO-8601 UTC datetime' }).optional(),
  /** JPEG or PNG data URI; base64 decoded size <= 5 MB */
  odometer_photo: z
    .string()
    .regex(/^data:image\/(jpeg|png);base64,/, 'odometer_photo must be a JPEG or PNG data URI'),
  device_details: deviceDetailsSchema.optional(),
});

export type StartTrackingRequest = z.infer<typeof startTrackingRequestSchema>;

export interface StartTrackingResponse {
  // Registration context — Frappe echoes these from the device assignment
  driver: string;
  vehicle: string;
  route: string;
  device: string;
  device_id: string;
  assignment: string;
  // Trip fields
  trip_id: string;
  status: 'In Transit';
  started_at: string;
  telemetry: TelemetryConfig;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// 6.5 Stop Tracking
// ---------------------------------------------------------------------------

export const stopTrackingRequestSchema = z.object({
  mobile_number: z
    .string()
    .min(10, 'mobile_number must be at least 10 digits')
    .regex(/^\+?91?\d{10}$|^\d{10}$/, 'Invalid Indian mobile number format'),
  pin: z
    .string()
    .min(4, 'pin must be 4–8 digits')
    .max(8, 'pin must be 4–8 digits')
    .regex(/^\d+$/, 'pin must be numeric'),
  device_id: z.string().min(1, 'device_id is required'),
  trip_id: z.string().min(1, 'trip_id is required'),
  /** Actual UTC time when the delivery boy tapped Stop */
  stopped_at: z.string().datetime({ message: 'stopped_at must be an ISO-8601 UTC datetime' }).optional(),
  /** JPEG or PNG data URI; base64 decoded size <= 5 MB */
  odometer_photo: z
    .string()
    .regex(/^data:image\/(jpeg|png);base64,/, 'odometer_photo must be a JPEG or PNG data URI'),
});

export type StopTrackingRequest = z.infer<typeof stopTrackingRequestSchema>;

export interface StopTrackingResponse {
  // Registration context — Frappe echoes these from the device assignment
  driver: string;
  vehicle: string;
  route: string;
  device: string;
  device_id: string;
  assignment: string;
  // Trip fields
  trip_id: string;
  status: 'Completed';
  started_at: string;
  stopped_at: string;
  telemetry: TelemetryConfig;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// 6.4 Telemetry ingest proxy request (mobile → our backend → telemetry service)
//
// latitude and longitude are OPTIONAL — the mobile sends every capture attempt
// including ones with no GPS fix (captureSource: 'skipped' | 'failed').
// Our proxy filters out no-GPS readings before forwarding to the upstream
// telemetry service.
// ---------------------------------------------------------------------------

export const telemetryReadingSchema = z.object({
  tripId: z.string().min(1, 'tripId is required'),
  deviceId: z.string().min(1, 'deviceId is required'),
  /** Absent (not null) when captureSource is 'skipped' or 'failed'. */
  latitude: z.number().optional(),
  /** Absent (not null) when captureSource is 'skipped' or 'failed'. */
  longitude: z.number().optional(),
  speedKph: z.number().optional(),
  headingDegrees: z.number().optional(),
  accuracyMeters: z.number().optional(),
  altitudeMeters: z.number().optional(),
  batteryPercent: z.number().optional(),
  isMock: z.boolean().optional(),
  /** UTC ISO-8601 timestamp of the fix (or capture attempt time for carried/skipped). */
  deviceTime: z.string().datetime({ message: 'deviceTime must be an ISO-8601 UTC datetime' }),
  /** Why this reading was captured (or not). */
  captureSource: z
    .enum(['gps', 'current', 'last_known', 'carried', 'skipped', 'failed'])
    .optional(),
  /** App lifecycle state at capture time. */
  appState: z.enum(['foreground', 'background', 'terminated']).optional(),
  /** Active network type string from the OS (may be a combo like 'Wi-Fi + VPN'). */
  networkType: z.string().optional(),
  /** Whether the API hostname resolved within 2 s. */
  internetAvailable: z.boolean().optional(),
  /** Device-level location switch state (absent if unreadable). */
  locationServiceOn: z.boolean().optional(),
  /** Android location permission grant level. */
  locationPermission: z
    .enum(['Always', 'While in use', 'Denied', 'Unknown'])
    .optional(),
});

/** Type of a single reading as received from the mobile app (full, including no-GPS). */
export type TelemetryReadingDto = z.infer<typeof telemetryReadingSchema>;

export const telemetryIngestSchema = z.object({
  data: z
    .array(telemetryReadingSchema)
    .min(1, 'data must contain at least one reading'),
});

export type TelemetryIngestDto = z.infer<typeof telemetryIngestSchema>;


