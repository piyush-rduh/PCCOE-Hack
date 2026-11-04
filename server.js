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
  buildAlerts,
  categorizedRecommendations,
  climateRisks,
  irrigationAdvice,
  landPower,
  profitAnalysis,
  waterBudget
} from './src/decision-engine.js';
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
    const weather = store.scoped('weather', farmId).length ? store.scoped('weather', farmId) : store.list('weather');
    const sensorReadings = store.scoped('sensorReadings', farmId).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)));
    const sensorDevices = store.scoped('sensorDevices', farmId);
    const land = landPower({ farm, seasons, soilTests, zones, activities });
    const recommendations = categorizedRecommendations({ farm, seasons, soilTests, zones, weather });
    const water = waterBudget({ farm, zones, activeCrops, sensorReadings, weather });
    const irrigation = irrigationAdvice({
      farm,
      activeCrops,
      soilTests: [
        ...soilTests,
        ...sensorReadings.map((reading) => ({
          parameter: 'Moisture',
          value: reading.soilMoisturePct,
          date: reading.recordedAt,
          source: reading.source
        }))
      ],
      activities,
      weather
    });
    const risks = climateRisks({ farm, zones, sensorReadings, weather, water });
    const profit = profitAnalysis({ seasons, recommendation: recommendations[2] });
    buildAlerts({ farm, water, risks, irrigation, activeCrops, sensorDevices, sensorReadings }).forEach((alert) => store.addAlert(alert));
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
  app.get('/api/admin/overview', auth, requireAdmin, wrap((_req, res) => {
    const farms = store.list('farms');
    const readings = store.list('sensorReadings');
    const devices = store.list('sensorDevices');
    const alerts = store.list('alerts');
    const decisions = store.list('decisions');
    const activeAlerts = alerts.filter((alert) => !alert.acknowledged);
    const highRiskFarms = new Set(activeAlerts.filter((alert) => alert.severity === 'critical').map((alert) => alert.farmId));

    ok(res, {
      role: 'ADMIN',
      metrics: {
        farmers: store.list('farmers').length,
        farms: farms.length,
        zones: store.list('zones').length,
        devices: devices.length,
        onlineDevices: devices.filter((device) => device.status === 'online').length,
        offlineDevices: devices.filter((device) => device.status === 'offline').length,
        revokedDevices: devices.filter((device) => device.status === 'revoked').length,
        activeAlerts: activeAlerts.length,
        highRiskFarms: highRiskFarms.size,
        decisions: decisions.length
      },
      farms: farms.map((farm) => ({
        ...farm,
        farmer: store.getFarmer(farm.farmerId),
        zoneCount: store.scoped('zones', farm.id).length,
        latestReading: store.scoped('sensorReadings', farm.id).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))[0] || null
      })),
      devices,
      alerts: alerts.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 12),
      decisions: decisions.slice(-12).reverse(),
      dataMode: store.data.sourceMode
    });
  }));

  app.post('/api/admin/devices/:id/revoke', auth, requireAdmin, wrap((req, res) => {
    const device = store.getDeviceById(req.params.id);
    if (!device) return fail(res, 404, 'device_not_found', 'Sensor device not found');
    const updated = store.revokeDevice(req.params.id);
    ok(res, updated);
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
