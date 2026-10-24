/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { loadMappls, type MapplsSdk } from '../lib/mappls';
import { useDashboardStore } from '../store/useDashboardStore';
import type { PlottablePoint } from '../types';

const MAP_ID = 'trip-map';
const DEFAULT_CENTER = { lat: 12.9716, lng: 77.5946 };

const dot = (color: string, size: number) =>
  `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.5);cursor:pointer"></div>`;

export function TripMap({ points }: { points: PlottablePoint[] }) {
  const [sdk, setSdk] = useState<MapplsSdk | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<any>(null);
  const layersRef = useRef<any[]>([]);
  const { selectPoint, hoverPoint } = useDashboardStore.getState();

  // 1. Load the SDK and create the map once.
  useEffect(() => {
    let cancelled = false;
    loadMappls()
      .then((mappls) => {
        if (cancelled) return;
        const map = new mappls.Map(MAP_ID, { center: DEFAULT_CENTER, zoom: 12 });
        mapRef.current = map;
        setSdk(mappls);
        map.addListener('load', () => !cancelled && setMapReady(true));
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. (Re)draw the route whenever the trip's points change.
  useEffect(() => {
    if (!sdk || !mapReady) return;
    const map = mapRef.current;

    layersRef.current.forEach((layer) => sdk.remove({ map, layer }));
    layersRef.current = [];
    if (points.length === 0) return;

    layersRef.current.push(
      new sdk.Polyline({
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
      const marker = new sdk.Marker({
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
  }, [sdk, mapReady, points, selectPoint, hoverPoint]);

  return (
    <div className="map-container">
      <div id={MAP_ID} className="map" />
      {loadError && <div className="map-error error">{loadError}</div>}
    </div>
  );
}
