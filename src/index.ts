import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { frappeRouter } from './routes/frappe.routes.js';
import { createSwaggerRouter } from './docs/swagger.js';
import { httpLogger } from './middlewares/http-logger.middleware.js';
import logger from './logger.js';
import { redisManager } from './redis.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(httpLogger);

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
