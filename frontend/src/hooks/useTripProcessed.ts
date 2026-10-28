import { useQuery } from '@tanstack/react-query';
import { fetchTripProcessed } from '../api/trips';

export const useTripProcessed = (tripId: string | null, version?: string) =>
  useQuery({
    queryKey: ['trip-processed', tripId, version],
    queryFn: () => fetchTripProcessed(tripId!, version),
    enabled: !!tripId,
    retry: 1,
  });
