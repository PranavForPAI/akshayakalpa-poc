# Trip Dashboard (frontend)

React + TypeScript + Vite, Zustand (UI state), TanStack Query (API calls), Mappls (MapmyIndia) Web SDK for the map.

## Run

```bash
cp .env.example .env   # set VITE_MAPPLS_KEY
npm install
npm run dev            # http://localhost:5173, proxies /api -> http://localhost:3000
```

`VITE_PROXY_TARGET` changes the dev proxy target; `VITE_API_BASE_URL` sets an absolute API base for deployed builds.

## API contract the UI expects

All under `/api/dashboard`; types live in `src/types.ts`.

| Endpoint | Response |
|---|---|
| `GET /trips?page&pageSize&status&search` | `{ items: Trip[], page, pageSize, total }` (newest first) |
| `GET /trips/:tripId/points` | `{ trip_id, count, points: TripPoint[] }` ordered by `deviceTime` |
| `GET /trips/:tripId/export` | `{ exported_at, trip, point_count, points }` (JSON) |

Points with null `latitude`/`longitude` are not plotted but are kept in the export.
Errors are expected as `{ "error": "message" }` with a non-2xx status.
