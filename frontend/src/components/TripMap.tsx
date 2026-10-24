/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { loadMappls, type MapplsSdk } from '../lib/mappls';
import { useDashboardStore } from '../store/useDashboardStore';
import type { PlottablePoint } from '../types';

const MAP_ID = 'trip-map';
const DEFAULT_CENTER = { lat: 12.9716, lng: 77.5946 };

const dot = (color: string, size: number) =>
  `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.5);cursor:pointer"></div>`;

export function TripMap({ points }: { points: PlottablePoint[] }) {
  const [engine, setEngine] = useState<'mappls' | 'leaflet' | null>(null);
  const [mapplsSdk, setMapplsSdk] = useState<MapplsSdk | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const mapInstanceRef = useRef<any>(null);
  const layersRef = useRef<any[]>([]);
  const leafletLayerGroupRef = useRef<L.LayerGroup | null>(null);

  const { selectPoint, hoverPoint } = useDashboardStore.getState();

  // 1. Attempt to load Mappls SDK. If it fails (e.g. 401 Client Credentials Expired), fallback to Leaflet / OpenStreetMap.
  useEffect(() => {
    let cancelled = false;

    loadMappls()
      .then((sdk) => {
        if (cancelled) return;
        const container = document.getElementById(MAP_ID);
        if (!container) return;
        const map = new sdk.Map(MAP_ID, { center: DEFAULT_CENTER, zoom: 12 });
        mapInstanceRef.current = map;
        setMapplsSdk(sdk);
        setEngine('mappls');
        map.addListener('load', () => !cancelled && setMapReady(true));
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setFallbackReason(err.message);

        const container = document.getElementById(MAP_ID);
        if (!container) return;

        // Clean up any stale DOM inside the map container
        if ((container as any)._leaflet_id) {
          container.innerHTML = '';
        }

        const lmap = L.map(container).setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
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

  // 2. (Re)draw the route whenever the trip's points change or the map becomes ready.
  useEffect(() => {
    if (!mapReady || !mapInstanceRef.current) return;

    if (engine === 'mappls' && mapplsSdk) {
      const map = mapInstanceRef.current;
      layersRef.current.forEach((layer) => mapplsSdk.remove({ map, layer }));
      layersRef.current = [];
      if (points.length === 0) return;

      layersRef.current.push(
        new mapplsSdk.Polyline({
          map,
          path: points.map((p) => ({ lat: p.latitude, lng: p.longitude })),
          strokeColor: '#2563eb',
          strokeOpacity: 0.9,
          strokeWeight: 4,
          fitbounds: true,
        })
      );

      const last = points.length - 1;
      points.forEach((p, i) => {
        const isEnd = i === 0 || i === last;
        const size = isEnd ? 18 : 10;
        const color = i === 0 ? '#16a34a' : i === last ? '#dc2626' : '#2563eb';
        const marker = new mapplsSdk.Marker({
          map,
          position: { lat: p.latitude, lng: p.longitude },
          html: dot(color, size),
          width: size,
          height: size,
          fitbounds: false,
        });
        marker.addListener('click', () => selectPoint(p.id));
        marker.addListener('mouseover', () => hoverPoint(p.id));
        marker.addListener('mouseout', () => hoverPoint(null));
        layersRef.current.push(marker);
      });
    } else if (engine === 'leaflet') {
      const lmap = mapInstanceRef.current as L.Map;
      const group = leafletLayerGroupRef.current;
      if (!group) return;

      group.clearLayers();
      if (points.length === 0) {
        lmap.setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 12);
        return;
      }

      const latLngs: L.LatLngExpression[] = points.map((p) => [p.latitude, p.longitude]);
      const polyline = L.polyline(latLngs, {
        color: '#2563eb',
        weight: 4,
        opacity: 0.9,
      }).addTo(group);

      const last = points.length - 1;
      points.forEach((p, i) => {
        const isEnd = i === 0 || i === last;
        const size = isEnd ? 18 : 10;
        const color = i === 0 ? '#16a34a' : i === last ? '#dc2626' : '#2563eb';

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

      lmap.fitBounds(polyline.getBounds(), { padding: [40, 40] });
    }
  }, [engine, mapplsSdk, mapReady, points, selectPoint, hoverPoint]);

  return (
    <div className="map-container">
      <div id={MAP_ID} className="map" />
      {engine === 'leaflet' && (
        <div
          className="map-fallback-badge"
          title={fallbackReason ?? 'Mappls key invalid/expired — fallback to OpenStreetMap'}
        >
          🗺️ OpenStreetMap fallback (Mappls key: 401 Unauthorized / Expired)
        </div>
      )}
    </div>
  );
}
