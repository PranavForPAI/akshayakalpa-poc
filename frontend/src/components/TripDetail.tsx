import { useMemo } from 'react';
import { useDashboardStore } from '../store/useDashboardStore';
import { useTripPoints } from '../hooks/useTripPoints';
import { TripMap } from './TripMap';
import { PointCard } from './PointCard';
import { ExportButton } from './ExportButton';
import type { PlottablePoint, TripPoint } from '../types';

const isPlottable = (p: TripPoint): p is PlottablePoint => p.latitude !== null && p.longitude !== null;

export function TripDetail() {
  const tripId = useDashboardStore((s) => s.selectedTripId);
  const { data, isLoading, isError, error } = useTripPoints(tripId);

  const plottable = useMemo(() => (data?.points ?? []).filter(isPlottable), [data]);

  if (!tripId) return <div className="empty muted">Select a trip to see it on the map.</div>;
  if (isLoading) return <div className="empty muted">Loading points…</div>;
  if (isError) return <div className="empty error">Failed to load points: {error.message}</div>;

  const skipped = (data?.count ?? 0) - plottable.length;

  return (
    <div className="detail">
      <header className="detail-head">
        <div>
          <h2>{tripId}</h2>
          <span className="muted small">
            {plottable.length} plotted
            {skipped > 0 && ` · ${skipped} without GPS fix`}
          </span>
        </div>
        <ExportButton tripId={tripId} disabled={!data?.count} />
      </header>
      <div className="map-wrap">
        <TripMap points={plottable} />
        <PointCard points={plottable} />
      </div>
    </div>
  );
}
