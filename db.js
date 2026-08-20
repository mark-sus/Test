const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');


const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const adapter = new FileSync(path.join(DATA_DIR, 'data.json'));
const db = low(adapter);

db.defaults({ executors: [], requests: [], messages: [], settings: [], buildings: [] }).write();


function getExecutor(id) {
  return db.get('executors').find({ id }).value();
}

function getExecutorByChatId(chatId) {
  return db.get('executors').find({ chatId: String(chatId) }).value();
}

function findExecutorByUsername(username) {
  if (!username) return null;
  const uname = String(username).replace(/^@/, '').toLowerCase();
  if (!uname) return null;
  return db
    .get('executors')
    .find((e) => (e.username || '').toLowerCase() === uname)
    .value();
}


function listExecutors() {
  return db.get('executors').filter({ active: true }).value();
}


function listReachableExecutors() {
  return listExecutors().filter((e) => !!e.chatId);
}


function addPendingExecutorByUsername({ username, firstName, lastName }) {
  const uname = String(username).replace(/^@/, '').trim();
  const existing = findExecutorByUsername(uname);
  if (existing) {
    db.get('executors')
      .find({ id: existing.id })
      .assign({ firstName: firstName || existing.firstName, lastName: lastName || existing.lastName, active: true })
      .write();
    return getExecutor(existing.id);
  }
  const executor = {
    id: nanoid(8),
    chatId: '',
    firstName: firstName || '',
    lastName: lastName || '',
    username: uname,
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.get('executors').push(executor).write();
  return executor;
}


function addExecutorFromContact({ chatId, username, firstName, lastName }) {
  const existing = getExecutorByChatId(chatId);
  if (existing) {
    db.get('executors')
      .find({ id: existing.id })
      .assign({
        firstName: firstName || existing.firstName,
        lastName: lastName || existing.lastName,
        username: username || existing.username,
        active: true,
      })
      .write();
    return getExecutor(existing.id);
  }
  const executor = {
    id: nanoid(8),
    chatId: String(chatId),
    firstName: firstName || '',
    lastName: lastName || '',
    username: username || '',
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.get('executors').push(executor).write();
  return executor;
}


function activatePendingExecutorByUsername(username, chatId, liveUsername) {
  const pending = findExecutorByUsername(username);
  if (!pending || pending.chatId) return null;
  db.get('executors')
    .find({ id: pending.id })
    .assign({ chatId: String(chatId), username: liveUsername || pending.username, active: true })
    .write();
  return getExecutor(pending.id);
}



// ---------- Будинки (для автопідстановки поверху/під'їзду) ----------
//
// Нумерація квартир вважається послідовною по під'їздах: спочатку всі
// квартири 1-го під'їзду (поверх за поверхом), потім 2-го і т.д.
// Це стандартна схема для більшості багатоквартирних будинків.

function normalizeStreet(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function listBuildings(city) {
  let q = db.get('buildings');
  if (city) q = q.filter((b) => normalizeStreet(b.city) === normalizeStreet(city));
  return q.orderBy(['street'], ['asc']).value();
}

function getBuilding(id) {
  return db.get('buildings').find({ id }).value();
}

function findBuildingByStreet(city, street) {
  const c = normalizeStreet(city);
  const s = normalizeStreet(street);
  if (!s) return null;
  return (
    db
      .get('buildings')
      .find((b) => normalizeStreet(b.city) === c && normalizeStreet(b.street) === s)
      .value() || null
  );
}

function createBuilding(data) {
  const building = {
    id: nanoid(8),
    city: data.city || '',
    street: data.street || '',
    entrances: Math.max(1, parseInt(data.entrances, 10) || 1),
    floors: Math.max(1, parseInt(data.floors, 10) || 1),
    aptsPerFloor: Math.max(1, parseInt(data.aptsPerFloor, 10) || 1),
    startApt: parseInt(data.startApt, 10) || 1,
    createdAt: new Date().toISOString(),
  };
  db.get('buildings').push(building).write();
  return building;
}

function updateBuilding(id, patch) {
  db.get('buildings').find({ id }).assign(patch).write();
  return getBuilding(id);
}

function deleteBuilding(id) {
  const existed = !!getBuilding(id);
  db.get('buildings').remove({ id }).write();
  return existed;
}

// Обчислює поверх і під'їзд для номера квартири в даному будинку.
// Повертає null, якщо номер квартири виходить за межі будинку.
function computeAptLocation(building, aptRaw) {
  if (!building) return null;
  const apt = parseInt(String(aptRaw).replace(/\D/g, ''), 10);
  if (!apt || isNaN(apt)) return null;
  const start = building.startApt || 1;
  const idx = apt - start;
  if (idx < 0) return null;
  const aptsPerEntrance = building.floors * building.aptsPerFloor;
  const entrance = Math.floor(idx / aptsPerEntrance) + 1;
  if (entrance > building.entrances) return null;
  const rem = idx % aptsPerEntrance;
  const floor = Math.floor(rem / building.aptsPerFloor) + 1;
  return { floor, entrance };
}

function createRequest(data) {
  const request = {
    id: nanoid(10),
    taskId: data.taskId || '',
    timeFrom: data.timeFrom || '',
    timeTo: data.timeTo || '',
    orderId: data.orderId || '',
    technology: data.technology || '',
    clientId: data.clientId || '',
    email: data.email || '',
    clientName: data.clientName || '',
    homePhone: data.homePhone || '',
    mobilePhone: data.mobilePhone || '',
    phone: data.phone || '', 
    city: data.city || 'Звягель',
    street: data.street || '',
    apt: data.apt || '',
    floor: data.floor || '',
    entrance: data.entrance || '',
    lat: data.lat || null,
    lng: data.lng || null,
    port: data.port || '',
    tkdAddress: data.tkdAddress || '',
    tkd: data.tkd || '',
    additionalInfo: Array.isArray(data.additionalInfo)
      ? data.additionalInfo
          .filter((item) => item && (item.name || item.value))
          .map((item) => ({
            name: item.name || '',
            value: item.value || '',
            copyable: !!item.copyable,
          }))
      : [],
    executorId: data.executorId || '', 
    status: 'new',
    rescheduleDate: null,
    rescheduleComment: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.get('requests').push(request).write();
  return request;
}


function listRequestsForExecutor(executorId, status) {
  let q = db.get('requests').filter((r) => !r.executorId || r.executorId === executorId);
  if (status) q = q.filter({ status });
  return q.orderBy(['createdAt'], ['desc']).value();
}

function listAllRequests(status) {
  let q = db.get('requests');
  if (status) q = q.filter({ status });
  return q.orderBy(['createdAt'], ['desc']).value();
}

function getRequest(id) {
  return db.get('requests').find({ id }).value();
}


function findRequestByTaskId(taskId) {
  if (!taskId) return null;
  return db.get('requests').find({ taskId: String(taskId) }).value() || null;
}

function findRequestByOrderId(orderId) {
  if (!orderId) return null;
  return db.get('requests').find({ orderId: String(orderId) }).value() || null;
}

function updateRequest(id, patch) {
  db.get('requests')
    .find({ id })
    .assign({ ...patch, updatedAt: new Date().toISOString() })
    .write();
  return getRequest(id);
}

function deleteRequest(id) {
  const existed = !!getRequest(id);
  db.get('requests').remove({ id }).write();
  db.get('messages').remove({ requestId: id }).write();
  return existed;
}

// ---------- Чат по заявці ----------

function addMessage(requestId, { role, authorName, text, photoUrl }) {
  const message = {
    id: nanoid(10),
    requestId,
    role, 
    authorName: authorName || (role === 'admin' ? 'Адміністратор' : 'Виконавець'),
    text: text || '',
    photoUrl: photoUrl || null,
    createdAt: new Date().toISOString(),
  };
  db.get('messages').push(message).write();
  return message;
}

function listMessages(requestId) {
  return db.get('messages').filter({ requestId }).orderBy(['createdAt'], ['asc']).value();
}



function getNotificationsEnabled(chatId) {
  const s = db.get('settings').find({ chatId: String(chatId) }).value();
  return s ? s.notificationsEnabled !== false : true; 
}

function setNotificationsEnabled(chatId, enabled) {
  const key = String(chatId);
  const existing = db.get('settings').find({ chatId: key }).value();
  if (existing) {
    db.get('settings').find({ chatId: key }).assign({ notificationsEnabled: !!enabled }).write();
  } else {
    db.get('settings').push({ chatId: key, notificationsEnabled: !!enabled }).write();
  }
  return getNotificationsEnabled(key);
}

module.exports = {
  getExecutor,
  getExecutorByChatId,
  findExecutorByUsername,
  listExecutors,
  listReachableExecutors,
  addPendingExecutorByUsername,
  addExecutorFromContact,
  activatePendingExecutorByUsername,
  listBuildings,
  getBuilding,
  findBuildingByStreet,
  createBuilding,
  updateBuilding,
  deleteBuilding,
  computeAptLocation,
  createRequest,
  listRequestsForExecutor,
  listAllRequests,
  getRequest,
  findRequestByTaskId,
  findRequestByOrderId,
  updateRequest,
  deleteRequest,
  addMessage,
  listMessages,
  getNotificationsEnabled,
  setNotificationsEnabled,
};

