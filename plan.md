# AGCRO implementation plan

## Scope

AGCRO is being upgraded from a single-file localStorage prototype into a runnable hackathon MVP with a responsive farmer application, an admin monitoring surface, a Node/Express API, a relational schema and migrations, a Python decision engine, an ESP32 firmware example, and explicit boundaries for external weather, market, and AI integrations.

The existing prototype remains the source of truth for farmer-facing workflows and is preserved under `docs/original-prototype.html`. The delivered MVP keeps the AGCRO identity and module names while making the highest-value end-to-end loop functional:

**Plan → Grow → Monitor → Protect → Sell → Learn → Plan Again**

## Implementation approach

- **Frontend:** accessible, responsive vanilla HTML/CSS/JS served by Express so the prototype can remain lightweight and reliable in a hackathon environment. Farmer and Admin modes share one authenticated API surface and use the same stored data contracts.
- **Backend:** Node.js + Express JSON API with validation, centralized error responses, request logging, rate limiting, demo seed data, and a repository layer. It uses an in-memory demo repository by default for instant startup and can use the managed MySQL-compatible database when `DATABASE_URL` is present.
- **Decision engine:** Python CLI/service module with deterministic rule-based calculations for Land Power, crop recommendations, water budget, irrigation advice, climate risk, and profit scenarios. The Node API calls it when Python is available and has a documented safe JavaScript fallback for Preview portability.
- **Data:** `schema/migrations/001_init.sql` defines the relational model for farmers, farms, zones, sensors, readings, crops, activities, soil tests, decisions, alerts, weather observations, and harvest/financial records. The app seeds only clearly labelled demonstration records and never presents them as live data.
- **External integrations:** Open-Meteo and NeuGen are adapters, not invented live endpoints. The weather adapter defaults to simulated demonstration data until a provider response is verified; the AI adapter returns a structured, labelled fallback unless configured with a verified endpoint.
- **IoT:** the API accepts validated sensor readings and the firmware example transmits calibrated readings with device identity. The UI marks live, external, farmer-entered, and simulated data separately and flags stale/offline readings.
- **Admin:** `/admin` mode provides a separate dashboard view with overview metrics, device/alert status, decision review, and data export; authorization boundaries are explicit in the API even though a full production identity provider is outside the demo scope.

## Design

Three possible styles: `field-notebook` (0.07), `quiet-command-center` (0.05), `harvest-ledger` (0.08). Chosen: **quiet-command-center**.

- **Design movement:** quiet-command-center — a calm operational dashboard blending agronomy field notes with modern control-room hierarchy.
- **Core principles:** action before decoration; explain every number; show provenance beside data; keep farmer decisions reversible and explicit.
- **Color philosophy:** deep leaf green communicates trustworthy action, warm wheat accents separate warnings from errors, and pale soil neutrals reduce cognitive load during field use.
- **Layout paradigm:** a persistent rail with a wide “today” command surface, followed by evidence cards and a focused two-column detail area rather than a dense dashboard grid.
- **Signature elements:** provenance chips (`Live sensor`, `Demo data`, `Farmer record`); a water-budget balance rail; recommendation cards with `Why`, `Risk`, and `Confidence` sections.
- **Interaction philosophy:** every recommendation can be inspected, accepted, rejected, or deferred; no planted crop or pump action changes automatically.
- **Animation:** restrained 160–220ms transitions for route changes, status chips, and balance bars; no continuous motion or decorative loops.
- **Typography:** system sans stack for fast loading and Marathi/Hindi coverage; strong numeric hierarchy for yield, score, and water values.
- **Brand essence:** “Practical intelligence for the next farm decision.” Personality: grounded, transparent, useful.
- **Brand voice:** headlines use direct questions (“What should I do today?”); CTAs are specific (“Review water deficit”, “Record harvest”).
- **Wordmark:** AGCRO in a compact leaf-and-row monogram used as the navigation mark.
- **Signature brand color:** `#2E6B4E` leaf green.

## Project structure

```text
public/                 Farmer + admin web app, styles, route manifest
server.js               Express entry point and REST routes
src/                    Repository, validation, decision and integration modules
python/                 Deterministic decision engine
schema/migrations/      Relational schema and migration notes
firmware/               ESP32 sensor example
docs/                   API, setup, architecture and demo documentation
tests/                  Calculation and API smoke tests
sample-data/            Clearly labelled demonstration dataset
docs/original-prototype.html  Original uploaded prototype for traceability
```

## Build and delivery workflow

1. Install the pinned Node dependencies.
2. Run the Python engine unit tests and Node tests.
3. Start Express on port 3000 and verify `/health`, `/api/dashboard`, `/api/recommendations`, `/api/water-budget`, and `/api/admin/overview`.
4. Check `/manus-routes.json` is served as JSON.
5. Inspect the farmer and admin surfaces in Preview.
6. Commit the complete implementation to the canonical project remote and keep publication manual unless explicitly requested.

## Known boundaries

- No NeuGen endpoint or credentials were supplied, so the adapter is intentionally configuration-driven and the UI labels the fallback as rule-based explanation.
- No verified market feed or official government-scheme feed was supplied, so those modules remain demonstration/source-link surfaces and do not create fake transactions.
- The managed Webdev database is MySQL-compatible even though the original brief names PostgreSQL; the schema uses portable relational SQL and the setup guide calls out this environment difference.
- Flutter mobile and a full production admin authentication provider are documented extension points; the delivered responsive farmer/admin web MVP is the demonstrable surface for this iteration.
