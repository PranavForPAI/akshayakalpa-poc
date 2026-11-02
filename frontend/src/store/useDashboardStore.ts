import { create } from 'zustand';
import type { TripStatus, ViewMode } from '../types';

interface DashboardState {
  selectedTripId: string | null;
  /** Pinned by click — stays visible until dismissed or another point/trip is chosen */
  selectedPointId: number | null;
  /** Transient preview while hovering a marker */
  hoveredPointId: number | null;
  search: string;
  status: TripStatus | undefined;
  page: number;
  viewMode: ViewMode;
  /** Draw every raw GPS fix as a dot on the raw path (off: line + start/end markers only) */
  showRawPoints: boolean;
  fallbackNotice: string | null;

  selectTrip: (tripId: string | null) => void;
  selectPoint: (pointId: number | null) => void;
  hoverPoint: (pointId: number | null) => void;
  setSearch: (search: string) => void;
  setStatus: (status: TripStatus | undefined) => void;
  setPage: (page: number) => void;
  setViewMode: (viewMode: ViewMode) => void;
  setShowRawPoints: (show: boolean) => void;
  setFallbackNotice: (notice: string | null) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  selectedTripId: null,
  selectedPointId: null,
  hoveredPointId: null,
  search: '',
  status: undefined,
  page: 1,
  viewMode: 'improved',
  showRawPoints: false,
  fallbackNotice: null,

  selectTrip: (selectedTripId) =>
    set({ selectedTripId, selectedPointId: null, hoveredPointId: null }),
  selectPoint: (selectedPointId) => set({ selectedPointId }),
  hoverPoint: (hoveredPointId) => set({ hoveredPointId }),
  setSearch: (search) => set({ search, page: 1 }),
  setStatus: (status) => set({ status, page: 1 }),
  setPage: (page) => set({ page }),
  setViewMode: (viewMode) => set({ viewMode }),
  // Hiding the dots also clears any pinned/hovered point, whose marker would no longer be visible
  setShowRawPoints: (showRawPoints) =>
    set(showRawPoints ? { showRawPoints } : { showRawPoints, selectedPointId: null, hoveredPointId: null }),
  setFallbackNotice: (fallbackNotice) => set({ fallbackNotice }),
}));

