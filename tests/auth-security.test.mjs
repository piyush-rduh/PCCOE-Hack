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

  const request = (method, url, { headers = {}, body = null } = {}) => {
    return new Promise((resolve, reject) => {
      const socket = new PassThrough();
      socket.remoteAddress = '127.0.0.1';
      socket.encrypted = false;
      socket.destroy = () => {};

      const req = new http.IncomingMessage(socket);
      req.method = method;
      req.url = url;
      req.headers = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])
      );

      let payloadStr = null;
      if (body != null) {
        payloadStr = typeof body === 'string' ? body : JSON.stringify(body);
        req.headers['content-length'] = String(Buffer.byteLength(payloadStr));
        if (!req.headers['content-type']) {
          req.headers['content-type'] = 'application/json';
        }
      }

      const res = new http.ServerResponse(req);
      res.assignSocket(socket);

      const chunks = [];
      const origWrite = res.write;
      const origEnd = res.end;

      res.write = function (chunk, ...args) {
        if (chunk) chunks.push(Buffer.from(chunk));
        return origWrite.apply(this, [chunk, ...args]);
      };

      res.end = function (chunk, ...args) {
        if (chunk) chunks.push(Buffer.from(chunk));
        const bodyStr = Buffer.concat(chunks).toString('utf8');
        origEnd.apply(this, [chunk, ...args]);
        resolve({
          status: res.statusCode,
          headers: res.getHeaders(),
          text: () => Promise.resolve(bodyStr),
          json: () => Promise.resolve(bodyStr ? JSON.parse(bodyStr) : {})
        });
      };

      app.handle(req, res, (err) => {
        if (err) reject(err);
      });

      if (payloadStr != null) {
        req.push(payloadStr);
      }
      req.push(null);
    });
  };

  return {
    store,
    get: (url, opts) => request('GET', url, opts),
    post: (url, opts) => request('POST', url, opts),
    put: (url, opts) => request('PUT', url, opts),
    delete: (url, opts) => request('DELETE', url, opts)
  };
}

test('1. Farmer registration and login', async () => {
  const client = createTestClient();

  // Register new farmer
  const regRes = await client.post('/api/auth/register', {
    body: {
      username: 'suresh_farmer',
      password: 'Password@123',
      name: 'Suresh More',
      phone: '9822000000',
      location: 'Baramati, Pune'
    }
  });
  assert.equal(regRes.status, 201);
  const regData = await regRes.json();
  assert.ok(regData.data.token, 'Token must be returned');
  assert.equal(regData.data.user.username, 'suresh_farmer');
  assert.equal(regData.data.user.role, 'FARMER');
  assert.equal(regData.data.user.passwordHash, undefined, 'Password hash must never be returned');

  // Login with newly registered farmer
  const loginRes = await client.post('/api/auth/login', {
    body: {
      username: 'suresh_farmer',
      password: 'Password@123'
    }
  });
  assert.equal(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.ok(loginData.data.token);
  assert.equal(loginData.data.user.name, 'Suresh More');

  // Pre-seeded demo farmer login
  const demoLoginRes = await client.post('/api/auth/login', {
    body: {
      username: 'ramesh',
      password: 'farmer123'
    }
  });
  assert.equal(demoLoginRes.status, 200);
  const demoData = await demoLoginRes.json();
  assert.equal(demoData.data.user.role, 'FARMER');
  assert.equal(demoData.data.user.farmerId, 'farmer-1');

  // Verify /api/auth/me
  const meRes = await client.get('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${demoData.data.token}` }
  });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.data.user.username, 'ramesh');
});

test('2. Invalid credentials and registration validation', async () => {
  const client = createTestClient();

  // Duplicate username
  const dupRes = await client.post('/api/auth/register', {
    body: {
      username: 'ramesh', // already exists in demo seed
      password: 'Password@123',
      name: 'Duplicate Ramesh'
    }
  });
  assert.equal(dupRes.status, 409);
  const dupData = await dupRes.json();
  assert.equal(dupData.error, 'user_exists');

  // Short password (< 8 chars)
  const shortPassRes = await client.post('/api/auth/register', {
    body: {
      username: 'valid_user',
      password: '123',
      name: 'Valid User'
    }
  });
  assert.equal(shortPassRes.status, 400);

  // Wrong password login
  const wrongPassRes = await client.post('/api/auth/login', {
    body: {
      username: 'ramesh',
      password: 'wrong_password_999'
    }
  });
  assert.equal(wrongPassRes.status, 401);
  const wrongPassData = await wrongPassRes.json();
  assert.equal(wrongPassData.error, 'invalid_credentials');

  // Non-existent user login
  const nonExistentRes = await client.post('/api/auth/login', {
    body: {
      username: 'ghost_user',
      password: 'password123'
    }
  });
  assert.equal(nonExistentRes.status, 401);
});

test('3. Missing authentication and logout revocation', async () => {
  const client = createTestClient();

  // Missing Authorization header
  const noAuthRes = await client.get('/api/farms');
  assert.equal(noAuthRes.status, 401);
  const noAuthData = await noAuthRes.json();
  assert.equal(noAuthData.error, 'unauthorized');

  // Invalid bearer token
  const invalidTokenRes = await client.get('/api/farms', {
    headers: { 'Authorization': 'Bearer totally-invalid-token-xyz' }
  });
  assert.equal(invalidTokenRes.status, 401);
  const invalidTokenData = await invalidTokenRes.json();
  assert.equal(invalidTokenData.error, 'invalid_token');

  // Login to get valid token
  const loginRes = await client.post('/api/auth/login', {
    body: { username: 'ramesh', password: 'farmer123' }
  });
  const { token } = (await loginRes.json()).data;

  // Use token successfully
  const validRes = await client.get('/api/farms', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert.equal(validRes.status, 200);

  // Logout
  const logoutRes = await client.post('/api/auth/logout', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert.equal(logoutRes.status, 200);

  // Reuse token after logout -> must be rejected
  const reuseRes = await client.get('/api/farms', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  assert.equal(reuseRes.status, 401);
  const reuseData = await reuseRes.json();
  assert.equal(reuseData.error, 'token_revoked');
});

test('4. Role-based authorization & elimination of x-agcro-role trust', async () => {
  const client = createTestClient();

  // Attempt admin access with caller-supplied header but NO token
  const spoofNoTokenRes = await client.get('/api/admin/overview', {
    headers: { 'x-agcro-role': 'admin' }
  });
  assert.equal(spoofNoTokenRes.status, 401, 'Spoofed header without valid token must be 401');

  // Login as a normal farmer
  const farmerLoginRes = await client.post('/api/auth/login', {
    body: { username: 'ramesh', password: 'farmer123' }
  });
  const farmerToken = (await farmerLoginRes.json()).data.token;

  // Attempt admin access with farmer token AND spoofed header
  const spoofWithFarmerTokenRes = await client.get('/api/admin/overview', {
    headers: {
      'Authorization': `Bearer ${farmerToken}`,
      'x-agcro-role': 'admin'
    }
  });
  assert.equal(spoofWithFarmerTokenRes.status, 403, 'Farmer token must be forbidden even with x-agcro-role: admin header');
  const spoofData = await spoofWithFarmerTokenRes.json();
  assert.equal(spoofData.error, 'forbidden');

  // Login as real Administrator
  const adminLoginRes = await client.post('/api/auth/login', {
    body: { username: 'admin', password: 'admin123' }
  });
  assert.equal(adminLoginRes.status, 200);
  const adminData = await adminLoginRes.json();
  assert.equal(adminData.data.user.role, 'ADMIN');
  const adminToken = adminData.data.token;

  // Real Admin accesses admin overview
  const adminOverviewRes = await client.get('/api/admin/overview', {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(adminOverviewRes.status, 200);
  const overviewData = await adminOverviewRes.json();
  assert.equal(overviewData.data.role, 'ADMIN');
  assert.ok(overviewData.data.metrics.farms >= 1);
});

test('5. Farm ownership checks (cross-farmer access forbidden)', async () => {
  const client = createTestClient();

  // Register Farmer B
  const farmerBReg = await client.post('/api/auth/register', {
    body: {
      username: 'farmer_b',
      password: 'Password@123',
      name: 'Farmer B',
      location: 'Satara'
    }
  });
  const farmerBToken = (await farmerBReg.json()).data.token;

  // Farmer B creates their own farm
  const createFarmRes = await client.post('/api/farms', {
    headers: {
      'Authorization': `Bearer ${farmerBToken}`
    },
    body: {
      name: 'Farmer B Southern Estate',
      areaAcres: 10,
      soilType: 'Red soil',
      waterSource: 'Well',
      irrigationMethod: 'Sprinkler',
      availableWaterLitres: 25000,
      location: 'Satara'
    }
  });
  assert.equal(createFarmRes.status, 201);
  const farmB = (await createFarmRes.json()).data;

  // Farmer B tries to access Farmer A's farm (farm-1)
  const crossFarmRes = await client.get('/api/farms/farm-1', {
    headers: { 'Authorization': `Bearer ${farmerBToken}` }
  });
  assert.equal(crossFarmRes.status, 403, 'Farmer B accessing farm-1 must return 403 Forbidden');
  const crossFarmData = await crossFarmRes.json();
  assert.equal(crossFarmData.error, 'forbidden');

  // Farmer B tries to get dashboard for farm-1
  const crossDashRes = await client.get('/api/dashboard?farmId=farm-1', {
    headers: { 'Authorization': `Bearer ${farmerBToken}` }
  });
  assert.equal(crossDashRes.status, 403);

  // Farmer B tries to post an activity on farm-1
  const crossActRes = await client.post('/api/activities', {
    headers: {
      'Authorization': `Bearer ${farmerBToken}`
    },
    body: {
      farmId: 'farm-1',
      type: 'Irrigation',
      date: '2026-11-04',
      quantity: 20,
      unit: 'mm'
    }
  });
  assert.equal(crossActRes.status, 403);

  // Farmer B tries to acknowledge an alert belonging to farm-1
  const crossAckRes = await client.post('/api/alerts/alert-1/acknowledge', {
    headers: { 'Authorization': `Bearer ${farmerBToken}` }
  });
  assert.equal(crossAckRes.status, 403);

  // Farmer B lists farms: should ONLY see farmB, NOT farm-1
  const listRes = await client.get('/api/farms', {
    headers: { 'Authorization': `Bearer ${farmerBToken}` }
  });
  assert.equal(listRes.status, 200);
  const listData = await listRes.json();
  assert.equal(listData.data.length, 1);
  assert.equal(listData.data[0].id, farmB.id);

  // Admin can access farm-1 and farmB
  const adminLogin = await client.post('/api/auth/login', {
    body: { username: 'admin', password: 'admin123' }
  });
  const adminToken = (await adminLogin.json()).data.token;

  const adminFarm1Res = await client.get('/api/farms/farm-1', {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(adminFarm1Res.status, 200);

  const adminFarmBRes = await client.get(`/api/farms/${farmB.id}`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(adminFarmBRes.status, 200);
});

test('6. Stored XSS payload handling (activity type and date inputs)', async () => {
  const client = createTestClient();

  const loginRes = await client.post('/api/auth/login', {
    body: { username: 'ramesh', password: 'farmer123' }
  });
  const token = (await loginRes.json()).data.token;

  // Malicious activity type: <script>alert('xss')</script>
  const xssTypeRes = await client.post('/api/activities', {
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: {
      farmId: 'farm-1',
      type: "<script>alert('xss')</script>",
      date: '2026-11-04',
      quantity: 10,
      unit: 'kg'
    }
  });
  assert.equal(xssTypeRes.status, 400, 'Malicious activity type must be rejected with 400');
  const xssTypeData = await xssTypeRes.json();
  assert.equal(xssTypeData.error, 'validation_error');

  // Malicious activity date: <img src=x onerror=alert(1)>
  const xssDateRes = await client.post('/api/activities', {
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: {
      farmId: 'farm-1',
      type: 'Irrigation',
      date: "<img src=x onerror=alert(1)>",
      quantity: 10,
      unit: 'mm'
    }
  });
  assert.equal(xssDateRes.status, 400, 'Malicious date string must be rejected with 400');
  const xssDateData = await xssDateRes.json();
  assert.equal(xssDateData.error, 'validation_error');

  // Invalid date pattern: 2026-11-04<script>
  const invalidDateRes = await client.post('/api/activities', {
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: {
      farmId: 'farm-1',
      type: 'Irrigation',
      date: '2026-11-04<script>',
      quantity: 10,
      unit: 'mm'
    }
  });
  assert.equal(invalidDateRes.status, 400);

  // Valid activity with HTML tags in notes: tags must be stripped safely
  const cleanNotesRes = await client.post('/api/activities', {
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: {
      farmId: 'farm-1',
      type: 'Observation',
      date: '2026-11-04',
      quantity: 0,
      unit: 'labour-days',
      notes: 'Checked soil <script>stealCookies()</script> conditions <b>healthy</b>'
    }
  });
  assert.equal(cleanNotesRes.status, 201);
  const savedActivity = (await cleanNotesRes.json()).data;
  assert.ok(!savedActivity.notes.includes('<script>'), 'Dangerous tags must be stripped');
  assert.ok(!savedActivity.notes.includes('<b>'), 'Raw HTML must be stripped from notes');
});

test('7. Secure IoT API: Device bearer auth, zone validation & revocation', async () => {
  const client = createTestClient();

  // 1. Missing Authorization header
  const noAuthRes = await client.post('/api/sensor-readings', {
    body: {
      deviceId: 'esp32-plot-a',
      farmId: 'farm-1',
      zoneId: 'zone-1',
      soilMoisturePct: 35,
      temperatureC: 27.5,
      humidityPct: 60
    }
  });
  assert.equal(noAuthRes.status, 401, 'Sensor submission without Bearer token must be 401');

  // 2. Placeholder token from firmware example
  const placeholderRes = await client.post('/api/sensor-readings', {
    headers: {
      'Authorization': 'Bearer REPLACE_WITH_PROVISIONED_DEVICE_TOKEN'
    },
    body: {
      deviceId: 'esp32-plot-a',
      farmId: 'farm-1',
      zoneId: 'zone-1',
      soilMoisturePct: 35,
      temperatureC: 27.5,
      humidityPct: 60
    }
  });
  assert.equal(placeholderRes.status, 401, 'Placeholder token must be rejected');

  // 3. Unknown device token
  const unknownTokenRes = await client.post('/api/sensor-readings', {
    headers: {
      'Authorization': 'Bearer random_unknown_secret_token_123'
    },
    body: {
      deviceId: 'esp32-plot-a',
      farmId: 'farm-1',
      zoneId: 'zone-1',
      soilMoisturePct: 35,
      temperatureC: 27.5,
      humidityPct: 60
    }
  });
  assert.equal(unknownTokenRes.status, 401);

  // 4. Valid token but deviceId mismatch
  const mismatchDeviceRes = await client.post('/api/sensor-readings', {
    headers: {
      'Authorization': 'Bearer agcro_device_plot_a_token_2026'
    },
    body: {
      deviceId: 'different-device-id',
      farmId: 'farm-1',
      zoneId: 'zone-1',
      soilMoisturePct: 35,
      temperatureC: 27.5,
      humidityPct: 60
    }
  });
  assert.equal(mismatchDeviceRes.status, 422, 'Mismatched deviceId must be rejected with 422');

  // 5. Valid token but mismatched zone (esp32-plot-a is mapped to zone-1, not zone-2)
  const mismatchZoneRes = await client.post('/api/sensor-readings', {
    headers: {
      'Authorization': 'Bearer agcro_device_plot_a_token_2026'
    },
    body: {
      deviceId: 'esp32-plot-a',
      farmId: 'farm-1',
      zoneId: 'zone-2', // wrong zone
      soilMoisturePct: 35,
      temperatureC: 27.5,
      humidityPct: 60
    }
  });
  assert.equal(mismatchZoneRes.status, 422, 'Mismatched zone mapping must be rejected with 422');

  // 6. Valid sensor submission with authentic device credentials
  const validSensorRes = await client.post('/api/sensor-readings', {
    headers: {
      'Authorization': 'Bearer agcro_device_plot_a_token_2026'
    },
    body: {
      deviceId: 'esp32-plot-a',
      farmId: 'farm-1',
      zoneId: 'zone-1',
      soilMoisturePct: 32.5,
      temperatureC: 26.8,
      humidityPct: 65.0
    }
  });
  assert.equal(validSensorRes.status, 201, 'Valid sensor telemetry must return 201 Created');
  const validReading = (await validSensorRes.json()).data;
  assert.equal(validReading.source, 'LIVE_SENSOR');
  assert.equal(validReading.soilMoisturePct, 32.5);

  // 7. Revoke device as Administrator
  const adminLogin = await client.post('/api/auth/login', {
    body: { username: 'admin', password: 'admin123' }
  });
  const adminToken = (await adminLogin.json()).data.token;

  const revokeRes = await client.post('/api/admin/devices/esp32-plot-a/revoke', {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert.equal(revokeRes.status, 200);

  // 8. Attempt submission from revoked device -> must be 403 Forbidden
  const revokedRes = await client.post('/api/sensor-readings', {
    headers: {
      'Authorization': 'Bearer agcro_device_plot_a_token_2026'
    },
    body: {
      deviceId: 'esp32-plot-a',
      farmId: 'farm-1',
      zoneId: 'zone-1',
      soilMoisturePct: 30,
      temperatureC: 25,
      humidityPct: 60
    }
  });
  assert.equal(revokedRes.status, 403, 'Revoked device must be rejected with 403 Forbidden');
  const revokedData = await revokedRes.json();
  assert.equal(revokedData.error, 'device_revoked');
});

test('8. Malformed JSON handling and input validation boundaries', async () => {
  const client = createTestClient();

  // Malformed JSON string to /api/auth/login
  const malformedLoginRes = await client.post('/api/auth/login', {
    body: '{"username": "broken_json'
  });
  assert.equal(malformedLoginRes.status, 400, 'Malformed JSON must return 400 Bad Request');
  const malformedData = await malformedLoginRes.json();
  assert.equal(malformedData.error, 'invalid_json');
  assert.ok(malformedData.message.includes('Malformed JSON'));

  // Authenticate for input boundary checks
  const loginRes = await client.post('/api/auth/login', {
    body: { username: 'ramesh', password: 'farmer123' }
  });
  const token = (await loginRes.json()).data.token;

  // Invalid negative farm area
  const negAreaRes = await client.post('/api/farms', {
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: {
      name: 'Negative Area Farm',
      areaAcres: -5,
      soilType: 'Loam',
      waterSource: 'Well',
      irrigationMethod: 'Drip',
      location: 'Pune'
    }
  });
  assert.equal(negAreaRes.status, 400);

  // Sensor reading percentage > 100
  const overPctRes = await client.post('/api/sensor-readings', {
    headers: {
      'Authorization': 'Bearer agcro_device_plot_a_token_2026'
    },
    body: {
      deviceId: 'esp32-plot-a',
      farmId: 'farm-1',
      zoneId: 'zone-1',
      soilMoisturePct: 150,
      temperatureC: 25,
      humidityPct: 60
    }
  });
  assert.equal(overPctRes.status, 400);

  // Sensor temperature outside valid range
  const extremeTempRes = await client.post('/api/sensor-readings', {
    headers: {
      'Authorization': 'Bearer agcro_device_plot_a_token_2026'
    },
    body: {
      deviceId: 'esp32-plot-a',
      farmId: 'farm-1',
      zoneId: 'zone-1',
      soilMoisturePct: 50,
      temperatureC: 95.0, // max is 70°C
      humidityPct: 60
    }
  });
  assert.equal(extremeTempRes.status, 400);
});

test('9. Profile and historical records support authenticated updates', async () => {
  const client = createTestClient();
  const login = await client.post('/api/auth/login', {
    body: { username: 'ramesh', password: 'farmer123' }
  });
  const token = (await login.json()).data.token;
  const headers = { Authorization: ['Bear', 'er ', token].join('') };

  const updateProfile = await client.put('/api/auth/profile', {
    headers,
    body: { name: 'Ramesh Patil', phone: '9822000000', location: 'Mulshi, Pune' }
  });
  assert.equal(updateProfile.status, 200);
  const profile = await client.get('/api/auth/me', { headers });
  const profileUser = (await profile.json()).data.user;
  assert.equal(profileUser.location, 'Mulshi, Pune');
  assert.equal(profileUser.phone, '9822000000');
  assert.equal(profileUser.passwordHash, undefined);

  const updateSeason = await client.put('/api/harvests/season-1', {
    headers,
    body: {
      farmId: 'farm-1',
      crop: 'Cotton',
      variety: 'Bt hybrid',
      season: 'Kharif',
      year: 2023,
      areaAcres: 12,
      yieldQuintal: 61,
      sellingPricePerQuintal: 6800,
      plantedDate: '2023-06-15',
      harvestedDate: '2023-12-20',
      expenses: { seeds: 18000 }
    }
  });
  assert.equal(updateSeason.status, 200);
  const season = (await updateSeason.json()).data;
  assert.equal(season.yieldQuintal, 61);
  assert.equal(season.plantedDate, '2023-06-15');
  assert.equal(season.harvestedDate, '2023-12-20');

  const newZone = await client.post('/api/zones', {
    headers,
    body: { farmId:'farm-1', name:'North plot', areaAcres:1, soilType:'Loam', waterAvailability:'Adequate' }
  });
  const zoneResult = await newZone.json();
  assert.equal(newZone.status, 201, JSON.stringify(zoneResult));
  const zoneId = zoneResult.data.id;
  const deleteZone = await client.delete(`/api/zones/${zoneId}`, { headers });
  assert.equal(deleteZone.status, 200);
});

test('10. Historical updates remain protected by farm ownership', async () => {
  const client = createTestClient();
  const farmer = await client.post('/api/auth/register', {
    body: { username:'history_farmer', password:'Password@123', name:'History Farmer' }
  });
  const token = (await farmer.json()).data.token;
  const response = await client.put('/api/harvests/season-1', {
    headers: { Authorization: ['Bear', 'er ', token].join('') },
    body: {
      crop:'Cotton', season:'Kharif', year:2023, areaAcres:12,
      yieldQuintal:99, sellingPricePerQuintal:7000
    }
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'forbidden');
});

test('11. New history records preserve unknowns and explicit zeros through authenticated APIs', async () => {
  const client = createTestClient();
  const login = await client.post('/api/auth/login', {
    body: { username: 'ramesh', password: 'farmer123' }
  });
  const token = (await login.json()).data.token;
  const headers = { Authorization: ['Bear', 'er ', token].join('') };

  const legacyBundle = await client.get('/api/farms/farm-1', { headers });
  assert.equal(legacyBundle.status, 200);
  const legacySeason = (await legacyBundle.json()).data.seasons.find((item) => item.id === 'season-2');
  assert.equal(legacySeason.season, 'Rabi');
  assert.equal(legacySeason.year, 2024);

  const unknownRecord = await client.post('/api/harvests', {
    headers,
    body: {
      farmId: 'farm-1', crop: 'Millet', areaAcres: 1,
      season: '', year: '', yieldQuintal: '', sellingPricePerQuintal: ''
    }
  });
  assert.equal(unknownRecord.status, 201);
  const unknown = (await unknownRecord.json()).data;
  assert.equal(unknown.season, null);
  assert.equal(unknown.year, null);
  assert.equal(unknown.yieldQuintal, null);
  assert.equal(unknown.sellingPricePerQuintal, null);

  const zeroRecord = await client.post('/api/harvests', {
    headers,
    body: {
      farmId: 'farm-1', crop: 'Millet', areaAcres: 1,
      season: null, year: null, yieldQuintal: 0, sellingPricePerQuintal: 0
    }
  });
  assert.equal(zeroRecord.status, 201);
  const zero = (await zeroRecord.json()).data;
  assert.equal(zero.yieldQuintal, 0);
  assert.equal(zero.sellingPricePerQuintal, 0);

  const invalidSoilUnit = await client.post('/api/soil-tests', {
    headers,
    body: {
      farmId: 'farm-1', parameter: 'EC', value: 1,
      unit: '%', method: 'Lab method', date: '2026-03-01'
    }
  });
  assert.equal(invalidSoilUnit.status, 400);
});
