import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PassThrough } from 'node:stream';
import { createApp } from '../server.js';
import { createStore } from '../src/store.js';

function createTestClient() {
  const store = createStore();
  store.reset();
  const { app } = createApp(store);
  const request = (method, url, { headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
    const socket = new PassThrough();
    socket.remoteAddress = '127.0.0.1';
    socket.encrypted = false;
    socket.destroy = () => {};
    const req = new http.IncomingMessage(socket);
    req.method = method;
    req.url = url;
    req.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    const requestBody = body == null ? null : typeof body === 'string' ? body : JSON.stringify(body);
    if (requestBody != null) {
      req.headers['content-type'] ||= 'application/json';
      req.headers['content-length'] = String(Buffer.byteLength(requestBody));
    }
    const res = new http.ServerResponse(req);
    res.assignSocket(socket);
    const chunks = [];
    const write = res.write;
    const end = res.end;
    res.write = function (chunk, ...args) {
      if (chunk) chunks.push(Buffer.from(chunk));
      return write.apply(this, [chunk, ...args]);
    };
    res.end = function (chunk, ...args) {
      if (chunk) chunks.push(Buffer.from(chunk));
      const content = Buffer.concat(chunks).toString('utf8');
      end.apply(this, [chunk, ...args]);
      resolve({
        status:res.statusCode,
        headers:res.getHeaders(),
        text:() => Promise.resolve(content),
        json:() => Promise.resolve(JSON.parse(content))
      });
    };
    app.handle(req, res, (error) => { if (error) reject(error); });
    if (requestBody != null) req.push(requestBody);
    req.push(null);
  });
  return {
    store,
    get:(url, options) => request('GET', url, options),
    post:(url, options) => request('POST', url, options)
  };
}

async function login(client, username, password) {
  const response = await client.post('/api/auth/login', { body:{ username, password } });
  assert.equal(response.status, 200);
  return (await response.json()).data.token;
}

const auth = (token, extras = {}) => ({ Authorization:`Bearer ${token}`, ...extras });

test('admin dashboard APIs require verified administrator identity and omit credentials', async () => {
  const client = createTestClient();
  const farmerToken = await login(client, 'ramesh', 'farmer123');
  const adminToken = await login(client, 'admin', 'admin123');
  const endpoints = [
    '/api/admin/overview', '/api/admin/farmers', '/api/admin/farmers/farmer-1',
    '/api/admin/farms', '/api/admin/farms/farm-1', '/api/admin/devices', '/api/admin/readings',
    '/api/admin/alerts', '/api/admin/decisions', '/api/admin/weather', '/api/admin/health'
  ];

  for (const endpoint of endpoints) {
    const noToken = await client.get(endpoint, { headers:{ 'x-agcro-role':'ADMIN' } });
    assert.equal(noToken.status, 401, `${endpoint} requires authentication`);
    const farmer = await client.get(endpoint, { headers:auth(farmerToken, { 'x-agcro-role':'ADMIN' }) });
    assert.equal(farmer.status, 403, `${endpoint} must reject farmer identity`);
    const admin = await client.get(endpoint, { headers:auth(adminToken) });
    assert.equal(admin.status, 200, `${endpoint} should allow admins`);
    const body = await admin.text();
    assert.doesNotMatch(body, /passwordHash|tokenHash|deviceToken|bearerToken/i);
  }

  const overview = (await (await client.get('/api/admin/overview', { headers:auth(adminToken) })).json()).data;
  assert.equal(overview.metrics.onlineDevices, 0, 'seeded sensor status must not imply a verified online device');
  assert.equal(overview.metrics.unverifiedDevices, 1);
  assert.equal(overview.devices[0].status, 'unverified');
  assert.equal(overview.devices[0].credentialStatus, 'provisioned');

  client.store.add('sensorReadings', {
    id:'reading-authenticated', deviceId:'esp32-plot-a', farmId:'farm-1', zoneId:'zone-1',
    soilMoisturePct:31, temperatureC:27, humidityPct:60, recordedAt:new Date().toISOString(), source:'LIVE_SENSOR'
  });
  const online = (await (await client.get('/api/admin/devices?status=online', { headers:auth(adminToken) })).json()).data;
  assert.equal(online.total, 1, 'a recent authenticated device reading establishes online status');
  client.store.update('sensorReadings', 'reading-authenticated', { recordedAt:new Date(Date.now() - 20 * 60 * 1000).toISOString() });
  const stale = (await (await client.get('/api/admin/devices?status=offline', { headers:auth(adminToken) })).json()).data;
  assert.equal(stale.total, 1, 'a stale authenticated reading is offline');
});

test('admin farmer, farm, sensor filters and empty/error responses are bounded', async () => {
  const client = createTestClient();
  const adminToken = await login(client, 'admin', 'admin123');
  const headers = auth(adminToken);

  const farmers = (await (await client.get('/api/admin/farmers?search=ramesh&page=1&pageSize=1&sortBy=name&sortOrder=desc', { headers })).json()).data;
  assert.equal(farmers.total, 1);
  assert.equal(farmers.items[0].username, 'ramesh');
  assert.equal(farmers.pageSize, 1);

  const farms = (await (await client.get('/api/admin/farms?farmerId=farmer-1&search=North', { headers })).json()).data;
  assert.equal(farms.total, 1);
  assert.equal(farms.items[0].zoneCount, 2);
  const farmDetails = (await (await client.get('/api/admin/farms/farm-1', { headers })).json()).data;
  assert.equal(farmDetails.zones[0].name, 'Plot A');
  assert.ok(farmDetails.soilTests.length > 0);
  assert.ok(farmDetails.seasons.length > 0);

  const readings = (await (await client.get('/api/admin/readings?source=SIMULATED_SENSOR&farmId=farm-1&dateFrom=2026-11-03&dateTo=2026-11-03', { headers })).json()).data;
  assert.equal(readings.total, 1);
  assert.equal(readings.items[0].validity, 'valid');
  assert.equal(readings.items[0].source, 'SIMULATED_SENSOR');
  assert.equal(readings.items[0].farmer.phone, undefined);

  const weather = (await (await client.get('/api/admin/weather?farmId=farm-1', { headers })).json()).data;
  assert.equal(weather.items[0].farmId, null, 'global fallback weather must not be presented as farm-specific');
  assert.equal(weather.risks.length, 1);
  assert.equal(weather.risks[0].farmId, 'farm-1');
  assert.equal(weather.risks[0].assessments.length, 2);

  const noMatches = (await (await client.get('/api/admin/readings?source=LIVE_SENSOR', { headers })).json()).data;
  assert.deepEqual(noMatches.items, []);
  const invalidDate = await client.get('/api/admin/readings?dateFrom=2026-02-31', { headers });
  assert.equal(invalidDate.status, 400);
  const invalidSort = await client.get('/api/admin/farmers?sortBy=passwordHash', { headers });
  assert.equal(invalidSort.status, 400);
  const invalidPageSize = await client.get('/api/admin/farms?pageSize=1000', { headers });
  assert.equal(invalidPageSize.status, 400);

  client.store.remove('sensorReadings', 'reading-1');
  const empty = (await (await client.get('/api/admin/readings', { headers })).json()).data;
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.items, []);
});

test('admin can acknowledge alerts, revoke devices and export formula-safe reports only', async () => {
  const client = createTestClient();
  const adminToken = await login(client, 'admin', 'admin123');
  const farmerToken = await login(client, 'ramesh', 'farmer123');

  const deniedAck = await client.post('/api/alerts/alert-1/acknowledge', { headers:auth(farmerToken) });
  assert.equal(deniedAck.status, 200, 'the existing farmer-scoped acknowledgement endpoint remains available to the owning farmer');
  const ack = await client.post('/api/alerts/alert-1/acknowledge', { headers:auth(adminToken) });
  assert.equal(ack.status, 200);
  assert.equal((await ack.json()).data.acknowledged, true);

  const deniedRevoke = await client.post('/api/admin/devices/esp32-plot-a/revoke', { headers:auth(farmerToken) });
  assert.equal(deniedRevoke.status, 403);
  const revoke = await client.post('/api/admin/devices/esp32-plot-a/revoke', { headers:auth(adminToken) });
  assert.equal(revoke.status, 200);
  const revokedDevice = (await revoke.json()).data;
  assert.equal(revokedDevice.status, 'revoked');
  assert.ok(revokedDevice.revokedAt);
  assert.equal((await client.get('/api/admin/devices?status=revoked', { headers:auth(adminToken) }).then((response) => response.json())).data.total, 1);

  const noAuthExport = await client.get('/api/admin/reports/farmers.csv');
  assert.equal(noAuthExport.status, 401);
  const farmerExport = await client.get('/api/admin/reports/farmers.csv', { headers:auth(farmerToken) });
  assert.equal(farmerExport.status, 403);

  client.store.findFarmer('farmer-1').name = '=HYPERLINK("https://example.invalid","click")';
  const report = await client.get('/api/admin/reports/farmers.csv', { headers:auth(adminToken) });
  assert.equal(report.status, 200);
  assert.match(report.headers['content-type'], /text\/csv/);
  const csv = await report.text();
  assert.match(csv, /'=HYPERLINK/);
  assert.doesNotMatch(csv, /passwordHash|tokenHash|deviceToken|bearerToken/i);

  const health = (await (await client.get('/api/admin/health', { headers:auth(adminToken) })).json()).data;
  assert.equal(health.databaseAdapter, 'not-configured');
  assert.doesNotMatch(JSON.stringify(health), /JWT_SECRET|NEUGEN_API_KEY|DATABASE_URL/i);
});
