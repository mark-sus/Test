const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const { nanoid } = require('nanoid');

const adapter = new FileSync(path.join(__dirname, 'data.json'));
const db = low(adapter);

db.defaults({ executors: [], requests: [] }).write();

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
    taskId: data.taskId,
    timeFrom: data.timeFrom,
    timeTo: data.timeTo,
    orderId: data.orderId,
    technology: data.technology,
    city: data.city || 'Звягель',
    street: data.street,
    apt: data.apt || '',
    phone: data.phone,
    clientId: data.clientId,
    executorId: data.executorId,
    status: 'new', // new -> confirmed_review -> approved | rescheduled
    rescheduleDate: null,
    rescheduleComment: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.get('requests').push(request).write();
  return request;
}

function listRequestsForExecutor(executorId, status) {
  let q = db.get('requests').filter({ executorId });
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

module.exports = {
  upsertExecutor,
  listExecutors,
  getExecutor,
  createRequest,
  listRequestsForExecutor,
  listAllRequests,
  getRequest,
  updateRequest,
};
