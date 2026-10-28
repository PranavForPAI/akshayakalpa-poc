import { useMemo } from 'react';
import { useDashboardStore } from '../store/useDashboardStore';
import { useTripPoints } from '../hooks/useTripPoints';
import { useTripProcessed } from '../hooks/useTripProcessed';
import { TripMap } from './TripMap';
import { PointCard } from './PointCard';
import { ExportButton } from './ExportButton';
import type { PlottablePoint, TripPoint } from '../types';

const isPlottable = (p: TripPoint): p is PlottablePoint =>
  p.latitude !== null && p.longitude !== null;

export function TripDetail() {
  const { selectedTripId: tripId, viewMode, setViewMode, fallbackNotice } = useDashboardStore();
  const rawQuery = useTripPoints(tripId);
  const processedQuery = useTripProcessed(tripId);

  const plottable = useMemo(
    () => (rawQuery.data?.points ?? []).filter(isPlottable),
    [rawQuery.data]
  );

  return (
    <div className="detail">
      {/* 1. OpenStreetMap fallback statement banner placed at the very top */}
      {fallbackNotice && (
        <div className="fallback-statement-banner" role="alert">
          <span className="statement-icon">ℹ️</span>
          <span className="statement-body">
            <strong>OpenStreetMap Engine Active:</strong> Mappls Web Maps API was unavailable or timed out; rendering with OpenStreetMap vector tiles.
          </span>
        </div>
      )}

      {/* 2. Top Header Bar with Trip ID, View Toggle, and Export */}
      <header className="detail-head">
        <div className="detail-info">
          <h2>{tripId ?? 'No trip selected'}</h2>
          <span className="muted small">
            {!tripId
              ? 'Select a ride from the list on the left to inspect its trajectory and smoothing statistics'
              : rawQuery.isLoading
              ? 'Loading raw GPS trajectory…'
              : rawQuery.isError
              ? `Failed to load points: ${rawQuery.error.message}`
              : `${plottable.length} raw points plotted`}
          </span>
        </div>

        {tripId && (
          <div className="detail-actions">
            {/* View Mode Toggle at the top of the map */}
            <div className="view-mode-toggle" role="group" aria-label="Map view mode">
              <button
                type="button"
                className={`toggle-option ${viewMode === 'original' ? 'active' : ''}`}
                onClick={() => setViewMode('original')}
                title="View original raw GPS telemetry with zigzag noise"
              >
                📍 Original (Raw)
              </button>
              <button
                type="button"
                className={`toggle-option ${viewMode === 'improved' ? 'active' : ''}`}
                onClick={() => setViewMode('improved')}
                title="View Kalman-smoothed trajectory with clustered stops"
              >
                ✨ Improved (Smoothed)
              </button>
              <button
                type="button"
                className={`toggle-option ${viewMode === 'compare' ? 'active' : ''}`}
                onClick={() => setViewMode('compare')}
                title="Overlay original and improved tracks simultaneously"
              >
                🔀 Compare Both
              </button>
            </div>

            <ExportButton tripId={tripId} disabled={!rawQuery.data?.count || rawQuery.isLoading} />
          </div>
        )}
      </header>

      {/* 3. Map Viewport & Foreground Point Card Overlay */}
      <div className="map-wrap">
        <TripMap
          rawPoints={plottable}
          processedData={processedQuery.data}
          viewMode={viewMode}
        />
        {plottable.length > 0 && <PointCard points={plottable} />}
      </div>
    </div>
  );
}
