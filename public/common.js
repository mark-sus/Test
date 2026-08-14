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

  // Форматує рядок цифр у маску +380 (XX) XXX-XX-XX
  function formatUaPhone(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (digits.startsWith('380')) digits = digits.slice(3);
    else if (digits.startsWith('0')) digits = digits.slice(1);
    digits = digits.slice(0, 9); // 9 цифр після коду країни

    let out = '+380';
    if (digits.length > 0) out += ' (' + digits.slice(0, 2);
    if (digits.length >= 2) out += ')';
    if (digits.length > 2) out += ' ' + digits.slice(2, 5);
    if (digits.length > 5) out += '-' + digits.slice(5, 7);
    if (digits.length > 7) out += '-' + digits.slice(7, 9);
    return out;
  }

  // Повертає лише цифри (з кодом країни 380...) — зручно для href="tel:" та збереження в БД
  function digitsUaPhone(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (digits.startsWith('380')) return digits;
    if (digits.startsWith('0')) return '380' + digits.slice(1);
    return digits ? '380' + digits : '';
  }

  // Навішує живу маску +380 (XX) XXX-XX-XX на поле вводу телефону
  function attachPhoneMask(input) {
    if (!input) return;
    input.setAttribute('inputmode', 'tel');
    input.setAttribute('maxlength', '19'); // довжина повністю відформатованого рядка
    input.addEventListener('focus', () => {
      if (!input.value) input.value = '+380 (';
    });
    input.addEventListener('input', () => {
      const formatted = formatUaPhone(input.value);
      input.value = formatted;
      // курсор завжди в кінці — простий і надійний варіант для мобільного вводу цифр
      input.setSelectionRange(formatted.length, formatted.length);
    });
    input.addEventListener('blur', () => {
      // якщо користувач нічого не ввів по суті — не лишаємо голий "+380 ("
      if (input.value.replace(/\D/g, '') === '380' || input.value.replace(/\D/g, '') === '') {
        input.value = '';
      }
    });
  }

  return {
    goBack,
    initTelegramBackButton,
    renderBackButton,
    renderNotifToggle,
    currentChatId,
    formatUaPhone,
    digitsUaPhone,
    attachPhoneMask,
  };
})();

