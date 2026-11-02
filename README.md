# Akshayakalpa Telemetry & Journey Tracking System

Production-ready integration backend and analytics dashboard for the Akshayakalpa Delivery Management System.

Acts as a high-throughput, non-blocking telemetry proxy between mobile delivery drivers, **Frappe**, and the upstream **telemetry ingestion service**, with an LRU **Redis** key-value store, **PostgreSQL (Prisma ORM)** debug audit persistence, and an interactive **React + Mappls (MapmyIndia)** analytics dashboard.

---

## 🏛️ System Architecture

```
                    Internet (HTTPS)
                           │
                           ▼
          ┌──────────────────────────────────┐
          │     Caddy Web Server / Proxy     │
          │  https://karivena.admin.polynomial.ai
          └────────────────┬─────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
     Path: / (SPA)               Path: /api/*
              │                         │
              ▼                         ▼
   ┌──────────────────────┐  ┌──────────────────────────────────┐
   │    Frontend (PM2)    │  │       Backend (Docker)           │
   │  React + Vite + Mappls│  │      Node.js + Express           │
   │   Port: 5173 (Host)  │  │      Port: 3000 (Docker)         │
   └──────────────────────┘  └──────┬────────────────┬──────────┘
                                    │                │
                                    ▼                ▼
                         ┌────────────────┐   ┌────────────────┐
                         │   PostgreSQL   │   │     Redis      │
                         │    (Prisma)    │   │  (LRU Cache)   │
                         │   Port: 5432   │   │   Port: 6379   │
                         └────────────────┘   └────────────────┘
```

### Components:
* **Backend (`akshayakalpa-backend`)**: Containerized Express/TypeScript service that handles device registration, tracking lifecycle, and telemetry ingest filtering (excludes points lacking GPS fixes before forwarding upstream).
* **Redis (`akshayakalpa-redis`)**: High-speed cache storing device-to-API-key mappings with an automatic Least Recently Used (LRU) sorted-set eviction policy.
* **PostgreSQL (`akshayakalpa-postgres`)**: Stores device keys, delivery trips, and raw coordinate readings with network/sensor metadata (`DEBUG_MODE=true`).
* **Frontend (`akshayakalpa-frontend`)**: React 19 + TypeScript + Vite SPA served via **PM2** displaying live delivery routes, point metadata inspection, and JSON export.
* **Caddy**: Reverse proxy managing SSL/TLS, routing `/api/*` to the backend container and `/` to the frontend.

---

## 📋 Prerequisites

Before setting up the VM or server, ensure you have installed:
* **Docker & Docker Compose** (v24+)
* **Node.js** (v20+ LTS) and **npm**
* **PM2** (`npm install -g pm2`)
* **Caddy Web Server** (`sudo apt install -y caddy` on Debian/Ubuntu)

---

## ⚙️ Environment Configuration

### 1. Backend Environment: `.env`
Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Configure the following variables in `.env`:

```env
PORT=3000

# Redis Cache
REDIS_URL=redis://localhost:6379
REDIS_LRU_CAP=50

# Upstream Frappe Endpoint
FRAPPE_BASE_URL=https://akshayakalpa-pm-test.nvi.frappe.cloud

# PostgreSQL Credentials (pulled automatically by Docker Compose)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=akshayakalpa_db

# Direct connection string for host/local scripts
DATABASE_URL=postgresql://postgres:your_secure_password@localhost:5432/akshayakalpa_db

# Audit Logging (set to true to persist trips & coordinates in Postgres)
DEBUG_MODE=true
```

> **Note**: In Docker Compose, the backend container automatically routes `DATABASE_URL` to the internal `postgres:5432` container and `REDIS_URL` to `redis:6379`.

---

### 2. Frontend Environment: `frontend/.env`
Create a `.env` file in the `frontend` folder:

```bash
cd frontend
cp .env.example .env
```

Configure:

```env
# Mappls (MapmyIndia) Web SDK Key
VITE_MAPPLS_KEY=your_mappls_static_key

# Leave empty for production (Caddy proxies /api directly to the backend)
VITE_API_BASE_URL=
```

---

## 🚀 Step-by-Step Deployment Guide

### Step 1: Start Backend, PostgreSQL & Redis (Docker Compose)

From the project root directory:

```bash
# Build images and start containers in the background
docker compose up -d --build
```

#### What happens automatically on startup:
1. `postgres:16-alpine` and `redis:7-alpine` spin up with healthchecks.
2. `docker-entrypoint.sh` runs inside the backend container and tests the PostgreSQL connection.
3. Once Postgres is ready, it applies pending migrations:
   ```bash
   npx prisma migrate deploy
   ```
   This applies only the committed, not-yet-applied files in `prisma/migrations/`. Existing data is never reset or dropped. If a migration fails, the container stops instead of starting against the wrong schema.
   A database created earlier with `prisma db push` (tables but no `_prisma_migrations` history) is detected and baselined once: `0_init` is marked as applied, and only newer migrations then run.
4. The Node.js production server starts on port `3000` (bound to `127.0.0.1:3000`).

#### Verify backend status:
```bash
# Check container status
docker compose ps

# View backend startup logs
docker compose logs -f backend

# Verify health endpoint
curl http://127.0.0.1:3000/health
```
Expected output:
```json
{"status":"healthy","timestamp":"...","redis":"connected"}
```

---

### Step 2: Build and Deploy the Frontend (PM2)

The frontend is served as a high-performance Single Page Application (SPA) using PM2 on port `5173`.

```bash
cd frontend

# Install frontend dependencies
npm install

# Build production assets into frontend/dist
npm run build

# Start the SPA server with PM2
pm2 start ecosystem.config.cjs

# Save PM2 process list to persist across server reboots
pm2 save
pm2 startup
```

#### Verify frontend status:
```bash
pm2 status
pm2 logs akshayakalpa-frontend
```

---

### Step 3: Configure Caddy Reverse Proxy

A production [`Caddyfile`](Caddyfile) is included in the project root.

1. Copy or link the configuration to `/etc/caddy/Caddyfile`:
   ```bash
   sudo cp Caddyfile /etc/caddy/Caddyfile
   ```

2. The configuration maps:
   * `https://karivena.admin.polynomial.ai/` ➔ Frontend PM2 (`127.0.0.1:5173`)
   * `https://karivena.admin.polynomial.ai/api/*` ➔ Backend Container (`127.0.0.1:3000`)
   * `https://karivena.admin.polynomial.ai/docs*` ➔ Swagger UI (`127.0.0.1:3000`)
   * `https://karivena.admin.polynomial.ai/health` ➔ Health check (`127.0.0.1:3000`)

3. Validate and reload Caddy:
   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```

Caddy will automatically provision and renew trusted SSL/TLS certificates via Let's Encrypt / ZeroSSL.

---

## 🛠️ Local Development (Without Docker)

If you prefer to run services locally during development:

### 1. Run Local PostgreSQL & Redis
Ensure PostgreSQL is running locally on port `5432` and Redis on `6379`.

### 2. Apply Migrations to Local Postgres
```bash
npx prisma generate
npm run db:deploy          # apply pending migrations (safe on existing data)
```
If your local database was created with `prisma db push` before migrations existed, baseline it once:
```bash
npx prisma migrate resolve --applied 0_init
npm run db:deploy
```

#### Changing the schema
Do **not** use `prisma db push` against shared or production databases. Use migrations:
1. Edit `prisma/schema.prisma`.
2. `npm run db:migrate -- --name <short_description>` creates `prisma/migrations/<timestamp>_<name>/migration.sql` and applies it locally.
3. Review the generated SQL. To rename a column or table, edit the SQL to use `RENAME` instead of the default drop + add, so data is kept. Commit the migration folder together with the schema change.
4. Deployments run `prisma migrate deploy` automatically (see `docker-entrypoint.sh`).

`npm run db:status` shows which migrations are applied. `prisma migrate dev` may offer to **reset** a local database when it detects drift. Never accept that on a database whose data you need.

### 3. Start Backend in Dev Mode
```bash
npm run dev
# Starts on http://localhost:3000 with tsx hot-reloading
```

### 4. Start Frontend in Dev Mode
```bash
cd frontend
npm run dev
# Starts on http://localhost:5173 with Vite HMR
# In dev, Vite automatically proxies /api requests to http://localhost:3000
```

---

## 📡 API Reference

### 1. Delivery Tracking & Ingest (`/api/frappe`)
* `POST /api/frappe/register-device`: Registers driver device and returns temporary telemetry API key.
* `POST /api/frappe/start-tracking`: Starts trip; caches device API key in Redis and sets trip state in Postgres.
* `POST /api/frappe/stop-tracking`: Ends trip; marks trip `Completed` in Postgres.
* `POST /api/frappe/ingest`: High-frequency mobile telemetry ingestion.
  * Filters out readings without latitude/longitude before proxying to the upstream telemetry service.
  * Responds with synthetic `202 Accepted` if all readings are no-fix/skipped.
  * Asynchronously persists complete audit batch to PostgreSQL (`DEBUG_MODE=true`).

### 2. Analytics Dashboard (`/api/dashboard`)
* `GET /api/dashboard/trips`: Paginated trip list with status filter (`In Transit`, `Completed`) and text search (`search=TRIP...`).
* `GET /api/dashboard/trips/:tripId/points`: Chronological point sequence for plotting on the map.
* `GET /api/dashboard/trips/:tripId/export`: Full JSON dump of trip details and all coordinates for offline analysis.

### 3. Interactive Documentation
* **Swagger UI**: `https://karivena.admin.polynomial.ai/docs`
* **Health Check**: `https://karivena.admin.polynomial.ai/health`

---

## 🛑 Useful Operational Commands

```bash
# Restart backend container after code update
docker compose up -d --build backend

# View live backend application logs
docker compose logs -f --tail=100 backend

# View live database logs
docker compose logs -f postgres

# Restart frontend application in PM2
pm2 restart akshayakalpa-frontend

# Inspect Redis keys directly
docker exec -it akshayakalpa-redis redis-cli keys "device_key:*"

# Inspect PostgreSQL tables directly
docker exec -it akshayakalpa-postgres psql -U postgres -d akshayakalpa_db -c "\dt"
```

```mermaid
flowchart TD
    Start([Launch App]) --> Splash[Splash Screen]
    Splash --> LangCheck{Language Chosen?}
    LangCheck -- No --> SelectLang[Select Vernacular Language<br/>Kannada, Tamil, Telugu, Hindi, English]
    LangCheck -- Yes --> CheckAuth{Auth Token Valid?}
    SelectLang --> CheckAuth

    CheckAuth -- Yes --> FetchProfile[Fetch Farmer Profile from Frappe]
    CheckAuth -- No --> EnterPhone[Enter Mobile Number]

    EnterPhone --> RequestOTP[Request OTP via SMS]
    RequestOTP --> EnterOTP[Enter 4/6-Digit OTP]
    EnterOTP --> VerifyOTP{OTP Valid?}
    VerifyOTP -- No --> OTPError[Show Error / Resend OTP]
    OTPError --> EnterOTP
    VerifyOTP -- Yes --> FetchProfile

    FetchProfile --> PersonaCheck{Determine Persona}
    PersonaCheck -- Persona A: Supplying --> DashboardA[Supplying Farmer Home / Overview]
    PersonaCheck -- Persona B: Pipeline --> DashboardB[Pipeline Onboarding Tracker]
    PersonaCheck -- Persona C: Community --> DashboardC[Open Community Feed & Knowledge Hub]
```

```mermaid
flowchart TD
    subgraph External[Chilling Centre / BMC & Frappe Backend]
        Procure[Farmer's Milk gets Delivered at Collection Centre] --> LabTest[BMC Tests Quantity, Fat & SNF]
        LabTest --> FrappeSync[(Frappe ERP Records Collection & Quality)]
    end

    subgraph FarmerApp[Farmer App: Overview & Procurement]
        FrappeSync -.->|Push Notification| RecvNotif[Receive Delivery & Quality Notification]
        RecvNotif --> OpenOverview[Open Overview Screen]
        OpenOverview --> ViewSummary[View Today's Supply & Rate Breakdown]
        
        ViewSummary --> ActionChoice{Farmer Action}
        ActionChoice --> ViewQuality[View Milk Quality Trends<br/>Fat, SNF, Alerts & Tips]
        ActionChoice --> ViewStatement[View Billing & Deduction Statement<br/>Net Payable, Advances, Feeds]
        ActionChoice --> Dispute[Discrepancy in Qty / Rate / Deductions?]

        Dispute -- Yes --> RaiseTicketCTA[Click CTA: Raise Ticket / Query]
        RaiseTicketCTA --> TicketForm[Select Line Item, Add Note / Photo]
        TicketForm --> SubmitQuery[Submit Ticket to Frappe]
    end

    subgraph AdminConsole[Extension Officer / Admin]
        SubmitQuery --> OfficerQueue[Extension Officer Reviews & Resolves]
        OfficerQueue -.-> StatusUpdate[Status Updated in App]
    end
```

```mermaid
flowchart TD
    subgraph FarmerApp[Farmer App: Herd Management]
        OpenHerd[Open Herd Management Tab] --> HerdList[View Cattle Registry & Summary]
        
        HerdList --> FilterCattle[Filter by Cattle Type, Breed, Life Stage]
        FilterCattle --> SelectCow[Select Cattle Card]

        SelectCow --> ViewDetails[View Cattle Profile:<br/>- Tag ID & Breed<br/>- Lactation & Life Stage<br/>- Produce Tracker / Yield<br/>- Feeding Tracker<br/>- Ownership Status & History]

        HerdList --> LogNewCattle[CTA: + Log New Cattle]
        LogNewCattle --> FormCattle[Fill Cattle Info:<br/>- Tag ID / RFID<br/>- Breed & Cattle Type<br/>- Age / DOB & Life Stage<br/>- Ownership Origin / Purchase Date]
        FormCattle --> SubmitCattle[Submit Cattle Entry]
    end

    subgraph Backend[Frappe & Field Extension]
        SubmitCattle --> FrappeHerd[(Frappe Herd Doctype)]
        FrappeHerd --> EOReview{Tag Verification Needed?}
        EOReview -- Yes --> EOTask[Assigned Extension Officer Verifies on Field]
        EOReview -- No --> Approved[Animal Registry Updated]
        EOTask --> Approved
        Approved -.-> LiveSync[Live on Farmer App]
    end
```

```mermaid
flowchart TD
    subgraph HealthTracker[Farmer App: Health & Reminders]
        ViewHealth[View Health & Vaccination Status] --> CheckSchedules[Reminders: Due Deworming, Vaccines, Dry-off]
        ViewHealth --> DetectIssue{Animal Sick or Injured?}
        
        DetectIssue -- Yes --> IllnessCTA[CTA: Raise Vet Request / Log Illness]
        IllnessCTA --> IllnessForm[Select Affected Cattle Tag<br/>Select Symptoms & Urgency<br/>Attach Photo / Voice Note]
        IllnessForm --> SubmitVetReq[Submit Service Request]
    end

    subgraph Ops[Frappe & Vet Field Dispatch]
        SubmitVetReq --> FrappeService[(Frappe Service Module)]
        FrappeService --> VetAssigned[Veterinarian / Para-vet Assigned]
        VetAssigned -.-> PushStatus[Push Status to Farmer App: Vet En Route]
        
        PushStatus --> VetVisit[Vet Conducts Checkup on Farm]
        VetVisit --> VetLogApp[Vet Logs Treatment & Injections in Field App]
        VetLogApp --> UpdateMedicalHist[(Update Frappe Medical Records)]
    end

    subgraph RecordUpdate[Farmer App: Records Updated]
        UpdateMedicalHist -.-> SyncedProfile[Cattle Profile Updated:<br/>- Illness Tracker Closed<br/>- Next Vaccine/Follow-up Scheduled]
    end
```

```mermaid
flowchart TD
    StartTicket[Click Help & Support / Raise Ticket] --> SelectCategory{Ticket Category}
    SelectCategory --> CatMilk[Milk Bill / Quality Dispute]
    SelectCategory --> CatHerd[Herd Registration Issue]
    SelectCategory --> CatService[Service / Feed Delivery Delay]
    SelectCategory --> CatOther[Other General Query]

    CatMilk & CatHerd & CatService & CatOther --> FillDetails[Enter Description & Upload Photo]
    FillDetails --> SubmitTicket[Submit to Frappe Helpdesk]
    
    SubmitTicket --> TicketCreated[Ticket ID Generated & Visible in App]
    TicketCreated --> EOAssign[Extension Officer / Support Team Assigned]

    EOAssign --> InProgress[Status: In Progress]
    InProgress --> Resolution[Resolution Provided / Call Made to Farmer]
    
    Resolution --> CloseCheck{Farmer Satisfied?}
    CloseCheck -- Yes --> TicketClosed[Status: Resolved / Closed]
    CloseCheck -- No --> Reopen[Reopen Ticket with Comments]
    CloseCheck -- No --> Reopen[Reopen Ticket with Comments]
    Reopen --> InProgress
```

---

## 🛰️ Trip-Level Path Smoothing & Distance Pipeline

An offline, asynchronous processing pipeline designed to eliminate GPS zigzag noise (which typically introduces 200–300m of phantom distance per trip), cluster premise stops, and compute robust geodesic trip distances.

### 1. Pipeline Execution Order

Processing runs per trip over a typed `TripContext` through 8 discrete stages:

1. **`preprocess`**:
   - Chronological sort by device timestamp.
   - Deduplication and out-of-order point drop.
   - Mock location filter (`isMock`).
   - Baseline filters: drops fixes with horizontal accuracy > 30m or implied speed > 100 km/h.
2. **`stopDetection`** *(before Kalman)*:
   - 60s rolling window stationary jitter detector. Identifies stationary jitter when net displacement is below `max(stopRadiusM, 2 * median_accuracy)` and path tortuosity > 3 (or Doppler speed < 1.0 m/s).
   - Enters stop when stationary condition holds for >= `stopMinDwellS` (default 90s).
   - Exits with hysteresis: distance from stop anchor > `exitRadiusM` (40m) for >= 3 consecutive fixes with speed > `exitSpeedMps` (2.0 m/s).
   - Optional premise geofence matching via R-Tree (`rbush`) bbox prefilter and exact `@turf/boolean-point-in-polygon`.
   - Absorbed points are excluded from Kalman smoothing and moving distance.
3. **`kalmanRts`**:
   - Splits moving points into chunks wherever time gap exceeds `gapSplitS` (default 30s).
   - Projects each chunk to local metric coordinates (UTM zone computed per chunk centroid: `zone = floor((lon + 180)/6) + 1`, EPSG:326xx).
   - Discrete white-noise-acceleration Kalman filter with variable $dt$.
   - Innovation $\chi^2$ gating (Mahalanobis distance squared > 9.21) flags and isolates noise spikes (e.g. 80m jumps) without deleting raw data.
   - Rauch-Tung-Striebel (RTS) backward smoothing pass produces optimal state estimates and converts back to WGS84 coordinates.
4. **`segmentAssembly`**:
   - Constructs ordered segments: moving chunks, stops, and connectors (last moving smoothed point -> stop anchor; stop anchor -> first moving smoothed point).
5. **`distance`**:
   - Geodesic length (`distanceSmoothedM`) computed via Haversine across smoothed moving chunks and connectors (stops add zero internal distance).
   - Diagnostics: `distanceRawFilteredM`, `distanceDopplerM`, `distanceOdometerM`, and absolute percentage error vs. start/end odometer readings.
   - Generates RDP-simplified polyline strictly for display (never used for distance calculations).
6. **`matching`**:
   - `SegmentMatcher` interface with default `NoopMatcher`.
   - Triggers map-matching only if `mapMatching.enabled=true`, odometer readings are available, and odometer error > `mmTriggerPct` for trips > `mmMinKm`.
7. **`persist`**:
   - Atomic PostgreSQL transaction: deletes prior records for `(tripId, pipelineVersion)` and bulk inserts into `trip_processed_points`, `trip_stops`, `trip_segments`, and `trip_distance_summaries`.
8. **`publish`**:
   - Forwards summary metrics (`distanceFinalM`, `distanceSmoothedM`, `distanceOdometerM`, `errorOdometerPct`, display polyline, stops, and segment types) to the upstream telemetry service with retries and exponential backoff.

---

### 2. Running Background Workers & Reprocessing CLI

#### Background Worker
Heavy processing is offloaded from the Express event loop to background workers via a PostgreSQL-backed queue (`FOR UPDATE SKIP LOCKED`):

```bash
# Run the worker process
npm run worker
```

#### Reprocessing via CLI
Reprocess single trips or historical date ranges:

```bash
# Reprocess a single trip
npm run reprocess-trip <tripId>
npm run reprocess-trip TRIP-2026-00047 -- -v v1.0.0

# Reprocess a date range
npm run reprocess-range -- --from 2026-03-01 --to 2026-03-15 -v v1.0.0
```

#### Processed Trip API
Read processed data and distance diagnostics:
```http
GET /api/dashboard/trips/:tripId/processed
```

---

### 3. Tuning Configuration Thresholds

All thresholds are centralized in `src/tripProcessing/config.ts` and can be customized via `.env`:

| Parameter | Default | Description |
| :--- | :--- | :--- |
| `PIPELINE_VERSION` | `v1.0.0` | Output version key for idempotent schema storage |
| `GAP_SPLIT_S` | `30` | Time gap in seconds to split moving track into distinct chunks |
| `STOP_RADIUS_M` | `25` | Base stationary jitter radius threshold (meters) |
| `STOP_MIN_DWELL_S` | `90` | Minimum dwell time (seconds) to qualify as a Stop |
| `STOP_SPEED_MPS` | `1.0` | Speed threshold below which points are considered stopped |
| `TORTUOSITY_MIN` | `3.0` | Minimum path length / net displacement ratio to confirm jitter |
| `EXIT_RADIUS_M` | `40` | Distance from stop anchor required to begin hysteresis exit |
| `EXIT_SPEED_MPS` | `2.0` | Minimum speed required for exit fixes |
| `KF_Q` | `1.5` | Kalman acceleration process noise $\sigma_a$ ($m/s^2$) |
| `MIN_SIGMA_M` | `3.0` | Minimum GPS measurement standard deviation (meters) |
| `CHI2_GATE` | `9.21` | Innovation gating threshold ($\chi^2$, 2 DOF, 99% confidence) |
| `MAX_CONSECUTIVE_REJECTS` | `5` | Rejection limit before Kalman state reinitializes |
| `MAP_MATCHING_ENABLED` | `false`| Enable / disable map matching stage |
| `MM_TRIGGER_PCT` | `3` | Odometer discrepancy percentage threshold to trigger matching |
| `MM_MIN_KM` | `3` | Minimum trip length in km to allow map matching trigger |
| `MAP_MATCHING_BACKEND` | `noop` | `noop` or `osrm_regional` (needs `MAP_MATCHING_ENABLED=true`) |

The regional OSRM matcher's own options (radiuses, acceptance thresholds, etc.) are not `.env` variables. They live in `osrmRegionalConfigSchema` in `src/tripProcessing/config.ts`; see [4.2](#42-what-you-can-tweak).

---

### 4. Map Matching with OSRM (snapping rides to roads)

The Kalman + RTS smoother (stage 3) removes GPS zigzag, but the smoothed path can still run beside a road, across a corner, or through a building. **Map matching** replaces moving stretches with the actual road geometry the vehicle most likely drove, using [OSRM](https://project-osrm.org/) (Open Source Routing Machine) on [OpenStreetMap](https://www.openstreetmap.org/) data.

Our hotspots are spread across India, and one all-India OSRM instance is impractical. So each **region** (a city or hotspot) runs its own small OSRM server, and the matcher sends each part of a ride to the server that covers it.

```
GPS fixes ──► preprocess ──► stop detection ──► Kalman + RTS ──► segments ──► distance
                                                                                   │
              UI "Matched" view ◄── persist ◄── final distance ◄── stitch ◄── OSRM /match (per region)
```

#### 4.1 How OSRM works (the parts that matter to us)

**1. Map data.** OSRM knows only the roads in the `.osm.pbf` file it was built from. We download a zone from [Geofabrik](https://download.geofabrik.de/asia/india.html) (e.g. Surat is in `western-zone`) and clip it to our area with `osmium`. If a road is missing or mis-tagged in OSM, OSRM cannot snap to it.

**2. Profile (a Lua script).** It decides which OSM ways count as usable roads, plus their speeds and one-way rules. Stock `car.lua` and `bicycle.lua` drop private roads and roads tagged `highway=construction`. Delivery bikes use exactly those (societies, campuses, new roads). Our profile `osrm/profiles/delivery_bike.lua` is `bicycle.lua` with changes marked `DELIVERY:`:
- allows `access=private` / `delivery` roads;
- routes on `highway=construction`;
- raises `max_speed_for_map_matching` from 40 to 80 km/h, because OSRM rejects match candidates that imply faster travel;
- never matches onto railways.

**3. Building a dataset (one-time, offline).** These steps run once per area/profile:

| Step | Command | What it does |
|---|---|---|
| Extract | `osrm-extract -p <profile>.lua <area>.osm.pbf` | Applies the profile to the raw OSM data and builds the road graph |
| Partition | `osrm-partition <area>.osrm` | Splits the graph into cells (MLD algorithm) for fast queries |
| Customize | `osrm-customize <area>.osrm` | Computes travel weights per cell |

The output is a set of `<area>.osrm.*` files on disk. **Any change to the map data or the profile means re-running all three steps.** For a city-sized clip this takes seconds and under 100 MB of RAM.

**4. Serving.** `osrm-routed` loads the `.osrm` files into RAM and answers HTTP requests. Restarting it does **not** need a rebuild. Two endpoints matter to us:
- **`/nearest`:** snaps one point to the nearest usable road. We use it for health checks and debugging (e.g. "how far is this point from a road?").
- **`/match`:** snaps a whole **sequence** of GPS points. This is not "nearest road per point". OSRM uses a Hidden Markov Model:
  1. For each point it finds candidate positions on nearby roads. The per-point `radiuses` value (expected GPS error in metres) controls how far a snap is plausible.
  2. It picks the chain of candidates that is both close to the GPS points **and** connected by a believable drivable route between consecutive points (route length similar to the straight-line distance, speed under the profile's limit).
  3. Points with no plausible candidate are dropped (returned as `null`). The result is road geometry plus a `confidence` from 0 to 1.

  That is why a single point or a two-point fragment can't really be matched, and why a path that keeps jumping between parallel roads gets low confidence instead of a zigzag.

**5. Things to know about `osrm-routed`.**
- GET only.
- It ignores the profile name in the URL; the loaded dataset decides.
- `--max-matching-size` caps the points per `/match` request (we send at most 90 and start the server with 100).
- Verified version: `ghcr.io/project-osrm/osrm-backend` reporting **v26.10.0** (`osrm-routed --version`).

#### 4.2 What you can tweak

| Lever | Where | What it changes | Needs a rebuild? |
|---|---|---|---|
| Area covered (clip bbox) | `osmium extract -b …` | Which roads exist in the dataset | **Yes**: re-clip + extract/partition/customize |
| Fresher OSM data | Re-download from Geofabrik | Picks up newly mapped or retagged roads | **Yes** |
| Profile (`delivery_bike.lua`) | `osrm/profiles/` | Which road types are usable, max matching speed, one-way handling | **Yes** |
| Region polygon / URL / kind | `npm run osrm-region -- add …` | Which server gets which points (hotspot before backbone) | No (cache refreshes within 60 s; restart worker to apply now) |
| GPS radius range | `radiusMinM` / `radiusMaxM` (10 / 40 m) | How far OSRM may snap a point. Larger values match noisier traces but risk the wrong parallel road | No (`config.ts`) |
| Point density | `downsampleIntervalS` (5 s), `turnAngleDeg` (30°) | Points sent per request; corners always kept | No |
| Request window | `maxPointsPerRequest` (90), `overlapPoints` (5) | Points per request (must be ≤ server `--max-matching-size`) | No |
| Acceptance | `mmMinConfidence` (0.6), `mmMinRatio`/`mmMaxRatio` (0.85–1.15), `maxSnapDistanceM` (60 m), `maxDroppedPointFrac` (0.3) | When a match is trusted vs. the smoothed path kept | No |
| Stitching | `stitchMaxGapM` (50 m) | When neighbouring matched pieces are joined vs. broken | No |
| Smoothing before matching | `KF_Q`, `MIN_SIGMA_M`, `GAP_SPLIT_S` (`.env`) | Smoothed path and per-point `sigmaM` (which sets the OSRM radius) | No |
| When matching runs | `MAP_MATCHING_ENABLED`, `MAP_MATCHING_BACKEND`, `MM_TRIGGER_PCT`, `MM_MIN_KM` | Worker runs matching only on odometer discrepancy; `match-trip` forces it | No |

Rule of thumb: if trips come back `unmatched`, look at the **reason** first (see [4.8](#48-troubleshooting)).
- `trace_outliers`, or snaps to the wrong road: usually **map data or profile**.
- `low_confidence` / `length_ratio` on good-looking matches: **acceptance thresholds**.

#### 4.3 How a ride gets matched (step by step)

1. **Trigger.**
   - The worker (`npm run worker`) processes a trip after its job is enqueued. It runs matching only if `MAP_MATCHING_ENABLED=true`, `MAP_MATCHING_BACKEND=osrm_regional`, **and** the odometer differs from the smoothed distance by more than `MM_TRIGGER_PCT`.
   - `npm run match-trip -- <tripId>` runs the whole pipeline for one trip immediately and **forces** matching. The stored trigger reason becomes `FORCED_MATCH:<original reason>`.
2. **Stages 1–5:** preprocess, stop detection, Kalman + RTS smoothing, segment assembly, distance. Raw and smoothed data are final at this point and never modified by matching.
3. **Collect moving chunks.** Only smoothed points of moving chunks are eligible. Stop points, premise fixes and stop anchors are **never** sent to OSRM.
4. **Region pre-check.** If the trip's bbox touches no enabled region, everything is `unmatched` (`no_region_coverage`) and no HTTP call is made.
5. **Route to regions** (`RegionRouter`).
   - For each chunk, compute the fraction of points inside each region polygon. Hotspot beats backbone; then higher coverage wins.
   - If the best region covers ≥ 95% of the chunk, the whole chunk goes there. Otherwise it is split into runs by region, short runs are merged, and each run gets 5 points of overlap with its neighbours.
   - Points outside a region are never sent to it.
6. **Health check.** Each region's server is pinged via `/nearest` (cached 30 s). A failing region is skipped for 120 s, and its runs become `unmatched` (`region_unavailable`).
7. **Build requests** (`OsrmClient`).
   - Downsample to about one point per 5 s, keeping turning points.
   - Cut into windows of at most 90 points.
   - Each point gets a timestamp and a radius equal to its smoothed `sigmaM`, clamped to 10–40 m.
8. **Call `/match`**, with up to 4 requests in parallel. Errors and timeouts never fail the trip; they become `unmatched` with a reason.
9. **Accept or reject each window** (all must hold):

   | Rule | Default | Reject reason |
   |---|---|---|
   | OSRM confidence ≥ `mmMinConfidence` | 0.6 | `low_confidence` |
   | matched length ÷ smoothed length within `mmMinRatio`–`mmMaxRatio` (skipped for stretches under 25 m) | 0.85–1.15 | `length_ratio` |
   | No point snapped more than `maxSnapDistanceM` | 60 m | `snap_distance` |
   | OSRM dropped at most `maxDroppedPointFrac` of the points | 30% | `trace_outliers` |
   | Sub-matchings join within `stitchMaxGapM` | 50 m | `submatching_gap` |

   A rejected window keeps its smoothed path, marked `unmatched` with the reason.
10. **Stitch** (`stitch()`). Windows and runs are joined in time order, with the overlap removed. Gaps up to 50 m are bridged; larger gaps break the segment rather than drawing a jump.
11. **Final distance.** Matched pieces count their road length; everything else keeps its smoothed length (`distanceFinalM`).
12. **Persist.**
    - Matched output is stored as **extra** `trip_segments` rows (`segment_type` = `matched` / `unmatched`, with `region_id`, `data_version`, `reject_reason`).
    - A per-trip summary goes into `trip_matching_summaries`.
13. **View.** In the dashboard, open the trip and choose **🛣️ Matched (Road)**.
    - Solid violet: road-matched. Dashed green: smoothed path kept.
    - Hover a segment for its region, confidence or reject reason.
    - The stats card shows the matched distance and the % of the ride on roads.

#### 4.4 New machine setup (Windows)

**Prerequisites:**
- Docker Desktop (WSL2 backend), Node.js 20+, Git
- WSL Ubuntu with `osmium-tool` (`sudo apt install osmium-tool`)
- PostgreSQL and Redis: native, or the compose containers below

OSRM has no supported Windows build. It runs in Docker (Linux) and the Windows backend reaches it at `http://localhost:<port>`.

The commands below use `D:\Work\osrm` as the OSRM working folder (`/mnt/d/Work/osrm` in WSL). Use any folder, but keep it **outside** the repo; the `.osm.pbf` and `.osrm*` files are large build artifacts.

**Step 1: app, database and migrations** (PowerShell, repo root)
```powershell
npm ci
cd frontend; npm ci; cd ..
# create .env (and frontend/.env); see "Environment Configuration" above
docker compose up -d postgres redis        # skip if PostgreSQL/Redis run natively (compose binds 5432/6379)
npx prisma generate
npm run db:deploy                          # applies prisma/migrations; never resets data
```

**Step 2: get and clip the map data** (WSL Ubuntu)
```bash
mkdir -p /mnt/d/Work/osrm && cd /mnt/d/Work/osrm
wget https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf     # Surat; pick the zone for your city
osmium extract -b 72.60,21.00,73.00,21.30 western-zone-latest.osm.pbf -o surat.osm.pbf   # minLon,minLat,maxLon,maxLat
ls -lh surat.osm.pbf                       # wait for the prompt: the file stays 0 bytes until osmium finishes
```
Note the snapshot date from the download's redirect (e.g. `western-zone-261030` = 2026-10-30) and use it in the region's `--data-version`.

**Step 3: build the dataset with the delivery profile** (PowerShell)
```powershell
cd D:\Work\osrm
Copy-Item D:\Work\askhayakalpa-poc-be\osrm\profiles\delivery_bike.lua .
docker pull ghcr.io/project-osrm/osrm-backend
docker run --rm -v "${PWD}:/data" -v "${PWD}/delivery_bike.lua:/opt/delivery_bike.lua" ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/delivery_bike.lua /data/surat.osm.pbf
docker run --rm -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend osrm-partition /data/surat.osrm
docker run --rm -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend osrm-customize /data/surat.osrm
```
The profile is mounted into `/opt` (not `/data`) because it loads OSRM's helper scripts from `/opt/lib`. Keep each command on **one line**; a wrapped line splits the command.

**Step 4: run the OSRM server** (PowerShell)
```powershell
docker run -d --name osrm-surat --restart unless-stopped -p 5001:5000 -v "D:\Work\osrm:/data" ghcr.io/project-osrm/osrm-backend osrm-routed --algorithm mld --max-matching-size 100 /data/surat.osrm
curl.exe "http://localhost:5001/nearest/v1/bike/72.8311,21.1702?number=1"     # expect "code":"Ok"
```
- `--restart unless-stopped` brings the server back automatically whenever Docker starts.
- Use one container name and one host port per region (`osrm-<region>`, ports 5001, 5002, …).

**Step 5: register the region** (repo root)
```powershell
npm run osrm-region -- add --id surat --name "Surat" --geojson osrm/regions/surat.geojson --url http://localhost:5001 --profile bike --kind hotspot --data-version western-zone-261030+delivery_bike
npm run osrm-region -- list
```
Make the region polygon slightly **smaller** than the clipped extract, so points near its edge still have surrounding roads. Ready-made polygons are in `osrm/regions/`.

**Step 6: run and match**
```powershell
npm run dev                                 # backend  (http://localhost:3000)
cd frontend; npm run dev                    # dashboard (http://localhost:5173)
npm run worker                              # optional: background processing of queued trips
npm run match-trip -- TRIP-2026-00083 --dry-run --segments   # preview, writes nothing
npm run match-trip -- TRIP-2026-00083                        # save; then open the trip → 🛣️ Matched (Road)
```
- If the backend or worker runs **inside Docker**, `localhost` is the container itself. Register the region URL as `http://host.docker.internal:5001`, or put OSRM on the compose network.
- The region URL must be reachable from wherever the worker or `match-trip` runs.

#### 4.5 After Docker or the machine restarts

Built `.osrm*` files and the database are on disk, so nothing needs rebuilding.

| What | Command |
|---|---|
| 1. Start Docker Desktop | wait for **Engine running**, then `docker version` must show a **Server** section |
| 2. Check containers came back | `docker ps` (containers with `--restart unless-stopped` start automatically) |
| 3. Start a stopped OSRM container | `docker start osrm-surat` |
| 4. Recreate a deleted OSRM container | re-run the `docker run -d --name … osrm-routed …` command from Step 4 (no rebuild) |
| 5. Postgres / Redis (compose) | `docker compose up -d postgres redis` |
| 6. Verify OSRM | `curl.exe "http://localhost:5001/nearest/v1/bike/72.8311,21.1702?number=1"` |
| 7. Verify regions | `npm run osrm-region -- list` (URL/port must match the running container) |

Full server deployment (backend + Postgres + Redis in Docker): `docker compose up -d --build`. The compose file does not include OSRM; run OSRM containers as in Step 4.

Containers on the current dev machine:

| Container | Port | Dataset | Region | Status |
|---|---|---|---|---|
| `osrm-surat-bike` | 5001 | `D:\Work\osrm\surat-trip-bike.osrm` (delivery_bike) | `surat-trip-bike` | active |
| *(unnamed, car)* | 5000 | `D:\Work\osrm\surat-trip.osrm` (stock car) | `surat-trip` | region disabled; started without `--name`/`--restart`, so it won't come back by itself |

To bring the car server back as a named container:
```powershell
docker run -d --name osrm-surat-car --restart unless-stopped -p 5000:5000 -v "D:\Work\osrm:/data" ghcr.io/project-osrm/osrm-backend osrm-routed --algorithm mld --max-matching-size 100 /data/surat-trip.osrm
```

#### 4.6 Adding a region or updating map data

1. **Choose the area.**
   - Zone: on Geofabrik's India page, check the zone's `.poly` boundary.
   - Bbox: to fit a specific trip, query its GPS bounds, then pad by ~2 km for the region polygon and ~4 km for the extract:
     ```sql
     SELECT min(longitude), min(latitude), max(longitude), max(latitude)
     FROM coordinates WHERE trip_id = 'TRIP-2026-00083' AND has_gps;
     ```
2. **Download, clip and build:** Steps 2–3 with a new file name, e.g. `pune.osm.pbf` → `pune.osrm`.
3. **Run it** on a new port and container name (Step 4).
4. **Register it** (Step 5) with a new `--id` and a GeoJSON polygon.
   - `--kind hotspot` for a city.
   - `--kind backbone` for a larger, coarser extract used only between hotspots.
5. **Refreshing an existing region:**
   - Build into a **new** file name, start it on a new port, and re-register the same `--id` with the new URL and `--data-version`. Re-registering replaces and re-enables the region.
   - Then `docker rm -f` the old container.
   - Old matched rows keep their old `data_version`, so you can tell them apart.
6. **Switching off a region:** `npm run osrm-region -- disable <id>`. To re-enable, run its `add` command again.

#### 4.7 Reference

**Commands**
```powershell
npm run osrm-region -- add --id <id> --geojson <file> --url <url> --profile <name> --kind hotspot|backbone --data-version <v> [--name <n>]
npm run osrm-region -- list
npm run osrm-region -- disable <id>
npm run match-trip -- <tripId> [--dry-run] [--segments] [--publish]   # --publish sends the summary upstream (off by default)
```
`--geojson` accepts a Polygon/MultiPolygon geometry, a Feature, or a one-feature FeatureCollection.

**Code map** (`src/tripProcessing/matching/`)

| File | Role |
|---|---|
| `regionRegistry.ts` | `osrm_region` table repository + in-memory cache (60 s) with an `rbush` bbox index |
| `regionRouter.ts` | Coverage per region, whole-vs-split decision, runs, overlap |
| `osrmClient.ts` | `/match` URL building (switches to `polyline6` for long URLs), downsampling, retries, error → reason codes |
| `regionHealth.ts` | `/nearest` health ping, cool-down |
| `acceptance.ts` | Acceptance rules, cutting geometry to each window's core |
| `stitch.ts` | Joining pieces, break on large gaps |
| `RegionalOsrmMatcher.ts` | Orchestration (implements `SegmentMatcher`) |
| `stages/6_matching.ts` | Trigger / force logic, final distance |
| `cli/matchTrip.ts`, `cli/osrmRegion.ts` | CLIs |

**Storage:**
- `osrm_region` holds the region registry.
- `trip_segments` gains `region_id`, `data_version` and `reject_reason`; matcher rows sit **alongside** the smoothed rows.
- `trip_matching_summaries` holds the per-trip summary.
- All of these are created by migration `20261031000000_osrm_regional_matching`.

**Guarantees:**
- With matching disabled, pipeline output and `paramsHash` are byte-identical to before (guarded by `tests/tripProcessing/fixtures/matching_disabled_golden.json`).
- A down region or a failed request never fails a trip.

**Tests:** `tests/tripProcessing/regional_osrm_matcher.test.ts` uses a local stub OSRM server, so no real OSRM is needed. To also run the integration test against a real server:
```powershell
$env:OSRM_TEST_URL="http://localhost:5001"; $env:OSRM_TEST_PROFILE="bike"; npx vitest run regional_osrm
```

#### 4.8 Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `docker: request returned 500 Internal Server Error … dockerDesktopLinuxEngine/_ping` | Docker Desktop engine not started or stuck (its log shows `no route to host 192.168.65.x`) | Quit Docker Desktop from the tray → `wsl --shutdown` → start Docker Desktop. Disconnect VPNs if it persists |
| `osmium: command not found` | Not installed in WSL | `sudo apt install osmium-tool` |
| Clipped `.osm.pbf` is 0 bytes | `osmium extract` still running (it writes at the end) | Wait for the shell prompt |
| `osrm-extract` fails to load the profile (`lib/…` not found) | Profile mounted into `/data` instead of `/opt` | Mount it as `-v "${PWD}/delivery_bike.lua:/opt/delivery_bike.lua"` |
| `match-trip`: "no enabled OSRM regions" | Nothing registered / all disabled | `npm run osrm-region -- list`, then `add` |
| All segments `no_region_coverage` / `no_region` | Trip is outside every region polygon | Check the polygon covers the trip; register the right region |
| `region_unavailable` | OSRM container down, wrong port, or Docker stopped | `docker ps`, `docker start osrm-…`, check the URL in `osrm-region list` |
| `trace_outliers`, or long stretches unmatched | Roads missing for the profile (private, under construction, unmapped) | Check distance to road with `/nearest`. Use `delivery_bike.lua`; refresh OSM data; fix the road in OSM |
| `low_confidence` on short pieces | 1–2-point fragments between stops | Expected; they keep the smoothed path |
| 🛣️ Matched button disabled | Trip never matched, or only a `--dry-run` was done | `npm run match-trip -- <tripId>` (without `--dry-run`) |
| `Can't reach database server at localhost:5432` | PostgreSQL not running | Start the `postgresql-x64-17` service, or `docker compose up -d postgres` |
