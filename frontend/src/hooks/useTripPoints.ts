import { useQuery } from '@tanstack/react-query';
import { fetchTripPoints } from '../api/trips';

export const useTripPoints = (tripId: string | null) =>
  useQuery({
    queryKey: ['trip-points', tripId],
    queryFn: () => fetchTripPoints(tripId!),
    enabled: !!tripId,
  });
