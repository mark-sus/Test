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

// Відправити виконавцю сповіщення про нову заявку з кнопкою відкрити деталі
async function notifyExecutorNewRequest(request) {
  const executor = db.getExecutor(request.executorId);
  if (!executor) return;
  const url = `${PUBLIC_URL}/request.html?id=${request.id}`;
  const timeStr = request.timeFrom ? `\nЧас: з ${request.timeFrom}${request.timeTo ? ' до ' + request.timeTo : ''}` : '';
  await bot.telegram.sendMessage(
    executor.chatId,
    `🆕 Нова заявка №${request.taskId}${timeStr}\nТехнологія: ${request.technology}\nАдреса: ${request.city}, ${request.street}${request.apt ? ', кв./під. ' + request.apt : ''}`,
    Markup.inlineKeyboard([Markup.button.webApp('Відкрити заявку', url)])
  );
}

// Сповістити всіх адмінів, що виконавець підтвердив заявку (на перевірку)
async function notifyAdminsConfirmed(request) {
  const url = `${PUBLIC_URL}/request.html?id=${request.id}&role=admin`;
  for (const adminChatId of ADMIN_IDS) {
    await bot.telegram.sendMessage(
      adminChatId,
      `✅ Заявку №${request.taskId} виконано, очікує на перевірку.`,
      Markup.inlineKeyboard([Markup.button.webApp('Перевірити', url)])
    );
  }
}

// Сповістити адмінів, що виконавець переніс заявку
async function notifyAdminsRescheduled(request) {
  const url = `${PUBLIC_URL}/request.html?id=${request.id}&role=admin`;
  for (const adminChatId of ADMIN_IDS) {
    await bot.telegram.sendMessage(
      adminChatId,
      `📅 Заявку №${request.taskId} перенесено на ${request.rescheduleDate}.${
        request.rescheduleComment ? '\nКоментар: ' + request.rescheduleComment : ''
      }`,
      Markup.inlineKeyboard([Markup.button.webApp('Деталі', url)])
    );
  }
}

// Сповістити виконавця, що адмін підтвердив/повернув заявку на доопрацювання
async function notifyExecutorReview(request, approved) {
  const executor = db.getExecutor(request.executorId);
  if (!executor) return;
  const url = `${PUBLIC_URL}/request.html?id=${request.id}`;
  await bot.telegram.sendMessage(
    executor.chatId,
    approved
      ? `🎉 Заявку №${request.taskId} прийнято адміністратором.`
      : `↩️ Заявку №${request.taskId} повернено на доопрацювання.`,
    Markup.inlineKeyboard([Markup.button.webApp('Відкрити', url)])
  );
}

module.exports = {
  bot,
  isAdmin,
  dbExecutorId,
  notifyExecutorNewRequest,
  notifyAdminsConfirmed,
  notifyAdminsRescheduled,
  notifyExecutorReview,
};
