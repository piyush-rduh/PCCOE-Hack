# Phase 4 Closure Audit and Implementation Plan

**Audit date:** 2026-11-06  
**Scope:** Close Phase 4 within the existing Node.js/Express backend, Python calculation engine, vanilla frontend, JSON store, authentication model, and existing safety gates.

## Executive summary

The Phase 4 engine migration is present. Express assembles farm-scoped records from the existing store, invokes the fixed Python engine, validates its response, and returns structured decision modules. The engine deliberately withholds crop rankings, exact irrigation quantities, future financial estimates, and calibrated climate-risk scores when required inputs or reviewed references are absent.

Closure work falls into two different tracks:

1. **Can be implemented now:** improve the input and data-quality contracts, add farmer and admin screens backed by existing authenticated APIs, make unknown values explicit in forms, render the already-returned soil observations, and replace fragile runtime-string translation with stable message keys.
2. **Requires external agricultural review first:** approve regional Land Power scoring, crop ranking and rotation rules, crop water and irrigation parameters, and calibrated drought/flood thresholds. These features must stay disabled until that review and its cited evidence are complete.

No evidence was found in the repository of reviewed Maharashtra agronomic reference records. `python/agronomic_references.json` currently contains an empty `references` array. The prototype Land Power thresholds are documented as provisional rather than validated.

## 1. Current implementation findings

| Area | Finding | Status |
|---|---|---|
| Engine boundary | Express calls `python/decision_engine.py` through the bounded JSON process service. The engine returns structured modules, missing inputs, assumptions, confidence-as-completeness, data sources, calculation version, and timestamp. | **Completed** |
| Missing-data behavior | Missing measurements generally remain `null`/unknown. The engine validates input shape and rejects invalid numerical values; the service bounds process duration/output and sanitizes failures. | **Completed** |
| Land Power | The score uses legacy provisional adjustments: baseline 60; pH 6.0–7.8 `+6`, otherwise `−7`; EC ≤4 dS/m `0`, above 4 `−10`; organic carbon ≥0.75% `+8`, <0.50% `−8`, otherwise 0; repeated adjacent crop name `−8`; Rain-fed `−4`; Drip `+3`; clamp 0–100. These rules are not supported by reviewed regional citations and do not constitute a standardized soil-health score. N/P/K are displayed but not scored. | **Requires external agronomic validation** |
| Crop and rotation recommendations | The Python engine returns restoration, balanced, and profit-oriented categories but no ranked crop or suitability score. Rotation history only detects repeated adjacent crop names; it does not infer crop families or disease/nutrient relationships. The reference catalog is empty. | **Requires external agronomic validation** |
| Water budget | The engine supports period-specific crop depth, effective rainfall, cultivated area, water availability, and supplied irrigation efficiency. Farmer-owned planning, rainfall, water inventory and water-use records are now captured and displayed, but the complete calculation bundle is not inferred from them. | **Partially completed; calculation gated** |
| Irrigation advice | The engine requires a fresh moisture reading and crop/stage-specific trigger, depth, root-zone, area, water and weather inputs before it returns an amount. It requires human confirmation and has no pump/valve control. Crop-specific values remain unavailable pending reviewed references. | **Partially completed; calculation gated** |
| Climate risk | The engine describes observations and may identify a potential water shortage, but does not calculate calibrated drought, flood, or waterlogging scores. No regional thresholds or model are configured. | **Requires external agronomic validation** |
| Historical finance | Recorded revenue uses known yield and selling price; unknown values remain null. Net profit requires itemized costs and `expensesComplete: true`. Demo-mode values are separated from actual farm values. New/updated records no longer default a missing season or year. | **Partially completed** |
| Soil-test input integrity | Farmer entries now preserve a nullable value, parameter-specific unit, test method and date. Invalid units/ranges/dates are rejected at the API boundary. Legacy values with missing or incompatible method/unit remain visible with quality warnings and are excluded from the provisional Land Power indicator. | **Partially completed** |
| Future finance | Low/medium/high farmer-entered scenarios have validated farm-owned CRUD routes and forms. Only complete scenarios with explicit yield, price, non-empty itemized costs and confirmation enter calculation; incomplete scenarios remain unknown and uncalculated. | **Completed** |
| Farmer Farm Memory | The memory view now includes a filtered timeline, crop plans, dated soil trends separated by unit/method, planning periods, effective rainfall, water availability/use and separately labeled actual/demo/scenario finance. | **Completed** |
| Admin data quality | `/api/admin/quality` and the admin dashboard provide bounded, filterable, paginated missing/stale/invalid/inconsistent/provenance findings and summary counts. Findings contain only safe identifiers, allowlisted values and fixed remediation text. | **Completed** |
| Dynamic multilingual explanations | Engine modules now return stable `engine.*` codes and typed params for decision reasons; en/mr/hi templates share code/placeholder parity and are used in farmer recommendation, irrigation and risk views. Numeric values remain engine output, not locale-specific calculations. | **Completed for rendered decision explanations** |
| Security and compatibility | Farmer farm APIs use authentication and farm ownership checks. Admin decision/report surfaces require authenticated admin identity. The project continues to use Express, Python, vanilla frontend code, and the current store; no database integration is needed for closure. | **Completed** |

### Relevant current implementation

- Engine and reference status: [`python/decision_engine.py`](../python/decision_engine.py), [`python/agronomic_references.json`](../python/agronomic_references.json), [`docs/DECISION_ENGINE.md`](./DECISION_ENGINE.md), [`docs/AGRONOMIC_ASSUMPTIONS.md`](./AGRONOMIC_ASSUMPTIONS.md).
- API assembly, ownership checks, farmer records, and admin reports: [`server.js`](../server.js), [`src/decision-service.js`](../src/decision-service.js), [`src/store.js`](../src/store.js), [`src/validators.js`](../src/validators.js).
- Farmer UI and localization: [`public/app.js`](../public/app.js), [`public/locales/en.json`](../public/locales/en.json), [`public/locales/mr.json`](../public/locales/mr.json), [`public/locales/hi.json`](../public/locales/hi.json).
- Admin UI: [`public/admin.js`](../public/admin.js).
- Automated coverage: [`tests/core.test.mjs`](../tests/core.test.mjs), [`tests/admin-api.test.mjs`](../tests/admin-api.test.mjs), [`python/test_decision_engine.py`](../python/test_decision_engine.py).

## 2. Missing functionality

1. No reviewed, regionally scoped crop/soil/water/risk reference records or enabled approval workflow; all reference-dependent rankings and calibrated scores remain disabled.
2. Crop plans, planning periods, effective rainfall, explicit water inventory and low/medium/high scenarios now have farmer UI/API paths, but no crop water requirement, irrigation trigger/depth/root-zone parameter is inferred or included without reviewed evidence.
3. Planning records are persisted and visible in Farm Memory. The water calculation remains unavailable unless the engine receives a complete period-specific calculation bundle; total rainfall and unknown water are never substituted.
4. Crop plan UI/API covers crop, season, growth stage, zone and dates; reference-backed water parameters remain intentionally absent.
5. **Resolved in Phase 4.1:** harvest/season create/edit accepts unknown season, year, yield and selling price as null; the form no longer requires unknown yield/price and does not default the season/year. Incomplete records are labeled in Farm Memory. Actual, demonstration and estimate separation remains in the engine.
6. **Resolved in Phase 4.1 for new writes:** soil input uses parameter-specific unit choices, captures method, permits an unknown value, validates known parameter ranges and valid dates, and warns about missing/incompatible legacy method/unit. The provisional indicator skips values without compatible units and a recorded method. Legacy raw soil records remain readable.
7. **Resolved:** explicit farmer-entered low/medium/high financial scenarios are persisted separately and only complete scenarios are calculated.
8. **Resolved:** Farm Memory renders per-parameter dated soil history and structured crop, planning, rainfall, water-use and financial records with filters and provenance.
9. **Resolved:** admin quality has bounded issue scans, categories, pagination, filters, safe display values and remediation.
10. **Resolved for rendered decision explanations:** Python returns locale-neutral code/parameter messages; en/mr/hi templates are parity-tested and farmer screens render them without changing calculation values.

## 3. Relevant files and APIs

### Existing farmer-facing endpoints

| Endpoint | Current role in Phase 4 | Closure impact |
|---|---|---|
| `GET /api/dashboard?farmId=...` and `GET /api/farms/:id` | Return farm bundle, structured planning records, and Python decision results after ownership verification. | Existing read model; planning, rainfall, water, and scenario records are included in the farm-scoped bundle. |
| `POST/PUT /api/farms`, `PUT /api/farms/:id` | Store farm name, area, soil type, water source, irrigation method, efficiency, available water, and location. | Reuse for farm-wide stable facts; do not make users re-enter them for each decision. |
| `POST /api/zones`, `PUT /api/zones/:id`, `GET /api/farms/:id/zones` | Store zones and their area, soil, current crop and growth-stage context. | Zone-scoped crop plans use separate routes; free-text zone fields are not treated as full plans. |
| `GET /api/recommendations`, `GET /api/water-budget`, `GET /api/irrigation-advice`, `GET /api/climate-risks`, `GET /api/profit-analysis` | Return farm-scoped calculation results; no planning input is submitted through these GET routes. | Keep reads side-effect-free where practical; add authenticated write routes for planning inputs rather than encoding them in query parameters. |
| `POST/PUT /api/soil-tests`, `POST/PUT /api/activities`, `POST/PUT /api/harvests` | Store farmer-owned history with validation. | Soil method/unit and nullable value; harvest optional season/year/yield/price; nullable activity quantity. Existing auth and ownership checks are unchanged. |
| `/api/farms/:farmId/crop-plans`, `/planning-periods`, `/effective-rainfall` | Farmer-owned structured crop/planning/rainfall record CRUD. | Unit/date/provenance validation and links are checked; period deletion is protected when rainfall records reference it. |
| `/api/farms/:farmId/water-availability`, `/water-use-events` | Farmer-owned water inventory and structured water-use CRUD. | Explicit type/unit/date/timestamp; aggregate/component double counting is rejected for a farm/date. |
| `/api/farms/:farmId/financial-scenarios` | Farmer-owned low/medium/high scenario CRUD. | Incomplete scenarios are preserved but excluded from engine calculations. |
| `GET /api/weather` | Returns weather observations/forecast from the existing adapter/store. | A weather record must not be treated as effective rainfall without a source/method that explicitly supports that interpretation. |

### Existing admin endpoints

- `GET /api/admin/decisions` is authenticated and admin-only. It returns decision records and per-farm scenario summaries with engine `missingInputs`, calculation version/time, and counts of zones, soil tests, seasons, activities, and data sources.
- `GET /api/admin/quality` is admin-only and returns bounded, paginated/filterable data-quality issues and summary counts without free-text notes or contact data.
- `GET /api/admin/health` and the admin dashboard provide operational health/integration information.
- `GET /api/admin/farms/:id` is admin-only and returns a farm record; credentials and unnecessary personal data are excluded from quality findings.

## 4. Required agricultural references

### Reference sources to consult

The following are candidate authoritative sources, not citations already verified or approved by this repository:

- ICAR and relevant ICAR institutes for crop production, soil interpretation, water management, and validated methods.
- Maharashtra agricultural universities selected for the farm's district/agro-climatic zone: Mahatma Phule Krishi Vidyapeeth (MPKV), Vasantrao Naik Marathwada Krishi Vidyapeeth (VNMKV), Dr. Panjabrao Deshmukh Krishi Vidyapeeth (PDKV), and Dr. Balasaheb Sawant Konkan Krishi Vidyapeeth (DBSKKV).
- Maharashtra Department of Agriculture and relevant state government publications for local recommendations and advisories.
- India Meteorological Department (IMD) for weather/climate observations and documented climate normals/methods; Central Water Commission (CWC) and Central Ground Water Board (CGWB) for relevant hydrology and water context.
- Government soil testing/Soil Health Card protocols for test methods, units, and interpretation. Use official market data sources only if an explicitly sourced price scenario is later approved.

For each intended use, select an actual publication or dataset, version, page/table, publication date, geographic scope, measurement method, and citation URL or archive location. Institutional name alone is not adequate evidence. A reviewer must confirm that a source applies to the target district/zone, crop, season, soil, growth stage, and irrigation context.

### Calculations needing references or validation

| Calculation/use | Required evidence before enabling | Current status |
|---|---|---|
| Land Power score | Soil pH, EC, and organic-carbon interpretation limits with test methods and units; agronomist-reviewed score meaning, factor weights, missing-data behavior, and validation across applicable local soils. Any N/P/K scoring requires method-specific units and interpretation limits too. | Existing scoring remains provisional and visibly non-standardized. Do not present it as a validated health rating. |
| Crop ranking and restoration/balanced/profit lenses | Candidate crop/variety suitability by district/agro-climatic zone and season; sowing window; soil and water constraints; crop-family/rotation incompatibilities; essential disqualifying conditions; and a reviewed, explainable scoring/weighting method. Profit lens also needs sourced yield, price, and cost assumptions or explicit farmer-supplied inputs. | No candidate is ranked. |
| Crop sequence/rotation interpretation | Crop-to-family mapping, valid rotation intervals and constraints, and relevant disease/nutrient references with region/crop applicability. | Only literal repeated adjacent crop names are summarized. |
| Water demand and irrigation depth | Crop water requirement or ET-based method by crop, season, growth stage, soil, and planning period; effective-rainfall method; irrigation method efficiency evidence; root depth/available soil water; depletion/trigger threshold; and application-depth basis. | The unit conversion is implemented, but no crop depth or irrigation parameters are populated from an approved catalog. |
| Drought score/classification | Defined index, data provenance and temporal window, local historical baseline, calibrated thresholds, spatial resolution, missing/stale-data handling, and expert validation against local events. | Scores are withheld; a water deficit is not labeled an official drought. |
| Flood/waterlogging score | Validated local rainfall/runoff/flood or waterlogging method, topography/drainage/soil context as required, historical validation, official warning boundary, and escalation wording. | Scores are withheld; general precautions are not a warning. |
| Future financial scenarios | Explicit scenario methodology and assumptions. Any yield, price, input cost, and uncertainty range must be sourced, dated, geographically/seasonally appropriate, and clearly distinguished from farmer-entered actuals. | Future scenarios are unavailable. Historical arithmetic remains available only with sufficient records. |

### Proposed versioned reference-record structure

Keep the catalog in version-controlled project data and continue to load it server-side in Python. A record should contain at least:

```json
{
  "id": "stable-reference-id",
  "kind": "crop_water_requirement",
  "institution": "issuing institution",
  "title": "publication or dataset title",
  "citation": "edition/version, page/table, stable URL or archive identifier",
  "publicationDate": "YYYY-MM-DD or null",
  "retrievedAt": "YYYY-MM-DD",
  "applicableRegion": {
    "state": "Maharashtra",
    "districts": [],
    "agroClimaticZone": null,
    "soilContext": []
  },
  "crop": { "name": "source-preserved crop name", "variety": null },
  "season": [],
  "growthStage": null,
  "parameter": "explicit parameter and method",
  "value": null,
  "range": { "minimum": null, "maximum": null },
  "unit": "explicit unit",
  "conditions": {},
  "intendedUse": "display-only | calculation-input | scoring-rule",
  "constraints": [],
  "limitations": [],
  "review": {
    "status": "draft",
    "reviewerRole": null,
    "reviewedAt": null,
    "approvalId": null
  }
}
```

The actual schema may be split into reference values and separate rules, but must be versioned and validated. Only `approved` records matching all required context can enter calculations. Draft, expired, unreviewed, region-mismatched, or unit-incompatible records must be ignored and surfaced as unavailable. Store the calculation/rule version and contributing reference IDs in each result for reproducibility. Never create defaults or scores from an empty/unapproved catalog.

## 5. Data models and validation requirements

### Input inventory and proposed entry points

| Engine input | Current source/API path | Missing or incomplete | Proposed place to enter/update |
|---|---|---|---|
| Farm area, water source, irrigation method | Farm create/edit form and `POST/PUT /api/farms`; `areaAcres` required, efficiency `(0,1]` if present, available water nonnegative. | Stable facts exist, but zone areas may be incomplete or not reconcile with farm area. Efficiency must identify whether it is measured, source-derived, or unknown. | Keep farm-wide fields in farm profile. Let zone areas be entered once in zone management; display area totals and inconsistency warnings. |
| Zone active crop, variety, season, growth stage and dates | Zone has free-text current crop and growth stage; engine consumes `activeCrops`; no complete active-crop write API/form is wired in the current flow. | Structured zone-scoped planted-crop plan and associated water parameters are absent. | Add a farmer-owned active crop plan per zone/season, linked to the existing zone and season records. Edit the existing plan rather than prompting again on each calculation. |
| Period crop water requirement | Engine accepts `waterRequirementMm` / `planningPeriodWaterRequirementMm` for an explicit period. | No validated catalog and no farmer form/API field currently supplies it. Do not infer by crop name. | Derive only from an approved matching reference; otherwise leave unavailable. If a reviewed human-supplied estimate is later allowed, label its source and require units/period. |
| Planning window | Engine expects `waterPlanningPeriodDays` (integer 1–365). | Current farm bundle does not set it or expose a user planning-period control. | Add start/end dates or an explicit duration to a saved plan, with one active planning window per relevant farm/zone; avoid repeated prompts on every page. |
| Effective rainfall | Engine expects one `effectiveRainfallMm` value per day in the planning window. Weather records currently provide observed/forecast rainfall, but total rainfall is not converted into effective rainfall. | No effective-rainfall method/data path and completeness checking at the API boundary. | Use only a reviewed method/source or a farmer-entered value explicitly labeled effective rainfall; persist by date, period, zone/farm, method, unit, source and provenance. Do not silently substitute total rainfall or zero. |
| Water availability | Farm form supports `availableWaterLitres`; engine also accepts separately named stored and reliable incoming water. | No clear source/measurement date/freshness model. Values can be mistaken for measured or current inventory. | Capture amount, unit (litres), source/type, measured/entered date, and optional reliability/validity period once in farm water inventory; preserve unknown. Avoid summing overlapping aggregate and component totals. |
| Irrigation efficiency | Farm form accepts fraction `(0,1]`, browser UI presents `0.01–1`. | No method-specific assumption is allowed, but entry lacks contextual provenance/measurement basis. | Store once on farm/irrigation-system profile with fraction, applicable system, source, and effective dates. Do not auto-fill typical values absent approved evidence. |
| Irrigation trigger, root-zone depth and application depth | Python engine accepts crop fields for trigger, `rootZoneDepthMm`, `irrigationDepthMm`, and area. | No farmer form/API path or approved reference lookup. | Populate only from an approved crop/soil/stage reference or a reviewed extension path; otherwise hide/disable numeric advice and show missing fields. |
| Fresh sensor moisture | Sensor-reading API and farmer monitoring UI; engine excludes readings older than one hour. | Existing freshness policy is fixed in code; admin quality page does not expose stale classification. | Continue deriving from recorded timestamp and source; display age and stale status. Review the one-hour policy as a product/sensor-operational threshold, not a crop threshold. |
| Historical soil | `POST/PUT /api/soil-tests`; farmer memory lists dated parameter/value/unit entries. | Unit is optional/free text; accepted parameter values need canonical mapping, test method and parameter-specific unit rules before interpretation. | Use a parameter-specific unit selector and preserve source/lab/method where available. Do not score measurements with incompatible units. |
| Historical crops and finance | `POST/PUT /api/harvests`, stored seasons, and farmer season form; records include crop, season/year, area, yield, price, dates, expenses, completeness. | Yield/price currently required in UI; validator defaults blank season/year. Structured production unit, sale date/price basis, and source context should be clear. | Allow unknown yield/price as null, require explicit year/season only when known, and keep actual financial records separate from estimates. |
| Future financial scenarios | Engine accepts `financialScenarios`; no farmer form, endpoint or persisted source in current farm bundle. | All low/medium/high scenario values and assumptions are absent. | Add optional scenario records linked to zone/crop/season; keep scenario values separate from actual harvest records and require explicit source, units, date, and assumptions. |

### Validation contract for new/adjusted inputs

- **Unknown semantics:** nullable/omitted means unknown. Never coerce an empty number to zero, nor infer a crop, season, year, rainfall, soil property, yield, price, expense, or efficiency. Do not default a missing season to `Rabi` or a missing year to the current year.
- **Numeric safety:** finite numbers only; reject booleans, NaN, infinity, negative values where physically invalid, and out-of-range values. Define decimals/precision and maximum payload/array sizes.
- **Units and context:** every value carries an explicit canonical unit and context. Proposed units include area `acre` (existing API unit), water volume `litre`, depth/rainfall/root-zone/application `mm`, efficiency as a fraction `(0,1]`, soil moisture as `%`, temperature `°C`, yield `quintal` with explicit area basis where applicable, and price/cost `INR` with their unit basis. Do not compare values with different measurement methods/units without an approved conversion.
- **Dates:** ISO `YYYY-MM-DD` for dates, timestamps with timezone for measurements, start ≤ end, period length within 1–365 days, no duplicate daily rainfall dates, no future-record timestamps unless the field explicitly represents a forecast, and no unexplained overlap in active plans.
- **Cross-field consistency:** zone area must be positive when supplied; report rather than silently rewrite mismatch with farm area. A period calculation requires complete daily effective-rainfall entries and a matching crop plan for each included zone. Do not sum `availableWaterLitres` with stored/incoming components unless the contract explicitly says one is not an aggregate.
- **Enums and provenance:** canonical crop/season/stage/parameter/unit values where applicable; keep source, method, reference ID/version, entry time and user-entered vs sensor/official provenance. Validate source and reference status server-side, not from client claims.
- **Soil tests:** validate units/method by parameter (for example pH is unitless, EC method/unit must be identified, and organic carbon basis must be explicit); preserve the raw lab result and do not calculate interpretations until the chosen test protocol is supported.
- **Financial records:** allow missing yield/price as unknown; nonnegative finite known values; explicit expense currency and basis; require farmer confirmation before net-profit calculation; make the completeness confirmation reversible on edit.
- **Historical records:** do not label a demonstration/default/estimated value as farmer-measured actual data. Preserve correction history/source metadata where feasible within the current store.

## 6. Farm Memory and admin data-quality UI changes

### Farmer-facing Farm Memory (implemented)

1. **Crop and season timeline:** implemented with crop, zone, season/year, dates, source, missing fields, filters and edit actions. Unknown values stay blank/unknown.
2. **Soil history:** `landPower.historicalChanges` is shown as separate dated series by parameter, unit and method/source. The score remains provisional.
3. **Water history:** structured planning periods, effective rainfall, water inventory and use events have authenticated farmer-owned CRUD and Farm Memory surfaces. No historic water balance is inferred.
4. **Financial history:** actual, demonstration and scenario data are separate; only complete confirmed inputs are calculated.
5. **Plan context:** active/planned crop plans and planning records are visible/editable; unsupported crop parameters remain missing rather than inferred.
6. **Access:** all farm edits use authenticated routes with server-side ownership checks.

### Admin data-quality interface

The dedicated `/api/admin/quality` endpoint and admin dashboard section summarize bounded scans and allow authorized admins to filter actionable issue categories:

- **Missing:** required plan fields absent; incomplete rainfall period; no soil test; no season/history; missing source/method.
- **Stale:** sensor readings beyond the documented freshness window; expired forecasts/plans/reference records.
- **Invalid:** server-rejected values and malformed records, without echoing secrets or raw attacker-controlled markup.
- **Inconsistent:** zone-area totals vs farm area; crop plan without matching zone/season; duplicate/overlapping period records; unit/source conflicts; impossible date ordering.
- **Provenance/reference:** unknown source, unreviewed reference, out-of-region or out-of-season reference. Such findings must block dependent calculations rather than merely warn.

The response exposes opaque record/farm IDs, issue code, severity, affected field, timestamps, allowlisted scalar display values, and fixed remediation hints. It omits free-text notes and contact data, credentials, JWTs, and token hashes. The route requires `auth` plus `requireAdmin`, supports filters and pagination, and caps each scanned collection at 500 records with truncation metadata. Farmer APIs continue to verify ownership.

## 7. Dynamic multilingual explanation design

### Implemented contract

Python decision modules include stable `engine.*` message codes and typed params alongside legacy English reason strings. The farmer UI resolves these codes through `engineMessages` templates and safely interpolates data values; legacy numeric results are not localized or changed. English, Marathi, and Hindi catalogs are checked for matching code sets and named placeholders. Unknown message codes render a localized “explanation unavailable” notice rather than raw Python prose.

### Proposed response and translation-key structure

Keep calculations and numeric outputs in Python and return locale-neutral structured messages. Do not translate numbers in the engine or make localization change calculation output.

```json
{
  "code": "engine.sensor.moisture_recorded",
  "params": { "moisturePct": 20.0, "source": "LIVE_SENSOR" }
}
```

Use the version-controlled `engine.*` namespaces defined by the Python engine and locale catalogs.

Each code has English, Marathi, and Hindi templates with named parameters. Numeric values remain numbers until the frontend formats them with the active locale; crop names, variety names, IDs, units, institution names, and technical terms are preserved or explicitly cataloged. Do not translate a crop name unless a reviewed canonical name/alias mapping exists.

### Fallback and parity rules

1. The selected language resolves the exact code; if unavailable, show the localized explanation-unavailable text and retain result/status/input information.
2. Development tests require equal code structure and placeholders across all locales.
3. Numeric values remain typed engine params and are interpolated as data; locale selection does not rerun or alter calculations.
4. Legacy `reasons` remain temporarily for API compatibility; farmer-facing reason views use structured messages.

## 8. Security and compatibility considerations

- Preserve Express, the fixed Python process boundary, the existing store, REST contracts where possible, and vanilla HTML/CSS/JavaScript. No React migration or database connection is part of this phase closure.
- Add farmer write endpoints with `auth`, verify farm ownership for every farm/zone/plan ID, and prevent moving records across farms. Add admin reads with `auth` and `requireAdmin`.
- Never trust client-supplied role, `farmerId`, source, reference approval status, or user identity. Derive actor identity from authenticated server state.
- Keep reference data server-side/read-only to clients unless an explicitly safe citation summary is needed. The client must not submit trusted calculation thresholds.
- Validate unknown keys/size/depth as appropriate; use existing payload validation, output escaping, parameterized safe DOM rendering, and bounded list/pagination patterns.
- Do not leak credentials, token hashes, raw environment values, Python tracebacks, or internal stack traces in admin quality reports or localized errors.
- Keep recommendation/risk/irrigation gates closed unless the reference/input requirements are complete and approved. A missing translation, reference, or measurement must not turn into a numeric default or a fabricated recommendation.
- Preserve `calculationVersion`, add reference/rule version and IDs where applicable, and make output changes backward-compatible or versioned.
- Do not automatically operate pumps, valves, or other equipment.

## 9. Testing requirements

### Engine and reference tests

- Empty catalog returns unavailable recommendations and no calibrated risk/irrigation result.
- Only approved, versioned, context-matching references are used; draft, retired, wrong-region, wrong-season, wrong-unit, and expired references are excluded.
- Boundary tests for every reviewed rule, scoring constraint, crop eligibility exclusion, stage, period, and unit conversion.
- Land Power remains labelled provisional until explicitly approved and tested; no absent soil value changes the score as if it were zero.
- Water requires full planning-period effective rainfall, matching crop/zone/area, available-water semantics and required efficiency; partial/duplicate periods remain unavailable.
- Irrigation requires fresh measurement plus all reviewed parameters and never returns an amount without explicit human confirmation.
- Climate scores stay null without a validated model/data contract; precautionary text is not an official warning.
- Finance keeps unknowns null, separates demo/actual/scenario records, and only calculates net profit with complete expenses.

### API, validation and security tests

- Create/read/update/delete plan and water records with correct farmer ownership; cross-farmer IDs return forbidden; admin-only quality APIs reject farmer access.
- Reject malformed JSON, unknown enums/units, non-finite/out-of-range values, invalid dates, duplicate dates, incompatible units, oversized arrays and invalid cross-field combinations.
- Verify unknown fields remain unknown; blank season/year/yield/price do not become defaults or zero.
- Verify no credentials/token hashes or unsafe record content are exposed; preserve output escaping and current authorization tests.
- Verify pagination, filtering, stable issue codes, and bounded processing on admin quality data.

### Frontend and multilingual tests

- Add/edit/refresh each planning input and ensure values are not requested repeatedly or lost across language changes/reload.
- Farm Memory displays dated parameter history, source, units, unknowns, and water/financial record distinctions without mixing incompatible units.
- Admin quality filters for missing/stale/invalid/inconsistent records and presents remediation without sensitive data.
- For each message code, test English/Marathi/Hindi key and placeholder parity, fallback behavior, HTML escaping, and untranslated-key diagnostics.
- Assert numeric values, calculation statuses, and reference IDs are invariant across locales; only formatting/text changes.
- Keep existing Node and Python suites green and add focused API/UI smoke tests for new contracts.

## 10. Implementation order, risks and unresolved questions

### Status and remaining gate

1. **Completed:** input audit and nullable/unit/provenance contracts; unknown historical fields remain unknown.
2. **Completed:** authenticated farm-owned crop-plan, planning-period, effective-rainfall, water inventory/use, and financial-scenario CRUD with validation and related-record deletion safeguards.
3. **Completed:** farmer Farm Memory timeline, filters, comparable soil history, planning/water records, and distinct actual/demo/scenario finance.
4. **Completed:** bounded admin-only data-quality endpoint and localized dashboard with filters, pagination, safe display values and remediation.
5. **Completed:** stable engine message codes, en/mr/hi templates, placeholder parity checks, and numeric-invariance checks.
6. **Remaining external gate:** curate regionally relevant sources with agricultural experts; include exact citations, units, methods, geographic/crop/season/stage applicability, limitations and approvals.
7. **Blocked by review:** activate only reviewed crop-ranking, irrigation, soil scoring, or climate-risk rules. Until then, those outputs remain unavailable or explicitly provisional.
8. **Verification:** run full Node and Python suites, targeted ownership/admin/validation tests, locale checks and confirm calculations remain gated without complete evidence.

### Risks

- A publication can be authoritative but not applicable to a farm's soil, district, crop, stage, method, or measurement protocol. Citation presence alone must not enable a value.
- Converting total rainfall to effective rainfall, inferring typical irrigation efficiency, filling crop-water requirements, or assuming a period can produce plausible but unsupported results.
- Free-text historical crop names, seasons and units make false joins and misleading trends possible. Preserve raw entries while adding canonical identifiers only through reviewed mappings.
- Existing seeded/demo data and old rows may have defaulted season/year or unitless values. Mark provenance/quality explicitly; do not silently reinterpret them as verified actual records.
- Admin quality findings may expose farmer data. Minimize returned data and enforce admin-only access on every route.
- Large or frequent admin scans and synchronous Python calculations can affect responsiveness; paginate and compute summaries in bounded paths, without changing architecture in this phase.
- Translation parity can drift across three catalogs. Automated key/placeholder parity should be a release gate.

### Questions requiring product or expert decisions

1. Which Maharashtra districts/agro-climatic zones are in the initial supported scope, and which institution/publication will be the authority for each crop/parameter?
2. Who is the named agricultural reviewer and what evidence constitutes approval/expiry for a reference update?
3. Is the Land Power prototype score to remain display-only, or should it be removed until a validated interpretation and scoring method exist?
4. Which source/method may supply daily effective rainfall, and may farmers enter it directly when no such source is available?
5. What planning horizon should be supported by default, if any? The safe default may be no selected period; do not imply a crop cycle without user selection.
6. Should low/medium/high financial estimates be farmer-defined scenarios only, or may a later approved source provide scenario assumptions? Which yield/price/cost bases and dates are required?
7. Which quality issue categories are visible to admins, and what remediation can an admin perform versus request from the farmer?
8. What retention/audit expectations apply to edits of historical harvest, soil, water, and scenario records in the current in-memory/demo store?

## Immediate work versus external review

### Can be implemented immediately

- Correct unknown/default handling for historical season, year, yield and price.
- Add validated farmer-owned active-crop plans, planning-window inputs, effective-rainfall provenance, structured water history and explicit financial scenarios, while leaving calculations gated until evidence is sufficient.
- Render existing dated soil history and improve Farm Memory.
- Add admin-only missing/stale/invalid/inconsistent data-quality views and API contracts.
- Introduce stable locale-neutral engine message codes, English/Marathi/Hindi catalogs, fallback, parity tests and number-format invariance.
- Add input, ownership, authorization, privacy, compatibility and UI tests.

### Requires external agricultural expert review before calculation activation

- Regional Land Power thresholds/weights and any standardized interpretation.
- Crop suitability/ranking, crop-family/rotation constraints, and restoration/balanced/profit scoring.
- Crop/season/stage water requirements, effective-rainfall method, irrigation efficiency assumptions, root-zone, trigger and application-depth values.
- Calibrated drought/flood/waterlogging indices, thresholds and warning language.
- Any sourced future yield, price, cost, fertilizer, or risk assumptions used in a recommendation or estimate.

Until those reviews are documented in approved, versioned reference records and validated tests, keep rankings, exact crop-driven irrigation quantities, and calibrated risk scores disabled. Farmer-entered values may be stored and clearly attributed, but must not be presented as independently verified agronomic guidance.
