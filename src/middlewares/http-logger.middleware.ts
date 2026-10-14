import { Request, Response, NextFunction } from 'express';
import logger from '../logger.js';

/**
 * HTTP request / response logger middleware.
 * Logs when a request arrives and again when the response finishes,
 * including method, path, status, and latency.
 */
export const httpLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startMs = Date.now();

  // Sanitise headers — strip authorisation values before logging
  const safeHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (['authorization', 'x-api-key', 'cookie'].includes(lower)) {
      safeHeaders[key] = '[REDACTED]';
    } else {
      safeHeaders[key] = String(value);
    }
  }

  logger.info('Incoming request', {
    type: 'http_request',
    method: req.method,
    path: req.path,
    query: req.query,
    headers: safeHeaders,
    ip: req.ip,
  });

  res.on('finish', () => {
    const latencyMs = Date.now() - startMs;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level]('Request completed', {
      type: 'http_response',
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      latencyMs,
    });
  });

  next();
};
