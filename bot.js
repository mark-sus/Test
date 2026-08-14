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

const ADMIN_MENU = Markup.keyboard([
  [Markup.button.webApp('🆕 Нова заявка', `${PUBLIC_URL}/admin.html`)],
  [Markup.button.webApp('📋 Усі заявки', `${PUBLIC_URL}/requests.html?role=admin`)],
  ['➕ Додати виконавця'],
]).resize();

function executorMenu(chatId) {
  return Markup.keyboard([
    [Markup.button.webApp('📋 Мої заявки', `${PUBLIC_URL}/requests.html?role=executor&executorId=${dbExecutorId(chatId)}`)],
  ]).resize();
}

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  const from = ctx.from;

  if (isAdmin(chatId)) {
    await ctx.reply('Вітаю, адміністраторе 👋\nВідкрийте панель, щоб створити нову заявку.', ADMIN_MENU);
    return;
  }

  // Виконавцем може стати лише той, кого попередньо додав адміністратор (за юзернеймом або контактом)
  const activated = db.activatePendingExecutorByUsername(from.username, chatId, from.username || '');
  const existing = activated || db.getExecutorByChatId(chatId);

  if (!existing) {
    // Звичайний, не доданий адміном акаунт — бот не реагує
    return;
  }

  await ctx.reply(
    `Вітаю, ${existing.firstName || from.first_name || ''}! Ви зареєстровані як виконавець.\nТут з'являтимуться ваші заявки.`,
    executorMenu(chatId)
  );
});

function dbExecutorId(chatId) {
  const ex = db.listExecutors().find((e) => e.chatId === String(chatId));
  return ex ? ex.id : '';
}

// ---------- Додавання виконавців адміном ----------
// Стан для покрокового діалогу: адмін надсилає юзернейм/контакт, потім Ім'я Прізвище
const pendingAdminAdd = new Map(); // adminChatId -> { username?, contact? }

function parseFullName(text) {
  const parts = String(text).trim().split(/\s+/).filter(Boolean);
  if (parts.length < 1) return null;
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');
  return { firstName, lastName };
}

async function finishPendingAdd(ctx, pending, name) {
  const { firstName, lastName } = name;
  let executor;
  if (pending.contact) {
    executor = db.addExecutorFromContact({
      chatId: pending.contact.userId,
      username: pending.contact.username || '',
      firstName,
      lastName,
    });
    await ctx.reply(`✅ Виконавця «${firstName} ${lastName}» додано і вже активовано.`);
  } else {
    executor = db.addPendingExecutorByUsername({ username: pending.username, firstName, lastName });
    await ctx.reply(
      `✅ Виконавця «${firstName} ${lastName}» (@${executor.username}) додано.\nВін зʼявиться в списку виконавців, щойно сам натисне /start у боті.`
    );
  }
}

bot.hears('➕ Додати виконавця', async (ctx) => {
  const chatId = ctx.chat.id;
  if (!isAdmin(chatId)) return;
  pendingAdminAdd.set(chatId, {});
  await ctx.reply('Надішліть юзернейм виконавця (@username) або поділіться його контактом.');
});

bot.on('contact', async (ctx) => {
  const chatId = ctx.chat.id;
  if (!isAdmin(chatId)) return; // звичайні акаунти — бот не реагує
  const contact = ctx.message.contact;
  if (!contact || !contact.user_id) {
    await ctx.reply('Не вдалося визначити Telegram-акаунт цього контакту. Спробуйте надіслати юзернейм (@username) замість контакту.');
    return;
  }
  pendingAdminAdd.set(chatId, {
    contact: { userId: contact.user_id, username: contact.username || '' },
  });
  await ctx.reply("Введіть Ім'я та Прізвище виконавця (наприклад: Іван Петренко).");
});

bot.on('text', async (ctx) => {
  const chatId = ctx.chat.id;
  if (!isAdmin(chatId)) return; // звичайні акаунти — бот не реагує на довільний текст
  const text = ctx.message.text.trim();
  if (text.startsWith('/') || text === '➕ Додати виконавця') return;

  // Формат в одне повідомлення: "@username Ім'я Прізвище"
  const oneShot = text.match(/^@([a-zA-Z0-9_]{5,32})\s+(.+)$/);
  if (oneShot) {
    const name = parseFullName(oneShot[2]);
    if (name && name.lastName) {
      pendingAdminAdd.delete(chatId);
      await finishPendingAdd(ctx, { username: oneShot[1] }, name);
      return;
    }
  }

  const pending = pendingAdminAdd.get(chatId);

  // Крок 1: очікуємо юзернейм (після натискання кнопки "Додати виконавця")
  if (pending && !pending.username && !pending.contact) {
    if (text.startsWith('@') && text.length > 1) {
      pendingAdminAdd.set(chatId, { username: text.slice(1) });
      await ctx.reply("Введіть Ім'я та Прізвище виконавця (наприклад: Іван Петренко).");
    } else {
      await ctx.reply('Надішліть юзернейм у форматі @username або поділіться контактом.');
    }
    return;
  }

  // Крок 2: очікуємо Ім'я Прізвище
  if (pending && (pending.username || pending.contact)) {
    const name = parseFullName(text);
    if (!name || !name.lastName) {
      await ctx.reply("Вкажіть і ім'я, і прізвище одним повідомленням, наприклад: Іван Петренко");
      return;
    }
    pendingAdminAdd.delete(chatId);
    await finishPendingAdd(ctx, pending, name);
    return;
  }

  // Юзернейм окремим повідомленням без попереднього натискання кнопки
  if (text.startsWith('@') && text.length > 1) {
    pendingAdminAdd.set(chatId, { username: text.slice(1) });
    await ctx.reply("Введіть Ім'я та Прізвище виконавця (наприклад: Іван Петренко).");
  }
});

// ---------- Аватар виконавця (для списку вибору в панелі адміна) ----------
const avatarCache = new Map(); // chatId -> { url, expiresAt }
const AVATAR_TTL_MS = 10 * 60 * 1000;

async function getExecutorAvatarUrl(chatId) {
  if (!chatId) return null;
  const cached = avatarCache.get(String(chatId));
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  try {
    const photos = await bot.telegram.getUserProfilePhotos(chatId, 0, 1);
    if (!photos || !photos.total_count) {
      avatarCache.set(String(chatId), { url: null, expiresAt: Date.now() + AVATAR_TTL_MS });
      return null;
    }
    const sizes = photos.photos[0];
    const fileId = sizes[sizes.length - 1].file_id;
    const file = await bot.telegram.getFile(fileId);
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    avatarCache.set(String(chatId), { url, expiresAt: Date.now() + AVATAR_TTL_MS });
    return url;
  } catch (err) {
    console.error(`[bot] не вдалося отримати аватар ${chatId}:`, err.message);
    return null;
  }
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

  // Заявка без виконавця — доступна всім, сповіщаємо кожного (кому вже можна писати)
  const executors = db.listReachableExecutors();
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

// Надсилає сповіщення про нове повідомлення в чаті (текст або фото) з урахуванням налаштувань сповіщень
async function sendMessageNotification(chatId, request, message, replyRole, fromLabel) {
  if (!db.getNotificationsEnabled(chatId)) return;
  const chatUrl = `${PUBLIC_URL}/chat.html?id=${request.id}&role=${replyRole}`;
  const extra = Markup.inlineKeyboard([Markup.button.webApp('Відповісти', chatUrl)]);
  try {
    if (message.photoUrl) {
      const caption = `💬 Заявка №${request.taskId} від ${fromLabel}${message.text ? ':\n' + message.text : ''}`;
      await bot.telegram.sendPhoto(chatId, message.photoUrl, { caption, ...extra });
    } else {
      await bot.telegram.sendMessage(chatId, `💬 Нове повідомлення по заявці №${request.taskId} від ${fromLabel}:\n${message.text}`, extra);
    }
  } catch (err) {
    console.error(`[bot] не вдалося надіслати повідомлення ${chatId}:`, err.message);
  }
}

// Сповістити про нове повідомлення в чаті заявки
async function notifyNewMessage(request, message) {
  if (message.role === 'executor') {
    for (const adminChatId of ADMIN_IDS) {
      await sendMessageNotification(adminChatId, request, message, 'admin', message.authorName);
    }
  } else {
    if (!request.executorId) return;
    const executor = db.getExecutor(request.executorId);
    if (!executor || !executor.chatId) return;
    await sendMessageNotification(executor.chatId, request, message, 'executor', 'адміністратора');
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
  getExecutorAvatarUrl,
};
