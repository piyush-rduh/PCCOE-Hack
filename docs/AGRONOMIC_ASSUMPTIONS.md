# Agronomic assumptions and evidence

## Reference status

The current repository has no verified ICAR, agricultural-university, or government agronomic reference records. `python/agronomic_references.json` is intentionally empty. No local crop suitability catalog, crop water requirements, yield expectations, price assumptions, fertilizer rates, pest/disease rules, drought index, or flood model is claimed as validated.

This is an explicit limitation, not a missing-value fallback. Recommendations and calibrated risk scores stay unavailable until locally appropriate values and citations are reviewed by an agronomist. Do not populate the catalog with estimates presented as official facts.

## Retained Land Power prototype

The former JavaScript prototype used a base score of 60 and these provisional adjustments, now mirrored by the Python primary engine:

| Input | Existing prototype rule | Unit / handling | Evidence status |
|---|---|---|---|
| pH | 6.0–7.8: +6; outside: −7 | pH is unitless | Unsourced prototype range; not a universal suitability range |
| Electrical conductivity | ≤4: 0; >4: −10 | Requires dS/m | Unsourced prototype flag |
| Organic carbon | ≥0.75%: +8; <0.50%: −8; otherwise 0 | Percent | Unsourced prototype bands |
| Repeated adjacent crop name | −8 | Recorded crop names only | Pattern flag, not a family/disease claim |
| Rain-fed source | −4 | Recorded farm field | Prototype management adjustment |
| Drip method | +3 | Recorded farm field | Prototype management adjustment |

The score is rounded and clamped from 0 to 100. Missing indicators do not change the score and do lower the evidence-completeness display. Available N/P/K are shown but have no score adjustment. These inputs, weights, and ranges are **not scientifically validated**, and the score is not a standardized soil-health measurement.

## Water and irrigation units

- Conversion used: `1 acre = 4,046.8564224 m²`; `1 mm = 0.001 m`; therefore `1 mm over 1 acre = 4,046.8564224 litres`.
- Water requirement is accepted only as an explicit depth for the supplied planning period.
- Effective rainfall must be provided separately and explicitly for every day in that period. Total rainfall is not converted into effective rainfall.
- Irrigation efficiency must be supplied as a fraction in `(0, 1]`; the engine does not assume efficiencies for named methods.
- Crop-specific irrigation triggers, application depths, root depth, and crop coefficients are not available in the catalog. Precise irrigation quantities are withheld unless they are supplied from a reviewed reference.
- Available water is either an already-aggregated usable amount or the sum of separately supplied stored and reliable incoming amounts. The engine never adds overlapping totals or silently substitutes zero for an unknown source.

## Risk and financial estimates

- Drought and waterlogging risk scores are not calculated. There are no validated local baselines or thresholds in the repository. A complete-input water deficit can be described as a potential water shortage, not an official drought category.
- No flood prediction is made. Localized precautions are general preparedness, not an official warning.
- Historical revenue uses recorded yield and selling price. Net profit requires complete itemized costs confirmed by the farmer; otherwise profit remains unknown.
- Demonstration records are segregated from actual records. Future outcomes require explicit scenario inputs. The engine does not use demo mandi prices, demo crop yields, guessed expense multipliers, or probability claims.

## Phase 4 planning-record gates

- Crop plans, planning periods, daily effective-rainfall observations, water inventory/use records, and farmer-entered low/medium/high financial scenarios are stored as explicit records with dates, units, and provenance where applicable.
- A recorded crop name or planning window does not supply crop water demand, root-zone depth, irrigation trigger/depth, or irrigation efficiency. Those values must come from reviewed local references or explicit supported inputs; they are not inferred.
- Effective rainfall is kept separate from total rainfall. Aggregate available water is not added to stored or incoming components, and unknown availability is not zero.
- Incomplete scenarios remain visible but are excluded from engine calculations. A scenario is only calculated when yield, price, non-empty itemized costs, and farmer confirmation that costs are complete are all present.
- Stable multilingual message codes change presentation only. Numeric inputs, result values, availability, and reference status do not change with the selected language.

## Review checklist for future reference updates

Every proposed regional entry should include:

1. Crop/common name and relevant region, soil group, and season.
2. Explicit units, applicable growth stage and planning period.
3. Source title, issuing institution, publication date/version, and a stable citation.
4. The intended use and limits of each threshold or coefficient.
5. Agronomist reviewer and review date.
6. Essential constraints that disqualify an unsuitable option.
7. Tests proving missing, boundary, and out-of-range behavior.

Do not treat this checklist or the current prototype formula as evidence for a crop, input rate, forecast, or yield outcome.
