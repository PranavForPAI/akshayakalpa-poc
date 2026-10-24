import { Request, Response } from 'express';
import prisma from '../db/prisma.js';
import logger from '../logger.js';
import type { Prisma } from '@prisma/client';

export class DashboardController {
  /**
   * GET /api/dashboard/trips
   * Paginated list of trips with filtering by status and search keyword.
   */
  getTrips = async (req: Request, res: Response): Promise<void> => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string, 10) || 20));
      const status =
        typeof req.query.status === 'string' && req.query.status !== ''
          ? req.query.status
          : undefined;
      const search =
        typeof req.query.search === 'string' && req.query.search.trim() !== ''
          ? req.query.search.trim()
          : undefined;

      const where: Prisma.TripWhereInput = {};

      if (status) {
        where.status = status;
      }

      if (search) {
        where.OR = [
          { tripId: { contains: search, mode: 'insensitive' } },
          { driver: { contains: search, mode: 'insensitive' } },
          { vehicle: { contains: search, mode: 'insensitive' } },
          { route: { contains: search, mode: 'insensitive' } },
          { deviceId: { contains: search, mode: 'insensitive' } },
        ];
      }

      const skip = (page - 1) * pageSize;

      const [total, trips] = await Promise.all([
        prisma.trip.count({ where }),
        prisma.trip.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { startedAt: 'desc' },
          include: {
            deviceKey: {
              select: { deviceName: true },
            },
            _count: {
              select: { coordinates: true },
            },
          },
        }),
      ]);

      const items = trips.map((t) => ({
        trip_id: t.tripId,
        status: t.status,
        driver: t.driver ?? null,
        vehicle: t.vehicle ?? null,
        route: t.route ?? null,
        device: t.deviceKey?.deviceName ?? null,
        device_id: t.deviceId,
        assignment: t.assignment ?? null,
        started_at: t.startedAt ? t.startedAt.toISOString() : null,
        stopped_at: t.stoppedAt ? t.stoppedAt.toISOString() : null,
        point_count: t._count.coordinates,
      }));

      res.status(200).json({
        items,
        page,
        pageSize,
        total,
      });
    } catch (err: any) {
      logger.error('DashboardController.getTrips failed', {
        error: err?.message ?? String(err),
      });
      res.status(500).json({ error: 'Failed to retrieve trips' });
    }
  };

  /**
   * GET /api/dashboard/trips/:tripId/points
   * Returns all recorded coordinates and metadata for a specific trip, ordered chronologically.
   */
  getTripPoints = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tripId } = req.params;

      const trip = await prisma.trip.findUnique({
        where: { tripId },
      });

      if (!trip) {
        res.status(404).json({ error: `Trip '${tripId}' not found` });
        return;
      }

      const coordinates = await prisma.coordinate.findMany({
        where: { tripId },
        orderBy: [
          { deviceTime: 'asc' },
          { id: 'asc' },
        ],
      });

      const points = coordinates.map((c, index) => ({
        id: c.id,
        tripId: c.tripId,
        deviceId: c.deviceId,
        sequence: index + 1,
        hasGps: c.hasGps,
        latitude: c.latitude,
        longitude: c.longitude,
        speedKph: c.speedKph,
        headingDegrees: c.headingDegrees,
        accuracyMeters: c.accuracyMeters,
        altitudeMeters: c.altitudeMeters,
        batteryPercent: c.batteryPercent,
        isMock: c.isMock,
        deviceTime: c.deviceTime.toISOString(),
        captureSource: c.captureSource,
        appState: c.appState,
        networkType: c.networkType,
        internetAvailable: c.internetAvailable,
        locationServiceOn: c.locationServiceOn,
        locationPermission: c.locationPermission,
        wasForwarded: c.wasForwarded,
        serverReceivedAt: c.serverReceivedAt.toISOString(),
      }));

      res.status(200).json({
        trip_id: tripId,
        count: points.length,
        points,
      });
    } catch (err: any) {
      logger.error('DashboardController.getTripPoints failed', {
        tripId: req.params.tripId,
        error: err?.message ?? String(err),
      });
      res.status(500).json({ error: 'Failed to retrieve trip points' });
    }
  };

  /**
   * GET /api/dashboard/trips/:tripId/export
   * Full dump of trip details and all coordinates for JSON export.
   */
  getTripExport = async (req: Request, res: Response): Promise<void> => {
    try {
      const { tripId } = req.params;

      const trip = await prisma.trip.findUnique({
        where: { tripId },
        include: {
          deviceKey: {
            select: { deviceName: true },
          },
          _count: {
            select: { coordinates: true },
          },
        },
      });

      if (!trip) {
        res.status(404).json({ error: `Trip '${tripId}' not found` });
        return;
      }

      const coordinates = await prisma.coordinate.findMany({
        where: { tripId },
        orderBy: [
          { deviceTime: 'asc' },
          { id: 'asc' },
        ],
      });

      const formattedTrip = {
        trip_id: trip.tripId,
        status: trip.status,
        driver: trip.driver ?? null,
        vehicle: trip.vehicle ?? null,
        route: trip.route ?? null,
        device: trip.deviceKey?.deviceName ?? null,
        device_id: trip.deviceId,
        assignment: trip.assignment ?? null,
        started_at: trip.startedAt ? trip.startedAt.toISOString() : null,
        stopped_at: trip.stoppedAt ? trip.stoppedAt.toISOString() : null,
        point_count: trip._count.coordinates,
      };

      const points = coordinates.map((c, index) => ({
        id: c.id,
        tripId: c.tripId,
        deviceId: c.deviceId,
        sequence: index + 1,
        hasGps: c.hasGps,
        latitude: c.latitude,
        longitude: c.longitude,
        speedKph: c.speedKph,
        headingDegrees: c.headingDegrees,
        accuracyMeters: c.accuracyMeters,
        altitudeMeters: c.altitudeMeters,
        batteryPercent: c.batteryPercent,
        isMock: c.isMock,
        deviceTime: c.deviceTime.toISOString(),
        captureSource: c.captureSource,
        appState: c.appState,
        networkType: c.networkType,
        internetAvailable: c.internetAvailable,
        locationServiceOn: c.locationServiceOn,
        locationPermission: c.locationPermission,
        wasForwarded: c.wasForwarded,
        serverReceivedAt: c.serverReceivedAt.toISOString(),
      }));

      res.status(200).json({
        exported_at: new Date().toISOString(),
        trip: formattedTrip,
        point_count: points.length,
        points,
      });
    } catch (err: any) {
      logger.error('DashboardController.getTripExport failed', {
        tripId: req.params.tripId,
        error: err?.message ?? String(err),
      });
      res.status(500).json({ error: 'Failed to export trip' });
    }
  };
}

export const dashboardController = new DashboardController();
export default dashboardController;
