# Emergency Coordination System (ECS)

Created by Arnav Adarsh & Yuvraj Rajput.

An ambulance coordination platform. A patient requests an ambulance; the nearest
free unit is dispatched; the best-suited hospital is chosen and alerted before
arrival; the family follows the ambulance through a private tracking link; and an
operations team oversees everything from an admin console.

Four roles, each with its own dashboard: **patient** (USER), **ambulance driver**
(DRIVER), **hospital staff** (HOSPITAL) and **administrator** (ADMIN).

---

## Technology stack

| Layer | Technology |
|---|---|
| API | NestJS 10, TypeORM 0.3, Socket.IO 4, Node.js 20 |
| Database | PostgreSQL (Supabase) in deployment; SQLite (better-sqlite3) for local development |
| Dashboards | React 18, TypeScript 5, Vite 5, React Router 6, Leaflet, Recharts |
| Auth | JWT (passport-jwt), bcrypt, role-based guards |
| Integrations (all optional) | Gemini (AI triage), Google Maps Distance Matrix (live ETAs), Twilio (SMS), Supabase Storage (chat images) |
| Deployment | Docker (backend + nginx web image), Docker Compose, Railway, Render |

---

## Architecture

```
  Browser dashboards (web/*)                       backend/ (NestJS)
  ┌───────────────┐   REST /api  +  Socket.IO      ┌──────────────────────────────┐
  │ user  :3001   │ ─────────────────────────────▶ │ auth · users · bookings      │
  │ admin :3002   │   JWT on every request and     │ dispatch · ambulances        │
  │ driver:3003   │   socket; origins checked      │ hospitals · tracking · admin │──▶ PostgreSQL
  │ hospital:3004 │ ◀───────────────────────────── │ realtime gateway (rooms per  │    (Supabase)
  └───────────────┘   live events to the people    │ user / hospital / ambulance) │
                      on each case only            └──────────────────────────────┘
                                                      │ optional: Gemini, Google Maps,
                                                      │ Twilio, Supabase Storage
```

- **Backend:** one NestJS module per feature (`controller → service → TypeORM
  entities`), the framework's standard layout. Cross-cutting rules live in one
  place each: case membership in `access/`, CORS in `config/cors.ts`, request
  pipeline in `app.setup.ts`, runtime switches in `settings/`.
- **Dashboards:** four independent Vite apps (built and deployed separately,
  served together under `/`, `/admin`, `/driver`, `/hospital`). Code and styles
  common to all four live once in `web/shared/` and are imported as `@shared/...`.
- **Realtime:** sockets must present a valid JWT and come from an allowed origin.
  Each account is placed in rooms derived from its own record; events about a
  case go only to that case's patient, driver, hospital and admins.
- **Dispatch:** a booking gets the nearest free ambulance, claimed atomically. If
  none is free it waits, and a retry worker dispatches it (most severe first) the
  moment a unit frees up.

---

## Folder structure

```
.
├── backend/                     NestJS API
│   ├── src/
│   │   ├── main.ts              entry point
│   │   ├── app.module.ts        module wiring + database connection
│   │   ├── app.setup.ts         CORS, socket adapter, validation, /api prefix
│   │   ├── access/              who belongs to a case (shared by REST and sockets)
│   │   ├── admin/               admin control centre (/api/admin/*)
│   │   ├── auth/                login, sign-up, JWT, roles, first-admin bootstrap
│   │   ├── users/               profiles, medical profile, emergency contacts
│   │   ├── bookings/            bookings, dispatch-on-create, dispatch retry worker
│   │   ├── dispatch/            trip lifecycle and its status rules
│   │   ├── ambulances/ hospitals/ triage/ tracking/ dashboard/ audit/
│   │   ├── realtime/            Socket.IO gateway, origin-checked adapter, case chat
│   │   ├── notifications/       SMS (log or Twilio)
│   │   ├── settings/            admin-editable runtime switches
│   │   ├── health/              /api/health, /api/health/ready, database keep-alive
│   │   ├── uploads/             chat image uploads (Supabase Storage)
│   │   ├── common/              enums, decorators, geo, rate limiting, travel time
│   │   ├── config/              environment-driven configuration
│   │   └── migrations/          TypeORM migrations (Postgres)
│   ├── scripts/                 one-off maintenance scripts
│   ├── test/                    end-to-end suite (npm run test:e2e)
│   └── Dockerfile
├── web/
│   ├── shared/                  UI kit, design system CSS, shared types/utils (@shared)
│   ├── user-dashboard/          patients; also the sign-in page for every role and /track
│   ├── admin-dashboard/         operations console
│   ├── driver-dashboard/        ambulance crews
│   ├── hospital-dashboard/      receiving hospitals
│   ├── nginx/                   config rendered at container start
│   └── Dockerfile               builds all four into one nginx image
├── deploy/                      env templates and the static-site build script
├── docs/                        deployment guide, architecture, feature notes
├── .github/workflows/ci.yml     lint, type-check, tests, builds, Docker builds
├── docker-compose.yml           single-host deployment
└── render.yaml                  Render blueprint
```

Unit tests sit next to the code they test (`*.spec.ts`), the NestJS convention.

---

## Prerequisites

- **Node.js 20 or newer** (`.nvmrc` pins 20; the Docker images use 20).
- npm.
- For deployment: a PostgreSQL database (the project uses Supabase).
  Local development needs no database server — it uses SQLite.

---

## Local development

### 1. Backend

```bash
cd backend
npm ci
cp .env.example .env
```

The template runs on a local SQLite file (`USE_SQLITE=true`) with demo hospitals
and ambulances. Before the first start, set a first admin in `backend/.env`:

```
BOOTSTRAP_ADMIN_EMAIL=you@example.com
BOOTSTRAP_ADMIN_PASSWORD=at-least-12-characters
```

```bash
npm run start:dev          # http://localhost:3000/api, restarts on changes
```

Check it: `curl http://localhost:3000/api/health`.

### 2. Dashboards

Each app is installed and run on its own:

```bash
cd web/user-dashboard     && npm ci && npm run dev    # http://localhost:3001  (sign-in for all roles)
cd web/admin-dashboard    && npm ci && npm run dev    # http://localhost:3002
cd web/driver-dashboard   && npm ci && npm run dev    # http://localhost:3003
cd web/hospital-dashboard && npm ci && npm run dev    # http://localhost:3004
```

Sign in at **http://localhost:3001**: every role signs in there and is sent on to
its own dashboard. In development the apps call `http://localhost:3000/api`; to
point them elsewhere copy a dashboard's `.env.example` to `.env`.

### Accounts

- **Patients** sign up on the sign-in page. Public sign-up only ever creates
  patient accounts.
- **The first admin** comes from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`
  and only while no admin exists. Remove them after signing in.
- **Hospital staff, drivers and further admins** are created by an admin:
  admin console → Users → Create account. A hospital login is linked to one
  hospital and a driver to one ambulance.

---

## Environment variables

`backend/.env.example` lists every variable the backend reads, grouped and
commented. The essentials:

| Variable | Purpose |
|---|---|
| `USE_SQLITE` | `true` for local development only; production refuses it |
| `DATABASE_URL` | Postgres connection string (Supabase pooler) |
| `DB_RUN_MIGRATIONS` | apply pending migrations at startup |
| `JWT_SECRET` | long random value — production refuses the placeholder |
| `CORS_ORIGINS` | dashboard origins allowed to call the API and open sockets (required in production) |
| `PUBLIC_TRACKING_BASE_URL` | `https://<site>/track` — sent to families by SMS |
| `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` | first admin on an empty database |
| `SEED_DEMO_DATA` | demo hospitals/ambulances; default on in development, off in production |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | chat image storage |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | real SMS (leave `SMS_PROVIDER` unset) |
| `GEMINI_API_KEY`, `GOOGLE_MAPS_API_KEY` | AI triage and live-traffic ETAs (optional) |

Dashboards are configured at **build** time through `VITE_*` variables
(`VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_LOGIN_URL`, `VITE_*_APP_URL`); see each
app's `.env.example`. Changing one requires a rebuild.

Real values belong in `.env` files (gitignored) or the hosting platform's
settings — never in the repository.

---

## Database and migrations

- **Local (SQLite):** the schema is created from the entities automatically
  (`synchronize`). Nothing to run.
- **Postgres:** the schema is managed only by migrations in
  `backend/src/migrations` (automatic sync is off: it could drop columns).

```bash
cd backend
npm run migration:show     # applied / pending
npm run migration:run      # apply pending
npm run migration:revert   # undo the last one
```

`DB_RUN_MIGRATIONS=true` applies pending migrations at startup instead. A
database that already has tables but little migration history needs a baseline
first — see [docs/deployment.md](docs/deployment.md#2-migrate-the-database).

---

## Testing and quality checks

```bash
cd backend
npm run lint          # ESLint (code quality; formatting is not a lint error)
npm run typecheck     # TypeScript
npm test              # unit tests
npm run test:e2e      # whole API on in-memory SQLite: auth, access rules, sockets,
                      # trip order, admin controls, rate limiting — no services needed
npm run build         # compile to dist/
npm run format        # optional: apply Prettier formatting

cd web/<app>
npm run typecheck
VITE_API_URL=http://localhost:3000/api npm run build
```

CI (`.github/workflows/ci.yml`) runs all of these, plus both Docker builds.

---

## Production build

```bash
# API
cd backend && npm ci && npm run build && npm run start:prod     # node dist/main.js

# Dashboards — production builds must be told where the API is
VITE_API_URL=https://api.example.com/api \
VITE_SOCKET_URL=https://api.example.com \
VITE_LOGIN_URL=https://app.example.com \
VITE_ADMIN_APP_URL=https://app.example.com/admin \
VITE_DRIVER_APP_URL=https://app.example.com/driver \
VITE_HOSPITAL_APP_URL=https://app.example.com/hospital \
bash ./deploy/build-web.sh   # all four apps → deploy/public/
```

Or build the images: `docker build -f backend/Dockerfile backend` and
`docker build -f web/Dockerfile web --build-arg VITE_API_URL=...`.

---

## Deployment

Three supported paths, each described step by step in
[docs/deployment.md](docs/deployment.md):

- **Railway** — two services (`backend/`, `web/`) from this repository.
- **Docker Compose** — one host you control: `docker compose --env-file deploy/.env up -d --build`.
- **Render** — one-click from `render.yaml`.

Health checks: `GET /api/health` (liveness) and `GET /api/health/ready`
(database, storage and SMS status). The backend refuses to start in production
with an unsafe configuration (SQLite, default JWT secret, no `CORS_ORIGINS`,
no database) and says which setting is wrong.

---

## Security notes

- Every socket and every REST route that reads or changes stored data requires a
  valid login. The public routes are: sign-in, sign-up, health checks, the
  secret family-tracking link and its opt-out, public ambulance registration
  (held as Pending until an admin verifies it), and the triage endpoints
  (stateless scoring; the AI one is rate-limited).
- Access to a case (booking page, report, chat, trip updates) is limited to its
  patient, assigned driver, receiving hospital and admins.
- Login and sign-up are rate-limited per IP (`AUTH_LOGIN_PER_MINUTE`,
  `AUTH_REGISTER_PER_HOUR`).
- Admin actions are written to the audit log (admin console → Audit Logs).
- `backend/ecs_local.db` (a development SQLite file) was committed in the past and
  is now gitignored. Untrack it with `git rm --cached backend/ecs_local.db`; the
  passwords it once held in plain text were development-only accounts.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Backend exits at startup in production | Read the log: it names each unsafe or missing setting. |
| `Unable to connect to the database` | Check `DATABASE_URL` (use the Supabase **pooler** host) or set `USE_SQLITE=true` locally. |
| Sign-in works but a dashboard shows nothing / "No hospital is linked" | Link the account in admin console → Users → Manage (hospital or ambulance). |
| `401` on every request after an admin reset your password | Sessions were ended on purpose — sign in again. |
| `429 Too many requests` on login | Rate limit per IP; wait a minute or raise `AUTH_LOGIN_PER_MINUTE`. |
| Dashboard calls `localhost` in production | `VITE_*` values are baked in at build time — rebuild with them set. |
| Socket never connects | The dashboard's origin must be in `CORS_ORIGINS`, and the user must be signed in. |
| `npm ci` (npm 11+) skips install scripts | Native modules (`bcrypt`, `better-sqlite3`) need them: run `npm approve-scripts` or use npm 10 (bundled with Node 20). |
| `Permission denied` running `npm run lint` etc. | `node_modules` was copied without executable bits; run `npm rebuild --ignore-scripts` or reinstall with `npm ci`. |

---

## More documentation

- [docs/deployment.md](docs/deployment.md) — deployment, admin controls, keep-alive, SMS, storage, latency
- [docs/architecture/](docs/architecture/) — system design and ER diagram (PDF), original schema notes
- [docs/features/](docs/features/) — feature notes written during development (historical)
- [docs/testing/](docs/testing/) — manual test checklist for the patient dashboard
