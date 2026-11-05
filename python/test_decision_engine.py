import unittest
from datetime import datetime, timezone

from decision_engine import ACRE_MM_TO_LITRES, InputError, calculate


class DecisionEngineTests(unittest.TestCase):
    def setUp(self):
        self.payload = {
            "farm": {
                "areaAcres": 2,
                "availableWaterLitres": 50000,
                "irrigationMethod": "Drip",
                "irrigationEfficiency": 0.8,
                "soilType": "Loam",
            },
            "zones": [{"id": "z1", "name": "North", "areaAcres": 2}],
            "activeCrops": [{
                "zoneId": "z1",
                "crop": "Chickpea", "growthStage": "Vegetative", "areaAcres": 2,
                "waterRequirementMm": 30, "rootZoneDepthMm": 300,
                "irrigationTriggerMoisturePct": 25, "irrigationDepthMm": 20,
            }],
            "soilTests": [
                {"parameter": "pH", "value": 7.6, "unit": "", "method": "Lab method A", "date": "2026-07-06"},
                {"parameter": "EC", "value": 0.5, "unit": "dS/m", "method": "Lab method B", "date": "2026-07-06"},
                {"parameter": "Organic carbon", "value": 0.8, "unit": "%", "method": "Lab method C", "date": "2026-07-06"},
            ],
            "seasons": [
                {"crop": "Cotton", "season": "Kharif", "year": 2024},
                {"crop": "Cotton", "season": "Rabi", "year": 2025},
            ],
            "activities": [],
            "weather": [{"rainfallMm": 12, "effectiveRainfallMm": 5}],
            "waterPlanningPeriodDays": 1,
            "sensorReadings": [{
                "soilMoisturePct": 20,
                "recordedAt": datetime.now(timezone.utc).isoformat(),
                "source": "LIVE_SENSOR",
            }],
        }

    def test_contract_and_provisional_land_power(self):
        result = calculate(self.payload)
        land = result["result"]["landPower"]
        self.assertEqual(result["status"], "success")
        self.assertIn("Available nitrogen", land["missing"])
        self.assertFalse(land["isStandardized"])
        self.assertEqual(land["score"], 69)
        self.assertGreaterEqual(land["confidence"]["score"], 0)
        self.assertLessEqual(land["confidence"]["score"], 100)
        self.assertIn("not a calibrated probability", land["confidence"]["explanation"])

    def test_unmeasured_soil_is_missing_not_zero(self):
        result = calculate({"farm": {}, "soilTests": [], "seasons": [], "zones": [],
                            "activities": [], "activeCrops": [], "sensorReadings": [], "weather": []})
        land = result["landPower"]
        self.assertEqual(land["score"], 60)
        self.assertEqual(land["dataCompleteness"], 0)
        self.assertTrue(all(item["value"] is None for item in land["indicators"][:3]))

    def test_crop_recommendations_withheld_without_reviewed_catalog(self):
        recommendations = calculate(self.payload)["recommendations"]
        self.assertEqual([item["categoryKey"] for item in recommendations],
                         ["restoration", "balanced", "profit"])
        self.assertTrue(all(item["crop"] is None for item in recommendations))
        self.assertTrue(all(item["suitabilityScore"] is None for item in recommendations))

    def test_water_budget_uses_explicit_effective_rain_and_units(self):
        water = calculate(self.payload)["waterBudget"]
        self.assertEqual(water["projectedDemandLitres"], 30 * 2 * ACRE_MM_TO_LITRES)
        self.assertEqual(water["expectedRainfallContributionLitres"], 5 * 2 * ACRE_MM_TO_LITRES)
        self.assertEqual(water["irrigationRequirementLitres"],
                         25 * 2 * ACRE_MM_TO_LITRES / 0.8)
        self.assertEqual(water["balanceLitres"],
                         50000 - water["irrigationRequirementLitres"])
        self.assertEqual(water["affectedZones"][0]["allocationLitres"],
                         water["irrigationRequirementLitres"])

    def test_water_budget_withholds_zone_allocations_without_crop_mapping(self):
        payload = dict(self.payload)
        payload["zones"] = payload["zones"] + [{"id": "z2", "name": "South", "areaAcres": 1}]
        water = calculate(payload)["waterBudget"]
        self.assertIsNone(water["projectedDemandLitres"])
        self.assertEqual(water["affectedZones"], [])
        self.assertTrue(any("zone South" in item for item in water["missingInputs"]))

    def test_missing_rain_and_water_are_not_zero(self):
        payload = {
            "farm": {"areaAcres": 1},
            "activeCrops": [{"crop": "Unknown"}],
            "weather": [{"temperatureC": 20}],
            "zones": [], "soilTests": [], "seasons": [], "activities": [], "sensorReadings": [],
        }
        water = calculate(payload)["waterBudget"]
        self.assertIsNone(water["availableWaterLitres"])
        self.assertIsNone(water["expectedRainfallContributionLitres"])
        self.assertIsNone(water["projectedDemandLitres"])
        self.assertEqual(water["decisionStatus"], "insufficient_data")

    def test_irrigation_with_stale_or_missing_reading_is_unquantified(self):
        payload = dict(self.payload)
        payload["sensorReadings"] = [{
            "soilMoisturePct": 0, "recordedAt": "2000-01-01T00:00:00+00:00",
        }]
        irrigation = calculate(payload)["irrigation"]
        self.assertTrue(irrigation["staleSensorReading"])
        self.assertIsNone(irrigation["quantityLitres"])
        self.assertFalse(irrigation["automaticControl"])
        self.assertIn("Fresh soil-moisture reading (latest is stale)", irrigation["missingInputs"])

    def test_irrigation_quantity_is_withheld_when_water_is_insufficient(self):
        payload = dict(self.payload)
        payload["sensorReadings"] = [{
            "zoneId": "z1", "soilMoisturePct": 10,
            "recordedAt": datetime.now(timezone.utc).isoformat(),
        }]
        irrigation = calculate(payload)["irrigation"]
        self.assertIsNone(irrigation["quantityLitres"])
        self.assertIsNone(irrigation["irrigationDepthMm"])
        self.assertEqual(irrigation["urgency"], "insufficient_water")
        self.assertTrue(irrigation["humanConfirmationRequired"])

    def test_rotation_detects_repeated_recorded_crop_name(self):
        memory = calculate(self.payload)["farmMemory"]
        self.assertEqual(len(memory["repeatedCropPatterns"]), 1)
        self.assertFalse(memory["available"])
        self.assertEqual(memory["diversificationOptions"], [])

    def test_profit_keeps_actual_records_separate_from_unavailable_forecasts(self):
        payload = dict(self.payload)
        payload["seasons"] = [{
            "crop": "Chickpea", "yieldQuintal": 10, "sellingPricePerQuintal": 100,
            "expenses": {"seed": 100, "labour": 200}, "expensesComplete": True, "areaAcres": 1,
        }]
        profit = calculate(payload)["profit"]
        self.assertEqual(profit["actual"]["revenue"], 1000)
        self.assertEqual(profit["actual"]["profit"], 700)
        self.assertEqual(profit["records"][0]["breakEvenPricePerQuintal"], 30)
        self.assertIsNone(profit["future"]["expected"])
        self.assertFalse(profit["future"]["available"])

    def test_nullable_historical_inputs_stay_unknown_and_explicit_zero_stays_zero(self):
        payload = dict(self.payload)
        payload["seasons"] = [
            {
                "crop": "Millet", "season": None, "year": None,
                "yieldQuintal": None, "sellingPricePerQuintal": None,
                "areaAcres": 1, "expensesComplete": True,
            },
            {
                "crop": "Rice", "season": None, "year": None,
                "yieldQuintal": 0, "sellingPricePerQuintal": 0,
                "areaAcres": 1, "expenses": {"seed": 0}, "expensesComplete": True,
            },
        ]
        profit = calculate(payload)["profit"]
        records = {record["crop"]: record for record in profit["records"]}
        self.assertIsNone(records["Millet"]["revenue"])
        self.assertIsNone(records["Millet"]["profit"])
        self.assertEqual(records["Rice"]["revenue"], 0)
        self.assertEqual(records["Rice"]["profit"], 0)
        self.assertIsNone(records["Rice"]["breakEvenPricePerQuintal"])
        self.assertEqual(calculate(payload)["farmMemory"]["cropSequence"], [])

    def test_incompatible_or_methodless_soil_measurements_are_not_scored(self):
        payload = {
            "farm": {}, "seasons": [], "zones": [], "activities": [],
            "activeCrops": [], "sensorReadings": [], "weather": [],
            "soilTests": [
                {"parameter": "pH", "value": 7, "unit": "", "date": "2026-01-01"},
                {"parameter": "EC", "value": 1, "unit": "mS/cm", "method": "Lab", "date": "2026-01-01"},
                {"parameter": "Organic carbon", "value": 1, "unit": "g/kg", "method": "Lab", "date": "2026-01-01"},
            ],
        }
        land = calculate(payload)["landPower"]
        self.assertEqual(land["score"], 60)
        self.assertEqual(land["dataCompleteness"], 0)
        self.assertEqual([item["status"] for item in land["indicators"][:3]],
                         ["uninterpretable", "uninterpretable", "uninterpretable"])
        self.assertIsNone(land["indicators"][0]["method"])

    def test_demo_records_are_never_returned_as_actual_farm_finances(self):
        payload = dict(self.payload)
        payload.update({"dataMode": "DEMO_DATA", "seasons": [{
            "crop": "Chickpea", "yieldQuintal": 10, "sellingPricePerQuintal": 100,
            "expenses": {"seed": 100, "labour": 200}, "areaAcres": 1,
        }]})
        profit = calculate(payload)["profit"]
        self.assertEqual(profit["actual"]["dataType"], "no_actual_data")
        self.assertIsNone(profit["actual"]["profit"])
        self.assertEqual(profit["records"][0]["dataType"], "simulated_demonstration")

    def test_rejects_negative_zero_area_and_extreme_values(self):
        for farm in ({"areaAcres": -1}, {"areaAcres": 0}, {"irrigationEfficiency": 0}):
            with self.subTest(farm=farm), self.assertRaises(InputError):
                calculate({"farm": farm})
        with self.assertRaises(InputError):
            calculate({"soilTests": [{"parameter": "pH", "value": 15}]})
        with self.assertRaises(InputError):
            calculate({"soilTests": [{"parameter": "Moisture", "value": 101}]})
        with self.assertRaises(InputError):
            calculate({"seasons": [{"crop": "Cotton", "year": 2101}]})
        with self.assertRaises(InputError):
            calculate({"farm": {"availableWaterLitres": -1}})

    def test_risk_scores_are_withheld_without_validated_thresholds(self):
        risks = calculate(self.payload)["risks"]
        self.assertEqual([item["type"] for item in risks], ["drought", "flood_waterlogging"])
        self.assertTrue(all(item["score"] is None for item in risks))
        self.assertEqual(risks[1]["level"], "unassessed")
        self.assertIn("official flood warning", risks[1]["confidence"]["explanation"])


if __name__ == "__main__":
    unittest.main()
