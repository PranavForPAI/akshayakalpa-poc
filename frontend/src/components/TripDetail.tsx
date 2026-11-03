import { useMemo } from 'react';
import { useDashboardStore } from '../store/useDashboardStore';
import { useTripPoints } from '../hooks/useTripPoints';
import { useTripProcessed } from '../hooks/useTripProcessed';
import { TripMap, MATCHED_COLOR, UNMATCHED_COLOR, RTS_COLOR, KALMAN_COLOR, RAW_COMPARE_COLOR, hasKalmanPath } from './TripMap';
import { hasMatchResult } from '../lib/matching';
import { PointCard } from './PointCard';
import { ExportButton } from './ExportButton';
import type { PlottablePoint, TripPoint } from '../types';

const isPlottable = (p: TripPoint): p is PlottablePoint =>
  p.latitude !== null && p.longitude !== null;

export function TripDetail() {
  const { selectedTripId: tripId, viewMode, setViewMode, showRawPoints, setShowRawPoints, fallbackNotice } =
    useDashboardStore();
  const rawQuery = useTripPoints(tripId);
  const processedQuery = useTripProcessed(tripId);

  const plottable = useMemo(
    () => (rawQuery.data?.points ?? []).filter(isPlottable),
    [rawQuery.data]
  );

  const canShowMatched = hasMatchResult(processedQuery.data);
  const canShowKalman = hasKalmanPath(processedQuery.data);
  // A trip without match results / Kalman data falls back to the RTS view instead of an empty map
  const effectiveViewMode =
    (viewMode === 'matched' && !canShowMatched) || (viewMode === 'kalman' && !canShowKalman) ? 'improved' : viewMode;
  const rawPathVisible = effectiveViewMode === 'original' || effectiveViewMode === 'compare';
  const matchedTitle = canShowMatched
    ? 'View road-snapped (OSRM map-matched) path; unmatched stretches keep the smoothed path'
    : processedQuery.isLoading
    ? 'Loading processed data…'
    : `Not map-matched yet. Run: npm run match-trip -- ${tripId ?? '<tripId>'}`;

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
                className={`toggle-option ${effectiveViewMode === 'kalman' ? 'active' : ''}`}
                onClick={() => setViewMode('kalman')}
                disabled={!canShowKalman}
                aria-disabled={!canShowKalman}
                title={
                  canShowKalman
                    ? 'Forward-only Kalman filter: each point uses only the fixes up to that moment (what a live tracker would show)'
                    : `No Kalman data stored for this trip yet. Reprocess it: npm run match-trip -- ${tripId ?? '<tripId>'} (or reprocess-trip + worker)`
                }
              >
                〰️ Kalman
              </button>
              <button
                type="button"
                className={`toggle-option ${effectiveViewMode === 'improved' ? 'active' : ''}`}
                onClick={() => setViewMode('improved')}
                title="Kalman + RTS backward smoother: each point also uses the fixes after it (best for finished trips)"
              >
                ✨ Improved (RTS)
              </button>
              <button
                type="button"
                className={`toggle-option ${effectiveViewMode === 'matched' ? 'active' : ''}`}
                onClick={() => setViewMode('matched')}
                disabled={!canShowMatched}
                aria-disabled={!canShowMatched}
                title={matchedTitle}
              >
                🛣️ Matched (Road)
              </button>
              <button
                type="button"
                className={`toggle-option ${viewMode === 'compare' ? 'active' : ''}`}
                onClick={() => setViewMode('compare')}
                title="Overlay raw, Kalman-only and RTS-smoothed tracks"
              >
                🔀 Compare
              </button>
            </div>

            <div className="view-mode-toggle" role="group" aria-label="Raw GPS points">
              <button
                type="button"
                className={`toggle-option ${showRawPoints && rawPathVisible ? 'active' : ''}`}
                onClick={() => setShowRawPoints(!showRawPoints)}
                disabled={!rawPathVisible}
                aria-pressed={showRawPoints}
                title={
                  rawPathVisible
                    ? showRawPoints
                      ? 'Hide individual GPS fixes (show the path line only)'
                      : 'Show every raw GPS fix as a dot on the raw path'
                    : 'Switch to Original or Compare to see the raw GPS points'
                }
              >
                • {showRawPoints ? 'Hide points' : 'Show points'}
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
          viewMode={effectiveViewMode}
          showRawPoints={showRawPoints}
        />
        {effectiveViewMode === 'matched' && (
          <div className="map-legend" aria-label="Matched view legend">
            <div className="legend-row">
              <span className="legend-swatch" style={{ background: MATCHED_COLOR }} />
              Road-matched
            </div>
            <div className="legend-row">
              <span className="legend-swatch dashed" style={{ borderColor: UNMATCHED_COLOR }} />
              Not matched (smoothed path kept)
            </div>
            <div className="legend-hint">Hover a segment for details</div>
          </div>
        )}
        {(effectiveViewMode === 'compare' || effectiveViewMode === 'kalman' || effectiveViewMode === 'improved') && (
          <div className="map-legend" aria-label="Smoothing legend">
            {effectiveViewMode === 'compare' && (
              <div className="legend-row">
                <span className="legend-swatch dashed" style={{ borderColor: RAW_COMPARE_COLOR }} />
                Raw GPS
              </div>
            )}
            {(effectiveViewMode === 'kalman' || (effectiveViewMode === 'compare' && canShowKalman)) && (
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: KALMAN_COLOR }} />
                Kalman (forward only)
              </div>
            )}
            {effectiveViewMode !== 'kalman' && (
              <div className="legend-row">
                <span className="legend-swatch" style={{ background: RTS_COLOR }} />
                RTS smoothed (Kalman + backward pass)
              </div>
            )}
            <div className="legend-row">
              <span className="legend-swatch dotted" style={{ borderColor: '#64748b' }} />
              GPS gap (no fixes, straight line)
            </div>
            <div className="legend-row">
              <span className="legend-dot" />
              Averaged low-accuracy fixes
            </div>
          </div>
        )}
        {plottable.length > 0 && <PointCard points={plottable} />}
      </div>
    </div>
  );
}
