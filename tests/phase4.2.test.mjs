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
    req.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

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

    if (payloadStr != null) req.push(payloadStr);
    req.push(null);
  });

  return {
    store,
    get: (url, opts) => request('GET', url, opts),
    post: (url, opts) => request('POST', url, opts),
    put: (url, opts) => request('PUT', url, opts),
    delete: (url, opts) => request('DELETE', url, opts)
  };
}

async function login(client, username = 'ramesh', password = 'farmer123') {
  const res = await client.post('/api/auth/login', {
    body: { username, password }
  });
  assert.equal(res.status, 200);
  return (await res.json()).data.token;
}

test('Phase 4.2 stores structured crop plans, planning periods, rainfall and water records', async () => {
  const client = createTestClient();
  const token = await login(client);
  const headers = { Authorization: `Bearer ${token}` };
  const farmId = 'farm-1';
  const zoneId = 'zone-1';

  const cropPlan = await client.post(`/api/farms/${farmId}/crop-plans`, {
    headers,
    body: {
      zoneId,
      crop: 'Wheat',
      variety: 'NIAW-1415',
      season: 'Rabi',
      agriculturalYear: 2026,
      sowingDate: '2026-11-01',
      expectedHarvestDate: '2027-03-30',
      currentGrowthStage: 'Vegetative',
      cultivatedArea: 2.5,
      areaUnit: 'acre',
      recordSource: 'FARMER_ENTERED',
      status: 'active'
    }
  });
  assert.equal(cropPlan.status, 201);
  const cropPlanJson = await cropPlan.json();
  assert.equal(cropPlanJson.data.zoneId, zoneId);
  assert.equal(cropPlanJson.data.status, 'active');

  const planningPeriod = await client.post(`/api/farms/${farmId}/planning-periods`, {
    headers,
    body: {
      zoneId,
      cropPlanId: cropPlanJson.data.id,
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      status: 'active'
    }
  });
  assert.equal(planningPeriod.status, 201);
  const planningJson = await planningPeriod.json();
  assert.equal(planningJson.data.durationDays, 30);

  const rainfall = await client.post(`/api/farms/${farmId}/effective-rainfall`, {
    headers,
    body: {
      zoneId,
      planningPeriodId: planningJson.data.id,
      observationDate: '2026-11-10',
      amount: 18,
      unit: 'mm',
      method: 'Farm rain gauge',
      source: 'FARMER_ENTERED',
      provenance: 'FARMER_ENTERED'
    }
  });
  assert.equal(rainfall.status, 201);
  const rainfallJson = await rainfall.json();
  assert.equal(rainfallJson.data.amount, 18);

  const waterAvailability = await client.post(`/api/farms/${farmId}/water-availability`, {
    headers,
    body: {
      zoneId,
      waterType: 'stored',
      availableWaterLitres: 15000,
      unit: 'litres',
      measurementDate: '2026-11-05',
      provenance: 'FARMER_ENTERED',
      notes: 'Tank storage'
    }
  });
  assert.equal(waterAvailability.status, 201);
  const waterAvailabilityJson = await waterAvailability.json();
  assert.equal(waterAvailabilityJson.data.unit, 'litres');

  const waterUseEvent = await client.post(`/api/farms/${farmId}/water-use-events`, {
    headers,
    body: {
      zoneId,
      cropPlanId: cropPlanJson.data.id,
      eventDateTime: '2026-11-12T07:00:00Z',
      waterQuantity: 500,
      quantityUnit: 'litres',
      applicationMethod: 'Drip',
      sourceOfMeasurement: 'Flow meter',
      recordProvenance: 'FARMER_ENTERED',
      notes: 'Measured application'
    }
  });
  assert.equal(waterUseEvent.status, 201);
  const waterUseJson = await waterUseEvent.json();
  assert.equal(waterUseJson.data.quantityUnit, 'litres');

  const getPlans = await client.get(`/api/farms/${farmId}/crop-plans`, { headers });
  assert.equal(getPlans.status, 200);
  const plans = await getPlans.json();
  assert.equal(plans.data.length, 1);

  const invalidOverlap = await client.post(`/api/farms/${farmId}/crop-plans`, {
    headers,
    body: {
      zoneId,
      crop: 'Barley',
      season: 'Rabi',
      agriculturalYear: 2026,
      sowingDate: '2026-11-15',
      expectedHarvestDate: '2027-02-15',
      cultivatedArea: 1,
      areaUnit: 'acre',
      status: 'active'
    }
  });
  assert.equal(invalidOverlap.status, 409);
});

test('water records require explicit units and timestamps and prevent aggregate double counting', async () => {
  const client = createTestClient();
  const headers = { Authorization:`Bearer ${await login(client)}` };
  const farmId = 'farm-1';
  const postWater = (body) => client.post(`/api/farms/${farmId}/water-availability`, { headers, body });

  const missingType = await postWater({ availableWaterLitres:500, unit:'litres', measurementDate:'2026-11-05' });
  assert.equal(missingType.status, 400);
  const component = await postWater({ waterType:'stored', availableWaterLitres:500, unit:'litres', measurementDate:'2026-11-05' });
  assert.equal(component.status, 201);
  const aggregate = await postWater({ waterType:'aggregate_available', availableWaterLitres:900, unit:'litres', measurementDate:'2026-11-05' });
  assert.equal(aggregate.status, 409);
  assert.equal((await aggregate.json()).error, 'water_availability_double_count');

  const missingTimestamp = await client.post(`/api/farms/${farmId}/water-use-events`, {
    headers,
    body:{ waterQuantity:10, quantityUnit:'litres', applicationMethod:'Drip', sourceOfMeasurement:'Farmer record' }
  });
  assert.equal(missingTimestamp.status, 400);
});

test('financial scenarios preserve unknowns and only calculate with complete explicit inputs', async () => {
  const client = createTestClient();
  const headers = { Authorization:`Bearer ${await login(client)}` };
  const farmId = 'farm-1';
  const planResponse = await client.post(`/api/farms/${farmId}/crop-plans`, {
    headers,
    body:{
      zoneId:'zone-1', crop:'Millet', variety:null, season:null, agriculturalYear:null,
      sowingDate:'2026-11-06', expectedHarvestDate:'2027-03-01', cultivatedArea:1,
      areaUnit:'acre', recordSource:'FARMER_ENTERED', status:'active'
    }
  });
  assert.equal(planResponse.status, 201);
  const plan = (await planResponse.json()).data;
  const endpoint = `/api/farms/${farmId}/financial-scenarios`;
  const create = (scenario) => client.post(endpoint, { headers, body:{ ...scenario, cropPlanId:plan.id, crop:'Millet' } });

  const incomplete = await create({
    scenario:'low', expectedYieldQuintal:null, yieldUnit:'quintal_total', pricePerQuintal:null,
    currency:'INR', costUnit:'INR_total', expenses:null, expensesComplete:false, assumptions:[],
    source:'FARMER_ENTERED'
  });
  assert.equal(incomplete.status, 201);
  assert.equal((await incomplete.json()).data.expectedYieldQuintal, null);
  let dashboard = (await (await client.get(`/api/dashboard?farmId=${farmId}`, { headers })).json()).data;
  assert.equal(dashboard.profit.future.scenarios.some((item) => item.crop === 'Millet'), false);

  const complete = await client.put(`${endpoint}/${(await incomplete.json()).data.id}`, {
    headers,
    body:{
      cropPlanId:plan.id, scenario:'low', expectedYieldQuintal:10, yieldUnit:'quintal_total', pricePerQuintal:2000,
      currency:'INR', costUnit:'INR_total', expenses:{ seed:500, labour:1000 },
      expensesComplete:true, assumptions:['Farmer-entered planning scenario'], source:'FARMER_ENTERED'
    }
  });
  assert.equal(complete.status, 200);
  dashboard = (await (await client.get(`/api/dashboard?farmId=${farmId}`, { headers })).json()).data;
  const scenario = dashboard.profit.future.scenarios.find((item) => item.crop === 'Millet');
  assert.ok(scenario, JSON.stringify({ profit:dashboard.profit, plans:dashboard.cropPlans, scenarios:dashboard.financialScenarios }));
  assert.equal(scenario.revenue, 20000);
  assert.equal(scenario.profit, 18500);

  const wrongCrop = await client.put(`${endpoint}/${(await complete.json()).data.id}`, {
    headers,
    body:{ crop:'Wheat', scenario:'low', cropPlanId:plan.id, expectedYieldQuintal:10, yieldUnit:'quintal_total',
      pricePerQuintal:2000, currency:'INR', costUnit:'INR_total', expenses:{ seed:500 },
      expensesComplete:true, assumptions:[], source:'FARMER_ENTERED' }
  });
  assert.equal(wrongCrop.status, 422);

  const protectedPlan = await client.delete(`/api/farms/${farmId}/crop-plans/${plan.id}`, { headers });
  assert.equal(protectedPlan.status, 409);
  assert.equal((await protectedPlan.json()).error, 'crop_plan_has_history');
  const deleteFarm = await client.delete(`/api/farms/${farmId}`, { headers });
  assert.equal(deleteFarm.status, 200);
  assert.equal(client.store.list('financialScenarios').some((item) => item.farmId === farmId), false);
});
