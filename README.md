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
3. Once Postgres is ready, it automatically executes:
   ```bash
   npx prisma db push --skip-generate
   ```
   This synchronizes all schema models (`device_keys`, `trips`, `coordinates`) without failing if tables already exist.
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

### 2. Push Schema to Local Postgres
```bash
npx prisma generate
npx prisma db push
```

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
    Reopen --> InProgress
```