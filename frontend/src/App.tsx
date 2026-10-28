import { useDashboardStore } from './store/useDashboardStore';
import { TripList } from './components/TripList';
import { TripStatsCard } from './components/TripStatsCard';
import { TripDetail } from './components/TripDetail';

export default function App() {
  const selectedTripId = useDashboardStore((s) => s.selectedTripId);

  return (
    <div className="app">
      <aside className="sidebar">
        <h1 className="brand">Trip Dashboard</h1>
        {selectedTripId ? <TripStatsCard /> : <TripList />}
      </aside>
      <main className="main">
        <TripDetail />
      </main>
    </div>
  );
}

