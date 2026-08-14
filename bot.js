const { Telegraf, Markup } = require('telegraf');
const db = require('./db');

const BOT_TOKEN = process.env.BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL;
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!BOT_TOKEN) {
  console.warn('[bot] BOT_TOKEN не задано в .env — бот не запуститься.');
}

const bot = new Telegraf(BOT_TOKEN || 'invalid-token');

function isAdmin(chatId) {
  return ADMIN_IDS.includes(String(chatId));
}

// Надсилає повідомлення лише якщо отримувач не вимкнув сповіщення
async function sendIfEnabled(chatId, text, extra) {
  if (!db.getNotificationsEnabled(chatId)) return;
  try {
    await bot.telegram.sendMessage(chatId, text, extra);
  } catch (err) {
    console.error(`[bot] не вдалося надіслати повідомлення ${chatId}:`, err.message);
  }
}

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  const from = ctx.from;

  if (isAdmin(chatId)) {
    await ctx.reply(
      'Вітаю, адміністраторе 👋\nВідкрийте панель, щоб створити нову заявку.',
      Markup.keyboard([
        [Markup.button.webApp('🆕 Нова заявка', `${PUBLIC_URL}/admin.html`)],
        [Markup.button.webApp('📋 Усі заявки', `${PUBLIC_URL}/requests.html?role=admin`)],
      ]).resize()
    );
    return;
  }

  // Реєструємо як потенційного виконавця
  db.upsertExecutor({
    chatId,
    firstName: from.first_name,
    lastName: from.last_name,
    username: from.username,
  });

  await ctx.reply(
    `Вітаю, ${from.first_name || ''}! Ви зареєстровані як виконавець.\nТут з'являтимуться ваші заявки.`,
    Markup.keyboard([
      [Markup.button.webApp('📋 Мої заявки', `${PUBLIC_URL}/requests.html?role=executor&executorId=${dbExecutorId(chatId)}`)],
    ]).resize()
  );
});

function dbExecutorId(chatId) {
  const ex = db.listExecutors().find((e) => e.chatId === String(chatId));
  return ex ? ex.id : '';
}

function requestSummary(request) {
  const timeStr = request.timeFrom ? `\nЧас: з ${request.timeFrom}${request.timeTo ? ' до ' + request.timeTo : ''}` : '';
  return `№${request.taskId}${timeStr}\nТехнологія: ${request.technology}\nАдреса: ${request.city}, ${request.street}${request.apt ? ', кв./під. ' + request.apt : ''}`;
}

// Відправити сповіщення про нову заявку: конкретному виконавцю, або всім, якщо виконавця не обрано
async function notifyExecutorNewRequest(request) {
  const url = `${PUBLIC_URL}/request.html?id=${request.id}`;
  const extra = Markup.inlineKeyboard([Markup.button.webApp('Відкрити заявку', url)]);

  if (request.executorId) {
    const executor = db.getExecutor(request.executorId);
    if (!executor) return;
    await sendIfEnabled(executor.chatId, `🆕 Нова заявка ${requestSummary(request)}`, extra);
    return;
  }

  // Заявка без виконавця — доступна всім, сповіщаємо кожного
  const executors = db.listExecutors();
  for (const executor of executors) {
    await sendIfEnabled(executor.chatId, `🆕 Нова заявка (для всіх) ${requestSummary(request)}`, extra);
  }
}

// Сповістити всіх адмінів, що виконавець підтвердив заявку (на перевірку)
async function notifyAdminsConfirmed(request) {
  const url = `${PUBLIC_URL}/request.html?id=${request.id}&role=admin`;
  const extra = Markup.inlineKeyboard([Markup.button.webApp('Перевірити', url)]);
  for (const adminChatId of ADMIN_IDS) {
    await sendIfEnabled(adminChatId, `✅ Заявку №${request.taskId} виконано, очікує на перевірку.`, extra);
  }
}

// Сповістити адмінів, що виконавець переніс заявку
async function notifyAdminsRescheduled(request) {
  const url = `${PUBLIC_URL}/request.html?id=${request.id}&role=admin`;
  const extra = Markup.inlineKeyboard([Markup.button.webApp('Деталі', url)]);
  for (const adminChatId of ADMIN_IDS) {
    await sendIfEnabled(
      adminChatId,
      `📅 Заявку №${request.taskId} перенесено на ${request.rescheduleDate}.${
        request.rescheduleComment ? '\nКоментар: ' + request.rescheduleComment : ''
      }`,
      extra
    );
  }
}

// Сповістити виконавця, що адмін підтвердив/повернув заявку на доопрацювання
async function notifyExecutorReview(request, approved) {
  if (!request.executorId) return; // заявка була для всіх — нема кого сповіщати персонально
  const executor = db.getExecutor(request.executorId);
  if (!executor) return;
  const url = `${PUBLIC_URL}/request.html?id=${request.id}`;
  const extra = Markup.inlineKeyboard([Markup.button.webApp('Відкрити', url)]);
  await sendIfEnabled(
    executor.chatId,
    approved
      ? `🎉 Заявку №${request.taskId} прийнято адміністратором.`
      : `↩️ Заявку №${request.taskId} повернено на доопрацювання.`,
    extra
  );
}

// Сповістити про нове повідомлення в чаті заявки
async function notifyNewMessage(request, message) {
  const chatUrl = (role) => `${PUBLIC_URL}/chat.html?id=${request.id}&role=${role}`;
  if (message.role === 'executor') {
    const extra = Markup.inlineKeyboard([Markup.button.webApp('Відповісти', chatUrl('admin'))]);
    for (const adminChatId of ADMIN_IDS) {
      await sendIfEnabled(adminChatId, `💬 Нове повідомлення по заявці №${request.taskId} від ${message.authorName}:\n${message.text}`, extra);
    }
  } else {
    if (!request.executorId) return;
    const executor = db.getExecutor(request.executorId);
    if (!executor) return;
    const extra = Markup.inlineKeyboard([Markup.button.webApp('Відповісти', chatUrl('executor'))]);
    await sendIfEnabled(executor.chatId, `💬 Нове повідомлення по заявці №${request.taskId} від адміністратора:\n${message.text}`, extra);
  }
}

module.exports = {
  bot,
  isAdmin,
  dbExecutorId,
  notifyExecutorNewRequest,
  notifyAdminsConfirmed,
  notifyAdminsRescheduled,
  notifyExecutorReview,
  notifyNewMessage,
};
