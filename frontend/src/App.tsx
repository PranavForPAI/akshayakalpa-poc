import { TripList } from './components/TripList';
import { TripDetail } from './components/TripDetail';

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <h1 className="brand">Trip Dashboard</h1>
        <TripList />
      </aside>
      <main className="main">
        <TripDetail />
      </main>
    </div>
  );
}
