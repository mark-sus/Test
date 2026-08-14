// Спільні хелпери для сторінок вебдодатку: кнопка "Назад" і перемикач сповіщень.
window.AppCommon = (function () {
  function tg() {
    return window.Telegram?.WebApp;
  }

  function goBack(fallbackHref) {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    const t = tg();
    if (t) {
      t.close();
    } else if (fallbackHref) {
      window.location.href = fallbackHref;
    }
  }

  // Синхронізує апаратну кнопку "Назад" Telegram із тією ж логікою
  function initTelegramBackButton(fallbackHref) {
    const t = tg();
    if (t?.BackButton) {
      t.BackButton.show();
      t.BackButton.onClick(() => goBack(fallbackHref));
    }
  }

  // Створює видиму кнопку "← Назад" (для звичайного браузера й для наочності в Telegram)
  function renderBackButton(fallbackHref) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'back-btn';
    btn.textContent = '← Назад';
    btn.addEventListener('click', () => goBack(fallbackHref));
    return btn;
  }

  function currentChatId() {
    return tg()?.initDataUnsafe?.user?.id ? String(tg().initDataUnsafe.user.id) : null;
  }

  // Додає перемикач сповіщень у контейнер, якщо сторінка відкрита всередині Telegram
  async function renderNotifToggle(container, apiFetch) {
    const chatId = currentChatId();
    if (!chatId) return; // відкрито поза Telegram — немає кого ідентифікувати

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notif-toggle';
    container.appendChild(btn);

    function paint(enabled) {
      btn.textContent = enabled ? '🔔 Сповіщення' : '🔕 Вимкнено';
      btn.classList.toggle('muted', !enabled);
      btn.dataset.enabled = enabled ? '1' : '0';
    }

    try {
      const s = await apiFetch(`/api/settings/${chatId}`);
      paint(s.notificationsEnabled);
    } catch (e) {
      paint(true);
    }

    btn.addEventListener('click', async () => {
      const nowEnabled = btn.dataset.enabled === '1';
      try {
        const s = await apiFetch(`/api/settings/${chatId}`, {
          method: 'POST',
          body: JSON.stringify({ notificationsEnabled: !nowEnabled }),
        });
        paint(s.notificationsEnabled);
      } catch (e) {
        // ігноруємо — залишаємо попередній стан кнопки
      }
    });
  }

  return { goBack, initTelegramBackButton, renderBackButton, renderNotifToggle, currentChatId };
})();
