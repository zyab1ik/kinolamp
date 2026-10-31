import type {
  Action,
  Client,
  Ui,
  Diagnostics,
  Transport,
  DiagnosticData,
  JQuery,
  Lampa,
  Setting,
  SettingAction,
  Root
} from './contracts.js';

import { httpsURL } from './text.js';
export function createPlayerDiagnostics(
  Lampa: Lampa,
  $: JQuery,
  root: Root,
  client: Client,
  transport: Transport,
  diagnostics: Diagnostics,
  ui: Ui
) {
  var notify = ui.notify;
  var restore = ui.restore;
  var menu = ui.menu;
  var diagnosticWork: DiagnosticData | null | undefined = null;
  var diagnosticVideo: HTMLVideoElement | null = null;
  var diagnosticHandlers: { event: string; run: Action }[] = [];
  var diagnosticFirst = true;
  var diagnosticSample = -Infinity;
  var lastCDN = '';
  var pendingProbe: XMLHttpRequest | null = null;
  function detachDiagnosticVideo() {
    diagnosticHandlers.forEach(function (binding) {
      diagnosticVideo!.removeEventListener(binding.event, binding.run);
    });
    diagnosticHandlers = [];
    diagnosticVideo = null;
  }
  function captureDiagnostic(event: string) {
    if (!diagnostics.enabled() || !diagnosticWork) {
      return;
    }
    var data: DiagnosticData = {
      mode: diagnosticWork.mode,
      format: diagnosticWork.format
    };
    try {
      if (diagnosticVideo) {
        data.current = diagnosticVideo.currentTime;
        data.readyState = diagnosticVideo.readyState;
        data.width = diagnosticVideo.videoWidth;
        data.height = diagnosticVideo.videoHeight;
        if (
          typeof diagnosticVideo.currentSrc === 'string' &&
          diagnosticVideo.currentSrc
        ) {
          data.path =
            diagnosticVideo.currentSrc.indexOf('blob:') === 0
              ? 'mse'
              : 'direct_src';
        }
        if (typeof diagnosticVideo.canPlayType === 'function') {
          data.nativeHls = !!diagnosticVideo.canPlayType(
            'application/vnd.apple.mpegurl'
          );
        }
        var ranges = diagnosticVideo.buffered;
        if (ranges) {
          data.buffer = 0;
          for (var i = 0; i < ranges.length; i++) {
            if (
              ranges.start(i) <= data.current &&
              ranges.end(i) >= data.current
            ) {
              data.buffer = ranges.end(i) - data.current;
            }
          }
        }
      }
    } catch (_) {
      data.result = 'unsupported';
    }
    if (event === 'playing' && diagnosticFirst) {
      data.ms = Date.now() - diagnosticWork.requested!;
      diagnosticFirst = false;
    }
    diagnostics.record(event, data);
  }
  function bindDiagnosticVideo() {
    if (
      !diagnostics.enabled() ||
      !diagnosticWork ||
      !Lampa.PlayerVideo ||
      typeof Lampa.PlayerVideo.video !== 'function'
    ) {
      return;
    }
    var video = Lampa.PlayerVideo.video();
    if (video === diagnosticVideo) {
      return;
    }
    detachDiagnosticVideo();
    if (!video || !video.addEventListener || !video.removeEventListener) {
      return;
    }
    diagnosticVideo = video;
    ['playing', 'waiting', 'stalled'].forEach(function (event) {
      var run = function () {
        captureDiagnostic(event);
      };
      video!.addEventListener(event, run);
      diagnosticHandlers.push({ event: event, run: run });
    });
  }
  if (Lampa.Player.listener) {
    Lampa.Player.listener.follow('start', function (work) {
      detachDiagnosticVideo();
      diagnosticWork = work && work._kinolampDiagnostic;
      diagnosticFirst = true;
      diagnosticSample = -Infinity;
      captureDiagnostic('start');
      bindDiagnosticVideo();
    });
    Lampa.Player.listener.follow('ready', bindDiagnosticVideo);
    Lampa.Player.listener.follow('destroy', function () {
      captureDiagnostic('stop');
      detachDiagnosticVideo();
      diagnosticWork = null;
    });
  }
  if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
    Lampa.PlayerVideo.listener.follow('timeupdate', function () {
      if (
        !diagnostics.enabled() ||
        !diagnosticWork ||
        Date.now() - diagnosticSample < 5000
      ) {
        return;
      }
      diagnosticSample = Date.now();
      bindDiagnosticVideo();
      captureDiagnostic('sample');
    });
    ['pause', 'ended'].forEach(function (event) {
      Lampa.PlayerVideo.listener.follow(event, function () {
        captureDiagnostic(event);
      });
    });
    Lampa.PlayerVideo.listener.follow('error', function (event) {
      if (!diagnosticWork || !diagnostics.enabled()) {
        return;
      }
      event = event || {};
      var match =
        typeof event.error === 'string' &&
        event.error.match(/details \[([a-zA-Z]+)\]/);
      diagnostics.record('error', {
        detail: match ? match[1] : 'other',
        fatal: event.fatal
      });
    });
  }
  function clear() {
    diagnostics.clear();
    lastCDN = '';
    detachDiagnosticVideo();
    if (pendingProbe) {
      pendingProbe.abort();
      pendingProbe = null;
    }
  }
  function probeDiagnostic(kind: string) {
    if (!diagnostics.enabled()) {
      return;
    }
    var finish = diagnostics.begin('probe_' + kind);
    function done(status: number, result: string) {
      if (finish({ status: status, result: result })) {
        notify('Проверка завершена. Результат в локальном отчёте.');
      }
    }
    if (kind === 'api') {
      client.api('/types', {}, function (error) {
        done(error ? Number(error.status) || 0 : 200, error ? 'error' : 'ok');
      });
      return;
    }
    var base = String(client.get('proxy_url')).replace(/\/+$/, '');
    if (kind === 'proxy') {
      if (!httpsURL(base) || !/^https:\/\/[^/]+$/.test(base)) {
        done(0, 'not_configured');
        return;
      }
      transport('GET', base + '/health', null, {}, function (error, json) {
        done(
          error ? Number(error.status) || 0 : 200,
          !error && json!.ok === true ? 'ok' : 'error'
        );
      });
      return;
    }
    if (!lastCDN) {
      done(0, 'not_configured');
      return;
    }
    if (!root.XMLHttpRequest) {
      done(0, 'unsupported');
      return;
    }
    if (pendingProbe) {
      notify('Проверка CDN уже выполняется.');
      return;
    }
    try {
      var xhr = new root.XMLHttpRequest();
      pendingProbe = xhr;
      xhr.open('HEAD', lastCDN, true);
      xhr.timeout = 15000;
      xhr.withCredentials = false;
      var result = function (code: string) {
        if (pendingProbe === xhr) {
          pendingProbe = null;
        }
        done(Number(xhr.status) || 0, code);
      };
      xhr.onload = function () {
        result(xhr.status >= 200 && xhr.status < 400 ? 'ok' : 'error');
      };
      xhr.onerror = function () {
        result('network_or_cors');
      };
      xhr.ontimeout = function () {
        result('timeout');
      };
      xhr.onabort = function () {
        result('cancelled');
      };
      xhr.send();
    } catch (_) {
      pendingProbe = null;
      done(0, 'unsupported');
    }
  }

  function registerSettings(setting: Setting, action: SettingAction) {
    Lampa.Template.add('settings_kp_self_diagnostics', '<div></div>');
    action(
      'diagnostics',
      'Диагностика воспроизведения',
      function () {
        Lampa.Settings.create('kp_self_diagnostics', {
          onBack: function () {
            Lampa.Settings.create('kp_self_advanced');
          }
        });
      },
      true
    );
    setting(
      'diagnostics_enabled',
      'trigger',
      'Локальная диагностика',
      'До 120 событий в памяти до перезапуска. Без URL и токенов. Выключение очищает отчёт.',
      '',
      false,
      'kp_self_diagnostics'
    );
    action(
      'diagnostics_report',
      'Показать отчёт',
      function () {
        var report = diagnostics.report();
        var errors = report.events.filter(function (entry) {
          return entry.event === 'error';
        }).length;
        var waiting = report.events.filter(function (entry) {
          return entry.event === 'waiting' || entry.event === 'stalled';
        }).length;
        Lampa.Modal.open({
          title: 'Диагностика Kinolamp',
          html: $('<div></div>')
            .append(
              $('<p></p>').text(
                'Сбор ' +
                  (report.enabled ? 'включён' : 'выключен') +
                  ' · Событий: ' +
                  report.events.length +
                  ' · Ошибок: ' +
                  errors +
                  ' · Ожиданий: ' +
                  waiting +
                  '. Только эта сессия и события доступного плеера. ms — миллисекунды, buffer — запас в секундах. Отсутствие события не означает отсутствие проблемы. HEAD/CORS-проверка CDN не измеряет скорость и загрузку сегментов.'
              )
            )
            .append(
              $(
                '<pre style="white-space:pre-wrap;font-size:1em;line-height:1.5"></pre>'
              ).text(JSON.stringify(report, null, 2))
            ),
          onBack: function () {
            Lampa.Modal.close();
            restore('settings_component');
          }
        });
      },
      'kp_self_diagnostics'
    );
    action(
      'diagnostics_clear',
      'Очистить отчёт',
      function () {
        clear();
        notify('Локальный отчёт очищен.');
      },
      'kp_self_diagnostics'
    );
    action(
      'diagnostics_export',
      'Скачать отчёт JSON',
      function () {
        if (!root.document || !root.document.createElement) {
          notify(
            'Скачивание недоступно в этом плеере. Открой отчёт на экране.'
          );
          return;
        }
        var link = root.document.createElement('a');
        if (!('download' in link)) {
          notify(
            'Скачивание недоступно в этом плеере. Открой отчёт на экране.'
          );
          return;
        }
        link.href =
          'data:application/json;charset=utf-8,' +
          encodeURIComponent(JSON.stringify(diagnostics.report(), null, 2));
        link.download = 'kinolamp-diagnostics.json';
        try {
          link.click();
        } catch (_) {
          notify(
            'Скачивание недоступно в этом плеере. Открой отчёт на экране.'
          );
        }
      },
      'kp_self_diagnostics'
    );
    action(
      'diagnostics_probe',
      'Проверить доступность API / прокси / CDN',
      function () {
        if (!diagnostics.enabled()) {
          notify('Сначала включи локальную диагностику.');
          return;
        }
        menu(
          'Проверка доступности · запускается вручную',
          ['api', 'proxy', 'cdn'].map(function (kind, index) {
            return {
              title: [
                'KinoPub API',
                'Свой прокси: health',
                'Последний выбранный CDN: HEAD'
              ][index],
              run: function () {
                probeDiagnostic(kind);
              }
            };
          })
        );
      },
      'kp_self_diagnostics'
    );
  }
  function source(url: string) {
    if (diagnostics.enabled()) {
      lastCDN = url;
    }
  }
  return { clear: clear, registerSettings: registerSettings, source: source };
}
