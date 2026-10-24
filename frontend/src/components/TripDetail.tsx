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

  if (!tripId) {
    return (
      <div className="detail">
        <header className="detail-head">
          <div>
            <h2 className="muted" style={{ fontWeight: 500 }}>No ride selected</h2>
            <span className="muted small">Select a ride from the list to view its route on the map</span>
          </div>
        </header>
        <div className="map-wrap">
          <TripMap points={[]} />
        </div>
      </div>
    );
  }

  const skipped = (data?.count ?? 0) - plottable.length;

  return (
    <div className="detail">
      <header className="detail-head">
        <div>
          <h2>{tripId}</h2>
          <span className="muted small">
            {isLoading
              ? 'Loading points…'
              : isError
              ? `Failed to load points: ${error.message}`
              : `${plottable.length} plotted${skipped > 0 ? ` · ${skipped} without GPS fix` : ''}`}
          </span>
        </div>
        <ExportButton tripId={tripId} disabled={!data?.count || isLoading} />
      </header>
      <div className="map-wrap">
        <TripMap points={plottable} />
        {plottable.length > 0 && <PointCard points={plottable} />}
      </div>
    </div>
  );
}
