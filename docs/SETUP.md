# AGCRO setup

## Quick start

```bash
corepack enable
pnpm install
pnpm test
pnpm python:test
pnpm start
```

Open the farmer view at `/` and the admin surface at `/admin`. The server listens on `0.0.0.0:3000` and returns `GET /health` when ready.

The default app uses the labelled demonstration dataset from `sample-data/demo.json`, so it starts without external credentials. To persist manual edits across restarts during a local demo, set `AGCRO_DATA_FILE=./data/agcro-store.json`. The app writes only user/demo records to that file and does not overwrite it on restart.

## Managed database

The Webdev managed database is MySQL-compatible. The supplied relational migration is portable SQL and is the schema contract for farmers, farms, zones, sensor devices, readings, soil tests, seasons, activities, decisions, alerts, and weather observations. Set `DATABASE_URL` only after the project has a migration runner and connection policy approved for the shared managed database. Do not run destructive DDL against the shared database without a backup/export and explicit approval.

## Integrations

Weather is currently a provider boundary with labelled simulated forecast data because verified farm coordinates and an agreed provider response mapping were not supplied. Set `OPEN_METEO_BASE_URL` only after the adapter is wired to a verified response contract.

The water budget uses a transparent three-day planning proxy: crop seasonal water reference × stage factor × area, converted using 4,046 litres per mm-acre, adjusted for irrigation efficiency, and reduced by an explicitly conservative 25% effective-rainfall factor. This is not a site-calibrated ETc model; replace it with local crop coefficients, soil data, and validated weather before field deployment.

NeuGen is intentionally not claimed as live. Set `NEUGEN_API_URL` and `NEUGEN_API_KEY` only when the exact endpoint, model, authentication, and terms are verified by the service owner. Until then, the assistant explains structured decision-engine outputs through the labelled rule-based fallback.

Market prices and scheme links are source-labelled. The app does not create fake buyers, transactions, successful applications, or confirmed eligibility.

## ESP32

Use `firmware/agcro_esp32.ino` as the starting point for an ESP32 DevKit V1, capacitive moisture sensor, and SHT31-D. Calibrate `DRY_RAW` and `WET_RAW` in the target soil, replace Wi-Fi and endpoint placeholders, and register/map the device before sending readings. The firmware has no pump control.
