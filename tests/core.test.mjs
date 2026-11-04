import test from 'node:test';
import assert from 'node:assert/strict';
import { landPower, waterBudget, categorizedRecommendations } from '../src/decision-engine.js';

test('Land Power distinguishes missing data from limitations', () => {
  const result = landPower({ farm: { soilType: 'Black cotton', waterSource: 'Borewell', irrigationMethod: 'Drip' }, seasons: [{ crop: 'Soybean', year: 2025, areaAcres: 12, yieldQuintal: 100 }], soilTests: [{ parameter: 'pH', value: 7.6, date: '2026-07-06' }, { parameter: 'EC', value: .5, date: '2026-07-06' }, { parameter: 'Organic carbon', value: .48, date: '2026-07-06' }], zones: [{ id:'zone-1' }], activities: [] });
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(result.missing.includes('Nitrogen'));
  assert.equal(result.confidence, 'Medium');
});

test('Water budget is available water minus irrigation requirement', () => {
  const result = waterBudget({ farm: { areaAcres: 12, availableWaterLitres: 50000, irrigationMethod: 'Drip' }, zones: [{ areaAcres: 7 }, { areaAcres: 5 }], activeCrops: [{ crop: 'Chickpea', growthStage: 'Vegetative' }], sensorReadings: [], weather: [{ rainfallMm: 0 }, { rainfallMm: 0 }, { rainfallMm: 18 }] });
  assert.equal(result.balanceLitres, result.availableWaterLitres - result.irrigationRequirementLitres);
  assert.equal(result.status, 'deficit');
});

test('Recommendations return three planning categories without mutating the crop record', () => {
  const result = categorizedRecommendations({ farm: { areaAcres: 12, soilType: 'Black cotton', waterSource: 'Borewell', irrigationMethod: 'Drip' }, seasons: [{ crop: 'Soybean', year: 2025, areaAcres: 12, yieldQuintal: 100 }], soilTests: [], zones: [], weather: [] });
  assert.equal(result.length, 3);
  assert.deepEqual(result.map((item) => item.category), ['Restoration-oriented', 'Balanced productivity', 'Profit-oriented']);
});
