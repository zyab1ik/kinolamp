import { VERSION, PREFIX } from './config.js';
import icon from '../static/icon.svg';
export function installSettings(
  Lampa,
  client,
  authorization,
  playback,
  catalog,
  playerDiagnostics,
  ui
) {
  var notify = ui.notify;
  var menu = ui.menu;
  Lampa.SettingsApi.addComponent({
    component: 'kp_self',
    name: 'Kinolamp',
    icon: icon
  });
  Lampa.Template.add('settings_kp_self_advanced', '<div></div>');
  function setting(key, type, name, description, values, initial, advanced) {
    Lampa.SettingsApi.addParam({
      component:
        typeof advanced === 'string'
          ? advanced
          : advanced
            ? 'kp_self_advanced'
            : 'kp_self',
      param: {
        name: PREFIX + key,
        type: type,
        placeholder: 'Не задано',
        values: values || '',
        default: initial
      },
      field: { name: name, description: description },
      onChange: function () {
        if (key === 'diagnostics_enabled') {
          playerDiagnostics.clear();
        }
        Lampa.Settings.update();
      },
      onRender: function (item) {
        if (
          type === 'input' &&
          client.get('proxy_enabled') !== true &&
          client.get('proxy_enabled') !== 'true'
        ) {
          item.hide().removeClass('selector');
        }
      }
    });
  }
  function action(key, name, run, advanced) {
    Lampa.SettingsApi.addParam({
      component:
        typeof advanced === 'string'
          ? advanced
          : advanced
            ? 'kp_self_advanced'
            : 'kp_self',
      param: { name: PREFIX + key, type: 'button' },
      field: { name: name },
      onChange: run,
      onRender: function (item) {
        if (
          (key === 'login' && client.hasToken()) ||
          (key === 'logout' && !client.hasToken())
        ) {
          item.hide().removeClass('selector');
        }
      }
    });
  }
  setting(
    'quality',
    'select',
    'Максимальное качество',
    'Лучшее доступное качество в пределах выбранного значения.',
    { 480: '480p', 720: '720p', 1080: '1080p', 2160: '2160p' },
    '1080'
  );
  setting(
    'proxy_enabled',
    'trigger',
    'Использовать свой HLS-прокси',
    'Включай только при проблемах воспроизведения HLS на телевизоре.',
    '',
    false,
    true
  );
  setting(
    'proxy_url',
    'input',
    'HTTPS-адрес своего HLS-прокси',
    'Адрес твоего сервера без завершающего пути.',
    '',
    '',
    true
  );
  setting(
    'proxy_token',
    'input',
    'Ключ своего HLS-прокси',
    'Ключ доступа к твоему прокси. Минимум 32 символа.',
    '',
    '',
    true
  );
  action('login', 'Войти в KinoPub', function () {
    authorization.login(function () {
      Lampa.Settings.update();
    });
  });
  action('logout', 'Выйти из KinoPub', authorization.logout);
  action('advanced', 'Дополнительно', function () {
    Lampa.Settings.create('kp_self_advanced', {
      onBack: function () {
        Lampa.Settings.create('kp_self');
      }
    });
  });
  action('catalog', 'Открыть каталог KinoPub', catalog.open, true);

  playerDiagnostics.registerSettings(setting, action);
  action('privacy', 'О плагине и приватности', function () {
    notify(
      'Kinolamp ' +
        VERSION +
        ': без телеметрии и облачной синхронизации. Токены на устройстве. HLS-прокси получает только ссылку на поток.'
    );
  });
  action(
    'reset_progress',
    'Сбросить весь прогресс Kinolamp',
    function () {
      menu('Сбросить локальный прогресс?', [
        {
          title: 'Удалить прогресс Kinolamp',
          run: function () {
            playback.resetProgress();
          }
        }
      ]);
    },
    true
  );
}
