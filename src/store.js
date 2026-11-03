import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const samplePath = path.join(here, '..', 'sample-data', 'demo.json');
const clone = (value) => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export function createStore() {
  const file = process.env.AGCRO_DATA_FILE ? path.resolve(process.env.AGCRO_DATA_FILE) : null;
  const databaseConfigured = Boolean(process.env.DATABASE_URL);
  let data;
  try {
    data = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  } catch {
    data = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  }
  const save = () => {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  };
  const list = (key) => data[key] || [];
  const getFarm = (id) => list('farms').find((farm) => farm.id === id) || list('farms')[0];
  const getFarmer = (id) => list('farmers').find((farmer) => farmer.id === id) || list('farmers')[0];
  const scoped = (key, farmId) => list(key).filter((item) => !farmId || item.farmId === farmId);
  const add = (key, item) => { data[key] = list(key); data[key].push(item); save(); return item; };
  const update = (key, id, patch) => {
    const index = list(key).findIndex((item) => item.id === id);
    if (index < 0) return null;
    data[key][index] = { ...data[key][index], ...patch, updatedAt: now() };
    save();
    return data[key][index];
  };
  const acknowledge = (id) => update('alerts', id, { acknowledged: true, acknowledgedAt: now() });
  const recordDecision = (decision) => add('decisions', { ...decision, id: decision.id || makeId('decision'), createdAt: now() });
  const addAlert = (alert) => {
    const duplicate = list('alerts').find((item) => item.farmId === alert.farmId && item.title === alert.title);
    return duplicate || add('alerts', { ...alert, id: alert.id || makeId('alert'), createdAt: now(), acknowledged: false });
  };
  return {
    data,
    storageMode: file ? 'json-persistent-demo' : 'memory-demo',
    databaseConfigured,
    clone,
    now,
    makeId,
    save,
    list,
    scoped,
    getFarm,
    getFarmer,
    add,
    update,
    acknowledge,
    recordDecision,
    addAlert,
    reset() { data = JSON.parse(fs.readFileSync(samplePath, 'utf8')); save(); return data; }
  };
}
