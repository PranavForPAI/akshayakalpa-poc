import { useTrips } from '../hooks/useTrips';
import { useDashboardStore } from '../store/useDashboardStore';
import { TripListItem } from './TripListItem';
import type { TripStatus } from '../types';

const PAGE_SIZE = 20;

export function TripList() {
  const { search, status, page, selectedTripId, setSearch, setStatus, setPage, selectTrip } =
    useDashboardStore();
  const { data, isLoading, isError, error, isFetching } = useTrips({
    page,
    pageSize: PAGE_SIZE,
    status,
    search: search || undefined,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="trip-list">
      <div className="filters">
        <input
          type="search"
          placeholder="Search trip, driver, vehicle…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={status ?? ''}
          onChange={(e) => setStatus((e.target.value || undefined) as TripStatus | undefined)}
        >
          <option value="">All statuses</option>
          <option value="In Transit">In Transit</option>
          <option value="Completed">Completed</option>
        </select>
      </div>

      {isLoading && <p className="muted pad">Loading trips…</p>}
      {isError && <p className="error pad">Failed to load trips: {error.message}</p>}
      {data && data.items.length === 0 && <p className="muted pad">No trips found.</p>}

      <ul className={isFetching ? 'items fetching' : 'items'}>
        {data?.items.map((trip) => (
          <TripListItem
            key={trip.trip_id}
            trip={trip}
            selected={trip.trip_id === selectedTripId}
            onSelect={() => selectTrip(trip.trip_id)}
          />
        ))}
      </ul>

      {data && data.total > data.pageSize && (
        <div className="pager">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Prev
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </section>
  );
}
