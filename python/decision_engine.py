"""AGCRO's deterministic agriculture decision engine.

The engine only calculates from supplied records and reviewed reference data.
It deliberately returns unavailable results rather than filling gaps with
unverified agronomic constants.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sys
from typing import Any

CALCULATION_VERSION = "4.0.0"
ACRE_MM_TO_LITRES = 4046.8564224
STALE_SENSOR_SECONDS = 60 * 60
LAND_POWER_BASELINE = 60
LAND_POWER_ASSUMPTIONS = [
    "Land Power is a prototype indicator, not a standardized soil-health index.",
    "Existing pH, EC, organic-carbon and management weights are provisional and unvalidated for regional use.",
    "Missing measurements are excluded from the score and lower evidence completeness; they are not treated as zero.",
]


class InputError(ValueError):
    """Raised when the engine contract contains invalid values."""


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise InputError(f"{label} must be an object")
    return value


def _array(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise InputError(f"{label} must be an array")
    return value


def _optional_number(value: Any, label: str, minimum: float | None = None,
                     maximum: float | None = None) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputError(f"{label} must be a finite number or null")
    number = float(value)
    if not math.isfinite(number) or (minimum is not None and number < minimum) or (
        maximum is not None and number > maximum
    ):
        raise InputError(f"{label} is outside the accepted range")
    return number


def validate_input(payload: Any) -> dict[str, Any]:
    root = _object(payload, "input")
    if len(json.dumps(root, allow_nan=False)) > 1_000_000:
        raise InputError("input exceeds the supported size")
    for key in ("farm",):
        if key in root:
            _object(root[key], key)
    for key in ("seasons", "soilTests", "zones", "activities", "activeCrops",
                "sensorReadings", "weather", "cropReferences", "financialScenarios"):
        if key in root:
            _array(root[key], key)
    if "waterPlanningPeriodDays" in root:
        days = root["waterPlanningPeriodDays"]
        if isinstance(days, bool) or not isinstance(days, int) or not 1 <= days <= 365:
            raise InputError("waterPlanningPeriodDays must be an integer from 1 to 365")

    farm = root.get("farm") or {}
    for key in ("areaAcres", "availableWaterLitres", "storedWaterLitres",
                "reliableIncomingWaterLitres", "irrigationEfficiency"):
        if key in farm:
            maximum = 1 if key == "irrigationEfficiency" else None
            minimum = 0.000001 if key == "areaAcres" else 0
            _optional_number(farm[key], f"farm.{key}", minimum, maximum)
            if key == "irrigationEfficiency" and farm[key] == 0:
                raise InputError("farm.irrigationEfficiency must be greater than zero")

    for collection in ("soilTests", "sensorReadings", "weather", "zones",
                       "activeCrops", "financialScenarios", "cropReferences"):
        for index, row in enumerate(root.get(collection, [])):
            _object(row, f"{collection}[{index}]")
            if collection == "soilTests":
                parameter = str(row.get("parameter", "")).strip().lower()
                maximum = 14 if parameter == "ph" else 100 if parameter == "moisture" else 1_000_000_000
                _optional_number(row.get("value"), f"{collection}[{index}].value", 0, maximum)
            for key, value in row.items():
                if key in ("value", "soilMoisturePct", "waterLevelPct", "rainfallMm",
                           "effectiveRainfallMm", "temperatureC", "humidityPct",
                           "areaAcres", "waterRequirementMm", "irrigationEfficiency",
                           "rootZoneDepthMm", "irrigationDepthMm", "yieldQuintal",
                           "expectedYieldQuintal", "pricePerQuintal",
                           "sellingPricePerQuintal", "expectedPricePerQuintal",
                           "availableWaterLitres", "expenses", "expectedExpenses"):
                    if key == "expenses" or key == "expectedExpenses":
                        _object(value, f"{collection}[{index}].{key}")
                        for expense_name, expense_value in value.items():
                            _optional_number(
                                expense_value,
                                f"{collection}[{index}].{key}.{expense_name}",
                                0,
                            )
                    else:
                        minimum = -20 if key == "temperatureC" else 0
                        maximum = 100 if key in ("soilMoisturePct", "waterLevelPct",
                                                 "humidityPct", "irrigationEfficiency") else (
                            70 if key == "temperatureC" else None
                        )
                        _optional_number(value, f"{collection}[{index}].{key}",
                                         minimum, maximum)
            if collection in ("zones", "activeCrops") and row.get("areaAcres") is not None:
                _optional_number(row["areaAcres"], f"{collection}[{index}].areaAcres", 0.000001)
    if "seasons" in root:
        for index, row in enumerate(root["seasons"]):
            _object(row, f"seasons[{index}]")
            for key in ("yieldQuintal", "sellingPricePerQuintal", "areaAcres"):
                if key in row:
                    minimum = 0.000001 if key == "areaAcres" else 0
                    _optional_number(row[key], f"seasons[{index}].{key}", minimum)
            if row.get("expenses") is not None:
                _object(row["expenses"], f"seasons[{index}].expenses")
                for key, value in row["expenses"].items():
                    _optional_number(value, f"seasons[{index}].expenses.{key}", 0)
    return root


def _confidence(present: int, expected: int, explanation: str) -> dict[str, Any]:
    completeness = round(100 * present / expected) if expected else 0
    level = "high" if completeness >= 80 else "medium" if completeness >= 50 else "low"
    return {
        "level": level,
        "score": completeness,
        "explanation": f"Evidence completeness is {completeness}% of {expected} expected items; "
                       "this is not a calibrated probability. " + explanation,
        "scoreMeaning": "input completeness percentage, not probability",
    }


def _module(result: dict[str, Any], status: str, reasons: list[str],
            assumptions: list[str], missing: list[str], confidence: dict[str, Any],
            data_sources: list[dict[str, Any]], generated_at: str) -> dict[str, Any]:
    direct_result = dict(result)
    if "status" in direct_result:
        direct_result["decisionStatus"] = direct_result.pop("status")
    return {
        "status": status,
        "result": result,
        **direct_result,
        "reasons": reasons,
        "assumptions": assumptions,
        "missingInputs": missing,
        "confidence": confidence,
        "dataSources": data_sources,
        "calculationVersion": CALCULATION_VERSION,
        "generatedAt": generated_at,
    }


def _data_sources(rows: list[dict[str, Any]], collection: str) -> list[dict[str, Any]]:
    sources = sorted({str(row.get("source") or "UNKNOWN") for row in rows})
    return [{"type": collection, "source": source, "recordCount": sum(
        1 for row in rows if str(row.get("source") or "UNKNOWN") == source
    )} for source in sources]


def _land_power(payload: dict[str, Any], generated_at: str) -> dict[str, Any]:
    soil_tests = payload.get("soilTests", [])
    seasons = sorted(payload.get("seasons", []),
                     key=lambda row: (str(row.get("year", "")), str(row.get("id", ""))))
    farm = payload.get("farm") or {}
    latest: dict[str, dict[str, Any]] = {}
    aliases = {
        "ph": "pH", "ec": "EC", "organic carbon": "Organic carbon",
        "organiccarbon": "Organic carbon", "n": "N", "nitrogen": "N",
        "p": "P", "phosphorus": "P", "k": "K", "potassium": "K",
    }
    for row in sorted(soil_tests, key=lambda item: str(item.get("date") or "")):
        parameter = aliases.get(str(row.get("parameter", "")).strip().lower())
        if parameter:
            latest[parameter] = row

    score = LAND_POWER_BASELINE
    missing: list[str] = []
    reasons: list[str] = []
    indicators: list[dict[str, Any]] = []
    adjustment_by_parameter = {"pH": 0, "EC": 0, "Organic carbon": 0}
    checks = [
        ("pH", "Soil pH", lambda value: 6 <= value <= 7.8, 6, -7,
         "Prototype workable-range check; regional validation required."),
        ("EC", "Electrical conductivity", lambda value: value <= 4, 0, -10,
         "Prototype salinity flag; unit must be dS/m and threshold is unvalidated."),
        ("Organic carbon", "Organic carbon", lambda value: value >= 0.75, 8, -8,
         "Prototype organic-carbon flag; unit must be percent and threshold is unvalidated."),
    ]
    for parameter, label, predicate, positive, negative, explanation in checks:
        row = latest.get(parameter)
        if row is None or row.get("value") is None:
            missing.append(label)
            indicators.append({"parameter": label, "value": None,
                               "unit": None, "status": "missing",
                               "explanation": "No measurement recorded."})
            continue
        value = float(row["value"])
        passed = predicate(value)
        adjustment = positive if passed else negative
        if parameter == "EC" and passed:
            adjustment = 0
        if parameter == "Organic carbon" and value >= 0.5 and value < 0.75:
            adjustment = 0
        score += adjustment
        adjustment_by_parameter[parameter] = adjustment
        indicators.append({
            "parameter": label, "value": value, "unit": row.get("unit") or None,
            "measuredAt": row.get("date") or None, "source": row.get("source") or "UNKNOWN",
            "status": "prototype_strength" if passed else "prototype_attention",
            "scoreAdjustment": adjustment, "explanation": explanation,
        })
        if adjustment > 0:
            reasons.append(f"{label} contributes a provisional positive indicator.")
        elif adjustment < 0:
            reasons.append(f"{label} triggers a provisional attention indicator.")

    for parameter, label in (("N", "Available nitrogen"),
                             ("P", "Available phosphorus"),
                             ("K", "Available potassium")):
        row = latest.get(parameter)
        if row is None or row.get("value") is None:
            missing.append(label)
        indicators.append({
            "parameter": label,
            "value": float(row["value"]) if row and row.get("value") is not None else None,
            "unit": (row.get("unit") or None) if row else None,
            "measuredAt": (row.get("date") or None) if row else None,
            "source": (row.get("source") or "UNKNOWN") if row else None,
            "status": "recorded_not_scored" if row and row.get("value") is not None else "missing",
            "explanation": "Recorded for completeness; no validated regional scoring rule is configured.",
        })

    if len(seasons) > 1 and str(seasons[-1].get("crop", "")).casefold() == str(
        seasons[-2].get("crop", "")
    ).casefold():
        score -= 8
        reasons.append("The two latest recorded seasons repeat the same crop name (provisional indicator).")
    if farm.get("waterSource") == "Rain-fed":
        score -= 4
        reasons.append("Rain-fed water source is recorded; this is a provisional variability indicator.")
    if farm.get("irrigationMethod") == "Drip":
        score += 3
        reasons.append("Drip irrigation is recorded; this is a provisional management indicator.")

    measured = sum(1 for row in latest.values() if row.get("value") is not None)
    score = max(0, min(100, round(score)))
    trend = []
    for parameter in ("pH", "EC", "Organic carbon", "N", "P", "K"):
        rows = [row for row in soil_tests if aliases.get(
            str(row.get("parameter", "")).strip().lower()) == parameter]
        rows.sort(key=lambda row: str(row.get("date") or ""))
        if rows:
            trend.append({"parameter": parameter, "observations": [
                {"date": row.get("date"), "value": row.get("value"),
                 "unit": row.get("unit") or None, "source": row.get("source") or "UNKNOWN"}
                for row in rows
            ]})
    missing.extend(label for label in ("Soil texture", "Crop rotation family data")
                   if label == "Soil texture" and not farm.get("soilType"))
    result = {
        "score": score,
        "indicators": indicators,
        "strengths": [item["parameter"] for item in indicators
                      if item["status"] == "prototype_strength"],
        "limitations": [item["parameter"] for item in indicators
                        if item["status"] == "prototype_attention"],
        "missing": missing,
        "dataCompleteness": round(100 * measured / 6),
        "trend": [],
        "historicalChanges": trend,
        "isStandardized": False,
    }
    confidence = _confidence(measured, 6, "Only recorded soil results contribute to soil evidence.")
    return _module(result, "success", reasons, LAND_POWER_ASSUMPTIONS, missing,
                   confidence, _data_sources(soil_tests, "soilTests"), generated_at)


def _rotation(payload: dict[str, Any], generated_at: str) -> dict[str, Any]:
    seasons = sorted(payload.get("seasons", []),
                     key=lambda row: (str(row.get("year", "")), str(row.get("id", ""))))
    crops = [str(row.get("crop", "")).strip() for row in seasons if row.get("crop")]
    repeats = []
    for index in range(1, len(crops)):
        if crops[index].casefold() == crops[index - 1].casefold():
            repeats.append({"crop": crops[index], "positions": [index - 1, index]})
    missing = [] if seasons else ["Previous crop and season history"]
    missing.append("Reviewed crop-family and rotation reference data")
    result = {
        "cropSequence": crops,
        "repeatedCropPatterns": repeats,
        "potentialLimitations": [
            "Crop-family, nutrient-demand, and validated pest/disease rotation references are not configured."
        ],
        "diversificationOptions": [],
        "missingHistoricalInformation": missing,
        "available": False,
    }
    reasons = ["Historical crop names are summarized without assuming crop-family or disease relationships."]
    confidence = _confidence(len(crops), max(1, len(crops) + 1),
                             "Rotation interpretation requires reviewed crop-family references.")
    return _module(result, "success", reasons, [], missing, confidence,
                   _data_sources(seasons, "seasons"), generated_at)


def _recommendations(payload: dict[str, Any], generated_at: str) -> list[dict[str, Any]]:
    active_crops = payload.get("activeCrops", [])
    categories = [
        ("Soil restoration", "restoration"),
        ("Balanced approach", "balanced"),
        ("Profit-oriented", "profit"),
    ]
    missing = [
        "Agronomist-reviewed regional crop reference catalog",
        "Validated crop suitability and essential-constraint scoring rules",
    ]
    if not payload.get("farm", {}).get("soilType"):
        missing.append("Soil type")
    if not active_crops and not payload.get("seasons"):
        missing.append("Current and previous crop history")
    if not payload.get("weather"):
        missing.append("Current-season weather observations or forecast")
    return [{
            "status": "success",
            "result": {"available": False, "crop": None, "suitabilityScore": None},
            "available": False,
            "crop": None,
            "category": category,
            "categoryKey": key,
            "suitabilityScore": None,
            "reasons": ["No candidate can be ranked until reviewed regional references and decision rules are configured."],
            "risks": ["Recommendations are intentionally withheld; no candidate has passed essential-constraint checks."],
            "soilCompatibility": None,
            "waterRequirementMm": None,
            "season": None,
            "rotationCompatibility": None,
            "confidence": _confidence(0, len(missing), "No reviewed recommendation rules are configured."),
            "assumptions": [],
            "missingInputs": missing,
            "dataSources": [],
            "calculationVersion": CALCULATION_VERSION,
            "generatedAt": generated_at,
        } for category, key in categories]


def _water_budget(payload: dict[str, Any], generated_at: str) -> dict[str, Any]:
    farm = payload.get("farm") or {}
    zones = payload.get("zones", [])
    active_crops = payload.get("activeCrops", [])
    weather = payload.get("weather", [])
    period_days = payload.get("waterPlanningPeriodDays")
    period_weather = weather[:period_days] if period_days else []
    weather_complete = bool(period_days and len(period_weather) == period_days
                            and all(day.get("effectiveRainfallMm") is not None
                                    for day in period_weather))
    dated_weather = [str(day["date"]) for day in period_weather if day.get("date")]
    if len(dated_weather) != len(set(dated_weather)):
        raise InputError("weather contains duplicate dates in the planning period")
    area = sum(float(zone.get("areaAcres") or 0) for zone in zones)
    area_source = "zones" if area > 0 else None
    if area <= 0:
        area = float(farm.get("areaAcres") or 0)
        area_source = "farm" if area > 0 else None
    missing = []
    zone_crop_inputs = []
    if zones and sum(float(zone.get("areaAcres") or 0) for zone in zones) <= 0:
        missing.append("Recorded area for each field zone")
    zone_crops = {str(crop.get("zoneId")): crop for crop in active_crops if crop.get("zoneId")}
    if zones:
        for zone in zones:
            crop = zone_crops.get(str(zone.get("id")))
            if not crop:
                missing.append(f"Actually planted crop and water requirement for zone {zone.get('name') or zone.get('id')}")
                continue
            crop_depth = crop.get("waterRequirementMm")
            if crop_depth is None:
                crop_depth = crop.get("planningPeriodWaterRequirementMm")
            if crop_depth is None or not zone.get("areaAcres") or float(zone["areaAcres"]) <= 0:
                missing.append(f"Crop water requirement and area for zone {zone.get('name') or zone.get('id')}")
                continue
            zone_crop_inputs.append((zone, float(_optional_number(
                crop_depth, "activeCrops.waterRequirementMm", 0
            ))))
    else:
        crop = active_crops[0] if active_crops else {}
        depth = crop.get("waterRequirementMm")
        if depth is None:
            depth = crop.get("planningPeriodWaterRequirementMm")
        depth = _optional_number(depth, "activeCrops.waterRequirementMm", 0) if depth is not None else None
        if not active_crops:
            missing.append("Actually planted crop")
        elif depth is None:
            missing.append("Reviewed crop water requirement for the planning period")
    available = farm.get("availableWaterLitres")
    incoming = farm.get("reliableIncomingWaterLitres")
    if available is not None:
        total_available = float(available)
    elif farm.get("storedWaterLitres") is not None and incoming is not None:
        total_available = float(farm["storedWaterLitres"]) + float(incoming)
    else:
        total_available = None
    efficiency = farm.get("irrigationEfficiency")
    expected_rain = None
    if weather_complete:
        expected_rain = sum(float(day["effectiveRainfallMm"]) for day in period_weather)
    demand = None
    irrigation = None
    balance = None
    if area_source is None:
        missing.append("Cultivated area")
    if total_available is None:
        missing.append("Available or stored water volume")
    if expected_rain is None:
        missing.append("Validated effective rainfall for the planning period")
    zone_irrigations = []
    if zones and len(zone_crop_inputs) == len(zones):
        demand = sum(depth * float(zone["areaAcres"]) * ACRE_MM_TO_LITRES
                     for zone, depth in zone_crop_inputs)
    elif not zones and area > 0 and depth is not None:
        demand = depth * area * ACRE_MM_TO_LITRES
    if demand is not None and expected_rain is not None:
        if zones:
            zone_net_depths = [(zone, max(0, depth - expected_rain))
                               for zone, depth in zone_crop_inputs]
            if efficiency is not None:
                zone_irrigations = [
                    (zone, net_depth * float(zone["areaAcres"]) * ACRE_MM_TO_LITRES / float(efficiency))
                    for zone, net_depth in zone_net_depths
                ]
                irrigation = sum(volume for _, volume in zone_irrigations)
            elif any(net_depth > 0 for _, net_depth in zone_net_depths):
                missing.append("Irrigation efficiency (gross withdrawal is unavailable)")
            else:
                zone_irrigations = [(zone, 0) for zone, _ in zone_net_depths]
                irrigation = 0
        else:
            net_depth = max(0, depth - expected_rain)
            if efficiency is not None:
                irrigation = net_depth * area * ACRE_MM_TO_LITRES / float(efficiency)
            elif net_depth > 0:
                missing.append("Irrigation efficiency (gross withdrawal is unavailable)")
    if total_available is not None and irrigation is not None:
        balance = total_available - irrigation
    zones_result = []
    if zone_irrigations and irrigation is not None:
        for zone, volume in zone_irrigations:
            zones_result.append({
                "zoneId": zone.get("id"),
                "zoneName": zone.get("name"),
                "areaAcres": zone.get("areaAcres"),
                "allocationLitres": volume,
                "allocationBasis": "zone-specific crop demand and area; not an irrigation schedule",
            })
    result = {
        "availableWaterLitres": total_available,
        "projectedDemandLitres": demand,
        "expectedRainfallContributionLitres": (
            expected_rain * area * ACRE_MM_TO_LITRES if expected_rain is not None and area else None
        ),
        "irrigationRequirementLitres": irrigation,
        "balanceLitres": balance,
        "status": "insufficient_data" if balance is None else ("deficit" if balance < 0 else "surplus"),
        "affectedZones": zones_result,
        "units": {"depth": "mm", "area": "acre", "volume": "litre"},
        "conversion": {"litresPerAcreMillimetre": ACRE_MM_TO_LITRES},
        "measuredEstimatedAssumed": {
            "availableWater": "measured_or_farmer_entered" if total_available is not None else "missing",
            "waterDemand": "estimated_from_supplied_crop_depth" if demand is not None else "unavailable",
            "effectiveRainfall": "measured_or_validated_input" if expected_rain is not None else "missing",
            "irrigationEfficiency": "provided" if efficiency is not None else "not_assumed",
        },
    }
    assumptions = [
        "Depth-to-volume conversion uses 1 mm over 1 acre = 4,046.8564224 litres.",
        "The engine does not estimate effective rainfall from total rainfall.",
        "Available and incoming water are combined only from separately named supplied values.",
        "Zone results require zone-specific crop and area records and are not an operating instruction.",
    ]
    confidence = _confidence(sum(value is not None for value in (total_available, demand, expected_rain, area_source)),
                             4, "Calculation completeness depends on explicitly supplied planning-period inputs.")
    return _module(result, "success", [], assumptions, sorted(set(missing)), confidence,
                   _data_sources(weather, "weather") + _data_sources(zones, "zones"), generated_at)


def _irrigation(payload: dict[str, Any], generated_at: str) -> dict[str, Any]:
    crops = payload.get("activeCrops", [])
    readings = payload.get("sensorReadings", [])
    activities = payload.get("activities", [])
    weather = payload.get("weather", [])
    period_days = payload.get("waterPlanningPeriodDays")
    period_weather = weather[:period_days] if period_days else []
    forecast_complete = bool(
        period_days and len(period_weather) == period_days
        and all(day.get("effectiveRainfallMm") is not None for day in period_weather)
    )
    now = datetime.now(timezone.utc)
    reading = max(readings, key=lambda row: str(row.get("recordedAt") or ""), default=None)
    if reading and reading.get("zoneId"):
        crop = next((item for item in crops if item.get("zoneId") == reading["zoneId"]), None)
    else:
        crop = crops[0] if len(crops) == 1 else None
    moisture = reading.get("soilMoisturePct") if reading else None
    age = None
    stale = bool(reading and not reading.get("recordedAt"))
    if reading and reading.get("recordedAt"):
        try:
            recorded = datetime.fromisoformat(str(reading["recordedAt"]).replace("Z", "+00:00"))
            if recorded.tzinfo is None:
                recorded = recorded.replace(tzinfo=timezone.utc)
            age_seconds = (now - recorded).total_seconds()
            stale = age_seconds < -300 or age_seconds > STALE_SENSOR_SECONDS
            age = max(0, age_seconds) if age_seconds >= -300 else None
        except ValueError:
            stale = True
    missing = []
    if crop is None or not crop.get("growthStage"):
        missing.append("Actually planted crop and growth stage mapped to the sensed zone")
    if moisture is None:
        missing.append("Fresh soil-moisture reading")
    elif stale:
        missing.append("Fresh soil-moisture reading (latest is stale)")
    if not crop or crop.get("rootZoneDepthMm") is None:
        missing.append("Crop root-zone depth")
    if not weather:
        missing.append("Forecast for the decision period")
    if not forecast_complete:
        missing.append("Validated effective rainfall")
    if payload.get("waterPlanningPeriodDays") is None:
        missing.append("Planning-period duration")
    if not farm_has_irrigation_method(payload.get("farm") or {}):
        missing.append("Irrigation method")
    farm = payload.get("farm") or {}
    if farm.get("irrigationEfficiency") is None:
        missing.append("Irrigation efficiency")
    can_quantify = bool(
        crop and crop.get("growthStage") and moisture is not None and not stale
        and crop.get("irrigationTriggerMoisturePct") is not None
        and crop.get("irrigationDepthMm") is not None
        and crop.get("rootZoneDepthMm") is not None
        and crop.get("areaAcres") is not None
        and farm.get("availableWaterLitres") is not None
        and farm.get("irrigationEfficiency") is not None
        and farm_has_irrigation_method(farm)
        and forecast_complete
    )
    depth = None
    volume = None
    recommendation = "Measure soil moisture and confirm crop, root-zone, and water information before deciding."
    urgency = "unassessed"
    reasons = []
    if reading and stale:
        reasons.append("The latest sensor reading is stale and is excluded from the decision.")
    elif moisture is None:
        reasons.append("No usable soil-moisture reading is available; missing moisture is not treated as zero.")
    else:
        reasons.append(f"Latest soil moisture is {moisture}% from {reading.get('source') or 'UNKNOWN'}.")
    if crop:
        reasons.append(f"Recorded crop and stage: {crop.get('crop', 'unknown')} / {crop.get('growthStage', 'unknown')}.")
    if can_quantify:
        trigger = float(crop["irrigationTriggerMoisturePct"])
        if float(moisture) < trigger:
            depth = float(crop["irrigationDepthMm"])
            volume = (depth * float(crop["areaAcres"]) * ACRE_MM_TO_LITRES
                      / float(farm["irrigationEfficiency"]))
            if volume > float(farm["availableWaterLitres"]):
                depth = None
                volume = None
                recommendation = "Calculated requirement exceeds recorded available water; no irrigation quantity is provided."
                urgency = "insufficient_water"
                reasons.append("Recorded available water is below the calculated gross requirement.")
            else:
                recommendation = "Supplied crop-specific trigger is met; review the calculated depth and confirm in the field."
                urgency = "review_required"
        else:
            recommendation = "Supplied crop-specific trigger is not met; continue monitoring."
            urgency = "monitor"
    recent_irrigation = max(
        (item for item in activities if str(item.get("type", "")).casefold() == "irrigation"),
        key=lambda item: str(item.get("date") or ""),
        default=None,
    )
    result = {
        "recommendation": recommendation,
        "timing": urgency,
        "urgency": urgency,
        "irrigationDepthMm": depth,
        "quantityLitres": volume,
        "reasons": reasons,
        "staleSensorReading": stale,
        "sensorAgeSeconds": age,
        "lastIrrigationAt": recent_irrigation.get("date") if recent_irrigation else None,
        "humanConfirmationRequired": True,
        "automaticControl": False,
        "safety": "Farmer confirmation is required. No pump or valve control occurs.",
    }
    confidence = _confidence(4 - min(4, len(missing)), 4,
                             "Irrigation thresholds must come from reviewed crop references.")
    return _module(result, "success", reasons, [
        "No precise schedule is generated unless fresh moisture and reviewed crop-specific parameters are supplied.",
        "No pump or valve control is performed.",
    ], sorted(set(missing)), confidence,
                   _data_sources(readings, "sensorReadings") + _data_sources(weather, "weather"),
                   generated_at)


def farm_has_irrigation_method(farm: dict[str, Any]) -> bool:
    return bool(farm.get("irrigationMethod") and farm.get("irrigationMethod") != "None")


def _climate_risks(payload: dict[str, Any], water: dict[str, Any],
                   generated_at: str) -> list[dict[str, Any]]:
    farm = payload.get("farm") or {}
    zones = payload.get("zones", [])
    weather = payload.get("weather", [])
    readings = payload.get("sensorReadings", [])
    freshness = "unknown"
    latest = max(readings, key=lambda row: str(row.get("recordedAt") or ""), default=None)
    moisture = latest.get("soilMoisturePct") if latest else None
    if latest and latest.get("recordedAt"):
        try:
            recorded = datetime.fromisoformat(str(latest["recordedAt"]).replace("Z", "+00:00"))
            if recorded.tzinfo is None:
                recorded = recorded.replace(tzinfo=timezone.utc)
            age_seconds = (datetime.now(timezone.utc) - recorded).total_seconds()
            freshness = "fresh" if -300 <= age_seconds <= STALE_SENSOR_SECONDS else "stale"
        except ValueError:
            freshness = "unknown"
    elif latest:
        freshness = "unknown"
    rain_known = bool(weather) and all(day.get("rainfallMm") is not None for day in weather)
    historical_rainfall_known = bool(farm.get("historicalRainfallBaseline"))
    crop_stress_threshold_known = any(
        crop.get("droughtThresholdMoisturePct") is not None
        for crop in payload.get("activeCrops", [])
    )
    drought_missing = []
    if not rain_known:
        drought_missing.append("Observed or forecast rainfall")
    if moisture is None or freshness == "unknown":
        drought_missing.append("Soil-moisture reading")
    if freshness == "stale":
        drought_missing.append("Fresh soil-moisture reading (latest is stale)")
    if water.get("decisionStatus") == "insufficient_data":
        drought_missing.append("Complete planning-period water budget")
    if not historical_rainfall_known:
        drought_missing.append("Regional historical rainfall baseline")
    if not crop_stress_threshold_known:
        drought_missing.append("Reviewed crop stress threshold")
    drought_level = "unassessed"
    drought_reasons = []
    if water.get("decisionStatus") == "deficit":
        drought_level = "potential_concern"
        drought_reasons.append("Supplied-input water budget indicates a potential water shortage; this is not an official drought classification.")
    if freshness == "stale":
        drought_reasons.append("Stale soil-moisture readings are excluded.")
    elif moisture is not None:
        drought_reasons.append("A soil-moisture observation is available; no validated stress threshold is configured.")
    if rain_known:
        drought_reasons.append("Rainfall records are available; no regional rainfall-deficit baseline is configured.")

    rain_forecast = [day.get("rainfallMm") for day in weather if day.get("rainfallMm") is not None]
    drainage_known = bool(farm.get("drainage") or any(zone.get("drainage") for zone in zones))
    topography_known = bool(farm.get("topography") or any(zone.get("topography") for zone in zones))
    waterlogging_history_known = bool(
        farm.get("waterloggingHistory") or any(zone.get("waterloggingHistory") for zone in zones)
    )
    flood_missing = []
    if not rain_forecast:
        flood_missing.append("Rainfall forecast")
    if not drainage_known:
        flood_missing.append("Field drainage information")
    if not topography_known:
        flood_missing.append("Field topography")
    if not waterlogging_history_known:
        flood_missing.append("Waterlogging history")
    flood_level = "unassessed"
    flood_reasons = ["No validated local flood or waterlogging model is configured."]
    if rain_forecast:
        flood_reasons.append("Forecast rainfall is reported as an input observation only; no risk threshold is applied.")
    risks = [
        {
            "status": "success", "result": {}, "type": "drought", "level": drought_level,
            "score": None, "affectedZones": [], "reasons": drought_reasons,
            "actions": ["Check fresh soil moisture by zone.", "Review measured water availability and the planning-period water budget."],
            "missingInputs": drought_missing, "confidence": _confidence(
                sum([rain_known, freshness == "fresh", water.get("decisionStatus") != "insufficient_data",
                     historical_rainfall_known, crop_stress_threshold_known]), 5,
                "No official meteorological drought classification is made."
            ), "assumptions": ["No drought index or calibrated risk score is configured."],
            "dataSources": _data_sources(weather, "weather") + _data_sources(readings, "sensorReadings"),
            "calculationVersion": CALCULATION_VERSION, "generatedAt": generated_at,
        },
        {
            "status": "success", "result": {}, "type": "flood_waterlogging", "level": flood_level,
            "score": None, "affectedZones": [], "reasons": flood_reasons,
            "actions": ["Inspect low-lying areas after heavy rainfall.", "Review field drainage and waterlogging history."],
            "missingInputs": flood_missing, "confidence": _confidence(
                sum([bool(rain_forecast), drainage_known, topography_known, waterlogging_history_known]), 4,
                "This is localized waterlogging context, not an official flood warning."
            ), "assumptions": ["No flood-forecast model or validated local risk thresholds are configured."],
            "dataSources": _data_sources(weather, "weather"),
            "calculationVersion": CALCULATION_VERSION, "generatedAt": generated_at,
        },
    ]
    return risks


def _profit(payload: dict[str, Any], generated_at: str) -> dict[str, Any]:
    seasons = payload.get("seasons", [])
    actual_records = []
    total_expenses = 0.0
    total_revenue = 0.0
    total_yield = 0.0
    for season in seasons:
        expenses = season.get("expenses") or {}
        expense_total = sum(float(value) for value in expenses.values())
        yield_value = _optional_number(season.get("yieldQuintal"), "season.yieldQuintal", 0)
        price = _optional_number(season.get("sellingPricePerQuintal"),
                                 "season.sellingPricePerQuintal", 0)
        revenue = yield_value * price if yield_value is not None and price is not None else None
        profit = revenue - expense_total if revenue is not None else None
        total_expenses += expense_total
        if revenue is not None:
            total_revenue += revenue
            total_yield += yield_value
        actual_records.append({
            **season, "totalExpenses": expense_total, "revenue": revenue,
            "profit": profit if season.get("expensesComplete") is True else None,
            "breakEvenPricePerQuintal": expense_total / yield_value if yield_value else None,
            "dataType": "recorded_history",
        })
    complete_revenue = bool(actual_records) and all(record["revenue"] is not None for record in actual_records)
    complete_actual = complete_revenue and all(
        record.get("expensesComplete") is True for record in seasons
    )
    demo_mode = payload.get("dataMode") == "DEMO_DATA"
    actual = {
        "expenses": total_expenses if complete_actual else None,
        "revenue": total_revenue if complete_revenue else None,
        "profit": total_revenue - total_expenses if complete_actual else None,
        "seasons": len(actual_records) if not demo_mode else 0,
        "breakEvenPricePerQuintal": total_expenses / total_yield if complete_actual and total_yield else None,
        "dataType": "simulated_demonstration" if demo_mode else "recorded_history",
    }
    demonstration = None
    if demo_mode:
        demonstration = {
            "expenses": total_expenses,
            "revenue": total_revenue if complete_revenue else None,
            "profit": total_revenue - total_expenses if complete_revenue else None,
            "seasons": len(actual_records),
            "records": [{**record, "dataType": "simulated_demonstration",
                         "source": "SIMULATED_DEMO_DATA"} for record in actual_records],
        }
        actual = {
            "expenses": None, "revenue": None, "profit": None, "seasons": 0,
            "breakEvenPricePerQuintal": None, "dataType": "no_actual_data",
        }
    by_crop = {str(row.get("crop", "")).casefold() for row in payload.get("activeCrops", [])}
    scenarios = [scenario for scenario in payload.get("financialScenarios", [])
                 if str(scenario.get("crop", "")).casefold() in by_crop]
    future_scenarios = []
    for scenario in scenarios:
        yield_value = scenario.get("yieldQuintal")
        price = scenario.get("pricePerQuintal")
        expenses = scenario.get("expenses")
        if yield_value is None or price is None or expenses is None:
            continue
        cost = sum(float(value) for value in expenses.values())
        revenue = float(yield_value) * float(price)
        future_scenarios.append({
            "label": scenario.get("label") or "user_supplied",
            "crop": scenario.get("crop"), "yieldQuintal": float(yield_value),
            "pricePerQuintal": float(price), "expenses": cost,
            "revenue": revenue, "profit": revenue - cost,
            "dataType": scenario.get("source") or "farmer_supplied_estimate",
            "assumptions": scenario.get("assumptions") or [],
        })
    missing = [] if future_scenarios else [
        "Crop-specific future yield, itemized costs, and verified or farmer-supplied planning price scenarios"
    ]
    result = {
        "actual": actual,
        "future": {
            "conservative": None, "expected": None, "optimistic": None,
            "scenarios": future_scenarios,
            "available": bool(future_scenarios),
            "assumptions": ["No future financial estimate is generated without explicit scenario inputs."],
        },
        "records": demonstration["records"] if demonstration else actual_records,
        "demonstration": demonstration,
        "strictSeparation": True,
    }
    confidence = _confidence(sum(record["revenue"] is not None for record in actual_records),
                             max(1, len(actual_records)),
                             "Historical totals use recorded data; future scenario values are not market forecasts.")
    return _module(result, "success", [], [
        "Historical revenue = recorded total yield × recorded selling price per quintal.",
        "Historical net profit = recorded revenue − sum of recorded expenses.",
        "Future estimates require explicit crop-specific scenario input; no demo market price or yield is used.",
    ], missing, confidence, _data_sources(seasons, "seasons"), generated_at)


def calculate(payload: Any) -> dict[str, Any]:
    input_data = validate_input(payload)
    if "cropReferences" not in input_data:
        reference_path = Path(__file__).with_name("agronomic_references.json")
        try:
            reference_document = json.loads(reference_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raise InputError("agronomic reference catalog is unavailable")
        if not isinstance(reference_document, dict) or not isinstance(reference_document.get("references"), list):
            raise InputError("agronomic reference catalog is invalid")
        input_data["cropReferences"] = reference_document["references"]
    generated_at = datetime.now(timezone.utc).isoformat()
    land = _land_power(input_data, generated_at)
    rotation = _rotation(input_data, generated_at)
    water = _water_budget(input_data, generated_at)
    irrigation = _irrigation(input_data, generated_at)
    risks = _climate_risks(input_data, water, generated_at)
    profit = _profit(input_data, generated_at)
    recommendations = _recommendations(input_data, generated_at)
    modules = [land, rotation, water, irrigation, profit, *risks, *recommendations]
    data_mode = str(input_data.get("dataMode") or "UNKNOWN")
    for module in modules:
        module["dataMode"] = data_mode
        if data_mode == "DEMO_DATA":
            module["dataSources"].append({
                "type": "storage", "source": "DEMO_DATA",
                "recordCount": 0,
            })
    return {
        "status": "success",
        "result": {
            "landPower": land,
            "recommendations": recommendations,
            "waterBudget": water,
            "irrigation": irrigation,
            "risks": risks,
            "profit": profit,
            "farmMemory": rotation,
        },
        "landPower": land,
        "recommendations": recommendations,
        "waterBudget": water,
        "irrigation": irrigation,
        "risks": risks,
        "profit": profit,
        "farmMemory": rotation,
        "reasons": [],
        "assumptions": LAND_POWER_ASSUMPTIONS,
        "missingInputs": sorted(set(
            land["missingInputs"] + rotation["missingInputs"]
            + water["missingInputs"] + irrigation["missingInputs"]
            + profit["missingInputs"]
        )),
        "confidence": _confidence(0, 1, "Confidence is reported for each module."),
        "dataSources": [],
        "calculationVersion": CALCULATION_VERSION,
        "generatedAt": generated_at,
        "dataMode": data_mode,
    }


if __name__ == "__main__":
    try:
        data = calculate(json.load(sys.stdin))
        json.dump(data, sys.stdout, allow_nan=False)
    except (InputError, json.JSONDecodeError):
        json.dump({"status": "error", "error": "invalid_input"}, sys.stdout)
        sys.exit(2)
    except Exception:
        json.dump({"status": "error", "error": "calculation_failed"}, sys.stdout)
        print("decision calculation failed", file=sys.stderr)
        sys.exit(1)
