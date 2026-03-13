# Emergency Coordination System (ECS)

A production-grade emergency ambulance coordination platform with multi-role architecture, real-time dispatch, triage assessment, and hospital ranking — built with NestJS, React, TypeScript, and PostgreSQL.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | NestJS 10, TypeORM, PostgreSQL, Socket.IO |
| **Frontend** | React 18, TypeScript, Vite 5, React Router 6 |
| **Auth** | JWT (passport-jwt), bcrypt |
| **Maps** | Leaflet (user, driver, admin dashboards) |
| **Validation** | class-validator, class-transformer |

---

## Project Structure

```
├── backend/                        # NestJS API server
│   └── src/
│       ├── auth/                   # JWT authentication & RBAC
│       ├── users/                  # User management & profiles
│       ├── hospitals/              # Hospital data & capabilities
│       ├── ambulances/             # Ambulance fleet management
│       ├── bookings/               # Emergency & scheduled bookings
│       ├── dispatch/               # Dispatch lifecycle management
│       ├── triage/                 # AI-driven triage assessment
│       ├── dashboard/              # Analytics & statistics
│       ├── realtime/               # WebSocket gateway (Socket.IO)
│       ├── audit/                  # Audit logging
│       ├── common/                 # Shared decorators & enums
│       ├── config/                 # App, DB, JWT configuration
│       └── migrations/             # TypeORM database migrations
│
├── web/
│   ├── user-dashboard/             # Patient/User dashboard (port 3004)
│   ├── driver-dashboard/           # Ambulance driver dashboard (port 3003)
│   ├── hospital-dashboard/         # Hospital staff dashboard (port 3001)
│   └── admin-dashboard/            # System admin dashboard (port 3002)
│
├── DATABASE_SCHEMA.txt             # Full database schema reference
└── README.md
```

---

## Features

### Backend
- JWT-based authentication with role-based access control (RBAC)
- 4 user roles: **USER**, **DRIVER**, **HOSPITAL**, **ADMIN**
- PostgreSQL database with TypeORM migrations
- WebSocket gateway with JWT-authenticated connections
- RESTful API with global validation pipe (`/api` prefix)
- 10 feature modules: Auth, Users, Hospitals, Ambulances, Bookings, Dispatch, Triage, Dashboard, Realtime, Audit
- CORS enabled for cross-origin dashboard access

### Web Dashboards
- **User Dashboard** — Book ambulances, view booking status, map integration (Leaflet)
- **Driver Dashboard** — View dispatch assignments, real-time location, map integration
- **Hospital Dashboard** — Manage incoming patients, view bookings
- **Admin Dashboard** — System-wide management, all entities, map overview
- All dashboards: Landing page → JWT-protected dashboard routing

### Database (13 tables, 9 domains)
- Users & profiles with role-based access
- Hospitals with capability tracking (ER, ICU, CARDIAC, TRAUMA, NEURO, OB)
- Ambulance fleet (BASIC, ADVANCED, CRITICAL_CARE) with GPS location logging
- Emergency & scheduled bookings with full status lifecycle
- AI-driven triage with severity scoring and confidence levels
- Dispatch lifecycle: DISPATCHED → EN_ROUTE_PICKUP → AT_PICKUP → EN_ROUTE_HOSPITAL → AT_HOSPITAL → COMPLETED
- Hospital ranking snapshots (distance, ETA, capability match, availability)
- Rerouting events (HOSPITAL_DIVERT, TRAFFIC, CLOSER, CAPACITY_FULL, PATIENT_CONDITION)
- Audit logs and system notifications

---

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- npm

### 1. Backend Setup

```bash
cd backend
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database credentials

# Create database
createdb ecs_db

# Run migrations
npm run migration:run

# Start development server
npm run start:dev
```

Backend API runs on **http://localhost:3000/api**

### 2. Web Dashboards

Each dashboard is an independent Vite + React app:

```bash
# User Dashboard (port 3004)
cd web/user-dashboard
npm install
npm run dev

# Driver Dashboard (port 3003)
cd web/driver-dashboard
npm install
npm run dev

# Hospital Dashboard (port 3001)
cd web/hospital-dashboard
npm install
npm run dev

# Admin Dashboard (port 3002)
cd web/admin-dashboard
npm install
npm run dev
```

### Port Summary

| Service | Port |
|---------|------|
| Backend API | `3000` |
| Hospital Dashboard | `3001` |
| Admin Dashboard | `3002` |
| Driver Dashboard | `3003` |
| User Dashboard | `3004` |

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and configure:

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment mode |
| `PORT` | `3000` | Backend server port |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USERNAME` | `postgres` | Database user |
| `DB_PASSWORD` | `postgres` | Database password |
| `DB_DATABASE` | `ecs_db` | Database name |
| `JWT_SECRET` | — | JWT signing secret (change in production) |
| `JWT_EXPIRES_IN` | `7d` | Token expiration |
| `WS_PORT` | `3001` | WebSocket port |

---

## User Roles

| Role | Dashboard | Access |
|------|-----------|--------|
| **USER** | User Dashboard | Book ambulances, view own bookings |
| **DRIVER** | Driver Dashboard | View dispatches, update location |
| **HOSPITAL** | Hospital Dashboard | Manage patients, view bookings |
| **ADMIN** | Admin Dashboard | Full system access, all endpoints |

---

## API Endpoints

All endpoints are prefixed with `/api`.

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register a new user |
| POST | `/api/auth/login` | Login and receive JWT |

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/me` | Get current user profile |
| GET | `/api/users` | List all users (admin) |

### Hospitals
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/hospitals` | List hospitals |
| GET | `/api/hospitals/:id` | Get hospital details |

### Ambulances
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ambulances` | List ambulances (admin/hospital) |
| GET | `/api/ambulances/available` | Available ambulances |
| GET | `/api/ambulances/:id` | Get ambulance details |

### Bookings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/bookings` | List bookings (admin/hospital) |
| GET | `/api/bookings/my-bookings` | Current user's bookings |
| GET | `/api/bookings/:id` | Get booking details |

### Dispatch
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/dispatch` | List dispatches (admin/hospital) |
| GET | `/api/dispatch/:id` | Get dispatch details |

### Audit
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/audit` | Audit logs (admin only) |

---

## WebSocket

Connect with JWT authentication:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  auth: { token: 'your-jwt-token' }
});

socket.on('heartbeat', (data) => console.log(data));
socket.emit('location:update', { lat: 28.6139, lng: 77.2090 });
```

---

## Database Schema

### Tables (13)

| Domain | Tables |
|--------|--------|
| **Users** | `users`, `user_profiles` |
| **Hospitals** | `hospitals`, `hospital_capabilities`, `hospital_status_history` |
| **Ambulances** | `ambulances`, `ambulance_assignments`, `ambulance_location_logs` |
| **Bookings** | `bookings`, `scheduled_requirements` |
| **Triage** | `emergency_triage`, `triage_questions`, `triage_answers` |
| **Dispatch** | `dispatches` |
| **Ranking** | `hospital_ranking_snapshots` |
| **Rerouting** | `reroute_events`, `reroute_blocks` |
| **Audit** | `audit_logs`, `system_notifications` |

### Key Enums

| Enum | Values |
|------|--------|
| `user_role` | USER, DRIVER, HOSPITAL, ADMIN |
| `booking_status` | CREATED, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED |
| `severity_level` | LOW, MEDIUM, HIGH, CRITICAL |
| `ambulance_status` | AVAILABLE, BUSY, MAINTENANCE, OFFLINE |
| `dispatch_status` | DISPATCHED, EN_ROUTE_PICKUP, AT_PICKUP, EN_ROUTE_HOSPITAL, AT_HOSPITAL, COMPLETED |
| `capability_type` | ER, ICU, CARDIAC, TRAUMA, NEURO, OB |
| `reroute_reason` | HOSPITAL_DIVERT, TRAFFIC, CLOSER, CAPACITY_FULL, PATIENT_CONDITION |

See [DATABASE_SCHEMA.txt](DATABASE_SCHEMA.txt) for the full schema reference.

---

## Testing

### Create Test Users

```bash
# Register users for each role
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@test.com","password":"password123","firstName":"Test","lastName":"User","role":"USER"}'

curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"driver@test.com","password":"password123","firstName":"Test","lastName":"Driver","role":"DRIVER"}'

curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"hospital@test.com","password":"password123","firstName":"Test","lastName":"Hospital","role":"HOSPITAL"}'

curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"password123","firstName":"Test","lastName":"Admin","role":"ADMIN"}'
```

### Run Backend Tests

```bash
cd backend
npm run test          # Unit tests
npm run test:e2e      # End-to-end tests
npm run test:cov      # Coverage report
```

---

## Backend Scripts

```bash
npm run start:dev       # Development with hot reload
npm run start:prod      # Production mode
npm run build           # Compile TypeScript
npm run lint            # ESLint check
npm run format          # Prettier formatting
npm run migration:run   # Run pending migrations
npm run migration:revert # Revert last migration
npm run migration:generate -- -n MigrationName  # Generate migration
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Backend won't start | Check PostgreSQL is running, verify `.env` credentials |
| Migration errors | Ensure database exists: `createdb ecs_db` |
| Dashboard can't connect to API | Verify backend is running on port 3000 |
| CORS errors | Backend CORS is enabled for all origins in development |
| JWT token expired | Default expiry is 7 days; re-login to get a new token |

---

## License

MIT
