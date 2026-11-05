import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDecisionEngine, DecisionEngineError } from '../src/decision-service.js';

const baseInput = {
  farm: { areaAcres: 1, availableWaterLitres: 10000, irrigationMethod: 'Drip', irrigationEfficiency: 0.8 },
  zones: [{ id: 'zone-1', name: 'North', areaAcres: 1 }],
  activeCrops: [{
    zoneId: 'zone-1',
    crop: 'Example crop', growthStage: 'Vegetative', areaAcres: 1,
    waterRequirementMm: 100, rootZoneDepthMm: 300, irrigationTriggerMoisturePct: 20,
    irrigationDepthMm: 30
  }],
  soilTests: [
    { parameter: 'pH', value: 7, unit: '', date: '2026-01-01', source: 'FARMER_ENTERED' },
    { parameter: 'EC', value: 1, unit: 'dS/m', date: '2026-01-01', source: 'FARMER_ENTERED' },
    { parameter: 'Organic carbon', value: 0.8, unit: '%', date: '2026-01-01', source: 'FARMER_ENTERED' },
    { parameter: 'Moisture', value: 15, unit: '%', date: '2026-01-01', source: 'FARMER_ENTERED' }
  ],
  sensorReadings: [],
  weather: [{ rainfallMm: 20, effectiveRainfallMm: 10, source: 'VALIDATED_WEATHER' }],
  waterPlanningPeriodDays: 1,
  seasons: [],
  activities: []
};

test('Python engine returns the structured API contract and withholds unreviewed crop rankings', () => {
  const result = calculateDecisionEngine(baseInput);
  assert.equal(result.status, 'success');
  assert.equal(result.result.landPower.score, 77);
  assert.equal(result.result.landPower.isStandardized, false);
  assert.equal(result.result.recommendations.length, 3);
  assert.ok(result.result.recommendations.every((item) => item.crop === null && item.suitabilityScore === null));
  assert.equal(result.result.waterBudget.status, 'success');
  assert.equal(result.result.waterBudget.decisionStatus, 'deficit');
});

test('water budget uses the documented acre-millimetre conversion and supplied efficiency', () => {
  const result = calculateDecisionEngine(baseInput).result.waterBudget;
  assert.equal(result.projectedDemandLitres, 100 * 4046.8564224);
  assert.equal(result.expectedRainfallContributionLitres, 10 * 4046.8564224);
  assert.equal(result.irrigationRequirementLitres, 90 * 4046.8564224 / 0.8);
  assert.equal(result.balanceLitres, 10000 - result.irrigationRequirementLitres);
});

test('missing rainfall and crop requirements remain unavailable instead of becoming zero', () => {
  const input = {
    farm: { areaAcres: 2 },
    activeCrops: [{ crop: 'Unspecified' }],
    weather: [{ temperatureC: 25 }],
    zones: [], seasons: [], soilTests: [], activities: [], sensorReadings: []
  };
  const water = calculateDecisionEngine(input).result.waterBudget;
  assert.equal(water.expectedRainfallContributionLitres, null);
  assert.equal(water.projectedDemandLitres, null);
  assert.equal(water.decisionStatus, 'insufficient_data');
  assert.ok(water.missingInputs.includes('Validated effective rainfall for the planning period'));
});

test('decision service surfaces a Python process failure without internal details', () => {
  assert.throws(
    () => calculateDecisionEngine(baseInput, { spawnSync: () => ({ error: { code: 'ENOENT' } }) }),
    (error) => error instanceof DecisionEngineError && error.status === 503
      && error.message === 'Agriculture decision service is temporarily unavailable'
  );
});

test('decision service surfaces a Python timeout without internal details', () => {
  assert.throws(
    () => calculateDecisionEngine(baseInput, { spawnSync: () => ({ error: { code: 'ETIMEDOUT' } }) }),
    (error) => error instanceof DecisionEngineError && error.code === 'decision_engine_unavailable'
  );
});

test('decision service rejects malformed Python output', () => {
  assert.throws(
    () => calculateDecisionEngine(baseInput, { spawnSync: () => ({ status: 0, stdout: '{}' }) }),
    DecisionEngineError
  );
});
