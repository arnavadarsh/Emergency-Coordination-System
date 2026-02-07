# Emergency Coordination System (ECS)

## Phase 0: Foundations & Environment Setup ✅

Production-grade emergency coordination platform with multi-role architecture.

---

## 🏗️ Project Structure

```
ECS FINAL/
├── backend/                    # NestJS Backend
│   ├── src/
│   │   ├── auth/              # JWT Authentication
│   │   ├── users/             # User Management
│   │   ├── hospitals/         # Hospital Data
│   │   ├── ambulances/        # Ambulance Fleet
│   │   ├── bookings/          # Booking Foundation
│   │   ├── dispatch/          # Dispatch Foundation
│   │   ├── triage/            # Triage Placeholder
│   │   ├── realtime/          # WebSocket Gateway
│   │   ├── audit/             # Audit Logging
│   │   ├── common/            # Shared Code
│   │   ├── config/            # Configuration
│   │   └── migrations/        # Database Migrations
│   └── README.md
│
├── mobile/
│   ├── user_app/              # Flutter User App
│   └── driver_app/            # Flutter Driver App
│
├── web/
│   ├── hospital-dashboard/    # React Hospital Dashboard
│   └── admin-dashboard/       # React Admin Dashboard
│
└── README.md                  # This file
```

---

## 🎯 Phase 0 Deliverables

### ✅ Backend (NestJS)
- JWT-based authentication
- Role-Based Access Control (RBAC): USER, DRIVER, HOSPITAL, ADMIN
- PostgreSQL database with migrations
- TypeORM entities for all core tables
- WebSocket foundation with JWT auth
- RESTful API endpoints for all modules
- Clean architecture with modular design

### ✅ Database (PostgreSQL)
- Users & User Profiles
- Hospitals & Hospital Capabilities
- Ambulances with driver assignment
- Bookings with status tracking
- Dispatches linking bookings, ambulances, hospitals
- Audit Logs for system-wide tracking

### ✅ Mobile Apps (Flutter)
- **User App**: Login, role-based redirect, placeholder home
- **Driver App**: Login, role-based redirect, placeholder home

### ✅ Web Dashboards (React + TypeScript)
- **Hospital Dashboard**: Login, role validation, placeholder dashboard
- **Admin Dashboard**: Login, role validation, placeholder dashboard

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Flutter SDK 3.0+ (for mobile apps)
- npm/yarn

### 1. Backend Setup

```bash
cd backend

# Install dependencies
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

Backend runs on `http://localhost:3000`

### 2. Mobile Apps Setup

**User App:**
```bash
cd mobile/user_app
flutter pub get
# Update lib/config/api_config.dart with backend URL
flutter run
```

**Driver App:**
```bash
cd mobile/driver_app
flutter pub get
# Update lib/config/api_config.dart with backend URL
flutter run
```

### 3. Web Dashboards Setup

**Hospital Dashboard:**
```bash
cd web/hospital-dashboard
npm install
npm run dev
```
Runs on `http://localhost:3001`

**Admin Dashboard:**
```bash
cd web/admin-dashboard
npm install
npm run dev
```
Runs on `http://localhost:3002`

---

## 👥 User Roles

| Role | Description | Access |
|------|-------------|--------|
| **USER** | End users requesting ambulances | User App, Booking endpoints |
| **DRIVER** | Ambulance drivers | Driver App, Dispatch endpoints |
| **HOSPITAL** | Hospital staff | Hospital Dashboard, Hospital/Booking endpoints |
| **ADMIN** | System administrators | Admin Dashboard, All endpoints |

---

## 🔐 Authentication Flow

1. User logs in via respective app/dashboard
2. Backend validates credentials and checks role
3. JWT token issued with user ID, email, and role
4. Token stored securely (Flutter Secure Storage / localStorage)
5. All API requests include token in Authorization header
6. Backend validates token and enforces role-based access

---

## 📡 API Documentation

### Authentication
- `POST /api/auth/login` - Login
- `POST /api/auth/register` - Register

### Users
- `GET /api/users/me` - Get current user
- `GET /api/users` - Get all users (admin)

### Hospitals
- `GET /api/hospitals` - List hospitals
- `GET /api/hospitals/:id` - Get hospital details

### Ambulances
- `GET /api/ambulances` - List ambulances (admin/hospital)
- `GET /api/ambulances/available` - Available ambulances
- `GET /api/ambulances/:id` - Get ambulance details

### Bookings
- `GET /api/bookings` - List bookings (admin/hospital)
- `GET /api/bookings/my-bookings` - User's bookings
- `GET /api/bookings/:id` - Get booking details

### Dispatch
- `GET /api/dispatch` - List dispatches (admin/hospital)
- `GET /api/dispatch/:id` - Get dispatch details

### Audit
- `GET /api/audit` - Audit logs (admin only)

---

## 🌐 WebSocket Events

Connect with JWT token:
```javascript
const socket = io('http://localhost:3000', {
  auth: { token: 'your-jwt-token' }
});
```

### Events (Phase 0)
- `heartbeat` - Connection keepalive
- `location:update` - Location updates (placeholder)

---

## 🗄️ Database Schema

### Core Tables
- **users** - User authentication and roles
- **user_profiles** - Extended user information
- **hospitals** - Hospital information
- **hospital_capabilities** - Hospital specializations (ER, ICU, CARDIAC, etc.)
- **ambulances** - Ambulance fleet and driver assignment
- **bookings** - Emergency booking requests
- **dispatches** - Booking-ambulance-hospital linkage
- **audit_logs** - System-wide change tracking

### Enums
- `UserRole`: USER, DRIVER, HOSPITAL, ADMIN
- `BookingStatus`: CREATED, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED
- `HospitalStatus`: ACTIVE, INACTIVE, MAINTENANCE
- `HospitalCapability`: ER, ICU, CARDIAC, TRAUMA, NEURO, OB
- `SeverityLevel`: LOW, MEDIUM, HIGH, CRITICAL
- `AmbulanceStatus`: AVAILABLE, BUSY, MAINTENANCE, OFFLINE

---

## ⚠️ Phase 0 Limitations

**NOT IMPLEMENTED:**
- ❌ Emergency triage logic
- ❌ Hospital ranking/selection algorithms
- ❌ Ambulance routing
- ❌ ETA calculations
- ❌ Maps integration
- ❌ Real-time tracking logic
- ❌ Booking creation UI
- ❌ Dispatch management UI

These features are **intentionally excluded** from Phase 0 and will be added in subsequent phases.

---

## 🧪 Testing

### Create Test Users

```bash
# Register a USER
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@test.com",
    "password": "password123",
    "firstName": "Test",
    "lastName": "User",
    "role": "USER"
  }'

# Register a DRIVER
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "driver@test.com",
    "password": "password123",
    "firstName": "Test",
    "lastName": "Driver",
    "role": "DRIVER"
  }'

# Register a HOSPITAL
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "hospital@test.com",
    "password": "password123",
    "firstName": "Test",
    "lastName": "Hospital",
    "role": "HOSPITAL"
  }'

# Register an ADMIN
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@test.com",
    "password": "password123",
    "firstName": "Test",
    "lastName": "Admin",
    "role": "ADMIN"
  }'
```

---

## 📋 Development Guidelines

### Code Quality
- ESLint + Prettier for backend
- TypeScript strict mode
- Clean architecture principles
- Meaningful variable/function names
- Comments explain WHY, not WHAT

### Git Workflow
```bash
# Feature branches
git checkout -b feature/your-feature-name

# Commit messages
git commit -m "feat: add hospital capability filtering"
git commit -m "fix: resolve JWT token validation bug"
git commit -m "docs: update API documentation"
```

### Environment Variables
- Never commit `.env` files
- Use `.env.example` as template
- Document all environment variables

---

## 🔧 Troubleshooting

### Backend won't start
- Check PostgreSQL is running
- Verify database credentials in `.env`
- Ensure migrations have run: `npm run migration:run`

### Mobile app can't connect
- For Android emulator: Use `http://10.0.2.2:3000/api`
- For iOS simulator: Use `http://localhost:3000/api`
- Check backend is running

### Database migration errors
- Ensure database exists: `createdb ecs_db`
- Drop and recreate if needed (dev only)
- Check PostgreSQL version (14+)

---

## 📚 Next Steps (Phase 1+)

1. **Phase 1**: Implement triage logic and hospital selection
2. **Phase 2**: Add maps integration and routing
3. **Phase 3**: Real-time tracking and dispatch management
4. **Phase 4**: Analytics and reporting
5. **Phase 5**: Testing and optimization

---

## 📄 License

MIT

---

## 👨‍💻 Development

This is a Phase 0 foundation. All business logic is intentionally minimal to establish:
- Clean architecture
- Authentication & authorization
- Database schema
- API structure
- Frontend-backend integration

Build upon this foundation in subsequent phases.
