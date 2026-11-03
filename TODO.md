# AGCRO MVP delivery checklist

## Farmer decision workflow

- [x] Preserve the existing farmer modules and make the dashboard answer “What should I do today on my farm?” with farmer, farm, crop, soil, weather, water, alert, recommendation, profit, and action context.
- [x] Show provenance labels for live sensor, external API, farmer-entered, and simulated demonstration data, plus last-updated timestamps.
- [x] Keep actual planted crops separate from recommendations; accepting a recommendation must never silently change the planted crop.
- [x] Store and display farm memory covering seasons, costs, yields, soil tests, irrigation, activities, harvests, and profitability.
- [x] Compute Land Power as a transparent prototype indicator with factor explanations, missing data, trend, confidence, and an explicit non-standardized disclaimer.
- [x] Provide restoration-oriented, balanced-productivity, and profit-oriented crop recommendations with variety, season, water, yield range, cost, revenue, profit, reasons, risks, confidence, and assumptions.
- [x] Provide zone-level records and zone-aware readings/recommendation context.
- [x] Provide water budget as available water minus projected demand, with rainfall contribution, deficit/surplus, allocation, assumptions, and action.
- [x] Provide irrigation advice using crop, stage, moisture, recent irrigation, forecast, and water availability; do not operate pumps automatically.
- [x] Provide drought and flood/waterlogging risk cards with reasons, affected zones, consequences, preventive actions, and confidence.
- [x] Provide actual historical profit plus conservative, expected, and optimistic future scenarios with assumptions and uncertainty.
- [x] Label market and government content as demonstration/source-based unless a verified integration is configured.
- [x] Generate and acknowledge alerts for moisture, weather, water, crop stress, sensors, harvest, and activities.

## API and platform

- [x] Serve a Node.js/Express API with health, dashboard, farms, zones, sensor readings, recommendations, water budget, irrigation, risks, profit, AI explanation/chat, alerts, and admin overview endpoints.
- [x] Validate body payloads, centralize errors, rate-limit requests, log request outcomes, and keep secrets server-side.
- [x] Include a relational schema with keys, constraints, timestamps, device/readings, decisions, alerts, and financial records.
- [x] Include a Python rule-based engine with tests and a documented JavaScript fallback.
- [x] Include Open-Meteo and NeuGen adapters with no invented credentials or endpoints.
- [x] Include ESP32 firmware and sensor mapping/integration instructions.

## Admin and documentation

- [x] Add a separate admin dashboard mode with metrics, device health, alerts, decision review, export, and role-aware action boundaries.
- [x] Include setup, API, architecture, demo script, environment example, sample data, and testing documentation.
- [x] Serve a synchronized `/manus-routes.json` route manifest.
- [ ] Add verified NeuGen credentials/endpoint when supplied by the service owner.
- [ ] Add a verified market-price provider and official government-scheme feed when source contracts are available.
- [ ] Build and connect the Flutter shell to the same API after the MVP web loop is accepted.
