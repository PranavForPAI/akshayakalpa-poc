import {
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  StartTrackingRequest,
  StartTrackingResponse,
  StopTrackingRequest,
  StopTrackingResponse,
  TelemetryConfig,
} from '../schemas/frappe.schema.js';
import {
  IDeviceKeyRepository,
  RedisDeviceKeyRepository,
} from '../repositories/device-key.repository.js';
import logger from '../logger.js';


// ---------------------------------------------------------------------------
// Frappe-specific error classes
// ---------------------------------------------------------------------------

export class FrappeError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseBody?: any
  ) {
    super(message);
    this.name = 'FrappeError';
  }
}

export class FrappeAuthError extends FrappeError {
  constructor(message: string, statusCode?: number, responseBody?: any) {
    super(message, statusCode, responseBody);
    this.name = 'FrappeAuthError';
  }
}

export class FrappeValidationError extends FrappeError {
  constructor(message: string, statusCode?: number, responseBody?: any) {
    super(message, statusCode, responseBody);
    this.name = 'FrappeValidationError';
  }
}

export class FrappeNotFoundError extends FrappeError {
  constructor(message: string, statusCode?: number, responseBody?: any) {
    super(message, statusCode, responseBody);
    this.name = 'FrappeNotFoundError';
  }
}

export class FrappeServerError extends FrappeError {
  constructor(message: string, statusCode?: number, responseBody?: any) {
    super(message, statusCode, responseBody);
    this.name = 'FrappeServerError';
  }
}

export class DeviceKeyNotFoundError extends Error {
  constructor(deviceId: string) {
    super(`No telemetry key found for device "${deviceId}". Register the device first.`);
    this.name = 'DeviceKeyNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Helpers: parse & extract Frappe error messages
// ---------------------------------------------------------------------------

/**
 * Strips basic HTML tags and unescapes common HTML entities.
 */
function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Parses Frappe's `_server_messages` header or body field.
 * Frappe typically formats `_server_messages` as a JSON string containing
 * a list of JSON-stringified objects: `"[{\"message\": \"...\", \"title\": \"...\"}]"`
 */
export function parseFrappeServerMessages(rawMessages: unknown): string[] {
  if (!rawMessages) return [];
  try {
    let list: any = rawMessages;
    // Unpack stringified JSON layers (handles multiple escapes if nested)
    while (typeof list === 'string') {
      try {
        list = JSON.parse(list);
      } catch {
        break;
      }
    }

    if (Array.isArray(list)) {
      const extracted = list
        .map((item) => {
          let parsed: any = item;
          while (typeof parsed === 'string') {
            try {
              parsed = JSON.parse(parsed);
            } catch {
              break;
            }
          }
          if (parsed && typeof parsed === 'object') {
            return parsed.message ?? parsed.title ?? JSON.stringify(parsed);
          }
          return String(parsed);
        })
        .map((text) => (typeof text === 'string' ? stripHtml(text) : String(text)))
        .filter((text) => text.length > 0);

      return Array.from(new Set(extracted));
    }
  } catch {
    if (typeof rawMessages === 'string' && rawMessages.trim()) {
      return [stripHtml(rawMessages)];
    }
  }
  return [];
}

/**
 * Extracts a human-readable error description from a Frappe error response body.
 */
export function extractFrappeErrorMessage(body: any, status: number): string {
  if (!body) {
    return `Frappe returned HTTP ${status}`;
  }

  // 1. Frappe server messages (e.g. from frappe.throw or frappe.msgprint)
  if (body._server_messages) {
    const messages = parseFrappeServerMessages(body._server_messages);
    if (messages.length > 0) {
      return messages.join('; ');
    }
  }

  // 2. Direct message field
  if (typeof body.message === 'string' && body.message.trim().length > 0) {
    return stripHtml(body.message);
  }
  if (body.message && typeof body.message === 'object') {
    if (typeof body.message.message === 'string' && body.message.message.trim().length > 0) {
      return stripHtml(body.message.message);
    }
  }

  // 3. Exception string (e.g. "frappe.exceptions.ValidationError: Vehicle KA-01-AB-1234 already has active trip")
  if (typeof body.exception === 'string' && body.exception.trim().length > 0) {
    const cleaned = stripHtml(body.exception);
    const match = cleaned.match(/^[a-zA-Z0-9_.]*(?:Error|Exception):\s*(.+)$/s);
    return match ? match[1].trim() : cleaned;
  }

  // 4. Exception type fallback
  if (typeof body.exc_type === 'string' && body.exc_type.trim().length > 0) {
    return `Frappe ${body.exc_type} (HTTP ${status})`;
  }

  return `Frappe returned HTTP ${status}`;
}

// ---------------------------------------------------------------------------
// Telemetry payload types (used by the ingest proxy)
// ---------------------------------------------------------------------------

export interface TelemetryReading {
  tripId: string;
  deviceId: string;
  latitude: number;
  longitude: number;
  speedKph?: number;
  headingDegrees?: number;
  accuracyMeters?: number;
  altitudeMeters?: number;
  batteryPercent?: number;
  isMock?: boolean;
  deviceTime: string;
}

export interface TelemetryIngestPayload {
  data: TelemetryReading[];
}

export interface TelemetryIngestResponse {
  accepted: boolean;
  duplicate: boolean;
  record_count: number | null;
  body_bytes: number;
  idempotency_key: string;
  raw_object_key?: string;
  correlation_id?: string;
}

// ---------------------------------------------------------------------------
// Sanitised response types (api_key stripped)
// ---------------------------------------------------------------------------

/** Telemetry config returned to the mobile — api_key removed, endpoint rewritten to our proxy */
export type SanitisedTelemetryConfig = Omit<TelemetryConfig, 'api_key'> & {
  endpoint: string; // overwritten to /api/frappe/ingest
};

export type SanitisedRegisterDeviceResponse = Omit<RegisterDeviceResponse, 'telemetry'> & {
  telemetry: SanitisedTelemetryConfig;
};

export type SanitisedStartTrackingResponse = Omit<StartTrackingResponse, 'telemetry'> & {
  telemetry: SanitisedTelemetryConfig;
};

export type SanitisedStopTrackingResponse = Omit<StopTrackingResponse, 'telemetry'> & {
  telemetry: SanitisedTelemetryConfig;
};

// ---------------------------------------------------------------------------
// Frappe API response envelope
// Frappe wraps all method responses in { message: <business_payload> }
// ---------------------------------------------------------------------------

interface FrappeEnvelope<T> {
  message: T;
}

// ---------------------------------------------------------------------------
// FrappeService
// ---------------------------------------------------------------------------

export class FrappeService {
  private readonly baseUrl: string;
  private readonly siteName: string | undefined;
  /** Public-facing proxy path the mobile app will call for telemetry uploads */
  private readonly proxyIngestPath = '/api/api/frappe/ingest';

  constructor(
    private readonly deviceKeyRepo: IDeviceKeyRepository = new RedisDeviceKeyRepository()
  ) {
    const rawBase = process.env.FRAPPE_BASE_URL;
    if (!rawBase) {
      throw new Error('FRAPPE_BASE_URL environment variable is not set');
    }
    this.baseUrl = rawBase.replace(/\/$/, '');
    this.siteName = process.env.FRAPPE_SITE_NAME || undefined;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.siteName) {
      headers['X-Frappe-Site-Name'] = this.siteName;
    }
    return headers;
  }

  /**
   * Build the absolute proxy ingest URL using the incoming request's host so
   * it works correctly behind any tunnel / reverse proxy.
   */
  private buildProxyIngestUrl(requestHost?: string): string {
    if (requestHost) {
      return `https://${requestHost}${this.proxyIngestPath}`;
    }
    const port = process.env.PORT || '3000';
    return `http://localhost:${port}${this.proxyIngestPath}`;
  }

  /**
   * Strip api_key from telemetry config and rewrite the endpoint to our proxy.
   */
  private sanitiseTelemetry(
    telemetry: TelemetryConfig,
    requestHost?: string
  ): SanitisedTelemetryConfig {
    const { api_key: _removed, endpoint: _originalEndpoint, ...rest } = telemetry;
    return {
      ...rest,
      endpoint: this.buildProxyIngestUrl(requestHost),
    };
  }

  /**
   * Persist the api_key from a Frappe response, then return a sanitised copy.
   */
  private async persistAndSanitise<T extends { telemetry: TelemetryConfig; device_id: string }>(
    raw: T,
    requestHost?: string
  ): Promise<Omit<T, 'telemetry'> & { telemetry: SanitisedTelemetryConfig }> {
    // Save the api_key server-side
    await this.deviceKeyRepo.upsert(
      raw.device_id,
      raw.telemetry.api_key,
      raw.telemetry.endpoint
    );

    const { telemetry, ...rest } = raw;
    return {
      ...rest,
      telemetry: this.sanitiseTelemetry(telemetry, requestHost),
    } as Omit<T, 'telemetry'> & { telemetry: SanitisedTelemetryConfig };
  }

  /**
   * Recursively redact sensitive values such as pin, api_key, password, token, etc.
   * Also redacts odometer_photo to avoid flooding logs with large base64 strings.
   */
  private redactSensitive(data: unknown): unknown {
    if (!data || typeof data !== 'object') {
      return data;
    }
    if (Array.isArray(data)) {
      return data.map((item) => this.redactSensitive(item));
    }
    const sensitiveKeys = new Set([
      'pin',
      'api_key',
      'apikey',
      'password',
      'secret',
      'token',
      'authorization',
      'odometer_photo',
    ]);
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      if (sensitiveKeys.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
      } else if (typeof val === 'object' && val !== null) {
        result[key] = this.redactSensitive(val);
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  private async callFrappeMethod<TResponse>(
    methodPath: string,
    payload: unknown
  ): Promise<TResponse> {
    const url = `${this.baseUrl}${methodPath}`;
    const startMs = Date.now();

    // Redact sensitive fields before logging
    const loggablePayload = this.redactSensitive(payload as Record<string, unknown>);

    logger.info('Frappe upstream request', {
      type: 'frappe_request',
      method: 'POST',
      url,
      payload: loggablePayload,
    });

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(payload),
      });
    } catch (networkError: any) {
      const latencyMs = Date.now() - startMs;
      logger.error('Frappe network error', {
        type: 'frappe_error',
        url,
        latencyMs,
        error: networkError?.message ?? String(networkError),
      });
      throw new FrappeServerError(
        `Network error reaching Frappe at ${url}: ${networkError?.message ?? String(networkError)}`
      );
    }

    const latencyMs = Date.now() - startMs;

    let rawText = '';
    let body: any;
    try {
      rawText = await response.text();
      body = JSON.parse(rawText);
    } catch {
      body = { message: rawText || response.statusText };
    }

    if (response.ok) {
      logger.info('Frappe upstream response', {
        type: 'frappe_response',
        url,
        statusCode: response.status,
        latencyMs,
        // Log response summary without api_key
        data: this.redactSensitive(body?.message ?? body),
      });
      const envelope = body as FrappeEnvelope<TResponse>;
      return envelope.message;
    }

    const serverMessage = extractFrappeErrorMessage(body, response.status);

    logger.warn('Frappe upstream error response', {
      type: 'frappe_error_response',
      url,
      statusCode: response.status,
      latencyMs,
      serverMessage,
      errorResponse: this.redactSensitive(body),
    });

    switch (response.status) {
      case 400:
      case 417:
        throw new FrappeValidationError(serverMessage, response.status, body);
      case 401:
      case 403:
        throw new FrappeAuthError(serverMessage, response.status, body);
      case 404:
        throw new FrappeNotFoundError(serverMessage, response.status, body);
      default:
        throw new FrappeServerError(serverMessage, response.status, body);
    }
  }


  // -------------------------------------------------------------------------
  // 6.2 Register Device
  // -------------------------------------------------------------------------

  async registerDevice(
    dto: RegisterDeviceRequest,
    requestHost?: string
  ): Promise<SanitisedRegisterDeviceResponse> {
    const raw = await this.callFrappeMethod<RegisterDeviceResponse>(
      '/api/method/delivery_management.mobile_tracking.register_device',
      dto
    );
    return this.persistAndSanitise(raw, requestHost);
  }

  // -------------------------------------------------------------------------
  // 6.3 Start Tracking / Create Trip
  // -------------------------------------------------------------------------

  async startTracking(
    dto: StartTrackingRequest,
    requestHost?: string
  ): Promise<SanitisedStartTrackingResponse> {
    const raw = await this.callFrappeMethod<StartTrackingResponse>(
      '/api/method/delivery_management.mobile_tracking.start_tracking',
      dto
    );
    return this.persistAndSanitise(raw, requestHost);
  }

  // -------------------------------------------------------------------------
  // 6.5 Stop Tracking / Complete Trip
  // -------------------------------------------------------------------------

  async stopTracking(
    dto: StopTrackingRequest,
    requestHost?: string
  ): Promise<SanitisedStopTrackingResponse> {
    const raw = await this.callFrappeMethod<StopTrackingResponse>(
      '/api/method/delivery_management.mobile_tracking.stop_tracking',
      dto
    );
    return this.persistAndSanitise(raw, requestHost);
  }

  // -------------------------------------------------------------------------
  // Telemetry ingest proxy
  // -------------------------------------------------------------------------

  /**
   * Look up the device's api_key from the DB, then forward the telemetry batch
   * to the real telemetry service with the proper auth headers.
   * The mobile app calls OUR endpoint; it never sees the api_key.
   */
  async proxyTelemetryIngest(
    deviceId: string,
    payload: TelemetryIngestPayload,
    idempotencyKey: string,
    correlationId?: string
  ): Promise<{ status: number; body: TelemetryIngestResponse }> {
    // Lookup the stored key
    const keyRecord = await this.deviceKeyRepo.findByDeviceId(deviceId);
    if (!keyRecord) {
      throw new DeviceKeyNotFoundError(deviceId);
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-API-Key': keyRecord.apiKey,
      'Idempotency-Key': idempotencyKey,
    };
    if (correlationId) {
      headers['X-Correlation-ID'] = correlationId;
    }

    const startMs = Date.now();
    logger.info('Telemetry upstream request', {
      type: 'telemetry_request',
      url: keyRecord.telemetryEndpoint,
      deviceId,
      idempotencyKey,
      correlationId,
      readingCount: payload.data?.length ?? 0,
    });

    let response: Response;
    try {
      response = await fetch(keyRecord.telemetryEndpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
    } catch (networkError: any) {
      const latencyMs = Date.now() - startMs;
      logger.error('Telemetry upstream network error', {
        type: 'telemetry_error',
        url: keyRecord.telemetryEndpoint,
        deviceId,
        latencyMs,
        error: networkError?.message ?? String(networkError),
      });
      throw new FrappeServerError(
        `Network error reaching telemetry service: ${networkError?.message ?? String(networkError)}`
      );
    }

    const latencyMs = Date.now() - startMs;

    let rawText = '';
    let body: any;
    try {
      rawText = await response.text();
      body = JSON.parse(rawText);
    } catch {
      body = rawText ? { raw: rawText } : {};
    }

    const level = response.ok ? 'info' : 'warn';
    logger[level]('Telemetry upstream response', {
      type: 'telemetry_response',
      url: keyRecord.telemetryEndpoint,
      deviceId,
      statusCode: response.status,
      latencyMs,
      body,
    });

    return { status: response.status, body };
  }
}
