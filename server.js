import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './src/store.js';
import { buildAlerts, categorizedRecommendations, climateRisks, irrigationAdvice, landPower, profitAnalysis, waterBudget } from './src/decision-engine.js';
import { dataBadge, getWeather, neuGenExplain } from './src/integrations.js';
import { enumValue, farmPayload, nonNegative, requireString, sensorPayload, zonePayload } from './src/validators.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const store = createStore();
const port = Number(process.env.PORT || 3000);
const hits = new Map();

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const key = req.ip || 'local';
  const bucket = hits.get(key) || { started: Date.now(), count: 0 };
  if (Date.now() - bucket.started > 60_000) { bucket.started = Date.now(); bucket.count = 0; }
  bucket.count += 1; hits.set(key, bucket);
  if (bucket.count > 240) return res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Try again shortly.' });
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

const ok = (res, data) => res.json({ data, generatedAt: new Date().toISOString() });
const fail = (res, status, code, message) => res.status(status).json({ error: code, message });
const wrap = (handler) => async (req, res) => { try { await handler(req, res); } catch (error) { console.error(error); fail(res, error.status || 400, error.code || 'validation_error', error.message || 'Request failed'); } };
const getFarmOr404 = (id) => { const farm = store.getFarm(id); if (!farm || farm.id !== id) { const error = new Error('Farm not found'); error.status = 404; error.code = 'not_found'; throw error; } return farm; };
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
  const irrigation = irrigationAdvice({ farm, activeCrops, soilTests: [...soilTests, ...sensorReadings.map((reading) => ({ parameter: 'Moisture', value: reading.soilMoisturePct, date: reading.recordedAt, source: reading.source }))], activities, weather });
  const risks = climateRisks({ farm, zones, sensorReadings, weather, water });
  const profit = profitAnalysis({ seasons, recommendation: recommendations[2] });
  buildAlerts({ farm, water, risks, irrigation, activeCrops, sensorDevices, sensorReadings }).forEach((alert) => store.addAlert(alert));
  return { farm, farmer: store.getFarmer(farm.farmerId), zones, activeCrops, latestReading: sensorReadings[0] || null, sensorDevices, soilTests, seasons, activities, weather, landPower: land, recommendations, waterBudget: water, irrigation, risks, profit, alerts: store.scoped('alerts', farmId).filter((alert) => !alert.acknowledged).slice(-8).reverse() };
};
const requireAdmin = (req, res, next) => {
  if (req.header('x-agcro-role') !== 'admin') return fail(res, 403, 'admin_role_required', 'Admin role is required for this endpoint. Configure real Manus OAuth roles before production use.');
  next();
};

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'agcro-api', storageMode: store.storageMode, databaseConfigured: store.databaseConfigured, databaseMode: store.databaseConfigured ? 'managed-database-adapter-pending' : 'not-configured', timestamp: new Date().toISOString() }));
app.get('/api/meta', (_req, res) => ok(res, { name: 'AGCRO', version: '1.0.0-mvp', dataMode: store.data.sourceMode || 'DEMO_DATA', capabilities: ['dashboard', 'farm-memory', 'land-power', 'crop-recommendations', 'water-budget', 'irrigation', 'climate-risks', 'profit-intelligence', 'iot-ready', 'admin-view', 'ai-explanation-fallback'], integrations: { weather: getWeather([]).mode, ai: process.env.NEUGEN_API_URL ? 'configured-pending-verification' : 'fallback-only' } }));
app.get('/api/dashboard', wrap((req, res) => ok(res, farmBundle(req.query.farmId || store.list('farms')[0].id))));
app.get('/api/farms', (_req, res) => ok(res, store.list('farms').map((farm) => ({ ...farm, farmer: store.getFarmer(farm.farmerId), sourceBadge: dataBadge(farm.source) }))));
app.get('/api/farms/:id', wrap((req, res) => ok(res, farmBundle(req.params.id))));
app.post('/api/farms', wrap((req, res) => { const farmer = store.list('farmers')[0]; const farm = { id: store.makeId('farm'), farmerId: farmer.id, ...farmPayload(req.body), createdAt: store.now() }; store.add('farms', farm); ok(res, farm); }));
app.get('/api/farms/:id/zones', wrap((req, res) => { getFarmOr404(req.params.id); ok(res, store.scoped('zones', req.params.id)); }));
app.post('/api/zones', wrap((req, res) => { const farm = getFarmOr404(req.body.farmId); const zone = { id: store.makeId('zone'), farmId: farm.id, ...zonePayload(req.body), createdAt: store.now() }; store.add('zones', zone); ok(res, zone); }));
app.put('/api/zones/:id', wrap((req, res) => { const zone = store.list('zones').find((item) => item.id === req.params.id); if (!zone) return fail(res, 404, 'not_found', 'Zone not found'); if (req.body.farmId && req.body.farmId !== zone.farmId) return fail(res, 422, 'farm_mismatch', 'A zone cannot be moved across farms through this endpoint.'); ok(res, store.update('zones', req.params.id, zonePayload({ ...zone, ...req.body }))); }));
app.post('/api/sensor-readings', wrap((req, res) => { const reading = sensorPayload(req.body); getFarmOr404(reading.farmId); const device = store.list('sensorDevices').find((item) => item.id === reading.deviceId); if (!device) return fail(res, 404, 'device_not_found', 'Register and map the device before sending readings.'); if (device.farmId !== reading.farmId || device.zoneId !== reading.zoneId) return fail(res, 422, 'device_zone_mismatch', 'Device is not mapped to the supplied farm zone.'); const saved = store.add('sensorReadings', { id: store.makeId('reading'), ...reading }); store.update('sensorDevices', device.id, { status: 'online', lastReadingAt: reading.recordedAt }); ok(res, saved); }));
app.get('/api/farms/:id/readings/latest', wrap((req, res) => { getFarmOr404(req.params.id); const latest = store.scoped('sensorReadings', req.params.id).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt))); ok(res, latest.slice(0, 20).map((reading) => ({ ...reading, stale: Date.now() - new Date(reading.recordedAt).getTime() > 60 * 60 * 1000, sourceBadge: dataBadge(reading.source) }))); }));
app.get('/api/recommendations', wrap((req, res) => ok(res, farmBundle(req.query.farmId || store.list('farms')[0].id).recommendations)));
app.post('/api/recommendations/:crop/decision', wrap((req, res) => { const farmId = req.body.farmId || store.list('farms')[0].id; getFarmOr404(farmId); const status = enumValue(req.body.status, 'status', ['accepted', 'rejected', 'deferred']); const decision = store.recordDecision({ farmId, category: 'crop-recommendation', crop: req.params.crop, status, source: 'FARMER_CONFIRMED', note: req.body.note || '' }); ok(res, decision); }));
app.get('/api/water-budget', wrap((req, res) => ok(res, farmBundle(req.query.farmId || store.list('farms')[0].id).waterBudget)));
app.get('/api/irrigation-advice', wrap((req, res) => ok(res, farmBundle(req.query.farmId || store.list('farms')[0].id).irrigation)));
app.get('/api/climate-risks', wrap((req, res) => ok(res, farmBundle(req.query.farmId || store.list('farms')[0].id).risks)));
app.get('/api/weather', wrap((req, res) => { const bundle = farmBundle(req.query.farmId || store.list('farms')[0].id); ok(res, { forecast: bundle.weather, ...getWeather(bundle.weather) }); }));
app.get('/api/profit-analysis', wrap((req, res) => ok(res, farmBundle(req.query.farmId || store.list('farms')[0].id).profit)));
app.post('/api/activities', wrap((req, res) => { const farm = getFarmOr404(req.body.farmId); const activity = { id: store.makeId('activity'), farmId: farm.id, zoneId: req.body.zoneId || null, type: requireString(req.body.type, 'type'), date: requireString(req.body.date, 'date'), quantity: nonNegative(req.body.quantity || 0, 'quantity'), unit: requireString(req.body.unit, 'unit'), notes: String(req.body.notes || ''), source: 'FARMER_ENTERED' }; store.add('activities', activity); ok(res, activity); }));
app.post('/api/soil-tests', wrap((req, res) => { const farm = getFarmOr404(req.body.farmId); const test = { id: store.makeId('soil'), farmId: farm.id, zoneId: req.body.zoneId || null, parameter: requireString(req.body.parameter, 'parameter'), value: nonNegative(req.body.value, 'value'), unit: String(req.body.unit || ''), date: requireString(req.body.date, 'date'), source: 'FARMER_ENTERED' }; store.add('soilTests', test); ok(res, test); }));
app.post('/api/harvests', wrap((req, res) => { const farm = getFarmOr404(req.body.farmId); const harvest = { id: store.makeId('season'), farmId: farm.id, crop: requireString(req.body.crop, 'crop'), variety: String(req.body.variety || ''), season: String(req.body.season || 'Rabi'), year: Number(req.body.year || new Date().getFullYear()), areaAcres: nonNegative(req.body.areaAcres, 'areaAcres'), yieldQuintal: nonNegative(req.body.yieldQuintal, 'yieldQuintal'), sellingPricePerQuintal: nonNegative(req.body.sellingPricePerQuintal, 'sellingPricePerQuintal'), expenses: req.body.expenses || {}, source: 'FARMER_ENTERED' }; store.add('seasons', harvest); ok(res, harvest); }));
app.get('/api/alerts', wrap((req, res) => ok(res, store.scoped('alerts', req.query.farmId).filter((alert) => req.query.includeAcknowledged === 'true' || !alert.acknowledged).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))))));
app.post('/api/alerts/:id/acknowledge', wrap((req, res) => { const alert = store.acknowledge(req.params.id); if (!alert) return fail(res, 404, 'not_found', 'Alert not found'); ok(res, alert); }));
app.post('/api/ai/explain', wrap((req, res) => { const bundle = farmBundle(req.body.farmId || store.list('farms')[0].id); const explanation = neuGenExplain({ question: req.body.question, context: { landPower: bundle.landPower, recommendation: bundle.recommendations[0], waterBudget: bundle.waterBudget, risks: bundle.risks, profit: bundle.profit } }); const decision = store.recordDecision({ farmId: bundle.farm.id, category: 'ai-explanation', status: 'generated', source: explanation.mode, question: req.body.question || '', summary: explanation.answer }); ok(res, { ...explanation, evidence: ['landPower', 'recommendation', 'waterBudget', 'risks', 'profit'].filter((key) => req.body.include?.includes?.(key) || !req.body.include), decisionId: decision.id }); }));
app.post('/api/ai/chat', wrap((req, res) => { if (!req.body.message) return fail(res, 422, 'message_required', 'message is required'); const bundle = farmBundle(req.body.farmId || store.list('farms')[0].id); ok(res, neuGenExplain({ question: req.body.message, context: bundle })); }));
app.get('/api/decisions', wrap((req, res) => ok(res, store.scoped('decisions', req.query.farmId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))))));
app.get('/api/market', (_req, res) => ok(res, { source: 'DEMO_MARKET_DATA', note: 'No verified live mandi feed is connected; do not treat prices as live.', listings: store.list('marketListings') }));
app.get('/api/schemes', (_req, res) => ok(res, { note: 'Official links are provided for verification; eligibility is not confirmed and no application is submitted.', schemes: store.list('schemes') }));
app.get('/api/admin/overview', requireAdmin, wrap((_req, res) => { const farms = store.list('farms'); const readings = store.list('sensorReadings'); const devices = store.list('sensorDevices'); const alerts = store.list('alerts'); const decisions = store.list('decisions'); ok(res, { role: 'admin-demo', metrics: { farmers: store.list('farmers').length, farms: farms.length, zones: store.list('zones').length, devices: devices.length, onlineDevices: devices.filter((device) => device.status === 'online').length, activeAlerts: alerts.filter((alert) => !alert.acknowledged).length, decisions: decisions.length }, farms: farms.map((farm) => ({ ...farm, farmer: store.getFarmer(farm.farmerId), zoneCount: store.scoped('zones', farm.id).length, latestReading: store.scoped('sensorReadings', farm.id).sort((a, b) => String(b.recordedAt).localeCompare(String(a.recordedAt)))[0] || null })), devices, alerts: alerts.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 12), decisions: decisions.slice(-12).reverse(), dataMode: store.data.sourceMode }); }));
app.get('/api/export', wrap((req, res) => { const farmId = req.query.farmId || store.list('farms')[0].id; const bundle = farmBundle(farmId); res.setHeader('Content-Disposition', `attachment; filename="agcro-${farmId}-report.json"`); res.json(bundle); }));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use('/api', (_req, res) => fail(res, 404, 'not_found', 'API route not found'));
app.use((error, _req, res, _next) => { console.error(error); fail(res, 500, 'internal_error', 'Unexpected server error'); });

app.listen(port, '0.0.0.0', () => console.log(`AGCRO listening on ${port}`));
