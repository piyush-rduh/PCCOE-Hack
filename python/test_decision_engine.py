import unittest
from decision_engine import land_power, water_budget

class DecisionEngineTests(unittest.TestCase):
    def setUp(self):
        self.payload = {
            'farm': {'areaAcres': 12, 'waterSource': 'Borewell', 'irrigationMethod': 'Drip', 'availableWaterLitres': 50000},
            'zones': [{'areaAcres': 7}, {'areaAcres': 5}],
            'activeCrops': [{'crop': 'Chickpea'}],
            'soilTests': [{'parameter': 'pH', 'value': 7.6, 'date': '2026-07-06'}, {'parameter': 'EC', 'value': .5, 'date': '2026-07-06'}, {'parameter': 'Organic carbon', 'value': .48, 'date': '2026-07-06'}],
            'seasons': [{'crop':'Soybean', 'year':2025}],
            'weather': [{'rainfallMm':0},{'rainfallMm':0},{'rainfallMm':18}],
        }
    def test_land_power_reports_missing_data_without_crashing(self):
        result = land_power(self.payload)
        self.assertIn('Nitrogen', result['missing'])
        self.assertGreaterEqual(result['score'], 0)
        self.assertLessEqual(result['score'], 100)
    def test_water_budget_is_available_minus_demand(self):
        result = water_budget(self.payload)
        self.assertEqual(result['balanceLitres'], result['availableWaterLitres'] - result['irrigationRequirementLitres'])
        self.assertEqual(result['status'], 'deficit')

if __name__ == '__main__':
    unittest.main()
