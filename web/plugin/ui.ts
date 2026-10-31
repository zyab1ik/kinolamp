import type { Action, PluginError, MenuEntry, Lampa } from './contracts.js';

import { escapeText } from './text.js';
export function createUi(Lampa: Lampa) {
  function notify(message: string) {
    Lampa.Noty.show(message);
  }
  function restore(name?: string) {
    if (name) {
      Lampa.Controller.toggle(name);
    }
  }
  function menu(title: string, entries: MenuEntry[], back?: Action | null) {
    var previous = (Lampa.Controller.enabled() || {}).name;
    Lampa.Select.show({
      title: escapeText(title),
      items: entries.map(function (entry) {
        return {
          title: escapeText(entry.title),
          subtitle: escapeText(entry.subtitle || ''),
          run: entry.run
        };
      }),
      // Native Select hides before onSelect, and close() itself invokes onBack.
      onSelect: function (item) {
        item.run();
      },
      onBack: function () {
        if (back) {
          back();
        } else {
          restore(previous);
        }
      }
    });
  }
  function errorMessage(error?: PluginError | null) {
    if (error && error.code === 'invalid_client') {
      return 'KinoPub временно не принимает общий клиент. Повтори вход позже или проверь обновления Kinolamp.';
    }
    if (error && (error.code === 'login_required' || error.status === 401)) {
      return 'Нужна авторизация: Настройки → Kinolamp → Войти.';
    }
    return 'Запрос не выполнен. Проверь сеть, подписку и настройки. Подробные данные не отправляются в логи.';
  }

  return {
    notify: notify,
    restore: restore,
    menu: menu,
    errorMessage: errorMessage
  };
}
