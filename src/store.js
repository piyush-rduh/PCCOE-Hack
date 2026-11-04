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

  // Ensure essential collections exist
  data.users = data.users || [];
  data.revokedTokens = data.revokedTokens || [];
  data.sensorDevices = data.sensorDevices || [];
  data.alerts = data.alerts || [];
  data.decisions = data.decisions || [];

  const save = () => {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  };

  const list = (key) => data[key] || [];
  const findFarm = (id) => list('farms').find((farm) => farm.id === id) || null;
  const findFarmer = (id) => list('farmers').find((farmer) => farmer.id === id) || null;
  const getFarm = (id) => findFarm(id) || list('farms')[0];
  const getFarmer = (id) => findFarmer(id) || list('farmers')[0];
  const getUserById = (id) => list('users').find((user) => user.id === id) || null;
  const getUserByUsername = (username) => {
    if (!username) return null;
    const lower = String(username).trim().toLowerCase();
    return list('users').find((user) => user.username.toLowerCase() === lower) || null;
  };
  const getDeviceById = (id) => list('sensorDevices').find((device) => device.id === id) || null;
  const getDeviceByTokenHash = (tokenHash) => {
    if (!tokenHash) return null;
    return list('sensorDevices').find((device) => device.tokenHash === tokenHash) || null;
  };

  const isTokenRevoked = (identifier) => {
    if (!identifier) return false;
    return list('revokedTokens').some((item) => (typeof item === 'string' ? item === identifier : item.tokenHash === identifier || item.jti === identifier));
  };

  const revokeToken = (identifier) => {
    if (!identifier) return;
    const entry = typeof identifier === 'string' ? { tokenHash: identifier, revokedAt: now() } : { ...identifier, revokedAt: now() };
    data.revokedTokens = list('revokedTokens');
    data.revokedTokens.push(entry);
    save();
    return entry;
  };

  const revokeDevice = (deviceId) => {
    const device = getDeviceById(deviceId);
    if (!device || device.status === 'revoked') return device;
    return update('sensorDevices', deviceId, { status: 'revoked', revokedAt: now() });
  };

  const scoped = (key, farmId) => list(key).filter((item) => !farmId || item.farmId === farmId);
  const add = (key, item) => {
    data[key] = list(key);
    data[key].push(item);
    save();
    return item;
  };
  const update = (key, id, patch) => {
    const index = list(key).findIndex((item) => item.id === id);
    if (index < 0) return null;
    data[key][index] = { ...data[key][index], ...patch, updatedAt: now() };
    save();
    return data[key][index];
  };
  const remove = (key, id) => {
    const index = list(key).findIndex((item) => item.id === id);
    if (index < 0) return false;
    data[key].splice(index, 1);
    save();
    return true;
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
    findFarm,
    findFarmer,
    getFarm,
    getFarmer,
    getUserById,
    getUserByUsername,
    getDeviceById,
    getDeviceByTokenHash,
    isTokenRevoked,
    revokeToken,
    revokeDevice,
    add,
    update,
    remove,
    acknowledge,
    recordDecision,
    addAlert,
    reset() {
      data = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
      data.users = data.users || [];
      data.revokedTokens = data.revokedTokens || [];
      data.sensorDevices = data.sensorDevices || [];
      save();
      return data;
    }
  };
}
