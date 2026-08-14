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
//
// Виконавця може додати лише адміністратор (через бота): надіславши юзернейм
// (@username) або контакт, і вказавши Ім'я та Прізвище. Якщо доданий за
// юзернеймом — запис створюється як "очікує" (chatId порожній) і стає активним,
// щойно ця людина сама натисне /start у боті (тоді юзернейм зіставляється).
// Якщо доданий через контакт з відомим user_id — запис одразу активний.
// Звичайні (не додані адміном) користувачі виконавцями НЕ стають.

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

// Усі виконавці, доданих адміністратором (і активні з відомим chatId, і ті, що ще очікують на /start)
function listExecutors() {
  return db.get('executors').filter({ active: true }).value();
}

// Лише ті, кому реально можна надіслати повідомлення (уже запускали бота)
function listReachableExecutors() {
  return listExecutors().filter((e) => !!e.chatId);
}

// Адмін додає виконавця за юзернеймом — запис "очікує", доки людина сама не натисне /start
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

// Адмін додає виконавця через надісланий контакт (одразу відомий chatId)
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

// Активує заздалегідь доданого (за юзернеймом) виконавця, коли той сам запускає бота
function activatePendingExecutorByUsername(username, chatId, liveUsername) {
  const pending = findExecutorByUsername(username);
  if (!pending || pending.chatId) return null;
  db.get('executors')
    .find({ id: pending.id })
    .assign({ chatId: String(chatId), username: liveUsername || pending.username, active: true })
    .write();
  return getExecutor(pending.id);
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

function addMessage(requestId, { role, authorName, text, photoUrl }) {
  const message = {
    id: nanoid(10),
    requestId,
    role, // 'admin' | 'executor'
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
  updateRequest,
  deleteRequest,
  addMessage,
  listMessages,
  getNotificationsEnabled,
  setNotificationsEnabled,
};
