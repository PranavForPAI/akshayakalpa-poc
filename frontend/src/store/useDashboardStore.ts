import { create } from 'zustand';
import type { TripStatus } from '../types';

interface DashboardState {
  selectedTripId: string | null;
  /** Pinned by click — stays visible until dismissed or another point/trip is chosen */
  selectedPointId: number | null;
  /** Transient preview while hovering a marker */
  hoveredPointId: number | null;
  search: string;
  status: TripStatus | undefined;
  page: number;

  selectTrip: (tripId: string | null) => void;
  selectPoint: (pointId: number | null) => void;
  hoverPoint: (pointId: number | null) => void;
  setSearch: (search: string) => void;
  setStatus: (status: TripStatus | undefined) => void;
  setPage: (page: number) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  selectedTripId: null,
  selectedPointId: null,
  hoveredPointId: null,
  search: '',
  status: undefined,
  page: 1,

  selectTrip: (selectedTripId) => set({ selectedTripId, selectedPointId: null, hoveredPointId: null }),
  selectPoint: (selectedPointId) => set({ selectedPointId }),
  hoverPoint: (hoveredPointId) => set({ hoveredPointId }),
  setSearch: (search) => set({ search, page: 1 }),
  setStatus: (status) => set({ status, page: 1 }),
  setPage: (page) => set({ page }),
}));
