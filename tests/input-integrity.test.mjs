import test from 'node:test';
import assert from 'node:assert/strict';
import {
  harvestPayload,
  nonNegative,
  optionalNumber,
  soilTestPayload,
  validateDate,
  validateTimestamp
} from '../src/validators.js';

const harvestInput = {
  farmId: 'farm-1',
  crop: 'Millet',
  areaAcres: 1
};

test('historical harvests preserve unknown season, year, yield and price as null', () => {
  const record = harvestPayload({
    ...harvestInput,
    season: '',
    year: '',
    yieldQuintal: '',
    sellingPricePerQuintal: ''
  });

  assert.equal(record.season, null);
  assert.equal(record.year, null);
  assert.equal(record.yieldQuintal, null);
  assert.equal(record.sellingPricePerQuintal, null);
  assert.equal(record.currency, 'INR');
});

test('explicit numeric zero remains distinct from an unknown value', () => {
  const record = harvestPayload({
    ...harvestInput,
    season: null,
    year: null,
    yieldQuintal: 0,
    sellingPricePerQuintal: 0
  });

  assert.equal(record.yieldQuintal, 0);
  assert.equal(record.sellingPricePerQuintal, 0);
  assert.equal(record.season, null);
  assert.equal(record.year, null);
  assert.equal(optionalNumber('', 'value'), null);
  assert.equal(optionalNumber(0, 'value'), 0);
  assert.throws(() => harvestPayload({ ...harvestInput, season: 'Monsoon' }), { code: 'validation_error' });
  assert.throws(() => harvestPayload({ ...harvestInput, year: 2026.5 }), { code: 'validation_error' });
});

test('server numeric validation rejects empty required values and non-finite numbers', () => {
  for (const value of ['', '   ', NaN, Infinity, -Infinity, true]) {
    assert.throws(() => nonNegative(value, 'value'), { code: 'validation_error' });
  }
  assert.throws(() => optionalNumber('NaN', 'value'), { code: 'validation_error' });
  assert.throws(() => optionalNumber(-1, 'value', { minimum: 0 }), { code: 'validation_error' });
  assert.throws(() => harvestPayload({ ...harvestInput, currency: 'USD' }), { code: 'validation_error' });
});

test('soil tests retain parameter-specific units and measurement method', () => {
  const ph = soilTestPayload({
    farmId: 'farm-1', parameter: 'pH', value: 7, unit: 'unitless',
    method: 'Lab method A', date: '2026-03-01'
  });
  assert.equal(ph.unit, '');
  assert.equal(ph.method, 'Lab method A');

  const ec = soilTestPayload({
    farmId: 'farm-1', parameter: 'EC', value: 1.2, unit: 'mS/cm',
    method: 'Lab method B', date: '2026-03-01'
  });
  assert.equal(ec.unit, 'mS/cm');
  assert.equal(ec.method, 'Lab method B');

  const organicCarbon = soilTestPayload({
    farmId: 'farm-1', parameter: 'Organic carbon', value: null, unit: 'g/kg',
    method: null, date: '2026-03-01'
  });
  assert.equal(organicCarbon.value, null);
  assert.equal(organicCarbon.unit, 'g/kg');
  assert.equal(organicCarbon.method, null);
});

test('soil tests reject incompatible units and invalid values', () => {
  const base = { farmId: 'farm-1', date: '2026-03-01' };
  for (const soilTest of [
    { ...base, parameter: 'pH', value: 7, unit: '%' },
    { ...base, parameter: 'EC', value: 1, unit: '%' },
    { ...base, parameter: 'Organic carbon', value: 1, unit: 'dS/m' },
    { ...base, parameter: 'pH', value: 15, unit: '' },
    { ...base, parameter: 'Moisture', value: 101, unit: '%' },
    { ...base, parameter: 'EC', value: -0.1, unit: 'dS/m' },
    { ...base, parameter: 'EC', value: Infinity, unit: 'dS/m' }
  ]) {
    assert.throws(() => soilTestPayload(soilTest), { code: 'validation_error' });
  }
});

test('date and measurement timestamp validation rejects normalized or timezone-free values', () => {
  assert.equal(validateDate('2026-03-01', 'date'), '2026-03-01');
  assert.throws(() => validateDate('2026-02-30', 'date'), { code: 'validation_error' });
  assert.equal(validateTimestamp('2026-03-01T10:20:30Z', 'recordedAt'), '2026-03-01T10:20:30Z');
  assert.throws(() => validateTimestamp('2026-03-01T10:20:30', 'recordedAt'), { code: 'validation_error' });
  assert.throws(() => validateTimestamp('2026-02-30T10:20:30Z', 'recordedAt'), { code: 'validation_error' });
});
