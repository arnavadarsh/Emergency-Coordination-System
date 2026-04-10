# EMERGENCY COORDINATION SYSTEM (ECS) - COMPREHENSIVE FEATURE DOCUMENTATION

This document provides a highly detailed, component-level breakdown of every feature, workflow, and technical mechanism currently implemented within the Emergency Coordination System (ECS), summarizing all recent enhancements and the global architectural design.

---

## 1. GLOBAL ARCHITECTURE & TECH STACK

### 1.1 Backend Environment
- **Framework:** NestJS (Node.js) using TypeScript.
- **Database:** PostgreSQL, managed via TypeORM with complex aggregation queries.
- **Authentication:** JWT (JSON Web Tokens) with AuthGuards and Role-Based Access Control (RBAC) supporting four strict roles: `Admin`, `Hospital`, `Driver`, and `User`.
- **Real-Time Communication:** Socket.io Gateway enabling low-latency duplex communication between services.
- **Data Validation:** `class-validator` and `class-transformer` embedded in Data Transfer Objects (DTOs) for strict request validation across all endpoints.

### 1.2 Frontend Environment
- **Framework:** React 18, Vite, TypeScript.
- **State Management:** Functional components utilizing `useState` and `useEffect` hooks for minimal re-renders.
- **Dashboards:** 4 distinct Single Page Applications (User, Driver, Hospital, Admin).
- **Styling Architecture:** Vanilla CSS utilizing modern variables, flexbox/grid, and a shared premium glassmorphism design system.
- **Mapping & Geolocation:** Leaflet.js with OpenStreetMap tiles for interactive location mapping, backed by the Browser Geolocation API with an IP fallback.
- **API Client:** Axios configured with interceptors for global JWT session management.

---

## 2. USER DASHBOARD IN-DEPTH

### 2.1 Profile & Medical Information Management
- Users can update their personal and medical profiles dynamically.
- **Captured Data:** First & Last Name, Phone Number, Emergency Contact Number, Date of Birth, Full Address, Live GPS Coordinates, Blood Type, and specific Medical Notes (e.g., allergies, chronic conditions).
- **Security & Preferences:** Configurations allowing users to toggle email, SMS, and push notification preferences.
- **Location Manager:** Management of a "Saved Locations" list allowing quick 1-click retrieval of commonly used pickup/dropoff points.

### 2.2 Artificial Intelligence Emergency Triage (The "Triage Engine")
- **Engine execution:** The system operates via a deterministic pure TypeScript state machine that runs entirely on the client side, yielding zero latency.
- **Conversational Auto-Flow:** 
  - The chatbot asks conditional questions branching based on previous responses (e.g., Answering "Yes" to "Chest pain" cascades into specific cardiovascular-related questions like "How long has it lasted?" and "Is it a heavy pressure?").
  - UI steps feature dynamic input methods including Yes/No buttons, Multiple Choice arrays, a visual 1-10 Pain Scale slider, and free-text inputs.
- **Real-Time Inference:**
  - **Severity Engine:** Automatically tags cases as `CRITICAL`, `HIGH`, `MODERATE`, or `LOW` based on rigid clinical rules (e.g., unresponsiveness immediately flags `CRITICAL`).
  - **Staff Routing:** Automatically dictates whether the ambulance requires a standard EMT, Paramedic, or Critical Care Specialist.
  - **Ambulance Selection:** Determines if the necessary transport is BLS (Basic Life Support), ALS (Advanced Life Support), ICU (Mobile Intensive Care Unit), or NEONATAL.
  - **Clinical Reasoning System:** The engine generates a localized breakdown for the doctor/user explaining exactly *why* the severity was rated (e.g., "⚠️ Severe bleeding detected — hemorrhage control required").
  - **Hospital Recommendation Logic:** Cross-references the emergency type with hospital capabilities to recommend specific receiving locations (e.g., "Level 1 Trauma Center with Burn Unit").

### 2.3 Map-Based Smart Booking System
- **Interactive Leaflet integration:** Users can drag map markers to pinpoint exact pickup locations. Includes address search with autocomplete.
- **Reverse Geocoding:** Translates raw latitude/longitude coordinates into human-readable street addresses.
- **Auto-Detect Location:** A button utilizing the native Browser Geolocation API to lock onto the current location.
- **Booking Types:**
  - `EMERGENCY`: Relies on the AI Triage data to bypass manual location entry entirely.
  - `SCHEDULED`: Standard point-A to point-B coordination allowing users to pick future date/times and specify specialized vehicle requirements.

### 2.4 Live Real-Time Tracking & SOS
- **One-Click SOS:** A dedicated button bypassing all triage questions to instantly dispatch a Critical-level ambulance to the user's current GPS location.
- **Live Tracking Component:** An interactive dashboard rendering real-time route visualization with polylines and movements updating every 3 seconds.
- **Real-time ETA:** Continuously calculates dynamic arrival times.
- **Progress Timeline:** Represents exact states consecutively (`Assigned` -> `Dispatched` -> `Arrived` -> `Completed`).
- **Cancellation Controls:** Integrates cancel functionality via `PATCH /bookings/:id/cancel`, allowing users a brief window to void an active dispatch.

---

## 3. DRIVER DASHBOARD IN-DEPTH

### 3.1 Live Dispatch & Case Routing
- Actively listens via WebSocket to incoming dispatches tied to that specific driver's ambulance ID.
- **Active Case Card:** Dynamically loads Patient Name, Emergency description, Triage Severity with color-coded stripes, Pickup Location, and Dropoff Hospital.
- **1-Click Patient Calling:** Connects directly via the device's native phone application based on the user's registered phone number.
- **State Navigation:** Controls the localized dispatch workflow directly altering states in the backend.

### 3.2 Dynamic Medical Checklist (Pre-Flight Protocol)
- **Mandatory Trigger:** Before the driver is allowed to officially start an emergency route, a mandatory modal is deployed.
- **AI-Synchronized Checklist:** Uses the data strictly passed via the Triage Engine. For example, if Triage detected "Severe Bleeding", the Checklist automatically flags "Tourniquet" and "Hemostatic Gauze" as required.
- **Responsive Visuals:** Features progress bars and verification ticks ensuring the driver manually checks off everything physically loaded onto the truck before the web system allows the status to proceed to 'Dispatched'.

### 3.3 Driver Map & Live Feed
- Simulates real-time GPS telemetry rendering the exact driving route from the ambulance's current location to the patient, and then onward to the receiving hospital facility.

---

## 4. HOSPITAL DASHBOARD IN-DEPTH

### 4.1 Capacity Control Tower
- Real-time synchronization of the hospital’s operational state.
- **Live Modifiers:** Allows administration staff to instantly update Total Bed Capacity vs. Available Bed counts.
- **Service State Toggle:** Allows hospitals to manually switch from `Active` to `Diverted` or `Full Capacity`. This setting acts directly upstream to influence the User Triage Engine's destination selection algorithm, effectively pausing intake.

### 4.2 Incident Reception Hub
- A dedicated feed tracking all incoming ambulances currently assigned to that specific hospital facility ID.
- **Pre-Arrival Setup:** Enables triage hospital staff/nurses to read the full AI Triage Clinical reasoning notes *minutes before* the patient arrives through the ambulance doors, ensuring the correct specialists (e.g. neurosurgeon vs cardiovascular surgeon) are standing by on arrival.

---

## 5. ADMIN DASHBOARD IN-DEPTH

### 5.1 High-Level Analytics & Metrics (Enhanced SystemStats)
- Powered by a comprehensive data aggregation endpoint (`/api/dashboard/admin` and `/api/bookings/stats/overview`).
- **User Statistics:** Total user count, breakdowns by exact role (admin, hospital, driver, user), and active statuses.
- **Booking Statistics:** Overall platform volume tracking, breaking down total vs active vs completed vs cancelled cases, dynamically calculating the network-wide `Completion Rate`.
- **Ambulance Fleet Integration:** Calculates utilization percentage, tracks verified vs unverified ambulances, and displays status allocations (busy, available, maintaining).
- **Network Hospital Capacity:** National/Network bed utilization rate tracking total beds across all connected hospitals against occupied beds.
- **Performance Key Metrics:** Dynamically tracks the average platform-wide "Ambulance Response Time" (in seconds), emergencies handled daily, and daily completions.

### 5.2 Resource Approval & Fleet Management
- **Verification Workflow:** When a new ambulance driver signs up, the Admin dashboard traps their registration in an `Unverified` state.
- Admins can individually review vehicle license numbers, equipment lists, and assign specific drivers to specific hospital jurisdictions, finalizing the provisioning process before the driver can accept cases.

### 5.3 Global User Management
- Comprehensive list formatting with deep search parsing and status filtering.
- Admins hold authority to remotely alter role permissions or instantly disable/ban user accounts (`is_active` boolean switches).

### 5.4 Unified Audit Log Viewer
- **Security & Compliance Check:** Deep tracing logs every significant action across the entire ECS platform utilizing the `/api/audit/stats` module.
- Records exact historical context: WHO did WHAT and WHEN (e.g., User 'John' cancelled Booking 'xyz' at 12:04PM).
- **Filtering Capability:** Sophisticated front-end filtering arrays allow admins to search strictly for `CREATE`, `UPDATE`, `DELETE` events, or target specific entities like the `ambulances` database table.

---

## 6. BACKEND API MODULES & SYSTEM ARCHITECTURE

### 6.1 Core Entitiy Schemas
- **Users**: the primary authentication unit handling authorization JWTs and profile meta.
- **Books**: The core routing request capturing `pickup_latitude`, `pickup_longitude`, `status`, and complex `triage_data` JSON objects.
- **Dispatches**: The transactional link connecting a User Booking to a designated Hospital and assigned Ambulance. It tracks mission-critical timestamps: `dispatched_at`, `arrived_at_pickup`, `arrived_at_hospital`, and `completed_at`.
- **Ambulances**: Tracks coordinate telemetry and extensive JSON payloads defining `equipment_list` loadouts.
- **Hospitals**: Primary hub resource managing `available_beds` integers and string `service_status`.
- **Audit Logs**: The read-only append ledger executing historical platform records.

### 6.2 Primary REST Controllers
- `/api/bookings`: Core CRUD operations. Also houses `/api/bookings/:id/tracking` for real-time positional retrieval and `/api/bookings/:id/cancel` for request termination.
- `/api/bookings/stats/overview`: Dedicated engine providing analytics for bookings explicitly.
- `/api/triage/assess`: An internal server-side validation mirror. It physically double-checks the frontend's AI logic output on the backend to guarantee absolute data integrity before a dispatch sequence is forcefully generated.
- `/api/dashboard/*`: Pre-calculated metrics reporting routes handling complex TypeORM aggregations.
- `/api/audit`: Core event ledger interface fetching audit metrics and tracking history logs.
- `/api/users`: General CRUD access exclusively gated behind RBAC.

---

### CONCLUSION

The ECS implementation successfully covers the full lifecycle of a next-generation emergency medical response. By integrating predictive zero-latency triage, live GIS mapping with tracking polylines, intelligent fleet routing formulas, rigorous action auditing, and a unified aesthetic experience across four parallel applications (User, Driver, Hospital, Admin)—the software is prepared to securely handle complex, concurrent multi-user emergency logistics.
