# AGCRO architecture

```text
Farmer browser ─────┐
                    ├─ Authenticated Express API ── Existing JSON/demo store
Admin browser ──────┘               │
                                    └─ Fixed Python decision-engine CLI
                                       (JSON stdin/stdout; bounded timeout)

Authenticated ESP32 telemetry ──────┘
Weather/market adapters ─────────────┘ (source-labelled; not assumed live)
```

Node.js and Express remain the application backend, authorization boundary, storage adapter, and REST API. Farm ownership is verified before farm data is passed to the calculation process. The Python engine is independent of the development JSON store and consumes only the structured records in the request. JavaScript does not duplicate agricultural calculations.

The process boundary accepts JSON data only. It has a fixed script path, no shell, a response contract check, a finite timeout, bounded output, and a generic public error response. `AGCRO_PYTHON` selects the local Python executable; `AGCRO_DECISION_TIMEOUT_MS` adjusts the bounded process timeout. See [DECISION_ENGINE.md](./DECISION_ENGINE.md) for the contract and [AGRONOMIC_ASSUMPTIONS.md](./AGRONOMIC_ASSUMPTIONS.md) for the formula audit.

The current sample store is explicitly `DEMO_DATA`. Synthetic financial history is separated from actual farmer finances. Crop rankings, water requirements, precise irrigation quantities, and drought/flood scores remain unavailable until reviewed references and required measurements are integrated. Existing authentication, localized farmer website, admin dashboard, and development storage remain in place. No MySQL connection is introduced.
