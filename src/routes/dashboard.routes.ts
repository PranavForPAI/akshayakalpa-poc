import { Router } from 'express';
import { dashboardController } from '../controllers/dashboard.controller.js';

export const dashboardRouter = Router();

/**
 * GET /api/dashboard/trips
 * Lists paginated trips with filter by status and text search.
 */
dashboardRouter.get('/trips', dashboardController.getTrips);

/**
 * GET /api/dashboard/trips/:tripId/points
 * Returns all coordinates and metadata for a specific trip.
 */
dashboardRouter.get('/trips/:tripId/points', dashboardController.getTripPoints);

/**
 * GET /api/dashboard/trips/:tripId/export
 * Dumps complete trip info and point data for JSON file download.
 */
dashboardRouter.get('/trips/:tripId/export', dashboardController.getTripExport);

export default dashboardRouter;
