
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('./db');
const {
  bot,
  isAdmin,
  notifyExecutorNewRequest,
  notifyAdminsConfirmed,
  notifyAdminsRescheduled,
  notifyExecutorReview,
  notifyNewMessage,
  getExecutorAvatarUrl,
} = require('./bot');

const PORT = process.env.PORT || 3000;
const VERIFY_INIT_DATA = process.env.VERIFY_INIT_DATA === 'true';
const PUBLIC_URL = process.env.PUBLIC_URL || '';

// Каталог для фото, надісланих у чаті заявки

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 8) || '.jpg';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new Error('Дозволені лише зображення'));
    }
    cb(null, true);
  },
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// перевірка підпису Telegram WebApp initData 
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
      if (VERIFY_INIT_DATA) return res.status(401).json({ error: 'invalid init data' });
    }
  }
  next();
});

// Дістає chat_id користувача

function getChatIdFromReq(req) {
  const initData = req.header('X-Telegram-Init-Data');
  if (!initData) return null;
  try {
    const params = new URLSearchParams(initData);
    const user = JSON.parse(params.get('user') || '{}');
    return user.id ? String(user.id) : null;
  } catch {
    return null;
  }
}

// ---------- API: виконавці ----------

app.get('/api/executors', (req, res) => {
  const executors = db.listExecutors().map((e) => ({
    id: e.id,
    firstName: e.firstName || '',
    lastName: e.lastName || '',
    username: e.username || '',
    pending: !e.chatId, // ще не натискав /start у боті
    name: [e.firstName, e.lastName].filter(Boolean).join(' ') || e.username || e.chatId,
  }));
  res.json(executors);
});

// Аватар виконавця
app.get('/api/executors/:id/avatar', async (req, res) => {
  try {
    const executor = db.getExecutor(req.params.id);
    if (!executor || !executor.chatId) return res.status(404).end();
    const url = await getExecutorAvatarUrl(executor.chatId);
    if (!url) return res.status(404).end();
    const r = await fetch(url);
    if (!r.ok) return res.status(404).end();
    res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=600');
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (err) {
    res.status(404).end();
  }
});

// ---------- API: заявки ----------

app.post('/api/requests', async (req, res) => {
  try {
    const b = req.body;
    if (!b.taskId && !b.orderId && !b.clientId && !b.street) {
      return res.status(400).json({ error: 'Заповніть хоча б одне поле заявки' });
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

// Перевірка дублікатів ID завдання / ID наряда під час заповнення форми створення заявки
app.get('/api/requests/check-duplicate', (req, res) => {
  const { taskId, orderId } = req.query;
  const result = {};
  if (taskId) {
    const existing = db.findRequestByTaskId(taskId);
    if (existing) result.taskId = { id: existing.id, status: existing.status };
  }
  if (orderId) {
    const existing = db.findRequestByOrderId(orderId);
    if (existing) result.orderId = { id: existing.id, status: existing.status };
  }
  res.json(result);
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

// Адмін підтверджує заявку після перевірки
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

// Адмін видаляє заявку
app.delete('/api/requests/:id', (req, res) => {
  const chatId = getChatIdFromReq(req);
  if (VERIFY_INIT_DATA && (!chatId || !isAdmin(chatId))) {
    return res.status(403).json({ error: 'лише адміністратор може видаляти заявки' });
  }
  const deleted = db.deleteRequest(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// Виконавець бере в роботу заявку без призначеного виконавця
app.post('/api/requests/:id/claim', (req, res) => {
  const { executorId } = req.body;
  if (!executorId) return res.status(400).json({ error: 'executorId required' });
  const existing = db.getRequest(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (existing.executorId && existing.executorId !== executorId) {
    return res.status(409).json({ error: 'заявку вже взяв інший виконавець' });
  }
  const request = db.updateRequest(req.params.id, { executorId });
  res.json(request);
});

// ---------- API: чат по заявці ----------

app.get('/api/requests/:id/messages', (req, res) => {
  const request = db.getRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'not found' });
  res.json(db.listMessages(req.params.id));
});

app.post('/api/requests/:id/messages', async (req, res) => {
  const request = db.getRequest(req.params.id);
  if (!request) return res.status(404).json({ error: 'not found' });
  const { role, authorName, text } = req.body;
  if (!role || !['admin', 'executor'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
  const message = db.addMessage(req.params.id, { role, authorName, text: text.trim() });
  try {
    await notifyNewMessage(request, message);
  } catch (e) {
    console.error('[notify]', e.message);
  }
  res.json(message);
});

// Надіслати фото в чат заявки
app.post('/api/requests/:id/messages/photo', (req, res) => {
  upload.single('photo')(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message || 'Помилка завантаження фото' });
    try {
      const request = db.getRequest(req.params.id);
      if (!request) return res.status(404).json({ error: 'not found' });
      const { role, authorName, text } = req.body;
      if (!role || !['admin', 'executor'].includes(role)) return res.status(400).json({ error: 'invalid role' });
      if (!req.file) return res.status(400).json({ error: 'photo required' });
      const photoUrl = `${PUBLIC_URL}/uploads/${req.file.filename}`;
      const message = db.addMessage(req.params.id, { role, authorName, text: (text || '').trim(), photoUrl });
      try {
        await notifyNewMessage(request, message);
      } catch (e) {
        console.error('[notify]', e.message);
      }
      res.json(message);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'server error' });
    }
  });
});

// ---------- API: налаштування сповіщень ----------

app.get('/api/settings/:chatId', (req, res) => {
  res.json({ notificationsEnabled: db.getNotificationsEnabled(req.params.chatId) });
});

app.post('/api/settings/:chatId', (req, res) => {
  const { notificationsEnabled } = req.body;
  const value = db.setNotificationsEnabled(req.params.chatId, !!notificationsEnabled);
  res.json({ notificationsEnabled: value });
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
