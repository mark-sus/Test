const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');


const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const adapter = new FileSync(path.join(DATA_DIR, 'data.json'));
const db = low(adapter);

db.defaults({ executors: [], requests: [], messages: [], settings: [] }).write();


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



function createRequest(data) {
  const request = {
    id: nanoid(10),
    taskId: data.taskId || '',
    timeFrom: data.timeFrom || '',
    timeTo: data.timeTo || '',
    orderId: data.orderId || '',
    connectionType: data.connectionType === 'PON' ? 'PON' : 'FTTB',
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

// Повне редагування заявки адміністратором (лише поки статус new/rescheduled — перевіряється на рівні server.js)
function updateRequestFull(id, data) {
  const patch = {
    taskId: data.taskId || '',
    timeFrom: data.timeFrom || '',
    timeTo: data.timeTo || '',
    orderId: data.orderId || '',
    connectionType: data.connectionType === 'PON' ? 'PON' : 'FTTB',
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
  };
  return updateRequest(id, patch);
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
  createRequest,
  listRequestsForExecutor,
  listAllRequests,
  getRequest,
  findRequestByTaskId,
  findRequestByOrderId,
  updateRequest,
  updateRequestFull,
  deleteRequest,
  addMessage,
  listMessages,
  getNotificationsEnabled,
  setNotificationsEnabled,
};

