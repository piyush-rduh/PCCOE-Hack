# AGCRO architecture

```text
Farmer browser (responsive web) ──┐
                                  ├── Express REST API ── Repository ── JSON demo store / managed relational DB
Admin browser (React surface) ────┘             │
                                               ├── JS-compatible deterministic decision engine
                                               ├── Python decision engine CLI/service boundary
                                               ├── Weather adapter (Open-Meteo boundary)
                                               └── NeuGen adapter (verified endpoint only; fallback is labelled)
ESP32 + SHT31 + capacitive sensor ─────────────┘
```

The API is the shared contract for farmer and admin surfaces. The decision engine consumes structured records and emits Land Power, recommendation, water-budget, irrigation, climate-risk, and profit outputs. Source labels travel with readings and cards so simulated, farmer-entered, external, and live data cannot be confused.

# Hackathon demo script

1. Start at **Today** and ask “What should I do today?” Show the water deficit, current chickpea stage, and the action to review allocation before irrigating.
2. Open **Farm memory**. Show season history, actual revenue/profit, missing N/P/K soil data, and the Land Power confidence explanation.
3. Open **Crop decisions**. Compare restoration, balanced, and profit lenses. Accept one for planning and point out that the planted crop did not change.
4. Open **Monitor & water**. Show the water formula, zone allocations, sensor status, irrigation recommendation, and drought/flood preparedness cards.
5. Add a sensor reading through the form. Refresh and show that the reading is stored, source-labelled, and reused by irrigation advice.
6. Open **Profit intelligence**. Contrast actual historical profit with conservative/expected/optimistic scenarios and state the assumptions.
7. Ask the assistant to explain the water deficit. Highlight that the fallback explains structured results and is not claimed to be NeuGen.
8. Open **Admin console**. Show farmers, zones, devices, active alerts, decisions, and the read-only role boundary.
9. Close with the trust statement: AGCRO is a decision-support layer; it does not silently control pumps, invent live data, or guarantee income.
