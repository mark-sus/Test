const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');
const { nanoid } = require('nanoid');

// DATA_DIR дозволяє винести data.json на постійний диск (наприклад, Railway Volume),
// щоб заявки НЕ зникали при кожному передеплої/перезапуску контейнера.
// Якщо DATA_DIR не задано — файл лежить поруч зі скриптом (тоді дані живуть лише
// до наступного деплою на платформах з ефемерною файловою системою).
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const adapter = new FileSync(path.join(DATA_DIR, 'data.json'));
const db = low(adapter);

db.defaults({ executors: [], requests: [], messages: [], settings: [] }).write();

// ---------- Виконавці ----------

function upsertExecutor({ chatId, firstName, lastName, username }) {
  const existing = db.get('executors').find({ chatId: String(chatId) }).value();
  if (existing) {
    db.get('executors')
      .find({ chatId: String(chatId) })
      .assign({ firstName, lastName, username })
      .write();
    return db.get('executors').find({ chatId: String(chatId) }).value();
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

function listExecutors() {
  return db.get('executors').filter({ active: true }).value();
}

function getExecutor(id) {
  return db.get('executors').find({ id }).value();
}

// ---------- Заявки ----------

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
    phone: data.phone || '', // робочий телефон
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
    executorId: data.executorId || '', // порожньо = заявка для всіх виконавців
    status: 'new', // new -> pending_review -> approved | rescheduled
    rescheduleDate: null,
    rescheduleComment: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.get('requests').push(request).write();
  return request;
}

// Заявки без призначеного виконавця бачать УСІ виконавці (як загальний пул)
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

function addMessage(requestId, { role, authorName, text }) {
  const message = {
    id: nanoid(10),
    requestId,
    role, // 'admin' | 'executor'
    authorName: authorName || (role === 'admin' ? 'Адміністратор' : 'Виконавець'),
    text,
    createdAt: new Date().toISOString(),
  };
  db.get('messages').push(message).write();
  return message;
}

function listMessages(requestId) {
  return db.get('messages').filter({ requestId }).orderBy(['createdAt'], ['asc']).value();
}

// ---------- Налаштування сповіщень (на chatId, окремо для адмінів і виконавців) ----------

function getNotificationsEnabled(chatId) {
  const s = db.get('settings').find({ chatId: String(chatId) }).value();
  return s ? s.notificationsEnabled !== false : true; // за замовчуванням увімкнено
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
  upsertExecutor,
  listExecutors,
  getExecutor,
  createRequest,
  listRequestsForExecutor,
  listAllRequests,
  getRequest,
  updateRequest,
  deleteRequest,
  addMessage,
  listMessages,
  getNotificationsEnabled,
  setNotificationsEnabled,
};
