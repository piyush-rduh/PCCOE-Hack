# AGCRO API

The API is served by `server.js` on port 3000. JSON responses use `{ data, generatedAt }` for success and `{ error, message }` for errors. The default repository uses the clearly labelled `sample-data/demo.json`; set `AGCRO_DATA_FILE` for a writable JSON store. The relational migration in `schema/migrations/001_init.sql` is the database contract, but the current MVP reports the managed database adapter as pending rather than claiming that `DATABASE_URL` is connected.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Readiness and storage mode |
| GET | `/api/meta` | Product capabilities and integration modes |
| GET | `/api/farms` | List farmer-owned farm records |
| GET | `/api/dashboard?farmId=farm-1` | Complete farmer decision bundle |
| GET | `/api/recommendations?farmId=farm-1` | Three recommendation lenses |
| POST | `/api/recommendations/:crop/decision` | Accept/reject/defer a recommendation; does not plant it |
| GET | `/api/water-budget?farmId=farm-1` | Available minus projected irrigation demand |
| GET | `/api/irrigation-advice?farmId=farm-1` | Moisture/weather/stage advice |
| GET | `/api/climate-risks?farmId=farm-1` | Drought and flood/waterlogging preparedness |
| GET | `/api/profit-analysis?farmId=farm-1` | Actual and scenario profit |
| POST | `/api/activities` | Store an activity in farm memory |
| POST | `/api/soil-tests` | Store a soil test |
| POST | `/api/sensor-readings` | Validate and store a mapped device reading |
| GET | `/api/farms/:id/readings/latest` | Latest sensor readings and stale flags |
| GET | `/api/alerts?farmId=farm-1` | Active alerts |
| POST | `/api/alerts/:id/acknowledge` | Acknowledge an alert |
| POST | `/api/ai/explain` | Explain structured results; fallback is explicitly not NeuGen inference |
| POST | `/api/ai/chat` | Ask about water, soil, crop, risk, or profit |
| GET | `/api/market` | Demo market references with source labels |
| GET | `/api/schemes` | Official links with unconfirmed eligibility |
| GET | `/api/export?farmId=farm-1` | Download a JSON farm report |
| GET | `/api/admin/overview` | Admin view; requires `x-agcro-role: admin` in this demo |

## IoT reading example

```bash
curl -X POST http://localhost:3000/api/sensor-readings \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"esp32-plot-a","farmId":"farm-1","zoneId":"zone-1","soilMoisturePct":31,"temperatureC":28.2,"humidityPct":64,"source":"LIVE_SENSOR"}'
```

A device must already be mapped to the farm and zone. Percentages are bounded to 0–100 and temperature is bounded to a validated sensor range. Invalid or stale readings are rejected or flagged; the API never substitutes a fake reading.
