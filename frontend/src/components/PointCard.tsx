import { useState } from 'react';
import { useDashboardStore } from '../store/useDashboardStore';
import { formatCoord, formatDateTime } from '../lib/format';
import type { PlottablePoint } from '../types';

/** Shows the pinned (clicked) point, falling back to the hovered one as a preview. */
export function PointCard({ points }: { points: PlottablePoint[] }) {
  const { selectedPointId, hoveredPointId, selectPoint } = useDashboardStore();
  const [copied, setCopied] = useState(false);

  const pinned = selectedPointId !== null;
  const id = selectedPointId ?? hoveredPointId;
  const point = id === null ? undefined : points.find((p) => p.id === id);
  if (!point) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(point, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="point-card">
      <div className="point-card-head">
        <strong>Point #{point.sequence}</strong>
        <span className="muted small">{pinned ? 'pinned' : 'preview'}</span>
        {pinned && (
          <button className="icon" aria-label="Close" onClick={() => selectPoint(null)}>
            ×
          </button>
        )}
      </div>
      <dl>
        <dt>Time</dt>
        <dd>{formatDateTime(point.deviceTime)}</dd>
        <dt>Latitude</dt>
        <dd>{formatCoord(point.latitude)}</dd>
        <dt>Longitude</dt>
        <dd>{formatCoord(point.longitude)}</dd>
        {point.speedKph !== null && (
          <>
            <dt>Speed</dt>
            <dd>{point.speedKph} km/h</dd>
          </>
        )}
        {point.accuracyMeters !== null && (
          <>
            <dt>Accuracy</dt>
            <dd>{point.accuracyMeters} m</dd>
          </>
        )}
      </dl>
      <button onClick={copy}>{copied ? 'Copied ✓' : 'Copy metadata (JSON)'}</button>
    </div>
  );
}
