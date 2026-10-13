# GPS Journey Tracking Backend (POC)

Lightweight Express & TypeScript backend with **Drizzle ORM**, **Zod** schema validation, automated SQL migrations, **OpenAPI 3.0 / Swagger UI documentation**, and **SOLID-compliant architecture** to track live mobile device GPS coordinates during journeys.

---

## 📖 OpenAPI / Swagger Documentation

An interactive Swagger UI and raw OpenAPI spec are built directly into the server:

- **Swagger UI Interactive Docs**: [http://localhost:3000/docs](http://localhost:3000/docs)
- **Raw OpenAPI 3.0 JSON Spec**: [http://localhost:3000/docs/json](http://localhost:3000/docs/json)
- **Specification Source File**: [`src/docs/openapi.yaml`](file:///d:/Work/askhayakalpa-poc-be/src/docs/openapi.yaml) (can be directly imported into Postman, Insomnia, or Swagger Editor)

Mobile developers can test requests directly inside the browser or generate client SDKs using OpenAPI generator tools.

---

## 🏛️ Architecture & SOLID Principles

The codebase is organized in decoupled layers:

```
src/
├── controllers/
│   └── journey.controller.ts       # HTTP handling, formatting responses & status codes
├── db/
│   ├── index.ts                    # Drizzle ORM client & pg connection pool
│   ├── migrate.ts                  # Migration runner for automated code-based DB schema changes
│   └── schema.ts                   # Drizzle Schema (journey & coordinates)
├── middlewares/
│   └── validate.middleware.ts      # Generic Express middleware for Zod validation
├── repositories/
│   └── journey.repository.ts       # Data access interfaces & Drizzle implementations
├── routes/
│   └── journey.routes.ts           # Clean router definitions with middleware wiring
├── schemas/
│   └── journey.schema.ts           # Zod validation schemas & inferred DTO types
└── index.ts                        # App initialization & migration execution
```

### SOLID Implementation:
- **Single Responsibility Principle (SRP)**:
  - `schemas`: Exclusively responsible for validation rules and DTO types.
  - `middlewares`: Reusable request validation without touching business logic.
  - `controllers`: Handle HTTP request unpacking, response headers, and status mapping.
  - `services`: Contain domain rules (e.g. only one active journey per phone, coordinate attachment).
  - `repositories`: Pure database queries without business assumptions.
- **Open/Closed Principle (OCP)** & **Liskov Substitution Principle (LSP)**:
  - Repositories are defined behind interfaces (`IJourneyRepository`, `ICoordinateRepository`).
  - Swapping PostgreSQL/Drizzle for an in-memory test repository or another database engine requires zero modifications to service logic.
- **Interface Segregation Principle (ISP)**:
  - Repository interfaces are broken into cohesive contracts (`IJourneyRepository` and `ICoordinateRepository`).
- **Dependency Inversion Principle (DIP)**:
  - `JourneyService` and `JourneyController` depend on abstractions rather than concrete classes, enabling painless dependency injection and unit testing.

---

## 🗄️ Database & Migrations (Drizzle ORM)

All database tables and relationships are defined via code in [`src/db/schema.ts`](file:///d:/Work/askhayakalpa-poc-be/src/db/schema.ts):

- **`journey`**: `id`, `phone`, `start`, `stop`, indexed on `(phone, stop)`
- **`coordinates`**: `id`, `journey_id`, `latitude`, `longitude`, `sequence`, `recorded_at`, foreign key referencing `journey.id` (cascade delete), indexed on `(journey_id, sequence)`

### Migration Commands:
- `npm run db:generate`: Generates SQL migration files in `drizzle/` from changes in `schema.ts`.
- `npm run db:migrate`: Executes pending SQL migrations against your PostgreSQL instance.
- Migrations also run automatically on server boot (`src/index.ts`).

---

## 📋 API Endpoints

### 1. Start Journey
`POST /start` or `POST /api/start`
- **Body**:
  ```json
  {
    "phone": "+919876543210",
    "start": "2026-10-12T12:00:00.000Z" // Optional, defaults to now
  }
  ```
- **Responses**:
  - `201 Created`: Journey created.
  - `409 Conflict`: If an active journey already exists for this phone.

### 2. End Journey
`POST /end` or `POST /api/end`
- **Body**:
  ```json
  {
    "phone": "+919876543210",
    "stop": "2026-10-12T13:00:00.000Z" // Optional, defaults to now
  }
  ```
- **Responses**:
  - `200 OK`: Active journey ended.
  - `404 Not Found`: No active journey found for this phone.

### 3. Track Coordinates
`POST /track` or `POST /api/track`
- Ingests either a **single coordinate** or an **array of coordinates** (for mobile offline caching / batch sync when reconnection happens):
  ```json
  {
    "phone": "+919876543210",
    "coordinates": [
      {
        "latitude": 12.971598,
        "longitude": 77.594562,
        "sequence": 1,
        "recorded_at": "2026-10-12T12:00:10.000Z"
      },
      {
        "latitude": 12.972100,
        "longitude": 77.595100,
        "sequence": 2
      }
    ]
  }
  ```

### 4. Get Current Active Journey
`GET /journey/current?phone=+919876543210` or `GET /api/journey/current?phone=+919876543210`
- Returns active journey and all coordinates sorted by sequence.

### 5. Get All Journeys
`GET /journeys` or `GET /journeys?phone=+919876543210`
- Returns list of journeys with status (`active` or `completed`).

### 6. Get Journey by ID
`GET /journey/:id`
- Returns a specific journey and its coordinates.

---

## ⚙️ Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set your PostgreSQL URL in `.env`:
   ```env
   PORT=3000
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tracking_db
   ```
3. Run the development server (auto-runs migrations and starts listening):
   ```bash
   npm run dev
   ```
