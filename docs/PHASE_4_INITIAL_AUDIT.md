# Phase 4 Initial Repository Audit

**Audit date:** 2026-11-06  
**Scope:** Static inspection before Phase 4 closure work. No separate deployment or runtime provider traffic was inspected.

## Executive summary

The repository already contains significant Phase 4 work. Phase 4.1 unknown-value validation and the Phase 4.2 structured planning-record API are present; the earlier `PHASE_4_CLOSURE_AUDIT.md` documents the engine's safety gates and agricultural evidence limitations. However, the actual farmer Farm Memory screen is still the older seasons/activities/soil/decisions view. It is not evidence that structured crop and water planning history is integrated into the farmer workflow. The admin dashboard exposes calculation `missingInputs` in decision scenario cards, but has no dedicated data-quality issue model, filters, or remediation view. Locale catalogs are structurally matched, while variable engine reasons and recommendations are not consistently represented by stable message codes.

This audit is the baseline. Implementation must preserve the existing vanilla JavaScript frontend, Express API, Python calculation engine, JSON/demo store, authentication, and farm ownership checks. No agricultural reference catalog is available, so unsupported rankings, calibrated risks, and crop-driven quantities remain disabled. NuGen and MySQL are explicitly out of scope.

## Existing implementation by phase

| Phase / area | Initial status | Evidence inspected |
|---|---|---|
| 4.1 — Unknown historical values | **Partially completed; verify and close gaps** | `src/validators.js` has nullable numeric/date helpers and Phase 4.1 payload validators; `tests/input-integrity.test.mjs` verifies unknown harvest season/year/yield/price and explicit zero. Farmer season and soil forms exist in `public/app.js`. |
| 4.1 — Soil-test validation | **Partially completed** | `soilTestPayload` validates parameter-specific units and retains method; focused integrity tests cover common incompatible-unit/range cases. Legacy records still require quality display rather than automatic reinterpretation. |
| 4.2 — Crop plans and planning periods | **Partially completed** | `server.js` has farm-scoped crop-plan and planning-period create/read/update/delete routes, zone ownership checks, and overlap checks. `tests/phase4.2.test.mjs` covers record creation and overlap rejection. |
| 4.2 — Effective rainfall and water history | **Partially completed** | Farm-scoped effective-rainfall, water-availability, and water-use-event CRUD routes and payload validators exist. Rainfall is explicitly recorded rather than derived from total rainfall. Coverage and Farmer UI integration are incomplete. |
| 4.2 — Financial scenarios | **Not implemented** | The inspected route inventory and project checklist contain no structured low/medium/high scenario write path. Actual harvest finance remains a separate record type. |
| 4.3 — Farmer Farm Memory | **Partially completed** | `renderMemory()` in `public/app.js` displays existing season, activity, soil-test and decision data. Structured crop plans, planning periods, rainfall, water inventory, and water-use events do not yet constitute a complete searchable agricultural timeline and history experience. |
| 4.4 — Admin data quality | **Partially completed** | Admin decision records include calculation `missingInputs` and metadata, but `public/admin.js` has no dedicated Data Quality module and the inspected server routes have no categorized issue feed with filtering/remediation metadata. |
| 4.5 — Dynamic multilingual explanations | **Partially completed** | `public/locales/{en,mr,hi}.json` share a translation-key shape, and `tests/locales.test.mjs` checks parity. Farmer display still uses string lookup/localized status helpers; the Python engine returns prose rather than a complete locale-neutral message-code contract. |
| Agricultural reference gates | **Requires external agricultural validation** | `python/agronomic_references.json` has no reviewed reference records; `docs/AGRONOMIC_ASSUMPTIONS.md` documents provisional Land Power and withheld crop/risk outputs. |
| NuGen | **Deferred / not implemented** | `docs/NUGEN_INTEGRATION_AUDIT.md` confirms the local assistant is a template fallback. The supplied Phase 4 specification prohibits live integration without separate approval. |
| MySQL | **Deferred / not implemented** | Existing JSON/demo storage remains the active store; Phase 4 prohibits MySQL integration. |

## Test and documentation baseline

- Node test command: `pnpm test`; Python test command: `pnpm python:test`.
- Existing focused coverage includes `tests/input-integrity.test.mjs`, `tests/phase4.2.test.mjs`, and `tests/locales.test.mjs`, alongside authentication, admin, core, and Python engine suites.
- `TODO.md` identifies planning inputs, Farm Memory soil trends, admin data-quality details, and dynamic explanations as unfinished.
- `docs/PHASE_4_CLOSURE_AUDIT.md`, `docs/DECISION_ENGINE.md`, `docs/AGRONOMIC_ASSUMPTIONS.md`, and `docs/API.md` provide the existing design and safety baseline.

## Closure work to perform

1. Verify and strengthen input semantics and boundary tests without changing legacy record meaning.
2. Complete farmer access to the already-existing planning records, implement required missing structured records only where absent, and avoid activating any calculation without complete inputs and reviewed evidence.
3. Extend the existing Farm Memory view with real stored records, chronology, and clear provenance/unknown-value display.
4. Add a bounded, admin-only categorized data-quality API and dashboard view without silently correcting farmer measurements.
5. Add stable locale-neutral explanation codes and equivalent English, Marathi, and Hindi messages while preserving numeric outputs.
6. Update API, engine, assumptions, closure, feature documentation, and `TODO.md`.
7. Run the full Node and Python test suites, relevant syntax/JSON checks, and verify authorization, ownership, missing-value, and locale-parity behavior.

This is a software-foundation closure effort, not agronomic approval or production-readiness certification.
