# AGCRO decision engine

## Architecture and migration

The Express API remains the application backend and storage boundary. It gathers a farm-scoped bundle from the existing JSON/demo store, sends JSON to the fixed `python/decision_engine.py` program, validates the response contract, and returns the structured results to farmer and admin clients.

```text
Farmer/Admin UI -> authenticated Express API -> JSON input validation
                -> fixed Python CLI (stdin/stdout JSON, 4 s timeout)
                -> output contract validation -> existing REST responses
```

The process is launched without a shell and with a fixed script path; request data is JSON input, never executable code or command arguments. Set `AGCRO_PYTHON` to the Python executable when it is not available as `python`. The subprocess timeout is `AGCRO_DECISION_TIMEOUT_MS` (100–10,000 ms; default 4,000 ms). Failures return a generic `503 decision_engine_unavailable`; Python tracebacks and stderr are not sent to clients. Invalid engine inputs return `422 decision_input_invalid`. The synchronous child-process boundary preserves the current synchronous route design, but blocks the Node event loop while a calculation runs; production deployment should move this same contract to a bounded worker/service pool.

The initial audit found two copies of calculations: `src/decision-engine.js` and `python/decision_engine.py`. Both included unsupported crop water, yield, price, cost, season, and scoring constants. The Python implementation is now primary. JavaScript retains only alert orchestration, HTTP validation, process management, and presentation. The pre-existing Land Power prototype weights are retained and explicitly marked provisional; unverified crop-specific constants have been removed rather than silently migrated.

## Input contract

The service accepts one JSON object. Collections may be omitted and are treated as empty collections; an absent measurement remains `null`/unknown. Supplied values must be finite numbers in supported ranges.

```json
{
  "farm": {
    "areaAcres": 4,
    "soilType": "recorded soil description",
    "waterSource": "recorded source",
    "irrigationMethod": "recorded method",
    "availableWaterLitres": 12000,
    "irrigationEfficiency": 0.8
  },
  "zones": [],
  "activeCrops": [],
  "soilTests": [],
  "sensorReadings": [],
  "weather": [],
  "seasons": [],
  "activities": [],
  "waterPlanningPeriodDays": 3,
  "dataMode": "DEMO_DATA"
}
```

Relevant optional fields include:

- Active crop: `waterRequirementMm` for the supplied planning period, `areaAcres`, `growthStage`, `rootZoneDepthMm`, `irrigationTriggerMoisturePct`, and `irrigationDepthMm`. The engine does not infer these from a crop name.
- Weather: daily `rainfallMm`, and separately validated `effectiveRainfallMm`; source and date should accompany records. Effective rainfall is never inferred from total rainfall.
- Water: `availableWaterLitres` means the already-aggregated usable amount. Alternatively, `storedWaterLitres` and `reliableIncomingWaterLitres` may be provided together. The engine does not add an incoming quantity to an already aggregated available-water value.
- Soil test: `parameter`, numeric `value` or `null`, `unit`, `date`, and `source`.
- Sensor reading: `soilMoisturePct`, `recordedAt`, and `source`.
- - Season history: crop, season/year, area, recorded yield/price and itemized expenses. `expensesComplete: true` is required before actual net profit is calculated.
- Financial scenario: farmer-entered low/medium/high scenario, explicit yield/price/cost units and assumptions. Only scenarios with non-null yield and price, non-empty itemized costs, and `expensesComplete: true` are sent to the engine.
- Crop plans, planning periods, effective-rainfall records, water inventory and structured water-use events are stored and returned in the farm bundle. Crop plans provide recorded crop context, but no crop water demand or validated irrigation parameters are inferred from them.
- `dataMode: "DEMO_DATA"` keeps synthetic sample figures out of actual-income fields.

The farm bundle passes eligible farmer-entered financial scenarios and recorded crop-plan context. Water calculations remain unavailable unless the engine receives complete period-specific crop demand, effective rainfall, area, available water and (where needed) irrigation efficiency. The current planning records do not supply reviewed crop water requirements, and stored effective-rainfall/water-inventory records are not treated as a complete calculation bundle by themselves.

## Output contract

The top-level response follows the standard decision envelope:

```json
{
  "status": "success",
  "result": {
    "landPower": {},
    "recommendations": [],
    "waterBudget": {},
    "irrigation": {},
    "risks": [],
    "profit": {},
    "farmMemory": {}
  },
  "reasons": [],
  "assumptions": [],
  "missingInputs": [],
  "confidence": {
    "level": "low",
    "score": 0,
    "scoreMeaning": "input completeness percentage, not probability",
    "explanation": ""
  },
  "dataSources": [],
  "calculationVersion": "4.0.0",
  "generatedAt": ""
}
```

Each module carries the same metadata and its own `result`, `reasons`, `messages`, `assumptions`, `missingInputs`, `confidence`, `dataSources`, version, and timestamp. `messages` is the locale-neutral explanation contract: each entry has a stable `engine.*` code and a `params` object. Irrigation also returns a `recommendationMessage`; unavailable recommendation categories return `messages` and `riskMessages`. Legacy English `reasons` and recommendation text remain for API compatibility, while the farmer UI renders the structured codes using `engineMessages` templates in English, Marathi, or Hindi. Numeric parameters stay numeric in the API and are not changed by language selection. The water module's `decisionStatus` is `deficit`, `surplus`, or `insufficient_data`; its module-level `status` still means the calculation completed successfully. Python returns null numeric results where evidence is incomplete.

Example:

```json
{
  "code": "engine.sensor.moisture_recorded",
  "params": { "moisturePct": 20.0, "source": "LIVE_SENSOR" }
}
```

The matching locale template is `engineMessages["engine.sensor.moisture_recorded"]`; all three catalogs must preserve the same code set and named placeholders. Missing templates render a localized unavailable message rather than displaying a success-shaped blank.

## Modules and formulas

### Land Power

Land Power remains a transparent 0–100 **prototype indicator**, not a standard soil-health index. It starts at 60 and retains these legacy prototype adjustments:

- Soil pH from 6.0 through 7.8: `+6`; otherwise `-7`.
- EC at or below 4 dS/m: `0`; above 4: `-10`.
- Organic carbon at or above 0.75%: `+8`; below 0.50%: `-8`; otherwise `0`.
- Two latest recorded seasons with the same crop name: `-8`.
- Recorded rain-fed water source: `-4`.
- Recorded drip irrigation: `+3`.
- Clamp the final integer score to `[0, 100]`.

The pH/EC/organic-carbon indicators are explained individually. N/P/K are reported but not scored. Missing values are excluded from the formula, explicitly listed, and lower evidence completeness. Soil-test histories are returned as dated observations without manufacturing a historical score from yields.

### Crop recommendations and Farm Memory

Three planning lenses are retained as response categories. They return no crop and no suitability score until reviewed regional crop references, scoring rules, and essential-constraint checks are configured. The catalog file is `python/agronomic_references.json`; it is intentionally empty. No variety, market price, yield, water requirement, disease risk, or fertilizer dose is synthesized.

Farm Memory summarizes the recorded crop sequence and repeated adjacent crop names. It does not infer crop family, nutrient effects, pest/disease relationships, or guaranteed soil improvements. Missing history and missing crop-family reference data are explicit.

### Water budget

The calculation requires:

- Cultivated area (sum of zones where present, otherwise recorded farm area).
- Crop water depth for the explicit planning period.
- A complete effective-rainfall record for that period.
- Available water, represented either as pre-aggregated `availableWaterLitres` or both stored and reliable incoming water.

Conversion: `1 mm × 1 acre = 4,046.8564224 litres`.

```text
Projected crop demand (L) = crop depth (mm) × area (acre) × 4,046.8564224
Net irrigation depth (mm) = max(0, crop depth − effective rainfall)
Gross irrigation requirement (L) = net depth × area × 4,046.8564224 ÷ supplied efficiency
Water balance (L) = available water − gross irrigation requirement
```

If a positive irrigation requirement exists but efficiency is unknown, the gross requirement and balance remain unavailable. Missing rainfall is not zero. Zone allocation, when computable, is proportional to recorded zone area and explicitly is not an irrigation schedule. Duplicate weather dates within the supplied period are rejected.

### Irrigation advice

The engine excludes sensor observations older than one hour. A fresh moisture reading, crop-specific reviewed trigger/depth, root-zone depth, area, irrigation method, available water, and complete effective-rainfall period are required before it returns an amount. Otherwise it gives a measurement/review prompt with null quantity and no exact schedule. It never actuates a pump or valve; human confirmation remains required.

### Drought and flood/waterlogging

No regional validated risk model or thresholds are currently configured. Consequently, scores are null and risk levels are `unassessed`, except a complete supplied water budget deficit may be labelled `potential_concern` (not an official drought classification). Stale/missing moisture and incomplete rainfall are called out. Waterlogging guidance is precautionary and is not an official flood warning.

### Profit analysis

Recorded gross revenue is `recorded yield × recorded selling price`. Recorded net profit is available only when revenue and itemized expenses are present and the farmer confirms `expensesComplete`. Break-even price is `complete expenses ÷ recorded yield` when yield is positive. Demo-mode records appear only in the separate `demonstration` object and are never presented as actual farm income.

Future scenario outcomes require explicit crop-specific scenario yield, price, expenses, source, and assumptions. Farmer-entered low/medium/high scenarios are stored separately from actual harvests and are only supplied to the engine when yield, price, and all itemized expenses are explicitly complete. Incomplete scenarios remain visible as unknown and are not calculated; demo market prices and prototype yield values are not used.

## Confidence, sources, and limitations

Confidence `score` is a rounded input-completeness percentage for that module, not a probability, calibration, or measure of agronomic accuracy. The textual explanation repeats this limitation. `dataSources` retains source labels and counts; demo mode is separately identified.

No authoritative regional agronomic source has been loaded into the project. The legacy Land Power thresholds are not sourced or validated. The recommendation catalog is empty, and drought/flood scoring is intentionally disabled. An agronomist must approve regional ranges, scoring rules, crop constraints, and citations before those features can rank crops or produce risk scores.

## Verification

```powershell
pnpm test
pnpm python:test
```

The suites cover the JSON/process boundary, failure and timeout behavior, missing values, soil inputs, provisional Land Power, water units, stale sensors, risk-score withholding, rotation history, financial separation, and input extremes.
