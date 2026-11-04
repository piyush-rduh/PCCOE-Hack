# AGCRO API (Phase 1 Security & Backend Foundation)

The API is served by `server.js` on port 3000. All responses use consistent formats:
- Success responses: `{ "data": <payload>, "generatedAt": "<timestamp>" }`
- Error responses: `{ "error": "<code>", "message": "<description>" }`

The in-memory demo repository uses `sample-data/demo.json`; set `AGCRO_DATA_FILE` for a writable JSON store. The relational schema contract is in `schema/migrations/001_init.sql`.

---

## Authentication Endpoints

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | Public (Rate-limited) | Register a new farmer account (password hashed with bcrypt) |
| POST | `/api/auth/login` | Public (Rate-limited) | Authenticate farmer or admin and receive a signed JWT |
| POST | `/api/auth/logout` | Bearer Token | Invalidate the current session token (server-side revocation) |
| GET | `/api/auth/me` | Bearer Token | Retrieve currently authenticated user identity and role |

---

## Farmer & Farm Decision Endpoints

All endpoints below require `Authorization: Bearer <token>`.
**Farm ownership is strictly verified:** Farmers can only access farms they own (`farm.farmerId === user.farmerId`). Admins have system-wide access.

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| GET | `/api/farms` | FARMER / ADMIN | List farms owned by the authenticated farmer (or all for admin) |
| POST | `/api/farms` | FARMER / ADMIN | Register a new farm (pinned to the authenticated user) |
| GET | `/api/farms/:id` | FARMER (Owner) / ADMIN | Get farm bundle (verified ownership) |
| GET | `/api/farms/:id/zones` | FARMER (Owner) / ADMIN | List zones for owned farm |
| POST | `/api/zones` | FARMER (Owner) / ADMIN | Create a zone for owned farm |
| PUT | `/api/zones/:id` | FARMER (Owner) / ADMIN | Update an existing zone |
| GET | `/api/dashboard?farmId=...` | FARMER (Owner) / ADMIN | Complete farmer decision bundle |
| GET | `/api/recommendations?farmId=...` | FARMER (Owner) / ADMIN | Three recommendation planning lenses |
| POST | `/api/recommendations/:crop/decision` | FARMER (Owner) / ADMIN | Accept/reject/defer a recommendation |
| GET | `/api/water-budget?farmId=...` | FARMER (Owner) / ADMIN | Available minus projected irrigation requirement |
| GET | `/api/irrigation-advice?farmId=...` | FARMER (Owner) / ADMIN | Moisture/weather/stage irrigation guidance |
| GET | `/api/climate-risks?farmId=...` | FARMER (Owner) / ADMIN | Drought and flood risk assessments |
| GET | `/api/profit-analysis?farmId=...` | FARMER (Owner) / ADMIN | Historical and projected profit scenarios |
| GET | `/api/weather?farmId=...` | FARMER (Owner) / ADMIN | Weather observations and forecast |
| POST | `/api/activities` | FARMER (Owner) / ADMIN | Record field activity (validated date & safe type) |
| POST | `/api/soil-tests` | FARMER (Owner) / ADMIN | Record soil parameter test |
| POST | `/api/harvests` | FARMER (Owner) / ADMIN | Record completed crop season and financial figures |
| GET | `/api/farms/:id/readings/latest` | FARMER (Owner) / ADMIN | Latest sensor readings and stale telemetry flags |
| GET | `/api/alerts?farmId=...` | FARMER (Owner) / ADMIN | Active alerts for owned farm |
| POST | `/api/alerts/:id/acknowledge` | FARMER (Owner) / ADMIN | Acknowledge alert on owned farm |
| POST | `/api/ai/explain` | FARMER (Owner) / ADMIN | Explain structured agronomic results |
| POST | `/api/ai/chat` | FARMER (Owner) / ADMIN | Multilingual conversational agronomy assistance |
| GET | `/api/export?farmId=...` | FARMER (Owner) / ADMIN | Download comprehensive farm JSON report |
| GET | `/api/market` | Public | Demo mandi prices with source provenance badges |
| GET | `/api/schemes` | Public | Official government agricultural schemes |

---

## Administration Endpoints

Server-side identity verification is enforced. Caller-supplied `x-agcro-role` headers are **strictly ignored**.

| Method | Endpoint | Role | Purpose |
|---|---|---|---|
| GET | `/api/admin/overview` | ADMIN | Backend-derived metrics, recent activities/readings, and stored alerts |
| GET | `/api/admin/farmers` | ADMIN | Search/sort/paginate farmer account summaries; supports `search`, `dateFrom`, `dateTo`, `sortBy`, `sortOrder`, `page`, and `pageSize` |
| GET | `/api/admin/farmers/:id` | ADMIN | Read a farmer profile and associated farms, zones, crop history, and activities |
| GET | `/api/admin/farms` | ADMIN | Search/filter/sort/paginate farm summaries; supports `search`, `farmerId`, date range, sorting, and pagination |
| GET | `/api/admin/farms/:id` | ADMIN | Read farm, zones, soil tests, seasons, active crops, and activities |
| GET | `/api/admin/devices` | ADMIN | Device inventory and status filter; no bearer credentials or hashes returned |
| GET | `/api/admin/readings` | ADMIN | Filter/paginate sensor readings by device, farm, zone, source, and date |
| GET | `/api/admin/alerts` | ADMIN | Search/filter/paginate stored alerts by farm, severity, acknowledgement state, and date |
| GET | `/api/admin/decisions` | ADMIN | Read recorded decisions and separately labeled current recommendation/profit scenarios |
| GET | `/api/admin/weather` | ADMIN | Weather observations with source/update time and separately calculated farm-level drought/flood risk |
| GET | `/api/admin/health` | ADMIN | Safe API, storage, and integration configuration status; no secret values |
| GET | `/api/admin/reports/:type.csv` | ADMIN | CSV export for `farmers`, `farms`, `devices`, `readings`, `alerts`, or `activities`; supports farm/farmer/date filters |
| POST | `/api/admin/devices/:id/revoke` | ADMIN | Revoke a registered IoT device; credential material is not returned |

All `/api/admin/*` routes require a verified JWT whose server-side account role is `ADMIN`. `x-agcro-role` is ignored. The shared `POST /api/alerts/:id/acknowledge` remains farm-scoped and can be used by the owning farmer or an admin.

Device presence is derived from authenticated `LIVE_SENSOR` readings: a reading within 15 minutes (allowing up to five minutes of timestamp skew) is online, an older live reading is offline, and devices without such a reading are unverified. Seeded `status: online` and simulated readings do not establish online status. Global fallback weather is not presented as farm-specific; farm-level climate risks are displayed separately and are not changed by observation date filters. The development store has no administrative audit log, so administrative events are explicitly reported as unavailable. Exports omit password hashes, bearer tokens, and token hashes, and escape formula-leading text values.

---

## IoT Sensor API (`/api/sensor-readings`)

IoT telemetry ingestion requires a valid Bearer token:
1. **Physical Devices (ESP32):** Must authenticate with their provisioned secret device token in the `Authorization: Bearer <deviceToken>` header.
2. **Farmer Manual Entry:** Authenticated farmers may submit manual readings with `source: 'FARMER_ENTERED'`.

### Validation Rules:
- Device token is hashed with SHA-256 and matched against `sensor_devices.token_hash`.
- Unregistered tokens or placeholder tokens are rejected (`401 Unauthorized`).
- Revoked devices (`status: 'revoked'`) are rejected (`403 Forbidden`).
- Device must be mapped to the supplied `farmId` and `zoneId` (`422 Unprocessable Entity` on mismatch).
- Sensor values are strictly validated:
  - `soilMoisturePct`: 0 to 100%
  - `humidityPct`: 0 to 100%
  - `temperatureC`: -20°C to 70°C
  - `recordedAt`: Valid ISO timestamp within ±5 minutes of server time.

### Example IoT Reading Request:

```bash
curl -X POST http://localhost:3000/api/sensor-readings \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer agcro_device_plot_a_token_2026' \
  -d '{
    "deviceId": "esp32-plot-a",
    "farmId": "farm-1",
    "zoneId": "zone-1",
    "soilMoisturePct": 32.5,
    "temperatureC": 26.8,
    "humidityPct": 65.0,
    "source": "LIVE_SENSOR"
  }'
```

## Phase 2 Farmer Account and Record Operations

The farmer website uses the existing authenticated endpoints for profile and farm management:

| Method | Endpoint | Purpose |
|---|---|---|
| PUT | `/api/auth/profile` | Update the authenticated user's name, phone, and location |
| PUT / DELETE | `/api/farms/:id` | Update or delete an owned farm; deletion removes its associated records |
| DELETE | `/api/zones/:id` | Delete a zone owned through its farm and unmap devices that referenced it |
| PUT | `/api/activities/:id` | Edit an activity without moving it to another farm |
| PUT | `/api/soil-tests/:id` | Edit an existing soil-test record |
| PUT | `/api/harvests/:id` | Edit a recorded season; planting and harvest dates are optional |

Every record update verifies the existing record's farm ownership before accepting edits. Historical dates remain blank unless a farmer supplies them. The farmer UI supports English, Marathi, and Hindi using the locale JSON files in `public/locales/`.
