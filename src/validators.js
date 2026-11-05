export function requireString(value, field, maxLength = 255) {
  if (typeof value !== 'string' || !value.trim()) {
    const error = new Error(`${field} is required`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    const error = new Error(`${field} must not exceed ${maxLength} characters`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  return trimmed;
}

export function nonNegative(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    const error = new Error(`${field} must be a non-negative number`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  return number;
}

export function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    const error = new Error(`${field} must be a positive number greater than 0`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  return number;
}

export function enumValue(value, field, options) {
  if (!options.includes(value)) {
    const error = new Error(`${field} must be one of: ${options.join(', ')}`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  return value;
}

export function rejectHtml(value, field) {
  if (typeof value === 'string' && (value.includes('<') || value.includes('>') || value.includes('javascript:') || value.includes('&lt;') || value.includes('&gt;'))) {
    const error = new Error(`${field} contains invalid or potentially unsafe characters`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  return value;
}

export function sanitizeNotes(value, maxLength = 1000) {
  if (!value) return '';
  const str = String(value).slice(0, maxLength);
  // Remove dangerous HTML/script tags from notes
  return str.replace(/<[^>]*>/g, '').trim();
}

export function validateDate(value, field) {
  if (typeof value !== 'string') {
    const error = new Error(`${field} must be a valid date string (YYYY-MM-DD)`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  const trimmed = value.trim();
  // Reject HTML tags immediately
  rejectHtml(trimmed, field);

  // Strict YYYY-MM-DD pattern
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(trimmed)) {
    const error = new Error(`${field} must be formatted as YYYY-MM-DD`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    const error = new Error(`${field} is not a valid calendar date`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  return trimmed;
}

export function validateRegister(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be a JSON object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const username = requireString(body.username, 'username', 40);
  rejectHtml(username, 'username');
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
    const error = new Error('Username must be 3-40 characters and contain only letters, numbers, underscores, dots, or hyphens');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  if (typeof body.password !== 'string' || body.password.length < 8) {
    const error = new Error('Password must be at least 8 characters long');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  if (body.password.length > 128) {
    const error = new Error('Password must not exceed 128 characters');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const name = requireString(body.name, 'name', 100);
  rejectHtml(name, 'name');

  const phone = body.phone ? requireString(body.phone, 'phone', 20) : '';
  if (phone) {
    rejectHtml(phone, 'phone');
    if (!/^[0-9+\s-]{8,20}$/.test(phone)) {
      const error = new Error('phone must be a valid telephone number');
      error.status = 400;
      error.code = 'validation_error';
      throw error;
    }
  }

  const location = body.location ? requireString(body.location, 'location', 120) : '';
  if (location) rejectHtml(location, 'location');

  return { username, password: body.password, name, phone, location };
}

export function profilePayload(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be a JSON object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  const name = requireString(body.name, 'name', 100);
  rejectHtml(name, 'name');

  let phone = '';
  if (body.phone) {
    phone = requireString(body.phone, 'phone', 20);
    rejectHtml(phone, 'phone');
    if (!/^[0-9+\s-]{8,20}$/.test(phone)) {
      const error = new Error('phone must be a valid telephone number');
      error.status = 400;
      error.code = 'validation_error';
      throw error;
    }
  }

  let location = '';
  if (body.location) {
    location = requireString(body.location, 'location', 160);
    rejectHtml(location, 'location');
  }

  return { name, phone, location };
}

export function validateLogin(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be a JSON object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  const username = requireString(body.username, 'username', 80);
  rejectHtml(username, 'username');
  if (typeof body.password !== 'string' || !body.password) {
    const error = new Error('password is required');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  return { username, password: body.password };
}

export function farmPayload(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be a JSON object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  const name = requireString(body.name, 'name', 100);
  rejectHtml(name, 'name');
  const optionalString = (value, field, maxLength) => {
    if (value == null || value === '') return null;
    const string = requireString(value, field, maxLength);
    rejectHtml(string, field);
    return string;
  };
  const soilType = optionalString(body.soilType, 'soilType', 80);
  const waterSource = optionalString(body.waterSource, 'waterSource', 80);
  const irrigationMethod = optionalString(body.irrigationMethod, 'irrigationMethod', 80);
  const location = optionalString(body.location, 'location', 160);
  let irrigationEfficiency = null;
  if (body.irrigationEfficiency != null && body.irrigationEfficiency !== '') {
    irrigationEfficiency = positiveNumber(body.irrigationEfficiency, 'irrigationEfficiency');
    if (irrigationEfficiency > 1) {
      const error = new Error('irrigationEfficiency must be a fraction greater than 0 and at most 1');
      error.status = 400;
      error.code = 'validation_error';
      throw error;
    }
  }

  return {
    name,
    areaAcres: positiveNumber(body.areaAcres, 'areaAcres'),
    soilType,
    waterSource,
    irrigationMethod,
    irrigationEfficiency,
    availableWaterLitres: body.availableWaterLitres == null || body.availableWaterLitres === ''
      ? null
      : nonNegative(body.availableWaterLitres, 'availableWaterLitres'),
    location,
    source: 'FARMER_ENTERED'
  };
}

export function zonePayload(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be a JSON object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  const farmId = requireString(body.farmId, 'farmId', 64);
  rejectHtml(farmId, 'farmId');
  const name = requireString(body.name, 'name', 80);
  rejectHtml(name, 'name');
  const optionalString = (value, field, maxLength) => {
    if (value == null || value === '') return null;
    const string = requireString(value, field, maxLength);
    rejectHtml(string, field);
    return string;
  };
  const soilType = optionalString(body.soilType, 'soilType', 80);
  const waterAvailability = optionalString(body.waterAvailability, 'waterAvailability', 60);
  const currentCrop = optionalString(body.currentCrop, 'currentCrop', 80);

  const allowedGrowthStages = ['Sowing', 'Vegetative', 'Flowering', 'Grain filling', 'Maturity', 'Harvested'];
  const growthStage = body.growthStage ? enumValue(body.growthStage, 'growthStage', allowedGrowthStages) : null;
  const sensorId = body.sensorId ? requireString(body.sensorId, 'sensorId', 64) : null;
  if (sensorId) rejectHtml(sensorId, 'sensorId');

  return {
    farmId,
    name,
    areaAcres: positiveNumber(body.areaAcres, 'areaAcres'),
    soilType,
    waterAvailability,
    currentCrop,
    growthStage,
    sensorId,
    source: 'FARMER_ENTERED'
  };
}

export function activityPayload(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be a JSON object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const farmId = requireString(body.farmId, 'farmId', 64);
  rejectHtml(farmId, 'farmId');

  const rawType = requireString(body.type, 'type', 60);
  rejectHtml(rawType, 'type');
  const allowedTypes = ['Irrigation', 'Fertilizer', 'Pesticide', 'Weeding', 'Observation', 'Harvest', 'Sowing', 'Pruning', 'Tillage', 'Other'];
  if (!allowedTypes.includes(rawType) && !/^[a-zA-Z0-9\s_-]{2,50}$/.test(rawType)) {
    const error = new Error(`type must be one of: ${allowedTypes.join(', ')} or a safe alphanumeric title`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const date = validateDate(body.date, 'date');
  const quantity = nonNegative(body.quantity ?? 0, 'quantity');

  const rawUnit = requireString(body.unit, 'unit', 30);
  rejectHtml(rawUnit, 'unit');
  const allowedUnits = ['mm', 'kg', 'litre', 'labour-days', 'bags', 'quintal', 'hours', 'acre'];
  if (!allowedUnits.includes(rawUnit) && !/^[a-zA-Z0-9\s_/-]{1,20}$/.test(rawUnit)) {
    const error = new Error(`unit must be a recognized unit (${allowedUnits.join(', ')}) or alphanumeric`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const notes = sanitizeNotes(body.notes);
  const zoneId = body.zoneId ? requireString(body.zoneId, 'zoneId', 64) : null;
  if (zoneId) rejectHtml(zoneId, 'zoneId');

  return {
    farmId,
    zoneId,
    type: rawType,
    date,
    quantity,
    unit: rawUnit,
    notes,
    source: 'FARMER_ENTERED'
  };
}

export function soilTestPayload(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be a JSON object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const farmId = requireString(body.farmId, 'farmId', 64);
  rejectHtml(farmId, 'farmId');

  const parameter = requireString(body.parameter, 'parameter', 60);
  rejectHtml(parameter, 'parameter');
  if (!/^[a-zA-Z0-9\s_+%-]{1,50}$/.test(parameter)) {
    const error = new Error('parameter contains invalid characters');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const value = nonNegative(body.value, 'value');
  if ((parameter === 'pH' && value > 14)
    || (parameter === 'Moisture' && value > 100)
    || (['N', 'P', 'K', 'EC', 'Organic carbon'].includes(parameter) && value > 1_000_000_000)) {
    const error = new Error(`${parameter} is outside the accepted measurement range`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  const date = validateDate(body.date, 'date');
  const unit = body.unit ? requireString(body.unit, 'unit', 20) : '';
  if (unit) rejectHtml(unit, 'unit');

  const zoneId = body.zoneId ? requireString(body.zoneId, 'zoneId', 64) : null;
  if (zoneId) rejectHtml(zoneId, 'zoneId');

  return {
    farmId,
    zoneId,
    parameter,
    value,
    unit,
    date,
    source: 'FARMER_ENTERED'
  };
}

export function harvestPayload(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be a JSON object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const farmId = requireString(body.farmId, 'farmId', 64);
  rejectHtml(farmId, 'farmId');

  const crop = requireString(body.crop, 'crop', 80);
  rejectHtml(crop, 'crop');

  const variety = body.variety ? requireString(body.variety, 'variety', 80) : '';
  if (variety) rejectHtml(variety, 'variety');

  const allowedSeasons = ['Kharif', 'Rabi', 'Zaid', 'Summer', 'Annual'];
  const season = body.season ? enumValue(body.season, 'season', allowedSeasons) : 'Rabi';

  const yearNum = Number(body.year || new Date().getFullYear());
  if (!Number.isInteger(yearNum) || yearNum < 1990 || yearNum > 2100) {
    const error = new Error('year must be an integer between 1990 and 2100');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const areaAcres = positiveNumber(body.areaAcres, 'areaAcres');
  const yieldQuintal = nonNegative(body.yieldQuintal, 'yieldQuintal');
  const sellingPricePerQuintal = nonNegative(body.sellingPricePerQuintal, 'sellingPricePerQuintal');
  const plantedDate = body.plantedDate ? validateDate(body.plantedDate, 'plantedDate') : null;
  const harvestedDate = body.harvestedDate ? validateDate(body.harvestedDate, 'harvestedDate') : null;

  const expenses = {};
  if (body.expenses && typeof body.expenses === 'object' && !Array.isArray(body.expenses)) {
    for (const [k, v] of Object.entries(body.expenses)) {
      if (/^[a-zA-Z0-9_-]{1,30}$/.test(k)) {
        expenses[k] = nonNegative(v, `expenses.${k}`);
      }
    }
  }
  if (body.expensesComplete != null && typeof body.expensesComplete !== 'boolean') {
    const error = new Error('expensesComplete must be a boolean');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  return {
    farmId,
    crop,
    variety,
    season,
    year: yearNum,
    areaAcres,
    yieldQuintal,
    sellingPricePerQuintal,
    plantedDate,
    harvestedDate,
    expenses,
    expensesComplete: body.expensesComplete === true,
    source: 'FARMER_ENTERED'
  };
}

export function sensorPayload(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be a JSON object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const deviceId = requireString(body.deviceId, 'deviceId', 64);
  rejectHtml(deviceId, 'deviceId');
  const farmId = requireString(body.farmId, 'farmId', 64);
  rejectHtml(farmId, 'farmId');
  const zoneId = requireString(body.zoneId, 'zoneId', 64);
  rejectHtml(zoneId, 'zoneId');

  const reading = {
    deviceId,
    farmId,
    zoneId,
    soilMoisturePct: nonNegative(body.soilMoisturePct, 'soilMoisturePct'),
    temperatureC: Number(body.temperatureC),
    humidityPct: nonNegative(body.humidityPct, 'humidityPct'),
    waterLevelPct: body.waterLevelPct == null || body.waterLevelPct === '' ? null : nonNegative(body.waterLevelPct, 'waterLevelPct'),
    waterFlowLpm: body.waterFlowLpm == null || body.waterFlowLpm === '' ? null : nonNegative(body.waterFlowLpm, 'waterFlowLpm'),
    recordedAt: body.recordedAt || new Date().toISOString(),
    source: body.source || 'LIVE_SENSOR'
  };

  const allowedSources = ['LIVE_SENSOR', 'FARMER_ENTERED', 'SIMULATED_SENSOR'];
  if (!allowedSources.includes(reading.source)) {
    const error = new Error(`source must be one of: ${allowedSources.join(', ')}`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const parsedTime = Date.parse(reading.recordedAt);
  if (Number.isNaN(parsedTime) || parsedTime > Date.now() + 5 * 60 * 1000) {
    const error = new Error('recordedAt must be a valid timestamp close to the current time');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  if (reading.soilMoisturePct > 100 || reading.humidityPct > 100 || (reading.waterLevelPct != null && reading.waterLevelPct > 100)) {
    const error = new Error('Percentage readings must be between 0 and 100');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  if (!Number.isFinite(reading.temperatureC) || reading.temperatureC < -20 || reading.temperatureC > 70) {
    const error = new Error('temperatureC is outside the validated sensor range (-20 to 70°C)');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  return reading;
}
