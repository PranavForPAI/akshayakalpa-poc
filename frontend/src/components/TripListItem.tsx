import { memo } from 'react';
import { formatDateTime } from '../lib/format';
import type { Trip } from '../types';

interface Props {
  trip: Trip;
  selected: boolean;
  onSelect: () => void;
}

export const TripListItem = memo(function TripListItem({ trip, selected, onSelect }: Props) {
  return (
    <li>
      <button className={selected ? 'trip selected' : 'trip'} onClick={onSelect}>
        <div className="trip-head">
          <strong>{trip.trip_id}</strong>
          <span className={`badge ${trip.status === 'Completed' ? 'done' : 'live'}`}>{trip.status}</span>
        </div>
        <div className="muted small">
          {trip.vehicle ?? '—'} · {trip.driver ?? '—'}
        </div>
        <div className="muted small">{formatDateTime(trip.started_at)}</div>
        <div className="muted small">{trip.point_count} points</div>
      </button>
    </li>
  );
});
