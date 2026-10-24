// Minimal typings for the parts of the Mappls (MapmyIndia) Web SDK we use.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface MapplsLatLng {
  lat: number;
  lng: number;
}

export interface MapplsSdk {
  Map: new (el: string | HTMLElement, opts: Record<string, unknown>) => any;
  Marker: new (opts: Record<string, unknown>) => any;
  Polyline: new (opts: Record<string, unknown>) => any;
  remove: (opts: { map: any; layer: any }) => void;
}

declare global {
  interface Window {
    mappls?: MapplsSdk;
  }
}

let loader: Promise<MapplsSdk> | null = null;

/** Loads the Mappls Web SDK once and resolves with the global `mappls` object. */
export function loadMappls(): Promise<MapplsSdk> {
  if (window.mappls) return Promise.resolve(window.mappls);
  if (loader) return loader;

  const key = import.meta.env.VITE_MAPPLS_KEY;
  if (!key) return Promise.reject(new Error('VITE_MAPPLS_KEY is not set'));

  loader = new Promise<MapplsSdk>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://apis.mappls.com/advancedmaps/api/${key}/map_sdk?layer=vector&v=3.0`;
    script.async = true;
    script.onload = () =>
      window.mappls ? resolve(window.mappls) : reject(new Error('Mappls SDK loaded but unavailable'));
    script.onerror = () => {
      loader = null;
      reject(new Error('Failed to load Mappls SDK — check VITE_MAPPLS_KEY and network'));
    };
    document.head.appendChild(script);
  });
  return loader;
}
