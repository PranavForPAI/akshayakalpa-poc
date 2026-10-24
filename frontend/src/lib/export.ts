import { fetchTripExport } from '../api/trips';

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Fetches every point + metadata for the trip and saves it as a JSON file. */
export async function exportTripJson(tripId: string): Promise<void> {
  const payload = await fetchTripExport(tripId);
  downloadJson(`${tripId}-points.json`, payload);
}
