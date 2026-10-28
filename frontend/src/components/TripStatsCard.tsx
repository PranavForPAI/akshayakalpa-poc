import { useDashboardStore } from '../store/useDashboardStore';
import { useTripProcessed } from '../hooks/useTripProcessed';
import { formatDateTime } from '../lib/format';
import type { ProcessedStop } from '../types';

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function formatKm(meters: number): string {
  return `${(meters / 1000).toFixed(2)} km`;
}

export function TripStatsCard() {
  const { selectedTripId, selectTrip } = useDashboardStore();
  const { data, isLoading, isError } = useTripProcessed(selectedTripId);

  if (!selectedTripId) return null;

  const summary = data?.summary;
  const stops = data?.stops ?? [];

  const rawM = summary?.distance_raw_filtered_m ?? 0;
  const smoothedM = summary?.distance_smoothed_m ?? 0;
  const savedM = Math.max(0, rawM - smoothedM);
  const savedPct = rawM > 0 ? ((savedM / rawM) * 100).toFixed(1) : '0';

  const totalDwellS = stops.reduce((acc, s) => acc + s.dwell_s, 0);

  return (
    <div className="trip-stats-sidebar">
      <div className="stats-top-bar">
        <button className="back-btn" onClick={() => selectTrip(null)}>
          ← Back to Trips
        </button>
      </div>

      <div className="trip-card-header">
        <div className="trip-id-row">
          <h2 title={selectedTripId}>{selectedTripId}</h2>
        </div>
      </div>

      {isLoading && (
        <div className="stats-loading">
          <div className="spinner-small" />
          <span>Computing smoothed path & stats…</span>
        </div>
      )}

      {isError && (
        <div className="stats-notice warning">
          <strong>Reprocessing Pending</strong>
          <p className="small muted">
            This trip has not been run through the smoothing pipeline yet. Run the worker or CLI to view metrics.
          </p>
        </div>
      )}

      {summary && (
        <div className="stats-content">
          {/* Main Distance Comparison Card */}
          <div className="stats-box metric-hero">
            <span className="metric-label">Distance Comparison</span>
            
            <div className="metric-grid">
              <div className="metric-col">
                <span className="sub-label">Original (Raw)</span>
                <span className="metric-val raw">{formatKm(rawM)}</span>
              </div>
              <div className="metric-col">
                <span className="sub-label">Improved (Smoothed)</span>
                <span className="metric-val smoothed">{formatKm(smoothedM)}</span>
              </div>
            </div>

            {savedM > 0 && (
              <div className="savings-badge">
                🎉 Eliminates <strong>{savedM.toFixed(0)} m</strong> ({savedPct}%) of GPS zigzag
              </div>
            )}

            {summary.distance_odometer_m !== null && (
              <div className="odometer-row">
                <span className="sub-label">Odometer Reading:</span>
                <span className="odo-val">
                  {formatKm(summary.distance_odometer_m)}{' '}
                  {summary.error_odometer_pct !== null && (
                    <span className="odo-err">
                      ({summary.error_odometer_pct.toFixed(1)}% error)
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>

          {/* Stops & Dwell Card */}
          <div className="stats-box">
            <div className="box-title-row">
              <span className="metric-label">Premise Stops</span>
              <span className="badge done">{stops.length} detected</span>
            </div>
            
            {stops.length === 0 ? (
              <p className="small muted">No stationary dwell stops detected on this trip.</p>
            ) : (
              <>
                <div className="dwell-total">
                  Total Dwell Duration: <strong>{formatDuration(totalDwellS)}</strong>
                </div>
                <div className="stops-scroll-list">
                  {stops.map((s: ProcessedStop, idx: number) => (
                    <div key={idx} className="stop-item">
                      <div className="stop-item-head">
                        <span className="stop-num">Stop #{idx + 1}</span>
                        <span className="stop-dwell">{formatDuration(s.dwell_s)}</span>
                      </div>
                      <div className="stop-item-meta small muted">
                        <span>{s.reason === 'geofence' ? '🏛️ Premise' : '📍 Stationary jitter'}</span>
                        <span>{s.absorbed_point_count} absorbed fixes</span>
                      </div>
                      <div className="stop-time small muted">
                        {formatDateTime(s.arrival_ts)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Filtering Diagnostics */}
          <div className="stats-box">
            <span className="metric-label">Data Filtering</span>
            <div className="diag-grid small">
              <div className="diag-row">
                <span className="muted">Total GPS Pings:</span>
                <strong>{summary.n_raw}</strong>
              </div>
              <div className="diag-row">
                <span className="muted">Stationary Absorbed:</span>
                <strong>{summary.n_stop_points}</strong>
              </div>
              <div className="diag-row">
                <span className="muted">80m Spikes Gated:</span>
                <strong>{summary.n_rejected}</strong>
              </div>
              <div className="diag-row">
                <span className="muted">Independent Chunks:</span>
                <strong>{summary.n_chunks}</strong>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
