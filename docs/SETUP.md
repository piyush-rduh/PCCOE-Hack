# AGCRO Setup & Security Foundation (Phase 1)

## Quick Start

```bash
corepack enable
pnpm install
pnpm test
python -m unittest discover -s python -p "test_*.py"
pnpm start
```

Open the farmer application at `http://localhost:3000/` and the admin surface at `http://localhost:3000/admin`. The server listens on `0.0.0.0:3000` and reports `GET /health` when ready.

The farmer application supports English, Marathi, and Hindi from the language selector. After signing in, use Farm management to add or edit farms and field zones, and Farm memory to record or update historical seasons, activities, and soil tests. Profile changes are saved through the authenticated API. New farm records are not pre-populated with demonstration readings.

The admin console at `/admin` uses the separately stored `agcro-admin-token` and provides overview, farmer, farm/zone, device, sensor, alert, decision, weather/risk, CSV report, and system-health modules. Admin lists are read-only except device revocation and alert acknowledgement. Device presence is verified only by authenticated live sensor readings; demo-seeded `online` status is not treated as live. The current development store does not record administrative audit events, and the health panel identifies demo or unverified integrations.

To try it locally, run `pnpm start`, open `http://localhost:3000/admin`, and sign in with the local demo administrator account listed below. Use the sidebar modules to inspect records and apply search/date filters. Device revocation and alert acknowledgement affect the active development store; use test data and do not treat demo records as production data.

---

## Pre-Seeded Demonstration Accounts

For local evaluation, the following pre-seeded credentials are available in `sample-data/demo.json` with securely hashed passwords:

| Role | Username | Password | Purpose | Notes |
|---|---|---|---|---|
| **FARMER** | `ramesh` | `farmer123` | Farmer Decision Portal (`/`) | Owns `farm-1` ("North Field Farm"). One-click login button available in UI. |
| **ADMIN** | `admin` | `admin123` | Admin Console (`/admin`) | System telemetry, cross-farm overview, device revocation. |

### IoT Demo Device Credentials

| Device ID | Mapped Farm | Mapped Zone | Secret Device Bearer Token |
|---|---|---|---|
| `esp32-plot-a` | `farm-1` | `zone-1` | `agcro_device_plot_a_token_2026` |

---

## Environment Variables

Copy `.env.example` to `.env` and configure as required:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP listener port. |
| `NODE_ENV` | `development` | Environment mode (`development` or `production`). |
| `JWT_SECRET` | *(built-in dev fallback)* | Cryptographic secret for signing JWT tokens. **Must be overridden with a strong 256-bit secret in production.** |
| `JWT_EXPIRES_IN` | `24h` | Token validity window (e.g., `24h`, `7d`). |
| `AGCRO_DATA_FILE` | *(in-memory fallback)* | Path to persist writable JSON storage (e.g., `./data/agcro-store.json`). |
| `DATABASE_URL` | *(none)* | Optional MySQL-compatible connection string for the managed database adapter. |
| `OPEN_METEO_BASE_URL` | Open-Meteo URL | External weather API endpoint. |
| `NEUGEN_API_URL` | *(none)* | NeuGen AI endpoint. |
| `NEUGEN_API_KEY` | *(none)* | NeuGen AI API key. |

---

## Security Architecture Implemented in Phase 1

1. **Authentication & Password Hashing:**
   - Farmer registration (`POST /api/auth/register`) and login (`POST /api/auth/login`).
   - Passwords hashed using bcrypt (cost factor 10). Plain-text passwords are never stored.
   - Session management via signed JWT with unique token identifiers (`jti`) and token expiration.
   - Logout endpoint (`POST /api/auth/logout`) blacklists the token server-side.
2. **Role-Based Access Control (RBAC):**
   - Distinct roles: `FARMER` and `ADMIN`.
   - Caller-supplied `x-agcro-role` header is **completely ignored and untrusted**.
   - Admin access is verified strictly through server-side authenticated identity.
   - `/admin` includes an authentic server-side login form; frontend-only click-throughs have been eliminated.
3. **Farm Ownership Verification:**
   - Every request involving farms, zones, soil tests, sensor telemetry, seasons, activities, harvests, alerts, and decisions enforces ownership.
   - Farmers can only read and mutate their own farm resources (`farm.farmerId === user.farmerId`).
   - Cross-farmer resource access attempts receive `403 Forbidden`.
4. **Stored XSS Elimination:**
   - Input sanitization and strict validation: dates strictly formatted as `YYYY-MM-DD`, activity types validated against allowed enums, HTML and script tags rejected.
   - Safe DOM output encoding: all user-controlled data is encoded with `esc()` in `public/app.js` and React-managed elements in `public/admin.js`.
   - Internationalized string formatting (`t()`) automatically encodes inserted variables.
5. **Secure IoT Telemetry API:**
   - Devices authenticate via `Authorization: Bearer <deviceToken>`.
   - Tokens are validated against SHA-256 hashes stored in the database.
   - Firmware placeholder tokens are rejected (`401 Unauthorized`).
   - Device mapping (farm and zone) is verified on ingestion (`422 Unprocessable Entity` on mismatch).
   - Revoked devices are denied telemetry transmission (`403 Forbidden`).
6. **Request Validation & Error Sanitization:**
   - Malformed JSON payloads return `400 Bad Request` (`invalid_json`) instead of unhandled 500 crashes.
   - Consistent error envelope `{ "error": "code", "message": "description" }`.
   - Internal stack traces are logged server-side and never exposed to clients.
   - Tiered rate limiting on general endpoints (300 req/min) and auth endpoints (25 req/min).

---

## Running Tests

Automated regression and security validation:

```bash
# Node regression, security, decision-engine, and locale test suite
pnpm test

# Python agronomic decision engine test suite
python -m unittest discover -s python -p "test_*.py"

# Syntax checks on all files
node --check server.js
node --check src/auth.js
node --check src/validators.js
node --check src/store.js
node --check public/app.js
node --check public/admin.js
```
