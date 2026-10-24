import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { frappeRouter } from './routes/frappe.routes.js';
import { dashboardRouter } from './routes/dashboard.routes.js';
import { createSwaggerRouter } from './docs/swagger.js';
import { httpLogger } from './middlewares/http-logger.middleware.js';
import logger from './logger.js';
import { redisManager } from './redis.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
// Log incoming request details first before body parsing
app.use(httpLogger);

// Body parsers with 5MB limit (safety net for large JSON payloads / base64 photos)
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    redis: redisManager.isAvailable() ? 'connected' : 'memory-fallback',
  });
});

// Interactive Swagger UI & OpenAPI spec
app.use(createSwaggerRouter());

// Mount Frappe wrapper router under /api/frappe
app.use('/api/frappe', frappeRouter);

// Mount Analytics Dashboard router under /api/dashboard
app.use('/api/dashboard', dashboardRouter);

// Centralised error handling middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    logger.warn('Request payload exceeded size limit', {
      error: err.message,
      limit: err.limit,
      length: err.length,
    });
    res.status(413).json({
      error: 'Payload Too Large',
      message:
        'Request payload exceeds the maximum allowed limit (5 MB). For odometer photos, multipart/form-data is recommended.',
    });
    return;
  }

  logger.error('Unhandled request error', {
    error: err?.message ?? String(err),
    stack: err?.stack,
  });
  res.status(err?.status || 500).json({
    error: err?.message || 'Internal Server Error',
  });
});

const server = app.listen(port, () => {
  logger.info(`Server is running at http://localhost:${port}`);
  logger.info(`API Documentation available at http://localhost:${port}/docs`);
});

// Graceful shutdown
const shutdown = async () => {
  logger.info('Shutting down server...');
  server.close(async () => {
    await redisManager.quit();
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

