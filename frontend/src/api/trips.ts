import { apiGet } from './client';
import type { Paginated, Trip, TripExport, TripFilters, TripPointsResponse } from '../types';

const BASE = '/api/dashboard/trips';

export const fetchTrips = (filters: TripFilters) =>
  apiGet<Paginated<Trip>>(BASE, { ...filters });

export const fetchTripPoints = (tripId: string) =>
  apiGet<TripPointsResponse>(`${BASE}/${encodeURIComponent(tripId)}/points`);

export const fetchTripExport = (tripId: string) =>
  apiGet<TripExport>(`${BASE}/${encodeURIComponent(tripId)}/export`);
