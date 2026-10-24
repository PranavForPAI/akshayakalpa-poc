import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchTrips } from '../api/trips';
import type { TripFilters } from '../types';

export const useTrips = (filters: TripFilters) =>
  useQuery({
    queryKey: ['trips', filters],
    queryFn: () => fetchTrips(filters),
    placeholderData: keepPreviousData,
  });
