import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { runMigrations } from './db/migrate.js';
import { journeyRouter } from './routes/journey.routes.js';
import { createSwaggerRouter } from './docs/swagger.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Interactive Swagger UI & OpenAPI spec
app.use(createSwaggerRouter());

// Mount journeys router under /api as well as root /
app.use('/api', journeyRouter);
app.use('/', journeyRouter);

const startServer = async () => {
  try {
    // Run schema migrations automatically on startup
    await runMigrations();

    app.listen(port, () => {
      console.log(`Server is running at http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Failed to run migrations and start server:', error);
    process.exit(1);
  }
};

startServer();
