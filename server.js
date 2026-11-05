import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './src/store.js';
import {
  authMiddleware,
  checkFarmOwnership,
  comparePassword,
  deviceAuthMiddleware,
  generateToken,
  hashPassword,
  hashToken,
  requireAdmin
} from './src/auth.js';
import {
  buildAlerts
} from './src/decision-engine.js';
import { calculateDecisionEngine } from './src/decision-service.js';
import { dataBadge, getWeather, neuGenExplain } from './src/integrations.js';
import {
  activityPayload,
  enumValue,
  farmPayload,
  harvestPayload,
  nonNegative,
  profilePayload,
  requireString,
  sensorPayload,
  soilTestPayload,
  validateLogin,
  validateRegister,
  zonePayload
} from './src/validators.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(customStore) {
  const store = customStore || createStore();
  const app = express();
  const hits = new Map();
  const authHits = new Map();

  app.disable('x-powered-by');

  // Body parser with size limit
  app.use(express.json({ limit: '256kb' }));

  // Malformed JSON handler: catch SyntaxError and return consistent 400 Bad Request
  app.use((err, _req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({
        error: 'invalid_json',
        message: 'Malformed JSON payload in request body'
      });
    }
    next(err);
  });

  // General rate limiter & security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');

    const key = req.ip || req.socket.remoteAddress || 'local';
    const now = Date.now();
    const bucket = hits.get(key) || { started: now, count: 0 };
    if (now - bucket.started > 60_000) {
      bucket.started = now;
      bucket.count = 0;
    }
    bucket.count += 1;
    hits.set(key, bucket);

    if (bucket.count > 300) {
      return res.status(429).json({
        error: 'rate_limited',
        message: 'Too many requests. Try again shortly.'
      });
    }
    next();
  });

  // Dedicated auth endpoint rate limiter (prevent brute force)
  const authLimiter = (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'local';
    const now = Date.now();
    const bucket = authHits.get(key) || { started: now, count: 0 };
    if (now - bucket.started > 60_000) {
      bucket.started = now;
      bucket.count = 0;
    }
    bucket.count += 1;
    authHits.set(key, bucket);

    if (bucket.count > 25) {
      return res.status(429).json({
        error: 'auth_rate_limited',
        message: 'Too many authentication attempts. Please wait a minute before trying again.'
      });
    }
    next();
  };

  app.use(express.static(path.join(__dirname, 'public')));

  const ok = (res, data, status = 200) => res.status(status).json({ data, generatedAt: new Date().toISOString() });
  const fail = (res, status, code, message) => res.status(status).json({ error: code, message });

  const wrap = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error.status && error.status < 500) {
        return fail(res, error.status, error.code || 'validation_error', error.message || 'Request validation failed');
      }
      console.error('Request error:', error);
      fail(res, error.status || 500, error.code || 'internal_error', error.status ? error.message : 'Unexpected server error');
    }
  };

  const getFarmOr404 = (id) => {
    const farm = store.findFarm(id);
    if (!farm) {
      const error = new Error('Farm not found');
      error.status = 404;
      error.code = 'not_found';
      throw error;
    }
    return farm;
  };

  const verifyFarm = (req, farmId) => {
    const farm = getFarmOr404(farmId);
    if (!checkFarmOwnership(req.user, farm)) {
      const error = new Error('Access denied: you do not have permission to access this farm');
      error.status = 403;
      error.code = 'forbidden';
      throw error;
    }
    return farm;
  };

  const verifyZoneForFarm = (farmId, zoneId) => {
    if (!zoneId) return;
    const zone = store.list('zones').find((item) => item.id === zoneId);
    if (!zone || zone.farmId !== farmId) {
      const error = new Error('Zone not found for the specified farm');
      error.status = 422;
      error.code = 'zone_farm_mismatch';
      throw error;
    }
  };

  const getUserFarms = (user) => {
    if (user.role === 'ADMIN') {
      return store.list('farms');
    }
    return store.list('farms').filter((farm) => farm.farmerId === user.farmerId || farm.farmerId === user.id);
  };

  const farmBundle = (farmId) => {
    const farm = getFarmOr404(farmId);
    const seasons = store.scoped('seasons', farmId);
    const soilTests = store.scoped('soilTests', farmId);
    const zones = store.scoped('zones', farmId);
    const activeCrops = store.scoped('activeCrops', farmId);
    const activities = store.scoped('activities', farmId);
    const decisionWeather = store.scoped('weather', farmId);
    const weather = decisionWeather.length ? decisionWeather : store.list('weather');
    const sensorReadings = store.scoped('sensorReadings', farmId).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
    const sensorDevices = store.scoped('sensorDevices', farmId);
    const calculation = calculateDecisionEngine({
      farm,
      seasons,
      soilTests,
      zones,
      activeCrops,
      sensorReadings,
      activities,
      weather: decisionWeather,
      dataMode: store.data.sourceMode || 'UNKNOWN'
    });
    const {
      landPower: land,
      recommendations,
      waterBudget: water,
      irrigation,
      risks,
      profit
    } = calculation.result;
    buildAlerts({ farm, water, risks, irrigation, activeCrops, sensorDevices }).forEach((alert) => store.addAlert(alert));
    return {
      farm,
      farmer: store.getFarmer(farm.farmerId),
      zones,
      activeCrops,
      latestReading: sensorReadings[0] || null,
      sensorReadings: sensorReadings.slice(0, 20),
      sensorDevices,
      soilTests,
      seasons,
      decisions: store.scoped('decisions', farmId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
      activities,
      weather,
      landPower: land,
      recommendations,
      waterBudget: water,
      irrigation,
      risks,
      profit,
      farmMemory: calculation.result.farmMemory,
      decisionEngine: {
        status: calculation.status,
        calculationVersion: calculation.calculationVersion,
        generatedAt: calculation.generatedAt,
        dataMode: calculation.dataMode,
        confidence: calculation.confidence,
        missingInputs: calculation.missingInputs
      },
      alerts: store.scoped('alerts', farmId).filter((alert) => !alert.acknowledged).slice(-8).reverse()
    };
  };

  const auth = authMiddleware(store);

  // -------------------------------------------------------------
  // Public Endpoints
  // -------------------------------------------------------------
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'agcro-api',
      storageMode: store.storageMode,
      databaseConfigured: store.databaseConfigured,
      databaseMode: store.databaseConfigured ? 'managed-database-adapter-pending' : 'not-configured',
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/meta', (_req, res) => {
    ok(res, {
      name: 'AGCRO',
      version: '1.1.0-secure-foundation',
      dataMode: store.data.sourceMode || 'DEMO_DATA',
      capabilities: [
        'dashboard',
        'farm-memory',
        'land-power',
        'crop-recommendations',
        'water-budget',
        'irrigation',
        'climate-risks',
        'profit-intelligence',
        'iot-ready',
        'admin-view',
        'ai-explanation-fallback',
        'authenticated-rbac',
        'device-bearer-auth'
      ],
      integrations: {
        weather: getWeather([]).mode,
        ai: process.env.NEUGEN_API_URL ? 'configured-pending-verification' : 'fallback-only'
      }
    });
  });

  // -------------------------------------------------------------
  // Authentication Endpoints
  // -------------------------------------------------------------
  app.post('/api/auth/register', authLimiter, wrap(async (req, res) => {
    const payload = validateRegister(req.body);

    const existingUser = store.getUserByUsername(payload.username);
    if (existingUser) {
      return fail(res, 409, 'user_exists', 'Username is already registered');
    }

    const passwordHash = await hashPassword(payload.password);
    const farmerId = store.makeId('farmer');
    const farmer = {
      id: farmerId,
      name: payload.name,
      location: payload.location || '',
      phone: payload.phone || '',
      role: 'farmer',
      createdAt: store.now()
    };
    store.add('farmers', farmer);

    const user = {
      id: store.makeId('user'),
      username: payload.username,
      passwordHash,
      role: 'FARMER',
      farmerId,
      name: payload.name,
      phone: payload.phone || '',
      createdAt: store.now()
    };
    store.add('users', user);

    const { token } = generateToken(user);
    ok(res, {
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        farmerId: user.farmerId,
        name: user.name
      },
      token
    }, 201);
  }));

  app.post('/api/auth/login', authLimiter, wrap(async (req, res) => {
    const { username, password } = validateLogin(req.body);
    const user = store.getUserByUsername(username);
    if (!user) {
      return fail(res, 401, 'invalid_credentials', 'Invalid username or password');
    }

    const matches = await comparePassword(password, user.passwordHash);
    if (!matches) {
      return fail(res, 401, 'invalid_credentials', 'Invalid username or password');
    }

    const { token } = generateToken(user);
    ok(res, {
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        farmerId: user.farmerId,
        name: user.name
      },
      token
    });
  }));

  app.post('/api/auth/logout', auth, wrap((req, res) => {
    if (req.jti) store.revokeToken(req.jti);
    if (req.tokenHash) store.revokeToken(req.tokenHash);
    ok(res, { message: 'Logged out successfully' });
  }));

  app.get('/api/auth/me', auth, wrap((req, res) => {
    const account = store.getUserById(req.user.id);
    ok(res, {
      user: {
        id: account.id,
        username: account.username,
        role: account.role,
        farmerId: account.farmerId,
        name: account.name,
        phone: account.phone || '',
        location: account.location || (account.farmerId ? store.getFarmer(account.farmerId)?.location : '') || '',
        createdAt: account.createdAt || null
      }
    });
  }));

  app.put('/api/auth/profile', auth, wrap((req, res) => {
    const payload = profilePayload(req.body);
    const updatedUser = store.update('users', req.user.id, {
      name: payload.name,
      phone: payload.phone,
      location: payload.location
    });
    if (req.user.farmerId) {
      store.update('farmers', req.user.farmerId, {
        name: payload.name,
        phone: payload.phone,
        location: payload.location
      });
    }
    ok(res, {
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        role: updatedUser.role,
        farmerId: updatedUser.farmerId,
        name: updatedUser.name,
        phone: updatedUser.phone,
        location: updatedUser.location
      }
    });
  }));

  // -------------------------------------------------------------
  // Farm & Dashboard Endpoints (Protected by Farm Ownership)
  // -------------------------------------------------------------
  app.get('/api/dashboard', auth, wrap((req, res) => {
    let farmId = req.query.farmId;
    if (!farmId) {
      const ownedFarms = getUserFarms(req.user);
      if (!ownedFarms.length) {
        return fail(res, 404, 'no_farms', 'No farms registered for your account. Please create a farm first.');
      }
      farmId = ownedFarms[0].id;
    }
    verifyFarm(req, farmId);
    ok(res, farmBundle(farmId));
  }));

  app.get('/api/farms', auth, wrap((req, res) => {
    const farms = getUserFarms(req.user);
    ok(res, farms.map((farm) => ({
      ...farm,
      farmer: store.getFarmer(farm.farmerId),
      sourceBadge: dataBadge(farm.source)
    })));
  }));

  app.get('/api/farms/:id', auth, wrap((req, res) => {
    verifyFarm(req, req.params.id);
    ok(res, farmBundle(req.params.id));
  }));

  app.put('/api/farms/:id', auth, wrap((req, res) => {
    verifyFarm(req, req.params.id);
    const existing = getFarmOr404(req.params.id);
    const payload = farmPayload(req.body);
    const updated = store.update('farms', req.params.id, {
      ...payload,
      farmerId: existing.farmerId
    });
    ok(res, updated);
  }));

  app.delete('/api/farms/:id', auth, wrap((req, res) => {
    verifyFarm(req, req.params.id);
    const farmId = req.params.id;

    const collectionsToClean = [
      'zones',
      'activities',
      'soilTests',
      'seasons',
      'activeCrops',
      'sensorReadings',
      'sensorDevices',
      'weather',
      'alerts',
      'decisions'
    ];
    for (const key of collectionsToClean) {
      const items = store.list(key).filter((item) => item.farmId === farmId);
      for (const item of items) {
        store.remove(key, item.id);
      }
    }
    store.remove('farms', farmId);
    ok(res, { message: 'Farm and associated records deleted successfully', farmId });
  }));

  app.post('/api/farms', auth, wrap((req, res) => {
    const payload = farmPayload(req.body);
    const farmerId = req.user.farmerId || req.user.id;
    const farm = {
      id: store.makeId('farm'),
      farmerId,
      ...payload,
      createdAt: store.now()
    };
    store.add('farms', farm);
    ok(res, farm, 201);
  }));

  app.get('/api/farms/:id/zones', auth, wrap((req, res) => {
    verifyFarm(req, req.params.id);
    ok(res, store.scoped('zones', req.params.id));
  }));

  app.post('/api/zones', auth, wrap((req, res) => {
    const payload = zonePayload(req.body);
    verifyFarm(req, payload.farmId);
    const zone = {
      id: store.makeId('zone'),
      ...payload,
      createdAt: store.now()
    };
    store.add('zones', zone);
    ok(res, zone, 201);
  }));

  app.put('/api/zones/:id', auth, wrap((req, res) => {
    const zone = store.list('zones').find((item) => item.id === req.params.id);
    if (!zone) return fail(res, 404, 'not_found', 'Zone not found');

    verifyFarm(req, zone.farmId);
    if (req.body.farmId && req.body.farmId !== zone.farmId) {
      return fail(res, 422, 'farm_mismatch', 'A zone cannot be moved across farms through this endpoint.');
    }
    const validated = zonePayload({ ...zone, ...req.body, farmId: zone.farmId });
    ok(res, store.update('zones', req.params.id, validated));
  }));

  app.delete('/api/zones/:id', auth, wrap((req, res) => {
    const zone = store.list('zones').find((item) => item.id === req.params.id);
    if (!zone) return fail(res, 404, 'not_found', 'Zone not found');

    verifyFarm(req, zone.farmId);
    store.remove('zones', req.params.id);

    // Unmap any sensor devices referencing this zone
    const devices = store.list('sensorDevices').filter((d) => d.zoneId === req.params.id);
    for (const d of devices) {
      store.update('sensorDevices', d.id, { zoneId: null });
    }

    ok(res, { message: 'Zone deleted successfully', zoneId: req.params.id });
  }));

  // -------------------------------------------------------------
  // Recommendations, Irrigation, Water, Risks, Weather, Profit
  // -------------------------------------------------------------
  app.get('/api/recommendations', auth, wrap((req, res) => {
    const farmId = req.query.farmId || getUserFarms(req.user)[0]?.id;
    if (!farmId) return fail(res, 404, 'no_farms', 'No farms found');
    verifyFarm(req, farmId);
    ok(res, farmBundle(farmId).recommendations);
  }));

  app.post('/api/recommendations/:crop/decision', auth, wrap((req, res) => {
    const farmId = req.body.farmId || getUserFarms(req.user)[0]?.id;
    if (!farmId) return fail(res, 404, 'no_farms', 'No farms found');
    verifyFarm(req, farmId);

    const status = enumValue(req.body.status, 'status', ['accepted', 'rejected', 'deferred']);
    const crop = requireString(req.params.crop, 'crop', 80);
    const decision = store.recordDecision({
      farmId,
      userId: req.user.id,
      category: 'crop-recommendation',
      crop,
      status,
      source: 'FARMER_CONFIRMED',
      note: req.body.note ? String(req.body.note).slice(0, 500) : ''
    });
    ok(res, decision);
  }));

  app.get('/api/water-budget', auth, wrap((req, res) => {
    const farmId = req.query.farmId || getUserFarms(req.user)[0]?.id;
    if (!farmId) return fail(res, 404, 'no_farms', 'No farms found');
    verifyFarm(req, farmId);
    ok(res, farmBundle(farmId).waterBudget);
  }));

  app.get('/api/irrigation-advice', auth, wrap((req, res) => {
    const farmId = req.query.farmId || getUserFarms(req.user)[0]?.id;
    if (!farmId) return fail(res, 404, 'no_farms', 'No farms found');
    verifyFarm(req, farmId);
    ok(res, farmBundle(farmId).irrigation);
  }));

  app.get('/api/climate-risks', auth, wrap((req, res) => {
    const farmId = req.query.farmId || getUserFarms(req.user)[0]?.id;
    if (!farmId) return fail(res, 404, 'no_farms', 'No farms found');
    verifyFarm(req, farmId);
    ok(res, farmBundle(farmId).risks);
  }));

  app.get('/api/weather', auth, wrap((req, res) => {
    const farmId = req.query.farmId || getUserFarms(req.user)[0]?.id;
    if (!farmId) return fail(res, 404, 'no_farms', 'No farms found');
    verifyFarm(req, farmId);
    const bundle = farmBundle(farmId);
    ok(res, { forecast: bundle.weather, ...getWeather(bundle.weather) });
  }));

  app.get('/api/profit-analysis', auth, wrap((req, res) => {
    const farmId = req.query.farmId || getUserFarms(req.user)[0]?.id;
    if (!farmId) return fail(res, 404, 'no_farms', 'No farms found');
    verifyFarm(req, farmId);
    ok(res, farmBundle(farmId).profit);
  }));

  // -------------------------------------------------------------
  // Farm Memory Endpoints: Activities, Soil Tests, Harvests
  // -------------------------------------------------------------
  app.post('/api/activities', auth, wrap((req, res) => {
    const payload = activityPayload(req.body);
    verifyFarm(req, payload.farmId);
    verifyZoneForFarm(payload.farmId, payload.zoneId);
    const activity = {
      id: store.makeId('activity'),
      ...payload
    };
    store.add('activities', activity);
    ok(res, activity, 201);
  }));

  app.put('/api/activities/:id', auth, wrap((req, res) => {
    const existing = store.list('activities').find((item) => item.id === req.params.id);
    if (!existing) return fail(res, 404, 'not_found', 'Activity not found');
    verifyFarm(req, existing.farmId);
    const payload = activityPayload({ ...req.body, farmId: existing.farmId });
    verifyZoneForFarm(existing.farmId, payload.zoneId);
    if (payload.farmId !== existing.farmId) return fail(res, 422, 'farm_mismatch', 'An activity cannot be moved across farms.');
    ok(res, store.update('activities', req.params.id, payload));
  }));

  app.post('/api/soil-tests', auth, wrap((req, res) => {
    const payload = soilTestPayload(req.body);
    verifyFarm(req, payload.farmId);
    verifyZoneForFarm(payload.farmId, payload.zoneId);
    const test = {
      id: store.makeId('soil'),
      ...payload
    };
    store.add('soilTests', test);
    ok(res, test, 201);
  }));

  app.put('/api/soil-tests/:id', auth, wrap((req, res) => {
    const existing = store.list('soilTests').find((item) => item.id === req.params.id);
    if (!existing) return fail(res, 404, 'not_found', 'Soil test not found');
    verifyFarm(req, existing.farmId);
    const payload = soilTestPayload({ ...req.body, farmId: existing.farmId });
    verifyZoneForFarm(existing.farmId, payload.zoneId);
    if (payload.farmId !== existing.farmId) return fail(res, 422, 'farm_mismatch', 'A soil test cannot be moved across farms.');
    ok(res, store.update('soilTests', req.params.id, payload));
  }));

  app.post('/api/harvests', auth, wrap((req, res) => {
    const payload = harvestPayload(req.body);
    verifyFarm(req, payload.farmId);
    const harvest = {
      id: store.makeId('season'),
      ...payload
    };
    store.add('seasons', harvest);
    ok(res, harvest, 201);
  }));

  app.put('/api/harvests/:id', auth, wrap((req, res) => {
    const existing = store.list('seasons').find((item) => item.id === req.params.id);
    if (!existing) return fail(res, 404, 'not_found', 'Season record not found');
    verifyFarm(req, existing.farmId);
    const payload = harvestPayload({ ...req.body, farmId: existing.farmId });
    if (payload.farmId !== existing.farmId) return fail(res, 422, 'farm_mismatch', 'A season record cannot be moved across farms.');
    ok(res, store.update('seasons', req.params.id, payload));
  }));

  // -------------------------------------------------------------
  // Sensor Readings & IoT Ingestion (Bearer Token Auth)
  // -------------------------------------------------------------
  app.post('/api/sensor-readings', deviceAuthMiddleware(store), wrap((req, res) => {
    const reading = sensorPayload(req.body);
    const farm = getFarmOr404(reading.farmId);

    // If authenticated via user session, check user owns the farm
    if (req.authType === 'user') {
      if (!checkFarmOwnership(req.user, farm)) {
        return fail(res, 403, 'forbidden', 'Access denied: you do not have permission for this farm');
      }
      reading.source = 'FARMER_ENTERED';
    } else {
      // Authenticated via device credentials
      const device = req.device;
      if (device.id !== reading.deviceId) {
        return fail(res, 422, 'device_mismatch', 'Device credentials do not match the specified deviceId in payload');
      }
      if (device.farmId !== reading.farmId || device.zoneId !== reading.zoneId) {
        return fail(res, 422, 'device_zone_mismatch', 'Device is not mapped to the supplied farm zone.');
      }
      reading.source = 'LIVE_SENSOR';
      store.update('sensorDevices', device.id, { status: 'online', lastReadingAt: reading.recordedAt });
    }

    const saved = store.add('sensorReadings', { id: store.makeId('reading'), ...reading });
    ok(res, saved, 201);
  }));

  app.get('/api/farms/:id/readings/latest', auth, wrap((req, res) => {
    verifyFarm(req, req.params.id);
    const latest = store.scoped('sensorReadings', req.params.id).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
    ok(res, latest.slice(0, 20).map((reading) => ({
      ...reading,
      stale: Date.now() - new Date(reading.recordedAt).getTime() > 60 * 60 * 1000,
      sourceBadge: dataBadge(reading.source)
    })));
  }));

  // -------------------------------------------------------------
  // Alerts & Decisions
  // -------------------------------------------------------------
  app.get('/api/alerts', auth, wrap((req, res) => {
    let alerts;
    if (req.query.farmId) {
      verifyFarm(req, req.query.farmId);
      alerts = store.scoped('alerts', req.query.farmId);
    } else {
      const userFarms = new Set(getUserFarms(req.user).map((f) => f.id));
      alerts = store.list('alerts').filter((alert) => userFarms.has(alert.farmId));
    }
    const filtered = alerts
      .filter((alert) => req.query.includeAcknowledged === 'true' || !alert.acknowledged)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    ok(res, filtered);
  }));

  app.post('/api/alerts/:id/acknowledge', auth, wrap((req, res) => {
    const alert = store.list('alerts').find((item) => item.id === req.params.id);
    if (!alert) return fail(res, 404, 'not_found', 'Alert not found');

    verifyFarm(req, alert.farmId);
    const updated = store.acknowledge(req.params.id);
    ok(res, updated);
  }));

  app.get('/api/decisions', auth, wrap((req, res) => {
    const farmId = req.query.farmId || getUserFarms(req.user)[0]?.id;
    if (!farmId) return fail(res, 404, 'no_farms', 'No farms found');
    verifyFarm(req, farmId);
    ok(res, store.scoped('decisions', farmId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
  }));

  // -------------------------------------------------------------
  // AI Assistant Endpoints
  // -------------------------------------------------------------
  app.post('/api/ai/explain', auth, wrap((req, res) => {
    const farmId = req.body.farmId || getUserFarms(req.user)[0]?.id;
    if (!farmId) return fail(res, 404, 'no_farms', 'No farms found');
    verifyFarm(req, farmId);

    const bundle = farmBundle(farmId);
    const explanation = neuGenExplain({
      question: req.body.question,
      language: req.body.language,
      context: {
        landPower: bundle.landPower,
        recommendation: bundle.recommendations[0],
        waterBudget: bundle.waterBudget,
        risks: bundle.risks,
        profit: bundle.profit
      }
    });

    const decision = store.recordDecision({
      farmId: bundle.farm.id,
      userId: req.user.id,
      category: 'ai-explanation',
      status: 'generated',
      source: explanation.mode,
      question: req.body.question ? String(req.body.question).slice(0, 500) : '',
      summary: explanation.answer
    });

    ok(res, {
      ...explanation,
      evidence: ['landPower', 'recommendation', 'waterBudget', 'risks', 'profit'].filter((key) => req.body.include?.includes?.(key) || !req.body.include),
      decisionId: decision.id
    });
  }));

  app.post('/api/ai/chat', auth, wrap((req, res) => {
    if (!req.body.message) return fail(res, 422, 'message_required', 'message is required');
    const farmId = req.body.farmId || getUserFarms(req.user)[0]?.id;
    if (!farmId) return fail(res, 404, 'no_farms', 'No farms found');
    verifyFarm(req, farmId);

    const bundle = farmBundle(farmId);
    ok(res, neuGenExplain({
      question: req.body.message,
      language: req.body.language,
      context: bundle
    }));
  }));

  // -------------------------------------------------------------
  // Export & Reference Endpoints
  // -------------------------------------------------------------
  app.get('/api/export', auth, wrap((req, res) => {
    const farmId = req.query.farmId || getUserFarms(req.user)[0]?.id;
    if (!farmId) return fail(res, 404, 'no_farms', 'No farms found');
    verifyFarm(req, farmId);

    const bundle = farmBundle(farmId);
    res.setHeader('Content-Disposition', `attachment; filename="agcro-${farmId}-report.json"`);
    res.json(bundle);
  }));

  app.get('/api/market', (_req, res) => {
    ok(res, {
      source: 'DEMO_MARKET_DATA',
      note: 'No verified live mandi feed is connected; do not treat prices as live.',
      listings: store.list('marketListings')
    });
  });

  app.get('/api/schemes', (_req, res) => {
    ok(res, {
      note: 'Official links are provided for verification; eligibility is not confirmed and no application is submitted.',
      schemes: store.list('schemes')
    });
  });

  // -------------------------------------------------------------
  // Admin Operations (Protected by Server-Side Admin Identity)
  // Completely rejects caller-supplied x-agcro-role
  // -------------------------------------------------------------
  const adminQueryString = (value, name, maxLength = 160) => {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > maxLength) {
      const error = new Error(`${name} must be a string no longer than ${maxLength} characters`);
      error.status = 400;
      error.code = 'validation_error';
      throw error;
    }
    return value.trim();
  };
  const adminQueryDate = (value, name) => {
    if (value === undefined || value === '') return '';
    const date = adminQueryString(value, name, 10);
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      const error = new Error(`${name} must be a valid YYYY-MM-DD date`);
      error.status = 400;
      error.code = 'validation_error';
      throw error;
    }
    return date;
  };
  const adminDateRange = (query) => {
    const from = adminQueryDate(query.dateFrom, 'dateFrom');
    const to = adminQueryDate(query.dateTo, 'dateTo');
    if (from && to && from > to) {
      const error = new Error('dateFrom must not be after dateTo');
      error.status = 400;
      error.code = 'validation_error';
      throw error;
    }
    return { from, to };
  };
  const adminPagination = (query) => {
    const parse = (value, fallback, name, maximum) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maximum) {
        const error = new Error(`${name} must be an integer between 1 and ${maximum}`);
        error.status = 400;
        error.code = 'validation_error';
        throw error;
      }
      return Number(value);
    };
    return {
      page: parse(query.page, 1, 'page', 1000000),
      pageSize: parse(query.pageSize, 25, 'pageSize', 100)
    };
  };
  const adminPage = (items, query) => {
    const { page, pageSize } = adminPagination(query);
    const start = (page - 1) * pageSize;
    return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
  };
  const adminSort = (items, query, allowed, defaultKey) => {
    const key = adminQueryString(query.sortBy, 'sortBy', 32) || defaultKey;
    const order = adminQueryString(query.sortOrder, 'sortOrder', 4) || 'asc';
    if (!allowed.includes(key) || !['asc', 'desc'].includes(order)) {
      const error = new Error('Unsupported sort field or order');
      error.status = 400;
      error.code = 'validation_error';
      throw error;
    }
    const multiplier = order === 'desc' ? -1 : 1;
    return items.sort((a, b) => {
      const left = a[key] == null ? '' : String(a[key]);
      const right = b[key] == null ? '' : String(b[key]);
      return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }) * multiplier;
    });
  };
  const adminInDateRange = (value, range) => {
    if (!range.from && !range.to) return true;
    if (!value) return false;
    const day = String(value).slice(0, 10);
    return (!range.from || day >= range.from) && (!range.to || day <= range.to);
  };
  const adminFarmerFor = (farmerId) => {
    const farmer = store.findFarmer(farmerId);
    const account = store.list('users').find((user) => user.farmerId === farmerId || user.id === farmer?.userId);
    if (!farmer && !account) return null;
    return {
      id: farmer?.id || account?.farmerId || account?.id || '',
      name: farmer?.name || account?.name || '',
      username: account?.username || '',
      phone: farmer?.phone || account?.phone || '',
      location: farmer?.location || account?.location || '',
      role: account?.role || farmer?.role || 'FARMER',
      createdAt: account?.createdAt || farmer?.createdAt || null
    };
  };
  const adminFarmerSummaryFor = (farmerId) => {
    const farmer = adminFarmerFor(farmerId);
    return farmer ? { id: farmer.id, name: farmer.name } : null;
  };
  const adminFarmRecord = (farm) => {
    const zones = store.scoped('zones', farm.id);
    const farmer = adminFarmerSummaryFor(farm.farmerId);
    return {
      id: farm.id,
      farmerId: farm.farmerId,
      name: farm.name,
      areaAcres: farm.areaAcres,
      soilType: farm.soilType,
      waterSource: farm.waterSource,
      irrigationMethod: farm.irrigationMethod,
      availableWaterLitres: farm.availableWaterLitres,
      location: farm.location,
      source: farm.source || 'UNKNOWN',
      createdAt: farm.createdAt || null,
      farmer,
      zones: zones.map((zone) => ({
        id: zone.id,
        farmId: zone.farmId,
        name: zone.name,
        areaAcres: zone.areaAcres,
        soilType: zone.soilType,
        waterAvailability: zone.waterAvailability,
        currentCrop: zone.currentCrop || '',
        growthStage: zone.growthStage || '',
        sensorId: zone.sensorId || null,
        source: zone.source || 'UNKNOWN'
      })),
      soilTests: store.scoped('soilTests', farm.id).map((item) => ({
        id: item.id, zoneId: item.zoneId || null, parameter: item.parameter, value: item.value,
        unit: item.unit || '', date: item.date || null, source: item.source || 'UNKNOWN'
      })),
      seasons: store.scoped('seasons', farm.id).map((item) => ({
        id: item.id, crop: item.crop, variety: item.variety || '', season: item.season,
        year: item.year, areaAcres: item.areaAcres, yieldQuintal: item.yieldQuintal,
        sellingPricePerQuintal: item.sellingPricePerQuintal, expenses: item.expenses || {},
        plantedDate: item.plantedDate || null, harvestDate: item.harvestDate || null,
        source: item.source || 'UNKNOWN'
      })),
      activeCrops: store.scoped('activeCrops', farm.id).map((item) => ({
        id: item.id, zoneId: item.zoneId || null, crop: item.crop, variety: item.variety || '',
        planted: item.planted || null, expectedHarvest: item.expectedHarvest || null,
        growthStage: item.growthStage || '', status: item.status || '', source: item.source || 'UNKNOWN'
      })),
      activities: store.scoped('activities', farm.id).map((item) => ({
        id: item.id, zoneId: item.zoneId || null, type: item.type, date: item.date,
        quantity: item.quantity, unit: item.unit || '', notes: item.notes || '', source: item.source || 'UNKNOWN'
      }))
    };
  };
  const adminFarmSummary = (farm) => ({
    id: farm.id,
    farmerId: farm.farmerId,
    name: farm.name,
    areaAcres: farm.areaAcres,
    soilType: farm.soilType,
    waterSource: farm.waterSource,
    irrigationMethod: farm.irrigationMethod,
    availableWaterLitres: farm.availableWaterLitres,
    location: farm.location,
    source: farm.source || 'UNKNOWN',
    createdAt: farm.createdAt || null,
    farmer: adminFarmerSummaryFor(farm.farmerId),
    zoneCount: store.scoped('zones', farm.id).length
  });
  const latestLiveReadingFor = (deviceId) => store.list('sensorReadings')
    .filter((reading) => reading.deviceId === deviceId && reading.source === 'LIVE_SENSOR')
    .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))[0] || null;
  const devicePresence = (device) => {
    if (device.status === 'revoked') return { status: 'revoked', lastAuthenticatedAt: null };
    const reading = latestLiveReadingFor(device.id);
    if (!reading) return { status: 'unverified', lastAuthenticatedAt: null };
    const age = Date.now() - new Date(reading.recordedAt).getTime();
    return {
      status: Number.isFinite(age) && age >= -5 * 60 * 1000 && age <= 15 * 60 * 1000 ? 'online' : 'offline',
      lastAuthenticatedAt: reading.recordedAt
    };
  };
  const adminDeviceRecord = (device) => {
    const farm = store.findFarm(device.farmId);
    const zone = store.list('zones').find((item) => item.id === device.zoneId && item.farmId === device.farmId);
    const latestReading = store.list('sensorReadings')
      .filter((reading) => reading.deviceId === device.id)
      .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))[0] || null;
    const presence = devicePresence(device);
    return {
      id: device.id,
      name: device.name || device.id,
      farmId: device.farmId,
      farmName: farm?.name || null,
      farmer: adminFarmerSummaryFor(farm?.farmerId),
      zoneId: zone?.id || null,
      zoneName: zone?.name || null,
      status: presence.status,
      lastAuthenticatedAt: presence.lastAuthenticatedAt,
      revokedAt: device.status === 'revoked' ? device.revokedAt || device.updatedAt || null : null,
      latestReading: latestReading ? {
        id: latestReading.id,
        soilMoisturePct: latestReading.soilMoisturePct,
        temperatureC: latestReading.temperatureC,
        humidityPct: latestReading.humidityPct,
        waterLevelPct: latestReading.waterLevelPct,
        recordedAt: latestReading.recordedAt,
        source: latestReading.source || 'UNKNOWN'
      } : null,
      credentialStatus: device.status === 'revoked' ? 'revoked' : device.tokenHash ? 'provisioned' : 'not-configured',
      firmware: device.firmware || null,
      source: device.source || 'UNKNOWN'
    };
  };
  const adminReadingRecord = (reading) => {
    const soilMoisturePct = reading.soilMoisturePct;
    const temperatureC = reading.temperatureC;
    const humidityPct = reading.humidityPct;
    const waterLevelPct = reading.waterLevelPct;
    const valid = (soilMoisturePct == null || (Number.isFinite(Number(soilMoisturePct)) && Number(soilMoisturePct) >= 0 && Number(soilMoisturePct) <= 100))
      && (temperatureC == null || (Number.isFinite(Number(temperatureC)) && Number(temperatureC) >= -20 && Number(temperatureC) <= 70))
      && (humidityPct == null || (Number.isFinite(Number(humidityPct)) && Number(humidityPct) >= 0 && Number(humidityPct) <= 100))
      && (waterLevelPct == null || (Number.isFinite(Number(waterLevelPct)) && Number(waterLevelPct) >= 0 && Number(waterLevelPct) <= 100));
    const farm = store.findFarm(reading.farmId);
    const zone = store.list('zones').find((item) => item.id === reading.zoneId && item.farmId === reading.farmId);
    return {
      id: reading.id,
      deviceId: reading.deviceId || null,
      farmId: reading.farmId,
      farmName: farm?.name || null,
      farmer: adminFarmerSummaryFor(farm?.farmerId),
      zoneId: reading.zoneId || null,
      zoneName: zone?.name || null,
      soilMoisturePct,
      temperatureC,
      humidityPct,
      waterLevelPct,
      waterFlowLpm: reading.waterFlowLpm,
      recordedAt: reading.recordedAt,
      source: reading.source || 'UNKNOWN',
      validity: valid ? 'valid' : 'out-of-range'
    };
  };
  const adminAlertRecord = (alert) => {
    const farm = store.findFarm(alert.farmId);
    const zone = store.list('zones').find((item) => item.id === alert.zoneId && item.farmId === alert.farmId);
    return {
      id: alert.id,
      farmId: alert.farmId,
      farmName: farm?.name || null,
      farmer: adminFarmerSummaryFor(farm?.farmerId),
      zoneId: zone?.id || null,
      zoneName: zone?.name || null,
      title: alert.title,
      description: alert.message,
      severity: alert.severity,
      category: alert.category || '',
      createdAt: alert.createdAt,
      acknowledged: Boolean(alert.acknowledged),
      acknowledgedAt: alert.acknowledgedAt || null,
      source: alert.source || 'UNKNOWN'
    };
  };
  const csvEscape = (value) => {
    let text = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[\s\u0000]*[=+\-@]/.test(value)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const adminCsv = (res, filename, columns, rows) => {
    const content = [columns.map(([, label]) => csvEscape(label)).join(','), ...rows.map((row) => columns.map(([key]) => csvEscape(row[key])).join(','))].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(`\uFEFF${content}`);
  };

  app.get('/api/admin/overview', auth, requireAdmin, wrap((_req, res) => {
    const farms = store.list('farms');
    const readings = store.list('sensorReadings').sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
    const devices = store.list('sensorDevices');
    const alerts = store.list('alerts');
    const decisions = store.list('decisions');
    const activeAlerts = alerts.filter((alert) => !alert.acknowledged);
    const highRiskFarms = new Set(activeAlerts.filter((alert) => alert.severity === 'critical').map((alert) => alert.farmId));
    const presences = devices.map(devicePresence);

    ok(res, {
      role: 'ADMIN',
      metrics: {
        farmers: store.list('farmers').length,
        farms: farms.length,
        zones: store.list('zones').length,
        devices: devices.length,
        onlineDevices: presences.filter((device) => device.status === 'online').length,
        offlineDevices: presences.filter((device) => device.status === 'offline').length,
        unverifiedDevices: presences.filter((device) => device.status === 'unverified').length,
        revokedDevices: devices.filter((device) => device.status === 'revoked').length,
        activeAlerts: activeAlerts.length,
        highRiskFarms: highRiskFarms.size,
        decisions: decisions.length,
        activities: store.list('activities').length,
        readings: readings.length
      },
      farms: farms.map((farm) => {
        const latestReading = store.scoped('sensorReadings', farm.id).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))[0];
        return {
          id: farm.id, farmerId: farm.farmerId, name: farm.name, areaAcres: farm.areaAcres,
          soilType: farm.soilType, irrigationMethod: farm.irrigationMethod, location: farm.location,
          source: farm.source || 'UNKNOWN', farmer: adminFarmerSummaryFor(farm.farmerId),
          zoneCount: store.scoped('zones', farm.id).length,
          latestReading: latestReading ? adminReadingRecord(latestReading) : null
        };
      }),
      devices: devices.map(adminDeviceRecord),
      alerts: alerts.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 12).map(adminAlertRecord),
      decisions: decisions.slice(-12).reverse().map((decision) => ({
        id: decision.id, farmId: decision.farmId, category: decision.category || '',
        status: decision.status || '', crop: decision.crop || '', summary: decision.summary || '',
        createdAt: decision.createdAt || null, source: decision.source || 'UNKNOWN',
        farmer: adminFarmerSummaryFor(store.findFarm(decision.farmId)?.farmerId)
      })),
      recentActivities: store.list('activities').slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10).map((activity) => {
        const farm = store.findFarm(activity.farmId);
        const zone = store.list('zones').find((item) => item.id === activity.zoneId && item.farmId === activity.farmId);
        return {
          id: activity.id, farmId: activity.farmId, farmName: farm?.name || null,
          farmer: adminFarmerSummaryFor(farm?.farmerId), zoneId: zone?.id || null,
          zoneName: zone?.name || null, type: activity.type, date: activity.date,
          quantity: activity.quantity, unit: activity.unit || '', source: activity.source || 'UNKNOWN'
        };
      }),
      recentReadings: readings.slice(0, 10).map(adminReadingRecord),
      administrativeEvents: { available:false, items:[] },
      dataMode: store.data.sourceMode || 'DEMO_DATA',
      demoData: (store.data.sourceMode || 'DEMO_DATA') === 'DEMO_DATA'
    });
  }));

  app.post('/api/admin/devices/:id/revoke', auth, requireAdmin, wrap((req, res) => {
    const device = store.getDeviceById(req.params.id);
    if (!device) return fail(res, 404, 'device_not_found', 'Sensor device not found');
    const updated = store.revokeDevice(req.params.id);
    ok(res, adminDeviceRecord(updated));
  }));

  app.get('/api/admin/farmers', auth, requireAdmin, wrap((req, res) => {
    const search = adminQueryString(req.query.search, 'search', 120).toLowerCase();
    const range = adminDateRange(req.query);
    const farmers = store.list('farmers').map((farmer) => {
      const profile = adminFarmerFor(farmer.id) || { id: farmer.id, name: farmer.name || '', username: '', phone: farmer.phone || '', location: farmer.location || '', role: 'FARMER', createdAt: farmer.createdAt || null };
      return { ...profile, farmCount: store.list('farms').filter((farm) => farm.farmerId === farmer.id).length };
    }).filter((farmer) => {
      const searchable = `${farmer.name} ${farmer.username} ${farmer.phone}`.toLowerCase();
      return (!search || searchable.includes(search)) && adminInDateRange(farmer.createdAt, range);
    });
    ok(res, adminPage(adminSort(farmers, req.query, ['name', 'username', 'createdAt', 'farmCount'], 'name'), req.query));
  }));

  app.get('/api/admin/farmers/:id', auth, requireAdmin, wrap((req, res) => {
    const farmer = adminFarmerFor(req.params.id);
    if (!farmer) return fail(res, 404, 'farmer_not_found', 'Farmer not found');
    const account = store.list('users').find((user) => user.farmerId === req.params.id || user.id === store.findFarmer(req.params.id)?.userId);
    ok(res, {
      ...farmer,
      account: account ? { createdAt: account.createdAt || null, role: account.role } : null,
      farms: store.list('farms').filter((farm) => farm.farmerId === req.params.id).map(adminFarmRecord)
    });
  }));

  app.get('/api/admin/farms', auth, requireAdmin, wrap((req, res) => {
    const search = adminQueryString(req.query.search, 'search', 120).toLowerCase();
    const farmerId = adminQueryString(req.query.farmerId, 'farmerId', 64);
    const range = adminDateRange(req.query);
    const farms = store.list('farms').map(adminFarmSummary).filter((farm) => {
      const searchable = `${farm.name} ${farm.location}`.toLowerCase();
      return (!search || searchable.includes(search))
        && (!farmerId || farm.farmerId === farmerId)
        && adminInDateRange(farm.createdAt, range);
    });
    ok(res, adminPage(adminSort(farms, req.query, ['name', 'location', 'areaAcres', 'createdAt'], 'name'), req.query));
  }));

  app.get('/api/admin/farms/:id', auth, requireAdmin, wrap((req, res) => {
    const farm = store.findFarm(req.params.id);
    if (!farm) return fail(res, 404, 'farm_not_found', 'Farm not found');
    ok(res, adminFarmRecord(farm));
  }));

  app.get('/api/admin/devices', auth, requireAdmin, wrap((req, res) => {
    const farmId = adminQueryString(req.query.farmId, 'farmId', 64);
    const status = adminQueryString(req.query.status, 'status', 20);
    if (status && !['online', 'offline', 'unverified', 'revoked'].includes(status)) {
      return fail(res, 400, 'validation_error', 'status is not supported');
    }
    const devices = store.list('sensorDevices').map(adminDeviceRecord)
      .filter((device) => (!farmId || device.farmId === farmId) && (!status || device.status === status))
      .sort((a, b) => a.id.localeCompare(b.id));
    ok(res, adminPage(devices, req.query));
  }));

  app.get('/api/admin/readings', auth, requireAdmin, wrap((req, res) => {
    const farmId = adminQueryString(req.query.farmId, 'farmId', 64);
    const zoneId = adminQueryString(req.query.zoneId, 'zoneId', 64);
    const deviceId = adminQueryString(req.query.deviceId, 'deviceId', 64);
    const sourceFilter = adminQueryString(req.query.source, 'source', 40);
    const range = adminDateRange(req.query);
    const readings = store.list('sensorReadings').map(adminReadingRecord)
      .filter((reading) => (!farmId || reading.farmId === farmId)
        && (!zoneId || reading.zoneId === zoneId)
        && (!deviceId || reading.deviceId === deviceId)
        && (!sourceFilter || reading.source === sourceFilter)
        && adminInDateRange(reading.recordedAt, range))
      .sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
    ok(res, adminPage(readings, req.query));
  }));

  app.get('/api/admin/alerts', auth, requireAdmin, wrap((req, res) => {
    const search = adminQueryString(req.query.search, 'search', 120).toLowerCase();
    const farmId = adminQueryString(req.query.farmId, 'farmId', 64);
    const severity = adminQueryString(req.query.severity, 'severity', 20);
    const status = adminQueryString(req.query.status, 'status', 20);
    const range = adminDateRange(req.query);
    if (severity && !['info', 'warning', 'critical'].includes(severity)) return fail(res, 400, 'validation_error', 'severity is not supported');
    if (status && !['active', 'acknowledged'].includes(status)) return fail(res, 400, 'validation_error', 'status is not supported');
    const alerts = store.list('alerts').map(adminAlertRecord)
      .filter((alert) => (!search || `${alert.title} ${alert.description} ${alert.farmName || ''} ${alert.farmer?.name || ''}`.toLowerCase().includes(search))
        && (!farmId || alert.farmId === farmId)
        && (!severity || alert.severity === severity)
        && (!status || (status === 'acknowledged') === alert.acknowledged)
        && adminInDateRange(alert.createdAt, range))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    ok(res, adminPage(alerts, req.query));
  }));

  app.get('/api/admin/decisions', auth, requireAdmin, wrap((req, res) => {
    const farmId = adminQueryString(req.query.farmId, 'farmId', 64);
    const range = adminDateRange(req.query);
    const decisions = store.list('decisions').map((decision) => {
      const farm = store.findFarm(decision.farmId);
      return {
        id: decision.id, farmId: decision.farmId, farmName: farm?.name || null,
        farmer: adminFarmerSummaryFor(farm?.farmerId), category: decision.category || '',
        status: decision.status || '', crop: decision.crop || '',
        summary: decision.summary || '', question: decision.question || '',
        createdAt: decision.createdAt || null, source: decision.source || 'UNKNOWN'
      };
    }).filter((decision) => (!farmId || decision.farmId === farmId) && adminInDateRange(decision.createdAt, range))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const scenarios = store.list('farms').filter((farm) => !farmId || farm.id === farmId).map((farm) => {
      const input = {
        farm,
        seasons: store.scoped('seasons', farm.id),
        soilTests: store.scoped('soilTests', farm.id),
        zones: store.scoped('zones', farm.id),
        weather: store.scoped('weather', farm.id),
        activeCrops: store.scoped('activeCrops', farm.id),
        sensorReadings: store.scoped('sensorReadings', farm.id),
        activities: store.scoped('activities', farm.id),
        dataMode: store.data.sourceMode || 'UNKNOWN'
      };
      const calculation = calculateDecisionEngine(input);
      return {
        farmId: farm.id,
        farmName: farm.name,
        farmer: adminFarmerSummaryFor(farm.farmerId),
        recommendations: calculation.result.recommendations,
        profit: calculation.result.profit,
        dataQuality: {
          missingInputs: calculation.missingInputs,
          calculationVersion: calculation.calculationVersion,
          generatedAt: calculation.generatedAt
        },
        supportingInputs: {
          zones: input.zones.length,
          soilTests: input.soilTests.length,
          historicalSeasons: input.seasons.length,
          recentActivities: store.scoped('activities', farm.id).length,
          weatherSource: input.weather[0]?.source || 'UNAVAILABLE',
          latestReadingSource: store.scoped('sensorReadings', farm.id).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))[0]?.source || 'UNAVAILABLE'
        }
      };
    });
    ok(res, { ...adminPage(decisions, req.query), scenarios });
  }));

  app.get('/api/admin/weather', auth, requireAdmin, wrap((req, res) => {
    const farmId = adminQueryString(req.query.farmId, 'farmId', 64);
    const range = adminDateRange(req.query);
    const farms = store.list('farms').filter((farm) => !farmId || farm.id === farmId);
    const records = store.list('weather').filter((item) => (!farmId || !item.farmId || item.farmId === farmId)
      && adminInDateRange(item.date || item.updatedAt || item.recordedAt, range)).map((item) => {
      const associatedFarm = item.farmId ? store.findFarm(item.farmId) : null;
      const associatedZone = item.zoneId ? store.list('zones').find((zone) => zone.id === item.zoneId && zone.farmId === item.farmId) : null;
      return {
        ...item,
        farmId: associatedFarm?.id || null,
        farmName: associatedFarm?.name || null,
        farmer: adminFarmerSummaryFor(associatedFarm?.farmerId),
        zoneId: associatedZone?.id || null,
        zoneName: associatedZone?.name || null
      };
    });
    const risks = farms.map((farm) => {
      const weather = store.scoped('weather', farm.id).length ? store.scoped('weather', farm.id) : store.list('weather');
      const readings = store.scoped('sensorReadings', farm.id);
      const zones = store.scoped('zones', farm.id);
      const activeCrops = store.scoped('activeCrops', farm.id);
      const calculation = calculateDecisionEngine({
        farm,
        zones,
        activeCrops,
        sensorReadings: readings,
        weather:store.scoped('weather', farm.id),
        seasons: store.scoped('seasons', farm.id),
        soilTests: store.scoped('soilTests', farm.id),
        activities: store.scoped('activities', farm.id),
        dataMode: store.data.sourceMode || 'UNKNOWN'
      });
      return {
        farmId:farm.id,
        farmName:farm.name,
        farmer:adminFarmerSummaryFor(farm.farmerId),
        zones:zones.map((zone) => ({ id:zone.id, name:zone.name })),
        assessments:calculation.result.risks,
        dataQuality:{
          missingInputs:calculation.missingInputs,
          calculationVersion:calculation.calculationVersion,
          generatedAt:calculation.generatedAt
        }
      };
    });
    const provenance = getWeather(store.list('weather'));
    ok(res, {
      ...adminPage(records.sort((a, b) => String(b.date || b.updatedAt || '').localeCompare(String(a.date || a.updatedAt || ''))), req.query),
      risks,
      integrationMode:provenance.mode,
      note:provenance.note
    });
  }));

  app.get('/api/admin/health', auth, requireAdmin, wrap((_req, res) => {
    const weather = getWeather(store.list('weather'));
    ok(res, {
      service: 'agcro-api',
      api: 'available',
      version: '1.1.0-secure-foundation',
      storageMode: store.storageMode,
      databaseAdapter: store.databaseConfigured ? 'configured-but-not-integrated' : 'not-configured',
      integrations: {
        weather: weather.mode === 'SIMULATED_WEATHER' ? 'simulated' : 'configured-not-verified',
        ai: process.env.NEUGEN_API_URL && process.env.NEUGEN_API_KEY ? 'configured-not-verified' : 'rule-based-fallback',
        sensorIngestion: 'available; device presence requires authenticated LIVE_SENSOR readings',
        administrativeAudit: 'not-recorded-in-current-store'
      },
      generatedAt: new Date().toISOString()
    });
  }));

  app.get('/api/admin/reports/:type.csv', auth, requireAdmin, wrap((req, res) => {
    const type = req.params.type;
    const allowed = ['farmers', 'farms', 'devices', 'readings', 'alerts', 'activities'];
    if (!allowed.includes(type)) return fail(res, 404, 'report_not_found', 'Report type not found');
    const farmId = adminQueryString(req.query.farmId, 'farmId', 64);
    const farmerId = adminQueryString(req.query.farmerId, 'farmerId', 64);
    const range = adminDateRange(req.query);
    let rows;
    let columns;
    if (type === 'farmers') {
      rows = store.list('farmers').map((farmer) => adminFarmerFor(farmer.id)).filter((farmer) => farmer && (!farmerId || farmer.id === farmerId) && adminInDateRange(farmer.createdAt, range));
      columns = [['id', 'Farmer ID'], ['name', 'Name'], ['username', 'Username'], ['phone', 'Phone'], ['location', 'Location'], ['createdAt', 'Registered at']];
    } else if (type === 'farms') {
      rows = store.list('farms').map(adminFarmRecord).filter((farm) => (!farmId || farm.id === farmId) && (!farmerId || farm.farmerId === farmerId) && adminInDateRange(farm.createdAt, range))
        .map((farm) => ({ ...farm, farmerName: farm.farmer?.name || '', zoneCount: farm.zones.length }));
      columns = [['id', 'Farm ID'], ['name', 'Farm'], ['location', 'Location'], ['farmerName', 'Farmer'], ['areaAcres', 'Area acres'], ['soilType', 'Soil type'], ['irrigationMethod', 'Irrigation'], ['zoneCount', 'Zones'], ['source', 'Source']];
    } else if (type === 'devices') {
      rows = store.list('sensorDevices').map(adminDeviceRecord).filter((device) => (!farmId || device.farmId === farmId) && (!farmerId || device.farmer?.id === farmerId) && adminInDateRange(device.lastAuthenticatedAt, range))
        .map((device) => ({ ...device, farmerName: device.farmer?.name || '', lastAuthenticatedAt: device.lastAuthenticatedAt || '' }));
      columns = [['id', 'Device ID'], ['name', 'Name'], ['farmerName', 'Farmer'], ['farmName', 'Farm'], ['zoneName', 'Zone'], ['status', 'Presence status'], ['lastAuthenticatedAt', 'Last authenticated reading'], ['revokedAt', 'Revoked at'], ['credentialStatus', 'Credential status']];
    } else if (type === 'readings') {
      rows = store.list('sensorReadings').map(adminReadingRecord).filter((reading) => (!farmId || reading.farmId === farmId) && (!farmerId || reading.farmer?.id === farmerId) && adminInDateRange(reading.recordedAt, range));
      columns = [['id', 'Reading ID'], ['deviceId', 'Device ID'], ['farmName', 'Farm'], ['zoneName', 'Zone'], ['soilMoisturePct', 'Soil moisture %'], ['temperatureC', 'Temperature C'], ['humidityPct', 'Humidity %'], ['recordedAt', 'Recorded at'], ['source', 'Source'], ['validity', 'Validity']];
    } else if (type === 'alerts') {
      rows = store.list('alerts').map(adminAlertRecord).filter((alert) => (!farmId || alert.farmId === farmId) && (!farmerId || alert.farmer?.id === farmerId) && adminInDateRange(alert.createdAt, range))
        .map((alert) => ({ ...alert, farmerName: alert.farmer?.name || '', acknowledged: alert.acknowledged ? 'yes' : 'no' }));
      columns = [['id', 'Alert ID'], ['title', 'Title'], ['description', 'Description'], ['severity', 'Severity'], ['farmerName', 'Farmer'], ['farmName', 'Farm'], ['zoneName', 'Zone'], ['createdAt', 'Created at'], ['acknowledged', 'Acknowledged'], ['source', 'Source']];
    } else {
      rows = store.list('activities').filter((activity) => (!farmId || activity.farmId === farmId) && adminInDateRange(activity.date, range)).map((activity) => {
        const farm = store.findFarm(activity.farmId);
        const zone = store.list('zones').find((item) => item.id === activity.zoneId && item.farmId === activity.farmId);
        return { id: activity.id, farmId: activity.farmId, farmName: farm?.name || '', farmerId: farm?.farmerId || '', farmerName: adminFarmerFor(farm?.farmerId)?.name || '', zoneName: zone?.name || '', date: activity.date, type: activity.type, quantity: activity.quantity, unit: activity.unit || '', notes: activity.notes || '', source: activity.source || 'UNKNOWN' };
      }).filter((activity) => !farmerId || activity.farmerId === farmerId);
      columns = [['id', 'Activity ID'], ['farmerName', 'Farmer'], ['farmName', 'Farm'], ['zoneName', 'Zone'], ['date', 'Date'], ['type', 'Activity'], ['quantity', 'Quantity'], ['unit', 'Unit'], ['notes', 'Notes'], ['source', 'Source']];
    }
    adminCsv(res, `agcro-${type}-report.csv`, columns, rows);
  }));

  app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

  app.use('/api', (_req, res) => fail(res, 404, 'not_found', 'API route not found'));

  // Centralized Express error handler (Never expose internal stack traces)
  app.use((error, _req, res, _next) => {
    console.error('Unhandled express error:', error);
    const status = error.status || 500;
    const code = error.code || (status === 500 ? 'internal_error' : 'request_error');
    const message = status === 500 ? 'Unexpected server error' : (error.message || 'Request failed');
    fail(res, status, code, message);
  });

  return { app, store };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const { app } = createApp();
  app.listen(port, '0.0.0.0', () => console.log(`AGCRO listening on ${port}`));
}
