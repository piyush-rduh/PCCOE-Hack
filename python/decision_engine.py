"""Deterministic AGCRO decision engine.

The Node API mirrors these formulas for Preview portability. This CLI is the
reference implementation for batch jobs, validation, and future service use.
"""
from __future__ import annotations
import json, sys

CROPS = {
    "Soybean": {"type":"legume", "season":"Kharif", "water_mm":450, "yield":10, "cost":22000, "price":4600},
    "Cotton": {"type":"fibre", "season":"Kharif", "water_mm":700, "yield":8, "cost":42000, "price":6800},
    "Wheat": {"type":"cereal", "season":"Rabi", "water_mm":450, "yield":18, "cost":24000, "price":2300},
    "Green gram": {"type":"legume", "season":"Summer", "water_mm":300, "yield":4, "cost":12000, "price":7500},
    "Chickpea": {"type":"legume", "season":"Rabi", "water_mm":300, "yield":7, "cost":15000, "price":5400},
}

def land_power(payload):
    farm, seasons, soil = payload.get("farm", {}), payload.get("seasons", []), payload.get("soilTests", [])
    score, missing, strengths, limitations = 60, [], [], []
    latest = {}
    for row in sorted(soil, key=lambda x: x.get("date", "")):
        latest[row.get("parameter")] = row.get("value")
    ph, ec, oc = latest.get("pH"), latest.get("EC"), latest.get("Organic carbon")
    if ph is None: missing.append("Soil pH")
    elif 6 <= ph <= 7.8: score += 6; strengths.append(f"pH {ph} is within the prototype workable range")
    else: score -= 7; limitations.append(f"pH {ph} is outside the prototype workable range")
    if ec is None: missing.append("Electrical conductivity")
    elif ec > 4: score -= 10; limitations.append(f"EC {ec} dS/m suggests salinity attention")
    else: strengths.append(f"EC {ec} dS/m shows no prototype salinity flag")
    if oc is None: missing.append("Organic carbon")
    elif oc >= .75: score += 8; strengths.append(f"Organic carbon {oc}% is a strength")
    elif oc < .5: score -= 8; limitations.append(f"Organic carbon {oc}% is low for this prototype indicator")
    for key, label in [("N", "Nitrogen"), ("P", "Phosphorus"), ("K", "Potassium")]:
        if latest.get(key) is None: missing.append(label)
    seasons = sorted(seasons, key=lambda x: x.get("year", 0))
    if seasons and CROPS.get(seasons[-1].get("crop"), {}).get("type") == "legume": score += 5; strengths.append("Latest crop was a legume")
    if len(seasons) > 1 and seasons[-1].get("crop") == seasons[-2].get("crop"): score -= 8; limitations.append("Latest two seasons repeat the same crop")
    if farm.get("waterSource") == "Rain-fed": score -= 4; limitations.append("Rain-fed water supply increases variability")
    if farm.get("irrigationMethod") == "Drip": score += 3; strengths.append("Drip irrigation improves water efficiency")
    data_points = len([x for x in (ph, ec, oc, latest.get("N"), latest.get("P"), latest.get("K")) if x is not None])
    confidence = "High" if data_points >= 5 and len(seasons) >= 2 and len(payload.get("activities", [])) >= 2 else "Medium" if data_points >= 3 or payload.get("zones") else "Low"
    return {"score": max(0, min(100, round(score))), "missing": missing, "strengths": strengths, "limitations": limitations, "confidence": confidence}

def water_budget(payload):
    farm, zones, crops, weather = payload.get("farm", {}), payload.get("zones", []), payload.get("activeCrops", []), payload.get("weather", [])
    crop = CROPS.get(crops[0].get("crop") if crops else "Chickpea", CROPS["Chickpea"])
    area = sum(float(z.get("areaAcres", 0)) for z in zones) or float(farm.get("areaAcres", 1))
    rain = sum(float(day.get("rainfallMm", 0)) for day in weather[:3])
    efficiency = .9 if farm.get("irrigationMethod") == "Drip" else .7
    litres_per_mm_acre = 4046
    effective_rainfall_factor = .25
    stage = crops[0].get("growthStage") if crops else None
    stage_factor = 1.15 if stage in ("Flowering", "Grain filling") else .8
    demand = round(crop["water_mm"] / 120 * 3 * stage_factor * area * litres_per_mm_acre / efficiency)
    rainfall = round(rain * area * litres_per_mm_acre * effective_rainfall_factor)
    irrigation = max(0, demand - rainfall)
    available = float(farm.get("availableWaterLitres", 0))
    return {"availableWaterLitres": available, "projectedDemandLitres": demand, "expectedRainfallContributionLitres": rainfall, "irrigationRequirementLitres": irrigation, "balanceLitres": available - irrigation, "status": "deficit" if available - irrigation < 0 else "surplus", "engine": "python-rule-based"}

def calculate(payload):
    return {"landPower": land_power(payload), "waterBudget": water_budget(payload)}

if __name__ == "__main__":
    payload = json.load(sys.stdin)
    json.dump(calculate(payload), sys.stdout)
