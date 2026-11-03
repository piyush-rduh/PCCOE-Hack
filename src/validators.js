export function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}
export function nonNegative(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${field} must be a non-negative number`);
  return number;
}
export function enumValue(value, field, options) {
  if (!options.includes(value)) throw new Error(`${field} must be one of: ${options.join(', ')}`);
  return value;
}
export function farmPayload(body) {
  return { name: requireString(body.name, 'name'), areaAcres: nonNegative(body.areaAcres, 'areaAcres'), soilType: requireString(body.soilType, 'soilType'), waterSource: requireString(body.waterSource, 'waterSource'), irrigationMethod: requireString(body.irrigationMethod, 'irrigationMethod'), availableWaterLitres: nonNegative(body.availableWaterLitres ?? 0, 'availableWaterLitres'), location: requireString(body.location, 'location'), source: 'FARMER_ENTERED' };
}
export function zonePayload(body) {
  return { name: requireString(body.name, 'name'), areaAcres: nonNegative(body.areaAcres, 'areaAcres'), soilType: requireString(body.soilType, 'soilType'), waterAvailability: requireString(body.waterAvailability, 'waterAvailability'), currentCrop: requireString(body.currentCrop, 'currentCrop'), growthStage: body.growthStage || 'Sowing', sensorId: body.sensorId || null, source: 'FARMER_ENTERED' };
}
export function sensorPayload(body) {
  const reading = { deviceId: requireString(body.deviceId, 'deviceId'), farmId: requireString(body.farmId, 'farmId'), zoneId: requireString(body.zoneId, 'zoneId'), soilMoisturePct: nonNegative(body.soilMoisturePct, 'soilMoisturePct'), temperatureC: Number(body.temperatureC), humidityPct: nonNegative(body.humidityPct, 'humidityPct'), waterLevelPct: body.waterLevelPct == null ? null : nonNegative(body.waterLevelPct, 'waterLevelPct'), waterFlowLpm: body.waterFlowLpm == null ? null : nonNegative(body.waterFlowLpm, 'waterFlowLpm'), recordedAt: body.recordedAt || new Date().toISOString(), source: body.source || 'FARMER_ENTERED' };
  const allowedSources = ['LIVE_SENSOR', 'FARMER_ENTERED', 'SIMULATED_SENSOR'];
  if (!allowedSources.includes(reading.source)) throw new Error(`source must be one of: ${allowedSources.join(', ')}`);
  if (Number.isNaN(Date.parse(reading.recordedAt)) || Date.parse(reading.recordedAt) > Date.now() + 5 * 60 * 1000) throw new Error('recordedAt must be a valid timestamp close to the current time');
  if (reading.soilMoisturePct > 100 || reading.humidityPct > 100 || reading.waterLevelPct > 100) throw new Error('Percentage readings must be between 0 and 100');
  if (!Number.isFinite(reading.temperatureC) || reading.temperatureC < -20 || reading.temperatureC > 70) throw new Error('temperatureC is outside the validated sensor range');
  return reading;
}
