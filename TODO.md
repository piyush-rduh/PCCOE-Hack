# AGCRO MVP delivery checklist

## Phase 4: Agriculture decision engine (Implemented with reference-data gates)

- [x] Make the Python CLI the primary calculation engine behind the existing Express API; validate JSON input/output and bound process time/output.
- [x] Keep missing values unknown, identify stale sensor data, distinguish demo finances from actual records, and return confidence as evidence completeness rather than probability.
- [x] Preserve the legacy Land Power prototype weights with explanations and explicit non-standardized/provisional status.
- [x] Add unit-explicit water-budget calculations, input completeness checks, zone allocation, and farmer-confirmed-only irrigation guidance.
- [x] Add crop-sequence summaries, historical financial calculations with expense-completeness confirmation, and unscored drought/waterlogging assessments.
- [x] Update farmer and admin API/UI consumers and English/Marathi/Hindi fallback notices without changing auth or storage backends.
- [x] Add Python/Node integration and regression tests; document architecture, assumptions, and APIs.
- [ ] Populate `python/agronomic_references.json` with locally reviewed authoritative values and scoring/essential-constraint rules before enabling crop ranking, exact irrigation quantities, or risk scores.
- [x] Add validated farmer-owned crop plans, planning periods, effective-rainfall records, explicit water inventory/use records, and low/medium/high financial scenarios; keep reference-dependent water calculations gated until complete evidence is available.
- [x] Present filtered Farm Memory timelines, comparable soil-history series, structured water/planning records, and distinct actual/demo/scenario finance.
- [x] Add bounded admin-only data-quality summary and paginated issue views with safe values, filters, and remediation guidance.
- [x] Return stable locale-neutral engine message codes and render translated English/Marathi/Hindi templates with parity and numeric-invariance tests.

## Phase 1: Security and Backend Foundation (Delivered)

- [x] **Authentication:**
  - [x] Farmer registration (`POST /api/auth/register`) with input validation and duplicate check.
  - [x] Farmer login (`POST /api/auth/login`) with username/password verification.
  - [x] Secure password hashing using bcrypt (cost factor 10); no plain-text passwords stored.
  - [x] Authentication middleware (`authMiddleware`) validating signed JWT tokens and session validity.
  - [x] Secure token and session revocation on logout (`POST /api/auth/logout`).
  - [x] Token expiration and revocation verification (`isTokenRevoked`).
  - [x] Strict input validation for all registration/login payloads.
- [x] **Role-Based Authorization (RBAC):**
  - [x] Defined roles: `FARMER` and `ADMIN`.
  - [x] Server-side identity verification for administrators.
  - [x] Completely removed reliance on caller-supplied `x-agcro-role` header.
  - [x] Real authenticated administrator login flow on `/admin`; eliminated frontend-only click-throughs.
  - [x] Protected all relevant GET, POST, PUT, DELETE, and export endpoints.
- [x] **Farm Ownership Verification:**
  - [x] Verified ownership (`checkFarmOwnership`) on all farm resources: farms, zones, soil tests, sensor readings, seasons, activities, harvests, alerts, and decisions.
  - [x] Rejection of cross-farmer resource access with `403 Forbidden`.
  - [x] Prevented resource access based purely on caller-supplied IDs without verified ownership.
- [x] **Stored XSS Elimination:**
  - [x] Safe DOM APIs and output encoding (`esc()`) in `public/app.js` and React-managed components in `public/admin.js`.
  - [x] Automatic escaping of interpolation variables in translation helper (`t()`).
  - [x] Strict server-side validation rejecting script tags and HTML injection in activity type, date, parameters, and farm names.
  - [x] Safe sanitization of notes and descriptions.
  - [x] Verified malicious activity type (`<script>alert('xss')</script>`) and date (`<img src=x onerror=alert(1)>`) are rejected with `400 Bad Request`.
- [x] **Secure IoT API:**
  - [x] Device authentication via `Authorization: Bearer <deviceToken>`.
  - [x] Per-device credentials hashed with SHA-256 and verified against `sensor_devices.token_hash`.
  - [x] Rejection of firmware placeholder tokens with `401 Unauthorized`.
  - [x] Device-to-farm and device-to-zone authorization checks (`422 Unprocessable Entity` on mismatch).
  - [x] Reading telemetry boundary validation (soil moisture 0-100%, humidity 0-100%, temperature -20 to 70°C).
  - [x] Rejection of revoked devices (`403 Forbidden`) with admin revocation endpoint (`POST /api/admin/devices/:id/revoke`).
  - [x] Updated `firmware/agcro_esp32.ino` with security protocol documentation and fail-safe guidelines.
- [x] **Request Validation and Error Handling:**
  - [x] Comprehensive payload validation for dates (`YYYY-MM-DD`), numbers, enums, and string lengths.
  - [x] Interception of malformed JSON with standard `400 Bad Request` (`invalid_json`) responses.
  - [x] Consistent error format `{ error, message }` across all endpoints.
  - [x] Internal stack traces masked in client responses.
  - [x] Tiered rate limiting on general endpoints (300 req/min) and auth endpoints (25 req/min).
- [x] **Automated Security Test Suite:**
  - [x] Created `tests/auth-security.test.mjs` with 8 automated test suites covering all security objectives.
  - [x] 100% test pass rate across both JavaScript and Python test suites.
- [x] **Documentation:**
  - [x] Updated `docs/SETUP.md`, `docs/API.md`, `.env.example`, and `schema/migrations/001_init.sql`.

---

## Farmer decision workflow (Preserved & Functional)

- [x] Preserve the existing farmer modules and make the dashboard answer “What should I do today on my farm?” with farmer, farm, crop, soil, weather, water, alert, recommendation, profit, and action context.
- [x] Show provenance labels for live sensor, external API, farmer-entered, and simulated demonstration data, plus last-updated timestamps.
- [x] Keep actual planted crops separate from recommendations; accepting a recommendation must never silently change the planted crop.
- [x] Store and display farm memory covering seasons, costs, yields, soil tests, irrigation, activities, harvests, and profitability.
- [x] Compute Land Power as a transparent prototype indicator with provisional factor explanations, missing data, evidence completeness, and an explicit non-standardized disclaimer.
- [ ] Provide reviewed restoration, balanced, and profit-oriented crop rankings; currently withheld until validated local references and essential constraints are configured.
- [x] Provide zone-level records and zone-aware readings/recommendation context.
- [x] Preserve explicit crop-plan, planning-period, effective-rainfall and water-history records; keep the water budget unavailable when crop-period demand, effective rainfall, area, available water, or required efficiency is incomplete.
- [ ] Provide precise irrigation depth/volume only when fresh measurements and reviewed crop parameters are present; never operate pumps automatically.
- [ ] Provide drought/flood preparedness context; calibrated risk scores remain disabled until a validated regional method is reviewed.
- [x] Provide actual historical profit only when full expenses are confirmed; future low/medium/high outcomes require complete explicit farmer-entered scenario inputs.
- [x] Label market and government content as demonstration/source-based unless a verified integration is configured.
- [x] Generate and acknowledge alerts for moisture, weather, water, crop stress, sensors, harvest, and activities.

---

## Future Phases (Pending Integration Prerequisites)

- [ ] Connect verified NeuGen credentials/endpoint when contract is finalized by service owner.
- [ ] Connect live mandi market-price API and official government-scheme feed when upstream contracts are available.
- [ ] Migrate in-memory storage to live MySQL database via `DATABASE_URL` with automated migration runner.
- [ ] Build Flutter mobile companion app connecting to the authenticated AGCRO REST API.
