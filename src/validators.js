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

function finiteNumber(value, field) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    const error = new Error(`${field} must be a finite number`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  if (typeof value === 'string' && !value.trim()) {
    const error = new Error(`${field} must be a finite number`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    const error = new Error(`${field} must be a finite number`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  return number;
}

export function optionalNumber(value, field, { minimum = null, maximum = null } = {}) {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  const number = finiteNumber(value, field);
  if ((minimum != null && number < minimum) || (maximum != null && number > maximum)) {
    const error = new Error(`${field} is outside the accepted range`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  return number;
}

export function nonNegative(value, field) {
  const number = finiteNumber(value, field);
  if (number < 0) {
    const error = new Error(`${field} must be a non-negative number`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  return number;
}

export function positiveNumber(value, field) {
  const number = finiteNumber(value, field);
  if (number <= 0) {
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

  const timestamp = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString().slice(0, 10) !== trimmed) {
    const error = new Error(`${field} is not a valid calendar date`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  return trimmed;
}

export function validateTimestamp(value, field) {
  if (typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const error = new Error(`${field} must be an ISO timestamp with a timezone`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  validateDate(value.slice(0, 10), field);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    const error = new Error(`${field} must be a valid ISO timestamp`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  return value;
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
  const quantity = optionalNumber(body.quantity, 'quantity', { minimum: 0 });

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
  const supportedParameters = ['pH', 'EC', 'Organic carbon', 'N', 'P', 'K', 'Moisture'];
  if (!supportedParameters.includes(parameter) && !/^[a-zA-Z0-9\s_+%-]{1,50}$/.test(parameter)) {
    const error = new Error('parameter contains invalid characters');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const value = optionalNumber(body.value, 'value', {
    minimum: 0,
    maximum: parameter === 'pH' ? 14 : parameter === 'Moisture' ? 100 : null
  });
  const date = validateDate(body.date, 'date');
  const unit = body.unit == null || body.unit === '' ? '' : requireString(body.unit, 'unit', 20);
  if (unit) rejectHtml(unit, 'unit');
  const allowedUnits = {
    pH: ['unitless'],
    EC: ['dS/m', 'mS/cm'],
    'Organic carbon': ['%', 'g/kg'],
    Moisture: ['%'],
    N: ['mg/kg', 'kg/ha', 'ppm'],
    P: ['mg/kg', 'kg/ha', 'ppm'],
    K: ['mg/kg', 'kg/ha', 'ppm']
  };
  if (unit && allowedUnits[parameter] && !allowedUnits[parameter].includes(unit)) {
    const error = new Error(`unit is not valid for ${parameter}`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  if (parameter === 'pH' && unit && unit !== 'unitless') {
    const error = new Error('pH is unitless');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  const method = body.method == null || (typeof body.method === 'string' && !body.method.trim())
    ? null : requireString(body.method, 'method', 100);
  if (method) rejectHtml(method, 'method');

  const zoneId = body.zoneId ? requireString(body.zoneId, 'zoneId', 64) : null;
  if (zoneId) rejectHtml(zoneId, 'zoneId');

  return {
    farmId,
    zoneId,
    parameter,
    value,
    unit: parameter === 'pH' ? '' : unit,
    method,
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
  const season = body.season == null || (typeof body.season === 'string' && !body.season.trim())
    ? null
    : enumValue(body.season, 'season', allowedSeasons);

  const yearNum = optionalNumber(body.year, 'year', { minimum: 1990, maximum: 2100 });
  if (yearNum != null && !Number.isInteger(yearNum)) {
    const error = new Error('year must be an integer between 1990 and 2100');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const areaAcres = positiveNumber(body.areaAcres, 'areaAcres');
  const yieldQuintal = optionalNumber(body.yieldQuintal, 'yieldQuintal', { minimum: 0 });
  const sellingPricePerQuintal = optionalNumber(body.sellingPricePerQuintal, 'sellingPricePerQuintal', { minimum: 0 });
  const plantedDate = body.plantedDate == null || (typeof body.plantedDate === 'string' && !body.plantedDate.trim())
    ? null : validateDate(body.plantedDate, 'plantedDate');
  const harvestedDate = body.harvestedDate == null || (typeof body.harvestedDate === 'string' && !body.harvestedDate.trim())
    ? null : validateDate(body.harvestedDate, 'harvestedDate');
  if (plantedDate && harvestedDate && plantedDate > harvestedDate) {
    const error = new Error('harvestedDate must not be before plantedDate');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  const currency = body.currency == null || body.currency === ''
    ? 'INR' : enumValue(body.currency, 'currency', ['INR']);

  const expenses = {};
  if (body.expenses != null && (typeof body.expenses !== 'object' || Array.isArray(body.expenses))) {
    const error = new Error('expenses must be an object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  if (body.expenses) {
    for (const [k, v] of Object.entries(body.expenses)) {
      if (!/^[a-zA-Z0-9_-]{1,30}$/.test(k)) {
        const error = new Error('expense category is invalid');
        error.status = 400;
        error.code = 'validation_error';
        throw error;
      }
      const amount = optionalNumber(v, `expenses.${k}`, { minimum: 0 });
      if (amount != null) expenses[k] = amount;
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
    currency,
    plantedDate,
    harvestedDate,
    expenses,
    expensesComplete: body.expensesComplete === true,
    source: 'FARMER_ENTERED'
  };
}

export function cropPlanPayload(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be a JSON object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const farmId = requireString(body.farmId, 'farmId', 64);
  rejectHtml(farmId, 'farmId');
  const zoneId = requireString(body.zoneId, 'zoneId', 64);
  rejectHtml(zoneId, 'zoneId');

  const crop = requireString(body.crop, 'crop', 80);
  rejectHtml(crop, 'crop');

  const variety = body.variety == null || (typeof body.variety === 'string' && !body.variety.trim())
    ? null
    : requireString(body.variety, 'variety', 80);
  if (variety) rejectHtml(variety, 'variety');

  const season = body.season == null || (typeof body.season === 'string' && !body.season.trim())
    ? null
    : requireString(body.season, 'season', 80);
  if (season) rejectHtml(season, 'season');

  const agriculturalYear = body.agriculturalYear == null || (typeof body.agriculturalYear === 'string' && !body.agriculturalYear.trim())
    ? null
    : optionalNumber(body.agriculturalYear, 'agriculturalYear', { minimum: 1900, maximum: 2100 });
  if (agriculturalYear != null && !Number.isInteger(agriculturalYear)) {
    const error = new Error('agriculturalYear must be an integer between 1900 and 2100');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const sowingDate = body.sowingDate == null || (typeof body.sowingDate === 'string' && !body.sowingDate.trim())
    ? null
    : validateDate(body.sowingDate, 'sowingDate');
  const expectedHarvestDate = body.expectedHarvestDate == null || (typeof body.expectedHarvestDate === 'string' && !body.expectedHarvestDate.trim())
    ? null
    : validateDate(body.expectedHarvestDate, 'expectedHarvestDate');
  const actualHarvestDate = body.actualHarvestDate == null || (typeof body.actualHarvestDate === 'string' && !body.actualHarvestDate.trim())
    ? null
    : validateDate(body.actualHarvestDate, 'actualHarvestDate');

  if (sowingDate && expectedHarvestDate && new Date(`${expectedHarvestDate}T00:00:00.000Z`).getTime() < new Date(`${sowingDate}T00:00:00.000Z`).getTime()) {
    const error = new Error('expectedHarvestDate must not be earlier than sowingDate');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  if (sowingDate && actualHarvestDate && new Date(`${actualHarvestDate}T00:00:00.000Z`).getTime() < new Date(`${sowingDate}T00:00:00.000Z`).getTime()) {
    const error = new Error('actualHarvestDate must not be earlier than sowingDate');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const currentGrowthStage = body.currentGrowthStage == null || (typeof body.currentGrowthStage === 'string' && !body.currentGrowthStage.trim())
    ? null
    : requireString(body.currentGrowthStage, 'currentGrowthStage', 60);
  if (currentGrowthStage) rejectHtml(currentGrowthStage, 'currentGrowthStage');

  const cultivatedArea = positiveNumber(body.cultivatedArea, 'cultivatedArea');
  const areaUnit = requireString(body.areaUnit, 'areaUnit', 20);
  rejectHtml(areaUnit, 'areaUnit');
  const allowedAreaUnits = ['acre', 'acres', 'ha', 'hectare', 'hectares', 'sqm', 'm2', 'm²'];
  if (!allowedAreaUnits.includes(areaUnit.toLowerCase())) {
    const error = new Error(`areaUnit must be one of: ${allowedAreaUnits.join(', ')}`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const recordSource = body.recordSource == null || (typeof body.recordSource === 'string' && !body.recordSource.trim())
    ? 'FARMER_ENTERED'
    : requireString(body.recordSource, 'recordSource', 60);
  rejectHtml(recordSource, 'recordSource');
  const allowedRecordSources = ['FARMER_ENTERED', 'SENSOR_OBSERVED', 'OFFICIAL_SOURCE', 'DEMONSTRATION_DATA'];
  if (!allowedRecordSources.includes(recordSource)) {
    const error = new Error(`recordSource must be one of: ${allowedRecordSources.join(', ')}`);
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const status = enumValue(body.status || 'planned', 'status', ['planned', 'active', 'completed', 'cancelled']);

  return {
    farmId,
    zoneId,
    crop,
    variety,
    season,
    agriculturalYear,
    sowingDate,
    expectedHarvestDate,
    actualHarvestDate,
    currentGrowthStage,
    cultivatedArea,
    areaUnit: areaUnit.toLowerCase() === 'm2' || areaUnit.toLowerCase() === 'm²' ? 'sqm' : areaUnit,
    recordSource,
    source: recordSource,
    status,
    createdAt: body.createdAt || null,
    updatedAt: body.updatedAt || null
  };
}

export function planningPeriodPayload(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be a JSON object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const farmId = requireString(body.farmId, 'farmId', 64);
  rejectHtml(farmId, 'farmId');
  const zoneId = body.zoneId == null || (typeof body.zoneId === 'string' && !body.zoneId.trim())
    ? null
    : requireString(body.zoneId, 'zoneId', 64);
  if (zoneId) rejectHtml(zoneId, 'zoneId');
  const cropPlanId = body.cropPlanId == null || (typeof body.cropPlanId === 'string' && !body.cropPlanId.trim())
    ? null
    : requireString(body.cropPlanId, 'cropPlanId', 64);
  if (cropPlanId) rejectHtml(cropPlanId, 'cropPlanId');

  const startDate = validateDate(body.startDate, 'startDate');
  const endDate = validateDate(body.endDate, 'endDate');
  if (new Date(`${endDate}T00:00:00.000Z`).getTime() < new Date(`${startDate}T00:00:00.000Z`).getTime()) {
    const error = new Error('startDate must not be later than endDate');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const computedDuration = Math.round((new Date(`${endDate}T00:00:00.000Z`).getTime() - new Date(`${startDate}T00:00:00.000Z`).getTime()) / 86400000) + 1;
  const durationDays = body.durationDays == null || body.durationDays === ''
    ? computedDuration
    : Number(body.durationDays);
  if (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > 365) {
    const error = new Error('durationDays must be between 1 and 365');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  if (!Number.isFinite(computedDuration) || computedDuration !== durationDays) {
    const error = new Error('durationDays must match the difference between startDate and endDate');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const status = enumValue(body.status || 'draft', 'status', ['draft', 'active', 'completed', 'cancelled']);

  return {
    farmId,
    zoneId,
    cropPlanId,
    startDate,
    endDate,
    durationDays,
    status
  };
}

export function effectiveRainfallPayload(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be a JSON object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const farmId = requireString(body.farmId, 'farmId', 64);
  rejectHtml(farmId, 'farmId');
  const zoneId = body.zoneId == null || (typeof body.zoneId === 'string' && !body.zoneId.trim())
    ? null
    : requireString(body.zoneId, 'zoneId', 64);
  if (zoneId) rejectHtml(zoneId, 'zoneId');
  const planningPeriodId = requireString(body.planningPeriodId, 'planningPeriodId', 64);
  rejectHtml(planningPeriodId, 'planningPeriodId');
  const observationDate = validateDate(body.observationDate, 'observationDate');
  const amount = nonNegative(body.amount, 'amount');
  const unit = requireString(body.unit, 'unit', 20);
  rejectHtml(unit, 'unit');
  if (unit !== 'mm') {
    const error = new Error('unit must be mm for effective rainfall records');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  const method = requireString(body.method, 'method', 120);
  rejectHtml(method, 'method');
  const source = requireString(body.source, 'source', 80);
  rejectHtml(source, 'source');
  const sourceTimestamp = body.sourceTimestamp == null || (typeof body.sourceTimestamp === 'string' && !body.sourceTimestamp.trim())
    ? null
    : validateTimestamp(body.sourceTimestamp, 'sourceTimestamp');
  const enteredBy = body.enteredBy == null || (typeof body.enteredBy === 'string' && !body.enteredBy.trim())
    ? null
    : requireString(body.enteredBy, 'enteredBy', 80);
  if (enteredBy) rejectHtml(enteredBy, 'enteredBy');
  const provenance = enumValue(body.provenance || 'FARMER_ENTERED', 'provenance', ['FARMER_ENTERED', 'SENSOR_OBSERVED', 'OFFICIAL_SOURCE', 'REVIEWED_CALCULATION', 'DEMONSTRATION_DATA']);

  return {
    farmId,
    zoneId,
    planningPeriodId,
    observationDate,
    amount,
    unit,
    method,
    source,
    sourceTimestamp,
    enteredBy,
    provenance
  };
}

export function waterAvailabilityPayload(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be a JSON object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const farmId = requireString(body.farmId, 'farmId', 64);
  rejectHtml(farmId, 'farmId');
  const zoneId = body.zoneId == null || (typeof body.zoneId === 'string' && !body.zoneId.trim())
    ? null
    : requireString(body.zoneId, 'zoneId', 64);
  if (zoneId) rejectHtml(zoneId, 'zoneId');

  const waterType = enumValue(body.waterType || 'stored', 'waterType', ['stored', 'reliable_incoming', 'aggregate_available', 'unknown']);
  const amountLitres = nonNegative(body.availableWaterLitres, 'availableWaterLitres');
  const unit = requireString(body.unit || 'litres', 'unit', 20);
  rejectHtml(unit, 'unit');
  if (!['litres', 'litre', 'l', 'liter', 'liters'].includes(unit.toLowerCase())) {
    const error = new Error('unit must be expressed in litres for water availability records');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }
  const measurementDate = validateDate(body.measurementDate, 'measurementDate');
  const provenance = enumValue(body.provenance || 'FARMER_ENTERED', 'provenance', ['FARMER_ENTERED', 'OFFICIAL_SOURCE', 'REVIEWED_CALCULATION', 'DEMONSTRATION_DATA', 'UNKNOWN']);
  const validityPeriod = body.validityPeriod == null || (typeof body.validityPeriod === 'string' && !body.validityPeriod.trim())
    ? null
    : requireString(body.validityPeriod, 'validityPeriod', 120);
  if (validityPeriod) rejectHtml(validityPeriod, 'validityPeriod');
  const notes = sanitizeNotes(body.notes);

  return {
    farmId,
    zoneId,
    waterType,
    availableWaterLitres: amountLitres,
    unit: 'litres',
    measurementDate,
    provenance,
    validityPeriod,
    notes
  };
}

export function waterUseEventPayload(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Request body must be a JSON object');
    error.status = 400;
    error.code = 'validation_error';
    throw error;
  }

  const farmId = requireString(body.farmId, 'farmId', 64);
  rejectHtml(farmId, 'farmId');
  const zoneId = body.zoneId == null || (typeof body.zoneId === 'string' && !body.zoneId.trim())
    ? null
    : requireString(body.zoneId, 'zoneId', 64);
  if (zoneId) rejectHtml(zoneId, 'zoneId');
  const cropPlanId = body.cropPlanId == null || (typeof body.cropPlanId === 'string' && !body.cropPlanId.trim())
    ? null
    : requireString(body.cropPlanId, 'cropPlanId', 64);
  if (cropPlanId) rejectHtml(cropPlanId, 'cropPlanId');

  const eventDateTime = body.eventDateTime == null || (typeof body.eventDateTime === 'string' && !body.eventDateTime.trim())
    ? validateTimestamp(new Date().toISOString(), 'eventDateTime')
    : validateTimestamp(body.eventDateTime, 'eventDateTime');
  const waterQuantity = nonNegative(body.waterQuantity, 'waterQuantity');
  const quantityUnit = enumValue((body.quantityUnit || 'litres').toLowerCase(), 'quantityUnit', ['litres', 'mm']);
  const applicationMethod = requireString(body.applicationMethod, 'applicationMethod', 80);
  rejectHtml(applicationMethod, 'applicationMethod');
  const sourceOfMeasurement = requireString(body.sourceOfMeasurement, 'sourceOfMeasurement', 80);
  rejectHtml(sourceOfMeasurement, 'sourceOfMeasurement');
  const recordProvenance = enumValue(body.recordProvenance || 'FARMER_ENTERED', 'recordProvenance', ['FARMER_ENTERED', 'SENSOR_OBSERVED', 'OFFICIAL_SOURCE', 'REVIEWED_CALCULATION', 'DEMONSTRATION_DATA']);
  const notes = sanitizeNotes(body.notes);

  if (quantityUnit === 'mm') {
    if (!zoneId) {
      const error = new Error('quantityUnit mm requires an associated zoneId to validate a matching area');
      error.status = 400;
      error.code = 'validation_error';
      throw error;
    }
  }

  return {
    farmId,
    zoneId,
    cropPlanId,
    eventDateTime,
    waterQuantity,
    quantityUnit,
    applicationMethod,
    sourceOfMeasurement,
    recordProvenance,
    notes
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
    temperatureC: finiteNumber(body.temperatureC, 'temperatureC'),
    humidityPct: nonNegative(body.humidityPct, 'humidityPct'),
    waterLevelPct: body.waterLevelPct == null || body.waterLevelPct === '' ? null : nonNegative(body.waterLevelPct, 'waterLevelPct'),
    waterFlowLpm: body.waterFlowLpm == null || body.waterFlowLpm === '' ? null : nonNegative(body.waterFlowLpm, 'waterFlowLpm'),
    recordedAt: body.recordedAt == null || body.recordedAt === ''
      ? new Date().toISOString() : validateTimestamp(body.recordedAt, 'recordedAt'),
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
