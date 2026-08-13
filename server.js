require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const path = require('path');
const db = require('./db');
const {
  bot,
  isAdmin,
  notifyExecutorNewRequest,
  notifyAdminsConfirmed,
  notifyAdminsRescheduled,
  notifyExecutorReview,
} = require('./bot');

const PORT = process.env.PORT || 3000;
const VERIFY_INIT_DATA = process.env.VERIFY_INIT_DATA === 'true';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- (опційна) перевірка підпису Telegram WebApp initData ----------
// Документація: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
function verifyInitData(initData) {
  if (!VERIFY_INIT_DATA) return true;
  if (!initData) return false;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  return computedHash === hash;
}

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const initData = req.header('X-Telegram-Init-Data');
    if (!verifyInitData(initData)) {
      // У режимі розробки (VERIFY_INIT_DATA=false) пропускаємо без перевірки
      if (VERIFY_INIT_DATA) return res.status(401).json({ error: 'invalid init data' });
    }
  }
  next();
});

// ---------- API: виконавці ----------

app.get('/api/executors', (req, res) => {
  const executors = db.listExecutors().map((e) => ({
    id: e.id,
    name: [e.firstName, e.lastName].filter(Boolean).join(' ') || e.username || e.chatId,
  }));
  res.json(executors);
});

// ---------- API: заявки ----------

app.post('/api/requests', async (req, res) => {
  try {
    const b = req.body;
    const required = ['taskId', 'timeFrom', 'timeTo', 'orderId', 'technology', 'street', 'phone', 'clientId', 'executorId'];
    for (const field of required) {
      if (!b[field]) return res.status(400).json({ error: `Поле "${field}" обов'язкове` });
    }
    const request = db.createRequest(b);
    try {
      await notifyExecutorNewRequest(request);
    } catch (notifyErr) {
      console.error('[notify] не вдалося надіслати повідомлення виконавцю:', notifyErr.message);
    }
    res.json(request);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/requests', (req, res) => {
  const { executorId, status } = req.query;
  const requests = executorId ? db.listRequestsForExecutor(executorId, status) : db.listAllRequests(status);
  res.json(requests);
});

app.get('/api/requests/:id', (req, res) => {
  const request = db.getRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'not found' });
  const executor = db.getExecutor(request.executorId);
  res.json({ ...request, executorName: executor ? [executor.firstName, executor.lastName].filter(Boolean).join(' ') : '' });
});

// Виконавець підтверджує виконання -> заявка йде на перевірку адміну
app.post('/api/requests/:id/confirm', async (req, res) => {
  const request = db.updateRequest(req.params.id, { status: 'pending_review' });
  if (!request) return res.status(404).json({ error: 'not found' });
  try { await notifyAdminsConfirmed(request); } catch (e) { console.error('[notify]', e.message); }
  res.json(request);
});

// Виконавець переносить заявку на інший день
app.post('/api/requests/:id/reschedule', async (req, res) => {
  const { date, comment } = req.body;
  if (!date) return res.status(400).json({ error: 'date required' });
  const request = db.updateRequest(req.params.id, {
    status: 'rescheduled',
    rescheduleDate: date,
    rescheduleComment: comment || null,
  });
  if (!request) return res.status(404).json({ error: 'not found' });
  try { await notifyAdminsRescheduled(request); } catch (e) { console.error('[notify]', e.message); }
  res.json(request);
});

// Адмін підтверджує (закриває) заявку після перевірки
app.post('/api/requests/:id/approve', async (req, res) => {
  const request = db.updateRequest(req.params.id, { status: 'approved' });
  if (!request) return res.status(404).json({ error: 'not found' });
  try { await notifyExecutorReview(request, true); } catch (e) { console.error('[notify]', e.message); }
  res.json(request);
});

// Адмін повертає заявку виконавцю на доопрацювання
app.post('/api/requests/:id/reject', async (req, res) => {
  const request = db.updateRequest(req.params.id, { status: 'new' });
  if (!request) return res.status(404).json({ error: 'not found' });
  try { await notifyExecutorReview(request, false); } catch (e) { console.error('[notify]', e.message); }
  res.json(request);
});

app.listen(PORT, () => {
  console.log(`[server] Вебдодаток слухає на порту ${PORT}`);
});

if (process.env.BOT_TOKEN) {
  bot.launch();
  console.log('[bot] Telegram-бот запущено');
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
} else {
  console.warn('[bot] BOT_TOKEN не задано — бот не запущено, працює лише вебсервер.');
}
