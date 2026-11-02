/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { mapplsSdk, initMappls } from '../lib/mappls';
import { useDashboardStore } from '../store/useDashboardStore';
import type { PlottablePoint, ProcessedSegment, TripProcessedResponse, ViewMode } from '../types';
import { rejectReasonLabel } from '../lib/matching';

const MAP_ID = 'trip-map';
const DEFAULT_CENTER: [number, number] = [12.9716, 77.5946];

const dot = (color: string, size: number) =>
  `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.5);cursor:pointer"></div>`;

const stopBadge = (label: string) =>
  `<div style="background:#d97706;color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);cursor:pointer" title="Stop: ${label}">🛑</div>`;

const escapeHtml = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const timeRange = (seg: ProcessedSegment) => {
  const f = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${f(seg.start_ts)} – ${f(seg.end_ts)}`;
};

/** Map colours for the matched view (kept distinct from raw blue and smoothed emerald). */
export const MATCHED_COLOR = '#7c3aed';
export const UNMATCHED_COLOR = '#059669';
const MATCHED_CONNECTOR_COLOR = '#64748b';

interface TripMapProps {
  rawPoints: PlottablePoint[];
  processedData?: TripProcessedResponse | null;
  viewMode?: ViewMode;
  /** Draw each raw GPS fix as a dot (default: path line with start/end markers only) */
  showRawPoints?: boolean;
  onEngineChange?: (engine: 'mappls' | 'leaflet', reason?: string | null) => void;
}

export function TripMap({
  rawPoints,
  processedData,
  viewMode = 'improved',
  showRawPoints = false,
  onEngineChange,
}: TripMapProps) {
  const [engine, setEngine] = useState<'mappls' | 'leaflet' | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const mapInstanceRef = useRef<any>(null);
  const layersRef = useRef<any[]>([]);
  const leafletLayerGroupRef = useRef<L.LayerGroup | null>(null);

  const { selectPoint, hoverPoint, setFallbackNotice } = useDashboardStore.getState();

  // 1. Initialize Map: Tries Mappls Web SDK first; falls back to OpenStreetMap / Leaflet if Mappls fails or times out
  useEffect(() => {
    let cancelled = false;

    initMappls(2500)
      .then(() => {
        if (cancelled) return;
        const container = document.getElementById(MAP_ID);
        if (!container) return;

        const map = mapplsSdk.Map({
          id: MAP_ID,
          properties: {
            center: DEFAULT_CENTER,
            zoom: 12,
            zoomControl: true,
            location: true,
          },
        });

        if (!map) {
          throw new Error('Mappls Map returned null or undefined');
        }

        mapInstanceRef.current = map;
        setEngine('mappls');
        onEngineChange?.('mappls', null);
        setFallbackNotice(null);

        if (typeof map.on === 'function') {
          map.on('load', () => {
            if (!cancelled) setMapReady(true);
          });
        } else {
          setMapReady(true);
        }
      })
      .catch((err: Error) => {
        if (cancelled) return;
        const reason = err.message || 'Mappls key invalid/expired or connection timed out';
        setFallbackNotice(reason);
        onEngineChange?.('leaflet', reason);

        const container = document.getElementById(MAP_ID);
        if (!container) return;

        // Clean up any existing DOM or leaflet instance inside the container
        if ((container as any)._leaflet_id) {
          container.innerHTML = '';
        }

        const lmap = L.map(container, { maxZoom: 22 }).setView(DEFAULT_CENTER, 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 22,
          maxNativeZoom: 19,
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(lmap);

        const group = L.layerGroup().addTo(lmap);
        leafletLayerGroupRef.current = group;
        mapInstanceRef.current = lmap;

        setEngine('leaflet');
        setMapReady(true);
      });

    return () => {
      cancelled = true;
      if (mapInstanceRef.current && typeof mapInstanceRef.current.remove === 'function') {
        mapInstanceRef.current.remove();
      }
      mapInstanceRef.current = null;
    };
  }, []);

  // 2. (Re)draw the route and markers whenever points, processedData, or viewMode change
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;

    if (engine === 'leaflet') {
      const lmap = mapInstanceRef.current as L.Map;
      const group = leafletLayerGroupRef.current;
      if (!group) return;

      group.clearLayers();

      const bounds = L.latLngBounds([]);

      const showRaw = viewMode === 'original' || viewMode === 'compare';
      const showImproved = (viewMode === 'improved' || viewMode === 'compare') && !!processedData;
      const showMatched = viewMode === 'matched' && !!processedData;

      // -------------------------------------------------------------
      // Layer A: Original / Raw Track
      // -------------------------------------------------------------
      if (showRaw && rawPoints.length > 0) {
        const rawLatLngs: L.LatLngExpression[] = rawPoints.map((p) => [p.latitude, p.longitude]);
        rawLatLngs.forEach((ll) => bounds.extend(ll));

        const isCompare = viewMode === 'compare';
        L.polyline(rawLatLngs, {
          color: isCompare ? '#f59e0b' : '#2563eb',
          weight: isCompare ? 3 : 4,
          opacity: isCompare ? 0.65 : 0.9,
          dashArray: isCompare ? '5, 8' : undefined,
        }).addTo(group);

        const last = rawPoints.length - 1;
        rawPoints.forEach((p, i) => {
          const isEnd = i === 0 || i === last;
          // Intermediate fixes are drawn only when "Show points" is on; start/end always are
          if (!isEnd && !showRawPoints) return;
          // In compare mode, draw smaller markers for raw to keep map readable
          const size = isEnd ? 16 : isCompare ? 6 : 10;
          const color = i === 0 ? '#16a34a' : i === last ? '#dc2626' : isCompare ? '#f59e0b' : '#2563eb';

          const icon = L.divIcon({
            className: 'custom-map-marker',
            html: dot(color, size),
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          });

          const marker = L.marker([p.latitude, p.longitude], { icon }).addTo(group);
          marker.on('click', () => selectPoint(p.id));
          marker.on('mouseover', () => hoverPoint(p.id));
          marker.on('mouseout', () => hoverPoint(null));
        });
      }

      // -------------------------------------------------------------
      // Layer B: Improved (smoothed) or Matched (road-snapped) Track + Stops + Connectors
      // -------------------------------------------------------------
      if ((showImproved || showMatched) && processedData) {
        const segments = processedData.segments ?? [];
        const stops = processedData.stops ?? [];
        const smoothedPts = processedData.points ?? [];

        // 1a. Matched view: matcher rows replace the smoothed moving rows (they cover the same path)
        if (showMatched) {
          for (const seg of segments) {
            if (!Array.isArray(seg.coordinates[0])) continue;
            const coords = seg.coordinates as [number, number][];
            const latLngs: L.LatLngExpression[] = coords.map((c) => [c[1], c[0]]);

            if (seg.segment_type === 'matched') {
              latLngs.forEach((ll) => bounds.extend(ll));
              L.polyline(latLngs, { color: MATCHED_COLOR, weight: 5, opacity: 0.95 })
                .bindTooltip(
                  `<strong>Road-matched</strong><br/>Region: ${escapeHtml(seg.region_id ?? '-')}` +
                    `<br/>Confidence: ${(seg.confidence * 100).toFixed(0)}%` +
                    `<br/>Map data: ${escapeHtml(seg.data_version ?? '-')}<br/>${timeRange(seg)}`,
                  { sticky: true }
                )
                .addTo(group);
            } else if (seg.segment_type === 'unmatched') {
              latLngs.forEach((ll) => bounds.extend(ll));
              L.polyline(latLngs, { color: UNMATCHED_COLOR, weight: 4, opacity: 0.85, dashArray: '8, 6' })
                .bindTooltip(
                  `<strong>Not matched – smoothed path kept</strong><br/>${escapeHtml(rejectReasonLabel(seg.reject_reason))}` +
                    (seg.region_id ? `<br/>Region: ${escapeHtml(seg.region_id)}` : '') +
                    `<br/>${timeRange(seg)}`,
                  { sticky: true }
                )
                .addTo(group);
            } else if (seg.segment_type === 'connector') {
              latLngs.forEach((ll) => bounds.extend(ll));
              L.polyline(latLngs, { color: MATCHED_CONNECTOR_COLOR, weight: 2.5, opacity: 0.8, dashArray: '4, 6' }).addTo(group);
            }
          }
        }

        // 1b. Improved view: smoothed moving segments + connectors
        for (const seg of showImproved ? segments : []) {
          if (seg.segment_type === 'moving' && Array.isArray(seg.coordinates[0])) {
            const coords = seg.coordinates as [number, number][];
            const latLngs: L.LatLngExpression[] = coords.map((c) => [c[1], c[0]]);
            latLngs.forEach((ll) => bounds.extend(ll));

            L.polyline(latLngs, {
              color: '#059669', // Emerald
              weight: 5,
              opacity: 0.95,
            }).addTo(group);
          } else if (seg.segment_type === 'connector' && Array.isArray(seg.coordinates[0])) {
            const coords = seg.coordinates as [number, number][];
            const latLngs: L.LatLngExpression[] = coords.map((c) => [c[1], c[0]]);
            latLngs.forEach((ll) => bounds.extend(ll));

            L.polyline(latLngs, {
              color: '#6366f1', // Indigo connector
              weight: 3,
              opacity: 0.85,
              dashArray: '6, 6',
            }).addTo(group);
          }
        }

        // 2. Draw stops with radius circles and stop badges
        stops.forEach((s, idx) => {
          bounds.extend([s.anchor_lat, s.anchor_lon]);

          // Radius bubble
          L.circle([s.anchor_lat, s.anchor_lon], {
            radius: Math.max(10, s.radius_m),
            color: '#d97706',
            fillColor: '#f59e0b',
            fillOpacity: 0.15,
            weight: 1.5,
          }).addTo(group);

          const stopIcon = L.divIcon({
            className: 'custom-map-marker',
            html: stopBadge(String(idx + 1)),
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          });

          const stopMarker = L.marker([s.anchor_lat, s.anchor_lon], { icon: stopIcon }).addTo(group);
          stopMarker.bindTooltip(
            `<strong>Stop #${idx + 1} (${s.reason})</strong><br/>Dwell: ${Math.round(s.dwell_s)}s<br/>${s.absorbed_point_count} absorbed fixes`,
            { direction: 'top', offset: [0, -10] }
          );
        });

        // 3. Draw start & end markers for smoothed trajectory if available
        if (smoothedPts.length > 0) {
          const first = smoothedPts[0];
          const last = smoothedPts[smoothedPts.length - 1];

          const startIcon = L.divIcon({
            className: 'custom-map-marker',
            html: dot('#16a34a', 18),
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          });
          L.marker([first.lat, first.lon], { icon: startIcon }).addTo(group);

          const endIcon = L.divIcon({
            className: 'custom-map-marker',
            html: dot('#dc2626', 18),
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          });
          L.marker([last.lat, last.lon], { icon: endIcon }).addTo(group);
        }
      }

      // If no points plotted at all, center default
      if (bounds.isValid()) {
        lmap.fitBounds(bounds, { padding: [45, 45] });
      } else {
        lmap.setView(DEFAULT_CENTER, 12);
      }
    } else if (engine === 'mappls') {
      const map = mapInstanceRef.current;
      layersRef.current.forEach((layer) => {
        try {
          mapplsSdk.removeLayer({ map, layer });
        } catch {
          /* ignore */
        }
      });
      layersRef.current = [];

      if (rawPoints.length === 0) return;

      try {
        const polyline = mapplsSdk.Polyline({
          map,
          path: rawPoints.map((p) => ({ lat: p.latitude, lng: p.longitude })),
          strokeColor: '#2563eb',
          strokeOpacity: 0.9,
          strokeWeight: 4,
          fitbounds: true,
        });
        if (polyline) layersRef.current.push(polyline);
      } catch (e) {
        console.error('Failed to create Mappls polyline:', e);
      }
    }
  }, [engine, mapReady, rawPoints, processedData, viewMode, showRawPoints, selectPoint, hoverPoint]);

  return (
    <div className="map-container">
      <div id={MAP_ID} className="map" />
    </div>
  );
}
