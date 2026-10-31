/* Kinolamp 0.4.1 — MIT. Generated from web/plugin/index.ts; edit sources and run make build-plugin. */
(function (root, factory) {
  'use strict';
  var plugin = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = plugin;
  } else if (root.Lampa && !root.kinolampInstalled) {
    root.kinolampInstalled = true;
    plugin.install(root.Lampa, root.jQuery || root.$, root);
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var plugin = (function () {
    'use strict';

    var VERSION = '0.4.1';
    var API = 'https://api.service-kp.com';
    var PREFIX = 'kp_self_';
    // Shared xbmc client distributed by open-source KinoPub clients; not an account token.
    var CLIENT_ID = 'xbmc';
    var CLIENT_SECRET = 'cgg3gtifu46urtfp2zp1nqtba0k2ezxh';

    function escapeText(value) {
      return String(value == null ? '' : value).replace(
        /[&<>"']/g,
        function (char) {
          return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
          }[char];
        }
      );
    }
    function encodeForm(values) {
      return Object.keys(values)
        .map(function (key) {
          return (
            encodeURIComponent(key) +
            '=' +
            encodeURIComponent(String(values[key]))
          );
        })
        .join('&');
    }
    function httpsURL(raw) {
      // ES5-compatible validation. No URL constructor required on older televisions.
      // eslint-disable-next-line no-control-regex -- Reject control characters in stream URLs.
      if (typeof raw !== 'string' || /[\s\\\u0000-\u001f\u007f]/.test(raw)) {
        return false;
      }
      return /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?(?:[/?][^#]*)?$/i.test(
        raw
      );
    }

    // Transport is injected to test OAuth without credentials or real network calls.
    function createClient(storage, transport) {
      var refreshing = false;
      var waiting = [];
      // Logout invalidates pending requests and token refreshes.
      var generation = 0;
      function get(key) {
        return storage.get(PREFIX + key, '') || '';
      }
      function set(key, value) {
        storage.set(PREFIX + key, value);
      }
      function save(json, expected) {
        if (
          expected !== generation ||
          !json ||
          typeof json.access_token !== 'string' ||
          !json.access_token
        ) {
          return false;
        }
        set('access', json.access_token);
        if (typeof json.refresh_token === 'string' && json.refresh_token) {
          set('refresh', json.refresh_token);
        }
        return true;
      }
      function logout() {
        generation++;
        set('access', '');
        set('refresh', '');
      }
      function oauth(path, grant, done) {
        grant.client_id = CLIENT_ID;
        grant.client_secret = CLIENT_SECRET;
        transport(
          'POST',
          API + path,
          encodeForm(grant),
          { 'Content-Type': 'application/x-www-form-urlencoded' },
          done
        );
      }
      function refresh(done) {
        if (!get('refresh')) {
          done({ code: 'login_required' });
          return;
        }
        waiting.push(done);
        if (refreshing) {
          return;
        }
        refreshing = true;
        var expected = generation;
        oauth(
          '/oauth2/token',
          { grant_type: 'refresh_token', refresh_token: get('refresh') },
          function (error, json) {
            if (!error && !save(json, expected)) {
              error = { code: 'session_changed' };
            }
            if (
              error &&
              expected === generation &&
              (error.status === 400 || error.status === 401)
            ) {
              logout();
            }
            refreshing = false;
            var callbacks = waiting;
            waiting = [];
            callbacks.forEach(function (callback) {
              callback(error);
            });
          }
        );
      }
      function api(path, params, done, retried, post) {
        if (!get('access')) {
          done({ code: 'login_required' });
          return;
        }
        var expected = generation;
        var query = encodeForm(params || {});
        var headers = {
          Authorization: 'Bearer ' + get('access')
        };
        if (post) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        transport(
          post ? 'POST' : 'GET',
          API + '/v1' + path + (!post && query ? '?' + query : ''),
          post ? query : null,
          headers,
          function (error, json) {
            if (generation !== expected) {
              done({ code: 'session_changed' });
              return;
            }
            if (error && error.status === 401 && !retried) {
              refresh(function (refreshError) {
                if (refreshError) {
                  done(refreshError);
                } else {
                  api(path, params, done, true, post);
                }
              });
            } else {
              done(error, json);
            }
          }
        );
      }
      return {
        get: get,
        set: set,
        api: api,
        oauth: oauth,
        logout: logout,
        hasToken: function () {
          return !!get('access');
        },
        generation: function () {
          return generation;
        },
        saveTokens: save,
        notifyDevice: function (info, done) {
          api('/device/notify', info, done, false, true);
        }
      };
    }

    function createProgress(storage) {
      var key = PREFIX + 'progress';
      function records() {
        var data = storage.get(key, {});
        return data && typeof data === 'object' && !Array.isArray(data)
          ? data
          : {};
      }
      function write(data) {
        try {
          storage.set(key, data);
        } catch (_) {
          /* A full local store must not stop playback. */
        }
      }
      function get(id) {
        var entry = records()[id];
        return entry &&
          typeof entry.time === 'number' &&
          isFinite(entry.time) &&
          entry.time > 0 &&
          typeof entry.duration === 'number' &&
          isFinite(entry.duration) &&
          entry.duration > 0
          ? entry
          : null;
      }
      function save(id, time, duration, ended) {
        if (
          !id ||
          typeof time !== 'number' ||
          !isFinite(time) ||
          time < 0 ||
          typeof duration !== 'number' ||
          !isFinite(duration) ||
          duration <= 0
        ) {
          return;
        }
        var data = records();
        time = Math.min(time, duration);
        data[id] = {
          time: time,
          duration: duration,
          watched: !!ended || time / duration >= 0.95,
          updated: Date.now()
        };
        var ids = Object.keys(data).sort(function (a, b) {
          return data[b].updated - data[a].updated;
        });
        ids
          .filter(function (old) {
            return old !== id;
          })
          .slice(499)
          .forEach(function (old) {
            delete data[old];
          });
        write(data);
      }
      function clear(id) {
        var data = records();
        if (id) {
          delete data[id];
        } else {
          data = {};
        }
        write(data);
      }
      function label(id) {
        var entry = get(id);
        return entry
          ? entry.watched
            ? 'Просмотрено'
            : 'Продолжить с ' +
              Math.floor(entry.time / 60) +
              ':' +
              ('0' + Math.floor(entry.time % 60)).slice(-2)
          : '';
      }
      return { get: get, save: save, clear: clear, label: label };
    }

    // Diagnostics is an allowlist, not a scrubber: arbitrary URLs, messages, titles
    // and request/response objects can never enter the report, even as nested fields.
    function createDiagnostics(storage, now) {
      var entries = [];
      var generation = 0;
      var started = now();
      var events = [
        'api',
        'proxy',
        'source',
        'prepare',
        'start',
        'playing',
        'waiting',
        'stalled',
        'sample',
        'pause',
        'ended',
        'error',
        'stop',
        'probe_api',
        'probe_proxy',
        'probe_cdn'
      ];
      var details = [
        'fragLoadError',
        'fragLoadTimeOut',
        'manifestLoadError',
        'manifestLoadTimeOut',
        'manifestParsingError',
        'levelLoadError',
        'levelLoadTimeOut',
        'bufferStalledError',
        'bufferFullError',
        'bufferAppendError',
        'other'
      ];
      function enabled() {
        var value = storage.get(PREFIX + 'diagnostics_enabled', false);
        return value === true || value === 'true';
      }
      function record(event, data) {
        if (!enabled() || events.indexOf(event) === -1) {
          return;
        }
        data = data || {};
        var entry = {
          event: event,
          at: Math.max(0, now() - started)
        };
        [
          'ms',
          'status',
          'current',
          'buffer',
          'readyState',
          'width',
          'height'
        ].forEach(function (key) {
          var value = data[key];
          if (
            typeof value === 'number' &&
            isFinite(value) &&
            value >= 0 &&
            value <= 86400000
          ) {
            entry[key] = Math.round(value * 100) / 100;
          }
        });
        if (['direct', 'proxy'].indexOf(data.mode) !== -1) {
          entry.mode = data.mode;
        }
        if (['hls2', 'hls4', 'hls', 'http'].indexOf(data.format) !== -1) {
          entry.format = data.format;
        }
        if (['mse', 'direct_src'].indexOf(data.path) !== -1) {
          entry.path = data.path;
        }
        if (typeof data.nativeHls === 'boolean') {
          entry.nativeHls = data.nativeHls;
        }
        if (
          [
            'ok',
            'error',
            'timeout',
            'network_or_cors',
            'not_configured',
            'unsupported',
            'cancelled'
          ].indexOf(data.result) !== -1
        ) {
          entry.result = data.result;
        }
        if (details.indexOf(data.detail) !== -1) {
          entry.detail = data.detail;
        }
        if (typeof data.fatal === 'boolean') {
          entry.fatal = data.fatal;
        }
        entries.push(entry);
        if (entries.length > 120) {
          entries.shift();
        }
        return true;
      }
      function begin(event) {
        var time = now();
        var current = generation;
        var collecting = enabled();
        return function (data) {
          if (!collecting || current !== generation) {
            return;
          }
          return record(event, {
            ms: Math.max(0, now() - time),
            status: data.status,
            result: data.result
          });
        };
      }
      return {
        enabled: enabled,
        record: record,
        begin: begin,
        clear: function () {
          entries = [];
          generation++;
          started = now();
        },
        report: function () {
          return JSON.parse(
            JSON.stringify({
              schema: 1,
              version: VERSION,
              enabled: enabled(),
              scope: 'local-session-last-120-events',
              events: entries
            })
          );
        }
      };
    }

    function createTransport(Lampa, diagnostics) {
      function transport(method, url, body, headers, done) {
        var complete = done;
        var finish = diagnostics.begin(
          url.indexOf(API + '/v1/') === 0
            ? 'api'
            : url.indexOf('/api/manifests') !== -1
              ? 'proxy'
              : ''
        );
        done = function (error, json) {
          finish({
            status: error ? Number(error.status) || 0 : 200,
            result: error ? 'error' : 'ok'
          });
          complete(error, json);
        };
        var request = new Lampa.Reguest();
        request.timeout(15000);
        request.silent(
          url,
          function (json) {
            if (typeof json === 'string') {
              try {
                json = JSON.parse(json);
              } catch (_) {
                done({ code: 'bad_response' });
                return;
              }
            }
            if (!json || typeof json !== 'object') {
              done({ code: 'bad_response' });
              return;
            }
            if (json.error) {
              done({ code: String(json.error) });
              return;
            }
            done(null, json);
          },
          function (xhr) {
            var code = 'network_error';
            try {
              code = JSON.parse(xhr.responseText).error || code;
            } catch (_) {
              // Keep the generic error when upstream did not return JSON.
            }
            done({ status: xhr && xhr.status, code: code });
          },
          method === 'POST' ? body : false,
          { headers: headers }
        );
      }
      return transport;
    }

    function createUi(Lampa) {
      function notify(message) {
        Lampa.Noty.show(message);
      }
      function restore(name) {
        if (name) {
          Lampa.Controller.toggle(name);
        }
      }
      function menu(title, entries, back) {
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
      function errorMessage(error) {
        if (error && error.code === 'invalid_client') {
          return 'KinoPub временно не принимает общий клиент. Повтори вход позже или проверь обновления Kinolamp.';
        }
        if (
          error &&
          (error.code === 'login_required' || error.status === 401)
        ) {
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

    function createAuthorization(Lampa, $, client, ui) {
      var notify = ui.notify;
      var restore = ui.restore;
      var errorMessage = ui.errorMessage;
      var pendingLogin = null;
      function updateDevice() {
        if (!client.hasToken()) {
          return;
        }
        var platform =
          Lampa.Platform && typeof Lampa.Platform.get === 'function'
            ? Lampa.Platform.get()
            : '';
        client.notifyDevice(
          {
            title: 'Kinolamp / Lampa',
            hardware: String(platform || 'Lampa'),
            software: 'Kinolamp ' + VERSION
          },
          function () {}
        );
      }
      updateDevice();
      function stopLogin() {
        if (!pendingLogin) {
          return;
        }
        clearTimeout(pendingLogin.timer);
        pendingLogin.cancelled = true;
        pendingLogin = null;
      }
      function login(done) {
        if (pendingLogin) {
          return;
        }
        var state = {
          cancelled: false,
          timer: null,
          generation: client.generation()
        };
        pendingLogin = state;
        client.oauth(
          '/oauth2/device',
          { grant_type: 'device_code' },
          function (error, json) {
            if (state.cancelled) {
              return;
            }
            if (error || !json.code || !json.user_code) {
              stopLogin();
              notify(errorMessage(error));
              return;
            }
            var pollInterval = Math.max(Number(json.interval) || 5, 5) * 1000;
            var expiresAt =
              Date.now() +
              Math.min(Number(json.expires_in) || 600, 3600) * 1000;
            var previous = (Lampa.Controller.enabled() || {}).name;
            var content = $('<div></div>');
            var verification =
              /^https:\/\/(?:kino\.pub|kino\.watch)\/device\/?$/.test(
                json.verification_uri
              )
                ? json.verification_uri
                : 'https://kino.pub/device';
            content.append(
              $('<p></p>').text(
                '1. Открой на телефоне или в другой вкладке: ' + verification
              )
            );
            content.append($('<h1></h1>').text(String(json.user_code)));
            content.append(
              $('<p></p>').text(
                '2. Войди в аккаунт KinoPub, введи этот код в поле «Код устройства» и нажми «Добавить».'
              )
            );
            content.append(
              $('<p></p>').text(
                '3. Оставь это окно открытым — вход завершится автоматически.'
              )
            );
            content.append(
              $('<a target="_blank" rel="noopener noreferrer"></a>')
                .attr('href', verification)
                .text('Открыть страницу активации')
            );
            content.append(
              $('<p></p>').text(
                'Назад — отменить. Пароль остаётся на сайте KinoPub.'
              )
            );
            function close() {
              stopLogin();
              Lampa.Modal.close();
              restore(previous);
            }
            Lampa.Modal.open({
              title: 'Kinolamp',
              html: content,
              size: 'small',
              onBack: close
            });
            function poll() {
              if (state.cancelled) {
                return;
              }
              if (Date.now() >= expiresAt) {
                close();
                notify('Код истёк. Запусти вход ещё раз.');
                return;
              }
              client.oauth(
                '/oauth2/device',
                { grant_type: 'device_token', code: json.code },
                function (error, token) {
                  if (state.cancelled) {
                    return;
                  }
                  if (!error && client.saveTokens(token, state.generation)) {
                    updateDevice();
                    close();
                    notify('KinoPub: вход выполнен.');
                    if (done) {
                      done();
                    }
                    return;
                  }
                  if (
                    error &&
                    (error.code === 'authorization_pending' ||
                      error.code === 'slow_down')
                  ) {
                    if (error.code === 'slow_down') {
                      pollInterval += 5000;
                    }
                    state.timer = setTimeout(poll, pollInterval);
                    return;
                  }
                  close();
                  notify(errorMessage(error));
                }
              );
            }
            state.timer = setTimeout(poll, pollInterval);
          }
        );
      }
      function authorized(run) {
        if (client.hasToken()) {
          run();
        } else {
          login(run);
        }
      }
      function logout() {
        if (pendingLogin) {
          stopLogin();
          Lampa.Modal.close();
        }
        client.logout();
        Lampa.Settings.update();
        notify(
          'Локальная сессия удалена. Отзыв устройства доступен на kino.pub.'
        );
      }
      return { login: login, logout: logout, authorized: authorized };
    }

    function createPlayerDiagnostics(
      Lampa,
      $,
      root,
      client,
      transport,
      diagnostics,
      ui
    ) {
      var notify = ui.notify;
      var restore = ui.restore;
      var menu = ui.menu;
      var diagnosticWork = null;
      var diagnosticVideo = null;
      var diagnosticHandlers = [];
      var diagnosticFirst = true;
      var diagnosticSample = -Infinity;
      var lastCDN = '';
      var pendingProbe = null;
      function detachDiagnosticVideo() {
        diagnosticHandlers.forEach(function (binding) {
          diagnosticVideo.removeEventListener(binding.event, binding.run);
        });
        diagnosticHandlers = [];
        diagnosticVideo = null;
      }
      function captureDiagnostic(event) {
        if (!diagnostics.enabled() || !diagnosticWork) {
          return;
        }
        var data = {
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
          data.ms = Date.now() - diagnosticWork.requested;
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
          video.addEventListener(event, run);
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
      function probeDiagnostic(kind) {
        if (!diagnostics.enabled()) {
          return;
        }
        var finish = diagnostics.begin('probe_' + kind);
        function done(status, result) {
          if (finish({ status: status, result: result })) {
            notify('Проверка завершена. Результат в локальном отчёте.');
          }
        }
        if (kind === 'api') {
          client.api('/types', {}, function (error) {
            done(
              error ? Number(error.status) || 0 : 200,
              error ? 'error' : 'ok'
            );
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
              !error && json.ok === true ? 'ok' : 'error'
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
          var result = function (code) {
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
      function registerSettings(setting, action) {
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
      function source(url) {
        if (diagnostics.enabled()) {
          lastCDN = url;
        }
      }
      return {
        clear: clear,
        registerSettings: registerSettings,
        source: source
      };
    }

    var PAGE_STYLES =
      ".kp-page {\n  font-family: inherit;\n  height: 100%;\n  display: flex;\n  flex-direction: column;\n  padding: 1.5em 2em;\n  box-sizing: border-box;\n}\n.kp-page__head {\n  display: flex;\n  align-items: center;\n  margin-bottom: 0.7em;\n}\n.kp-page__title {\n  font-size: 1.8em;\n  font-weight: 600;\n  line-height: 1.2;\n}\n.kp-page__status {\n  opacity: 0.65;\n  margin-bottom: 1em;\n}\n.kp-page > .scroll {\n  flex: 1;\n  min-height: 0;\n}\n.kp-page__grid {\n  display: grid;\n  grid-template-columns: repeat(5, minmax(0, 1fr));\n  /* Older TV engines understand grid-gap but ignore the newer gap alias. */\n  grid-gap: 2em 1.5em;\n  align-items: start;\n  padding: 0.4em;\n}\n.kp-page__card {\n  min-width: 0;\n  box-sizing: border-box;\n}\n.kp-page__poster {\n  height: 0;\n  padding-bottom: 150%;\n  position: relative;\n  border-radius: 0.6em;\n  background: rgba(255, 255, 255, 0.07);\n  overflow: hidden;\n  outline: 0.18em solid transparent;\n  outline-offset: 0.25em;\n}\n.kp-page__poster img {\n  position: absolute;\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n.kp-page__placeholder {\n  position: absolute;\n  top: 0;\n  right: 0;\n  bottom: 0;\n  left: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  opacity: 0.4;\n  font-size: 2em;\n}\n.kp-page__card.focus .kp-page__poster {\n  outline-color: currentColor;\n}\n.kp-page__name {\n  margin-top: 0.85em;\n  word-wrap: break-word;\n}\n.kp-page__meta {\n  opacity: 0.55;\n  font-size: 0.75em;\n  margin-top: 0.3em;\n}\n@media (max-width: 800px) {\n  .kp-page {\n    padding: 1em;\n  }\n  .kp-page__grid {\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n  }\n}\n@media (max-width: 480px) {\n  .kp-page__grid {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n}\n.kp-page__details {\n  font-size: 1em;\n  opacity: 0.8;\n  line-height: 1.5;\n}\n.kp-page__description {\n  max-width: 65em;\n  font-size: 1.05em;\n  line-height: 1.55;\n  white-space: pre-line;\n  margin: 0.6em 0 1.5em;\n}\n.kp-page__description:empty,\n.kp-page__details:empty {\n  display: none;\n}\n.kp-page__grid[data-layout='seasons'] {\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n}\n.kp-page__grid[data-layout='episodes'] {\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n}\n.kp-page__grid[data-layout='episodes'] .kp-page__poster {\n  padding-bottom: 56.25%;\n}\n.kp-page__grid[data-layout='episodes'] .kp-page__name,\n.kp-page__grid[data-layout='seasons'] .kp-page__name {\n  font-size: 1.15em;\n  font-weight: 600;\n}\n.kp-page__meta {\n  font-size: 0.95em;\n  opacity: 0.75;\n  line-height: 1.4;\n}\n@media (max-width: 800px) {\n  .kp-page__grid[data-layout='episodes'],\n  .kp-page__grid[data-layout='seasons'] {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n}\n@media (max-width: 480px) {\n  .kp-page__grid[data-layout='episodes'] {\n    grid-template-columns: 1fr;\n  }\n}\n.kp-page__toolbar {\n  display: flex;\n  flex-wrap: wrap;\n  margin: 0.2em 0 0.6em;\n}\n.kp-page__action {\n  /* Margins also work on TV browsers without flex gap support. */\n  margin: 0 0.6em 0.6em 0;\n  font-size: 1em;\n  padding: 0.6em 1em;\n  border-radius: 0.35em;\n  background: rgba(255, 255, 255, 0.09);\n  line-height: 1.2;\n}\n.kp-page__action.focus {\n  background: #fff;\n  color: #1d1f20;\n}\n.kp-page__grid[data-layout='folders'] {\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n}\n.kp-page__grid[data-layout='folders'] .kp-page__poster {\n  padding-bottom: 56.25%;\n}\n.kp-page__grid[data-layout='folders'] .kp-page__placeholder {\n  font-size: 3em;\n  color: #9cebc9;\n}\n.kp-page__grid[data-layout='catalog'] .kp-page__card {\n  display: flex;\n  flex-direction: column;\n}\n.kp-page__grid[data-layout='catalog'] .kp-page__poster {\n  border-radius: 0.4em;\n}\n.kp-page__grid[data-layout='catalog'] .kp-page__name {\n  order: 1;\n}\n.kp-page__original {\n  order: 2;\n  font-size: 0.85em;\n  line-height: 1.35;\n  margin-top: 0.25em;\n  opacity: 0.55;\n  word-wrap: break-word;\n}\n.kp-page__grid[data-layout='catalog'] .kp-page__meta {\n  order: 3;\n  font-size: 0.85em;\n  line-height: 1.4;\n  opacity: 0.75;\n}\n.kp-page__badges {\n  position: absolute;\n  top: 0.55em;\n  left: 0.55em;\n  right: 0.55em;\n}\n.kp-page__badge {\n  display: inline-block;\n  margin: 0 0.35em 0.35em 0;\n  padding: 0.25em 0.45em;\n  border-radius: 0.3em;\n  background: #143b2c;\n  color: #b6f4cf;\n  font-size: 0.75em;\n  font-weight: 600;\n}\n.kp-page__rating {\n  position: absolute;\n  bottom: 0.55em;\n  left: 0.55em;\n  padding: 0.3em 0.5em;\n  border-radius: 0.3em;\n  background: rgba(0, 0, 0, 0.8);\n  color: #fff;\n  font-size: 0.8em;\n}\n.kp-page__pagination {\n  margin-top: 1.8em;\n  justify-content: center;\n}\n.kp-page__pagination:empty {\n  display: none;\n}\n\n.kp-page__loading {\n  font: inherit;\n  width: 100%;\n  text-align: center;\n  opacity: 0.7;\n  padding: 0.6em;\n}\n";

    function createNativePages(Lampa, $, navigation, load, activate) {
      if (!Lampa.Component || !Lampa.Activity || !Lampa.Scroll || !navigation) {
        return null;
      }
      var active = null;
      $('body').append($('<style></style>').text(PAGE_STYLES));
      Lampa.Component.add('kinolamp', function (object) {
        var self = this;
        var isAlive = true;
        var isSuspended = false;
        var requestId = 0;
        var focusedElement = false;
        var captions = [];
        var isStale = null;
        var more = null;
        var loadingMore = false;
        var moreFailed = false;
        var moreRequest = 0;
        var seen = Object.create(null);
        var view = $('<div class="kp-page"></div>');
        var head = $('<div class="kp-page__head"></div>');
        var title = $('<div class="kp-page__title"></div>').text('KinoPub');
        var status = $(
          '<div class="kp-page__status" role="status"></div>'
        ).text('Загрузка…');
        var grid = $('<div class="kp-page__grid"></div>');
        var toolbar = $('<div class="kp-page__toolbar"></div>');
        var pagination = $(
          '<div class="kp-page__toolbar kp-page__pagination"></div>'
        );
        var details = $('<div class="kp-page__details"></div>');
        var description = $('<div class="kp-page__description"></div>');
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        head.append(title);
        scroll.append(toolbar);
        scroll.append(details);
        scroll.append(description);
        scroll.append(grid);
        scroll.append(pagination);
        view.append(head).append(status).append(scroll.render());
        function buttons(actions, target) {
          actions.forEach(function (action) {
            var button = $(
              '<div class="simple-button selector kp-page__action"></div>'
            ).text(action.title);
            button.on('hover:focus', function () {
              focusedElement = button[0];
              scroll.update(button, true);
            });
            button.on('hover:enter', function () {
              if (isAlive && !isSuspended) {
                action.run();
              }
            });
            (target || toolbar).append(button);
            if (!focusedElement) {
              focusedElement = button[0];
            }
          });
        }
        function updateCaptions() {
          captions.forEach(function (label) {
            label.node.text(
              typeof label.row.subtitle === 'function'
                ? label.row.subtitle()
                : label.row.subtitle
            );
          });
        }
        function appendRows(rows) {
          var count = captions.length;
          rows.forEach(function (row) {
            if (row.key && seen[row.key]) {
              return;
            }
            if (row.key) {
              seen[row.key] = true;
            }
            var position = captions.length;
            var card = $('<div class="kp-page__card selector"></div>');
            var poster = $('<div class="kp-page__poster"></div>');
            poster.append(
              $('<span class="kp-page__placeholder"></span>').text(
                row.symbol || '▶'
              )
            );
            if (httpsURL(row.poster)) {
              poster.append(
                $('<img loading="lazy" alt="">')
                  .attr('src', row.poster)
                  .on('error', function () {
                    $(this).remove();
                  })
              );
            }
            card
              .append(poster)
              .append(
                $('<div class="kp-page__name card__title"></div>').text(
                  row.title
                )
              );
            var meta = $('<div class="kp-page__meta"></div>');
            card.append(meta);
            if (row.original) {
              card.append(
                $('<div class="kp-page__original"></div>').text(row.original)
              );
            }
            var badges = $('<div class="kp-page__badges"></div>');
            (row.badges || []).forEach(function (label) {
              badges.append(
                $('<span class="kp-page__badge"></span>').text(label)
              );
            });
            poster.append(badges);
            if (row.rating) {
              poster.append(
                $('<span class="kp-page__rating"></span>').text(row.rating)
              );
            }
            captions.push({ node: meta, row: row });
            if (!focusedElement) {
              focusedElement = card[0];
            }
            card.on('hover:focus', function () {
              focusedElement = card[0];
              scroll.update(card, true);
              if (position >= captions.length - 5) {
                loadMore();
              }
            });
            card.on('hover:enter', function () {
              if (isAlive && !isSuspended) {
                activate(row);
              }
            });
            if (row.menu) {
              card.on('hover:long', function () {
                if (isAlive && !isSuspended) {
                  row.menu();
                }
              });
            }
            grid.append(card);
          });
          updateCaptions();
          return captions.length - count;
        }
        function loadMore() {
          if (!isAlive || isSuspended || loadingMore || moreFailed || !more) {
            return;
          }
          var expected = ++moreRequest;
          loadingMore = true;
          pagination
            .empty()
            .append(
              $('<div class="kp-page__loading" role="status"></div>').text(
                'Загрузка…'
              )
            );
          more(function (error, data) {
            if (!isAlive || isSuspended || expected !== moreRequest) {
              return;
            }
            loadingMore = false;
            pagination.empty();
            if (isStale && isStale()) {
              more = null;
              return;
            }
            if (error) {
              moreFailed = true;
              var beforeRetry = focusedElement;
              pagination.append(
                $('<div class="kp-page__loading" role="status"></div>').text(
                  'Не удалось загрузить следующие карточки.'
                )
              );
              buttons(
                [
                  {
                    title: 'Повторить',
                    run: function () {
                      moreFailed = false;
                      focusedElement = beforeRetry;
                      loadMore();
                    }
                  }
                ],
                pagination
              );
            } else {
              var added = appendRows(data.rows);
              more = added ? data.more || null : null;
            }
            Lampa.Controller.collectionSet(view);
            Lampa.Controller.collectionFocus(focusedElement, view);
          });
        }
        scroll.onEnd = loadMore;
        this.create = function () {
          var expected = ++requestId;
          moreRequest++;
          more = null;
          loadingMore = false;
          moreFailed = false;
          seen = Object.create(null);
          status.text('Загрузка…');
          self.activity.loader(true);
          load(object, function (error, data) {
            if (!isAlive || expected !== requestId) {
              return;
            }
            self.activity.loader(false);
            grid.empty();
            toolbar.empty();
            pagination.empty();
            focusedElement = false;
            captions = [];
            isStale = null;
            if (error) {
              title.text('KinoPub');
              details.text('');
              description.text('');
              status.text(error);
              buttons([{ title: 'Повторить', run: self.create }]);
            } else {
              isStale = data.isStale || null;
              title.text(data.title);
              details.text(data.details || '');
              description.text(data.description || '');
              grid.attr('data-layout', data.layout || 'posters');
              buttons(data.actions || []);
              status.text(
                data.rows.length
                  ? data.hint || 'Выбери подходящий результат.'
                  : data.empty ||
                      'Ничего не найдено. Вернись назад и выбери другой материал.'
              );
              appendRows(data.rows);
              more = data.rows.length ? data.more || null : null;
            }
            if (!isSuspended) {
              self.activity.toggle();
            }
          });
        };
        this.start = function () {
          if (!isAlive) {
            return;
          }
          isSuspended = false;
          active = self;
          if (isStale && isStale()) {
            self.create();
            return;
          }
          updateCaptions();
          Lampa.Controller.add('content', {
            toggle: function () {
              Lampa.Controller.collectionSet(view);
              Lampa.Controller.collectionFocus(focusedElement, view);
            },
            up: function () {
              if (navigation.canmove('up')) {
                navigation.move('up');
              } else {
                Lampa.Controller.toggle('head');
              }
            },
            down: function () {
              navigation.move('down');
            },
            right: function () {
              navigation.move('right');
            },
            left: function () {
              if (navigation.canmove('left')) {
                navigation.move('left');
              } else {
                Lampa.Controller.toggle('menu');
              }
            },
            back: function () {
              Lampa.Activity.backward();
            }
          });
          Lampa.Controller.toggle('content');
        };
        this.render = function () {
          return view;
        };
        this.pause = function () {
          isSuspended = true;
          moreRequest++;
          if (loadingMore) {
            loadingMore = false;
            pagination.empty();
          }
          if (active === self) {
            active = null;
          }
        };
        this.stop = function () {};
        this.destroy = function () {
          isAlive = false;
          if (active === self) {
            active = null;
          }
          scroll.destroy();
          view.remove();
        };
      });
      return {
        show: function (route) {
          // Activity history must contain only route data, never DOM nodes, callbacks or API tokens.
          Lampa.Activity.push({
            component: 'kinolamp',
            title: 'KinoPub',
            kp_view: route.view,
            kp_query: route.query,
            kp_id: route.id,
            kp_season: route.season,
            kp_section: route.section,
            kp_page: route.page,
            kp_genre: route.genre,
            kp_genre_title: route.genreTitle,
            kp_quality: route.quality,
            kp_quality_title: route.qualityTitle,
            kp_sort: route.sort,
            kp_folder: route.folder
          });
        },
        current: function () {
          return active;
        },
        refresh: function () {
          if (active) {
            active.create();
          }
        },
        resume: function () {
          if (active) {
            active.start();
          }
        }
      };
    }

    // Resolve artwork by identity, never by an ambiguous translated title.
    // Reuse Lampa's TMDB client/proxy/cache; KinoPub tokens never enter these calls.
    function createSeasonPosters(Lampa) {
      return function load(item, done) {
        var imdb = String(item.imdb || '').replace(/^tt/, '');
        var source = Lampa.Api && Lampa.Api.sources && Lampa.Api.sources.tmdb;
        if (
          !/^[0-9]{1,10}$/.test(imdb) ||
          Number(imdb) === 0 ||
          !source ||
          typeof source.get !== 'function' ||
          !Lampa.TMDB ||
          typeof Lampa.TMDB.image !== 'function'
        ) {
          done([]);
          return;
        }
        while (imdb.length < 7) {
          imdb = '0' + imdb;
        }
        var settled = false;
        // Artwork is optional. A slow metadata service must not block season choice.
        var timer = setTimeout(finish, 2500);
        function finish(seasons) {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          done(seasons || []);
        }
        function failed() {
          finish([]);
        }
        try {
          source.get(
            'find/tt' + imdb + '?external_source=imdb_id',
            {},
            function (found) {
              if (settled) {
                return;
              }
              var matches = found && found.tv_results;
              if (
                !Array.isArray(matches) ||
                matches.length !== 1 ||
                !matches[0] ||
                !/^[1-9][0-9]*$/.test(String(matches[0].id))
              ) {
                failed();
                return;
              }
              source.get(
                'tv/' + matches[0].id,
                {},
                function (show) {
                  var seasons = show && show.seasons;
                  finish(
                    Array.isArray(seasons)
                      ? seasons.map(function (season) {
                          return {
                            number: season.season_number,
                            // Only image paths are passed to Lampa's image/proxy helper.
                            poster:
                              typeof season.poster_path === 'string' &&
                              /^\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(
                                season.poster_path
                              )
                                ? Lampa.TMDB.image(
                                    't/p/w500' + season.poster_path
                                  )
                                : ''
                          };
                        })
                      : []
                  );
                },
                failed,
                { life: 60 * 24 * 7 }
              );
            },
            failed,
            { life: 60 * 24 * 7 }
          );
        } catch (_) {
          // Older/custom Lampa builds may expose an incompatible metadata adapter.
          failed();
        }
      };
    }

    function qualityOf(file) {
      return (
        parseInt(
          String(file.quality || file.h || '').replace(/[^0-9]/g, ''),
          10
        ) || 0
      );
    }
    function streams(files, proxy, maxHeight, multipleAudios) {
      var result = [];
      // HLS2 may expose only the default voice. Keep every quality on HLS4 when
      // KinoPub advertises multiple voices, so Lampa can discover native tracks.
      var useHLS4 =
        proxy ||
        (multipleAudios &&
          (files || []).some(function (file) {
            var urls = file.urls || file.url || {};
            return httpsURL(urls.hls4);
          }));
      (files || []).forEach(function (file) {
        var urls = file.urls || file.url || {};
        var formats = useHLS4 ? ['hls4'] : ['hls2', 'hls', 'hls4', 'http'];
        for (var i = 0; i < formats.length; i++) {
          var url = urls[formats[i]];
          if (httpsURL(url)) {
            result.push({
              url: url,
              height: qualityOf(file),
              format: formats[i]
            });
            break;
          }
        }
      });
      result.sort(function (a, b) {
        return b.height - a.height;
      });
      var limited = result.filter(function (s) {
        return !s.height || s.height <= maxHeight;
      });
      return limited.length ? limited : result.slice(-1);
    }
    function audioTitle(audio, index) {
      var type = audio.type && (audio.type.title || audio.type.short_title);
      var types = {
        DUB: 'Дубляж',
        MVO: 'Многоголосый',
        DVO: 'Двухголосый',
        AVO: 'Авторский',
        VO: 'Одноголосый',
        ORIG: 'Оригинал'
      };
      var languages = {
        ru: 'Русский',
        rus: 'Русский',
        en: 'Английский',
        eng: 'Английский',
        uk: 'Украинский',
        ukr: 'Украинский',
        ja: 'Японский',
        jpn: 'Японский',
        de: 'Немецкий',
        deu: 'Немецкий',
        ger: 'Немецкий',
        fr: 'Французский',
        fra: 'Французский',
        fre: 'Французский',
        es: 'Испанский',
        spa: 'Испанский',
        it: 'Итальянский',
        ita: 'Итальянский',
        ko: 'Корейский',
        kor: 'Корейский',
        zh: 'Китайский',
        zho: 'Китайский',
        chi: 'Китайский'
      };
      var lang = String(audio.lang || '').toLowerCase();
      var codec = String(audio.codec || '').toUpperCase();
      var label =
        [
          types[String(type).toUpperCase()] || type,
          audio.author && audio.author.title,
          codec === 'AAC' ? '' : codec
        ]
          .filter(Boolean)
          .join(' · ') || 'Дорожка ' + (index + 1);
      return (
        label +
        (lang ? ' (' + (languages[lang] || lang.toUpperCase()) + ')' : '')
      );
    }
    function voiceIdentity(audio) {
      return JSON.stringify([
        audio.lang || '',
        (audio.type && (audio.type.id || audio.type.title)) || '',
        (audio.author && (audio.author.id || audio.author.title)) || '',
        audio.codec || ''
      ]).toLowerCase();
    }
    function episodeQueue(item) {
      var result = [];
      (item.seasons || []).forEach(function (season, seasonIndex) {
        (season.episodes || []).forEach(function (video, episodeIndex) {
          result.push({
            video: video,
            context: {
              kind: 'episode',
              season:
                season.number === undefined ? seasonIndex + 1 : season.number,
              number: video.number || episodeIndex + 1
            }
          });
        });
      });
      return result.sort(function (a, b) {
        return (
          a.context.season - b.context.season ||
          a.context.number - b.context.number
        );
      });
    }
    function matchItem(movie, items) {
      function title(value) {
        return String(value || '')
          .toLowerCase()
          .replace(/ё/g, 'е')
          .replace(/[^a-zа-я0-9]+/g, ' ')
          .trim();
      }
      var names = [
        movie.title,
        movie.name,
        movie.original_title,
        movie.original_name
      ]
        .map(title)
        .filter(Boolean);
      var year = String(
        movie.release_date || movie.first_air_date || movie.year || ''
      ).slice(0, 4);
      var series = !!movie.first_air_date || movie.media_type === 'tv';
      var exact = (items || []).filter(function (item) {
        if (movie.imdb_id && item.imdb === movie.imdb_id) {
          return true;
        }
        if (!year || String(item.year) !== year) {
          return false;
        }
        if (series ? item.type !== 'serial' : item.type !== 'movie') {
          return false;
        }
        return String(item.title || '')
          .split('/')
          .some(function (part) {
            return names.indexOf(title(part)) !== -1;
          });
      });
      return exact.length === 1 ? exact[0] : null;
    }
    function mediaKey(item, video, context) {
      if (item.id === undefined || item.id === null) {
        return '';
      }
      return (
        'media:' +
        JSON.stringify([
          String(item.id),
          context.kind,
          context.season,
          String(video.id || video.media_id || context.number)
        ])
      );
    }

    /** Fresh links are resolved only when Lampa selects the next episode. */
    function createEpisodePlaylist(Lampa, client, openVideo, notify) {
      // In-flight episode responses belong to one player lifecycle only.
      var navigation = 0;
      var queueOwner = null;
      if (Lampa.Player.listener) {
        Lampa.Player.listener.follow('create', function () {
          navigation++;
        });
        Lampa.Player.listener.follow('destroy', function () {
          navigation++;
        });
        Lampa.Player.listener.follow('start', function (work) {
          if (queueOwner && work && work._kinolampQueueId === queueOwner.id) {
            queueOwner.entries.forEach(function (entry) {
              if (entry !== work) {
                entry.url = entry._kinolampLoad;
              }
            });
          }
        });
      }
      return function playlist(item, video, work, playback) {
        var entries = [work];
        if (
          playback.context.kind === 'episode' &&
          Lampa.Player.listener &&
          Lampa.Player.close &&
          playback.key
        ) {
          var owner = {
            id: navigation + 1,
            height: playback.height,
            voice: playback.voice,
            current: work,
            video: video,
            loading: false
          };
          queueOwner = owner;
          entries = episodeQueue(item).map(function (entry) {
            var id = mediaKey(item, entry.video, entry.context);
            var target =
              id === playback.key
                ? work
                : {
                    title: escapeText(
                      's' +
                        entry.context.season +
                        'e' +
                        entry.context.number +
                        ' · ' +
                        (entry.video.title || '')
                    )
                  };
            target.season = entry.context.season;
            target.episode = entry.context.number;
            target._kinolampQueueId = owner.id;
            target._kinolampLoad = function (ready) {
              if (owner.loading || queueOwner !== owner) {
                return;
              }
              owner.loading = true;
              var expected = navigation;
              function current() {
                return expected === navigation && queueOwner === owner;
              }
              function failed() {
                owner.loading = false;
                if (current()) {
                  Lampa.Player.close();
                }
              }
              client.api(
                '/items/' + encodeURIComponent(item.id),
                { nolinks: 0 },
                function (error, json) {
                  if (!current()) {
                    owner.loading = false;
                    return;
                  }
                  var next =
                    !error &&
                    json.item &&
                    episodeQueue(json.item).filter(function (candidate) {
                      return (
                        mediaKey(
                          json.item,
                          candidate.video,
                          candidate.context
                        ) === id
                      );
                    })[0];
                  if (!next) {
                    notify(
                      'Следующая серия недоступна. Воспроизведение остановлено.'
                    );
                    failed();
                    return;
                  }
                  openVideo(json.item, next.video, null, next.context, {
                    automatic: true,
                    transition: {
                      height: owner.height,
                      voice: owner.voice,
                      fail: failed,
                      valid: current,
                      accept: function (prepared, options) {
                        owner.loading = false;
                        if (!current()) {
                          return;
                        }
                        Object.keys(prepared).forEach(function (key) {
                          target[key] = prepared[key];
                        });
                        owner.current = target;
                        owner.video = next.video;
                        owner.height = options.height;
                        owner.voice = options.voice;
                        ready();
                      }
                    }
                  });
                }
              );
            };
            if (target !== work) {
              target.url = target._kinolampLoad;
            }
            return target;
          });
          owner.entries = entries;
        }
        return entries;
      };
    }

    /** Bridges player lifecycle events to local progress without overwriting a pending seek. */
    function createProgressTracker(Lampa, progress) {
      var session = null;
      var canSaveProgress = !!(
        Lampa.Player.listener &&
        Lampa.PlayerVideo &&
        Lampa.PlayerVideo.listener &&
        Lampa.PlayerVideo.to
      );
      function saveSession(ended) {
        if (session && session.ready) {
          session.ended = session.ended || ended;
          progress.save(
            session.key,
            session.time,
            session.duration,
            session.ended
          );
        }
      }
      if (canSaveProgress) {
        Lampa.Player.listener.follow('create', function () {
          saveSession(false);
          session = null;
        });
        Lampa.Player.listener.follow('start', function (work) {
          saveSession(false);
          session =
            work && work._kinolampProgress
              ? {
                  work: work,
                  key: work._kinolampProgress.key,
                  seek: work._kinolampProgress.time,
                  time: 0,
                  duration: 0,
                  ready: false,
                  savedAt: 0
                }
              : null;
        });
        Lampa.PlayerVideo.listener.follow('timeupdate', function (event) {
          if (
            !session ||
            !event ||
            typeof event.current !== 'number' ||
            !isFinite(event.current) ||
            event.current < 0 ||
            typeof event.duration !== 'number' ||
            !isFinite(event.duration) ||
            event.duration <= 0
          ) {
            return;
          }
          if (session.seek > 0) {
            var seek = Math.min(session.seek, Math.max(0, event.duration - 1));
            session.waitForSeek = seek;
            session.seek = 0;
            Lampa.PlayerVideo.to(seek);
            return;
          }
          if (session.waitForSeek && event.current < session.waitForSeek - 2) {
            return;
          }
          session.waitForSeek = 0;
          session.time = event.current;
          session.duration = event.duration;
          session.ready = true;
          if (Date.now() - session.savedAt >= 5000) {
            saveSession(false);
            session.savedAt = Date.now();
          }
        });
        Lampa.PlayerVideo.listener.follow('pause', function () {
          saveSession(false);
        });
        Lampa.PlayerVideo.listener.follow('ended', function () {
          saveSession(true);
        });
        Lampa.Player.listener.follow('destroy', function () {
          saveSession(false);
          session = null;
        });
      }
      function attach(work, playback) {
        if (canSaveProgress && playback.key) {
          work._kinolampProgress = { key: playback.key, time: playback.time };
          work.timeline = {
            time: playback.time,
            duration: 0,
            percent: 0,
            handler: function (_percent, time, duration) {
              if (
                session &&
                session.work.timeline === work.timeline &&
                session.seek === 0 &&
                session.ready
              ) {
                progress.save(playback.key, time, duration, session.ended);
              }
            }
          };
        }
      }
      function clear() {
        session = null;
      }
      return { supported: canSaveProgress, attach: attach, clear: clear };
    }

    /** Owns playback, local progress and the lazy next-episode queue for one installation. */
    function createPlayback(Lampa, dependencies) {
      var client = dependencies.client;
      var transport = dependencies.transport;
      var pages = dependencies.pages;
      var progress = dependencies.progress;
      var diagnostics = dependencies.diagnostics;
      var recordSource = dependencies.recordSource;
      var authorization = dependencies.authorization;
      var ui = dependencies.ui;
      var notify = ui.notify;
      var restore = ui.restore;
      var menu = ui.menu;
      var errorMessage = ui.errorMessage;
      var authorized = authorization.authorized;
      var playlist = createEpisodePlaylist(Lampa, client, openVideo, notify);
      var tracker = createProgressTracker(Lampa, progress);
      var loadSeasonPosters = createSeasonPosters(Lampa);
      // Resolve a unique card match before asking the viewer to choose a result!.
      function search(movie) {
        var query =
          movie.title ||
          movie.name ||
          movie.original_title ||
          movie.original_name ||
          '';
        if (!query) {
          notify('Открой карточку фильма или сериала.');
          return;
        }
        authorized(function () {
          if (
            movie.release_date ||
            movie.first_air_date ||
            movie.year ||
            movie.imdb_id
          ) {
            client.api('/items/search', { q: query }, function (error, json) {
              if (error) {
                notify(errorMessage(error));
                return;
              }
              var match = matchItem(movie, json.items);
              if (match) {
                openMatchedItem(match.id);
              } else {
                showResults();
              }
            });
            return;
          }
          showResults();
        });
        function showResults() {
          if (pages) {
            pages.show({ view: 'search', query: query });
            return;
          }
          client.api('/items/search', { q: query }, function (error, json) {
            if (error) {
              notify(errorMessage(error));
              return;
            }
            var items = json.items || [];
            if (!items.length) {
              notify('В KinoPub ничего не найдено.');
              return;
            }
            function results() {
              menu(
                'Результаты KinoPub',
                items.map(function (item) {
                  return {
                    title: item.title,
                    subtitle: [item.year, item.type]
                      .filter(Boolean)
                      .join(' · '),
                    run: function () {
                      openItem(item.id, results);
                    }
                  };
                })
              );
            }
            results();
          });
        }
      }
      function openMatchedItem(id) {
        client.api(
          '/items/' + encodeURIComponent(id),
          { nolinks: 0 },
          function (error, json) {
            if (error || !json.item) {
              notify(errorMessage(error));
              return;
            }
            var item = json.item;
            if (item.seasons && item.seasons.length) {
              if (pages) {
                pages.show({ view: 'item', id: id });
              } else {
                openItem(id, function () {
                  restore('full');
                });
              }
            } else if (item.videos && item.videos.length === 1) {
              openVideo(
                item,
                item.videos[0],
                null,
                { kind: 'part', season: 0, number: 1 },
                { automatic: true }
              );
            } else if (pages) {
              pages.show({ view: 'item', id: id });
            } else {
              openItem(id, function () {
                restore('full');
              });
            }
          }
        );
      }
      function openItem(id, back) {
        client.api(
          '/items/' + encodeURIComponent(id),
          { nolinks: 0 },
          function (error, json) {
            if (error) {
              notify(errorMessage(error));
              return;
            }
            var item = json.item;
            if (!item) {
              notify('Нет данных о видео.');
              return;
            }
            function seasons() {
              menu(
                item.title,
                item.seasons.map(function (season, index) {
                  return {
                    title: 'Сезон ' + (season.number || index + 1),
                    run: function () {
                      episodes(season);
                    }
                  };
                }),
                back
              );
            }
            function episodes(season) {
              menu(
                'Серии',
                (season.episodes || []).map(function (episode, index) {
                  var context = {
                    kind: 'episode',
                    season:
                      season.number === undefined
                        ? item.seasons.indexOf(season) + 1
                        : season.number,
                    number: episode.number || index + 1
                  };
                  return {
                    title:
                      (episode.number || index + 1) +
                      '. ' +
                      (episode.title || 'Серия'),
                    subtitle: progress.label(mediaKey(item, episode, context)),
                    run: function () {
                      openVideo(
                        item,
                        episode,
                        function () {
                          episodes(season);
                        },
                        context
                      );
                    }
                  };
                }),
                seasons
              );
            }
            if (item.seasons && item.seasons.length) {
              seasons();
            } else {
              var videos = item.videos || [];
              if (videos.length === 1) {
                openVideo(item, videos[0], back, {
                  kind: 'part',
                  season: 0,
                  number: 1
                });
              } else if (videos.length) {
                menu(
                  item.title,
                  videos.map(function (video, index) {
                    var context = {
                      kind: 'part',
                      season: 0,
                      number: index + 1
                    };
                    return {
                      title: video.title || 'Видео ' + (index + 1),
                      subtitle: progress.label(mediaKey(item, video, context)),
                      run: function () {
                        openVideo(
                          item,
                          video,
                          function () {
                            openItem(id, back);
                          },
                          context
                        );
                      }
                    };
                  }),
                  back
                );
              } else {
                notify('У этого материала нет доступного видео.');
              }
            }
          }
        );
      }
      // Named options keep a normal start distinct from a lazy episode transition.
      function openVideo(item, video, back, context, options) {
        options = options || {};
        var automatic = options.automatic;
        if (pages) {
          back = pages.resume;
        }
        var transition = options.transition;
        var playback = {
          key: mediaKey(item, video, context),
          time: 0,
          context: context,
          voice: '',
          accept: transition && transition.accept
        };
        function unavailable(message) {
          if (transition && !transition.valid()) {
            return;
          }
          notify(message);
          if (transition) {
            transition.fail();
          }
        }
        function choose(data) {
          if (transition && !transition.valid()) {
            return;
          }
          var proxy =
            client.get('proxy_enabled') === true ||
            client.get('proxy_enabled') === 'true';
          var maxHeight = transition
            ? transition.height
            : Number(client.get('quality')) || 1080;
          var audios =
            Array.isArray(video.audios) && video.audios.length
              ? video.audios
              : data.audios || [];
          var availableStreams = streams(
            data.files,
            proxy,
            maxHeight,
            audios.length > 1
          );
          if (!availableStreams.length) {
            unavailable(
              proxy
                ? 'Нет HTTPS HLS4-ссылок. Отключи HLS-прокси или проверь данные KinoPub.'
                : 'Нет HTTPS-ссылок на видео.'
            );
            return;
          }
          if (transition && availableStreams[0].height > maxHeight) {
            unavailable(
              'В следующей серии нет качества в выбранном ограничении.'
            );
            return;
          }
          function selectStream(stream) {
            playback.mode = proxy ? 'proxy' : 'direct';
            playback.format = stream.format;
            diagnostics.record('source', {
              mode: proxy ? 'proxy' : 'direct',
              format: stream.format,
              height: stream.height
            });
            recordSource(stream.url);
            playback.height = stream.height || maxHeight;
            playback.audios = audios;
            if (transition) {
              var matching = transition.voice
                ? audios.filter(function (audio) {
                    return voiceIdentity(audio) === transition.voice;
                  })
                : [];
              if (transition.voice && !matching.length) {
                notify(
                  'Предыдущая озвучка недоступна в этой серии. Выбрана первая доступная.'
                );
              }
              var selected = matching[0] || audios[0];
              playback.selectedAudio = selected;
              playback.voice = selected ? voiceIdentity(selected) : '';
              if (proxy) {
                prepareProxy(
                  item,
                  video,
                  data,
                  stream,
                  selected
                    ? Number(selected.index) || audios.indexOf(selected) + 1
                    : 0,
                  Math.min(playback.height, maxHeight),
                  playback,
                  unavailable
                );
                return;
              }
            }
            if (!proxy) {
              play(item, video, data, stream.url, playback, availableStreams);
              return;
            }
            var tracks = audios.map(function (audio, index) {
              return {
                title: audioTitle(audio, index),
                run: function () {
                  playback.voice = voiceIdentity(audio);
                  playback.selectedAudio = audio;
                  prepareProxy(
                    item,
                    video,
                    data,
                    stream,
                    Number(audio.index) || index + 1,
                    Math.min(stream.height || maxHeight, maxHeight),
                    playback,
                    unavailable
                  );
                }
              };
            });
            if (tracks.length) {
              menu('Озвучка', tracks, function () {
                choose(data);
              });
            } else {
              prepareProxy(
                item,
                video,
                data,
                stream,
                0,
                Math.min(stream.height || maxHeight, maxHeight),
                playback,
                unavailable
              );
            }
          }
          if (automatic) {
            selectStream(availableStreams[0]);
          } else {
            menu(
              'Качество',
              availableStreams.map(function (stream) {
                return {
                  title:
                    (stream.height ? stream.height + 'p' : 'Авто') +
                    ' · ' +
                    stream.format.toUpperCase(),
                  run: function () {
                    selectStream(stream);
                  }
                };
              }),
              back
            );
          }
        }
        function load() {
          playback.preparedAt = Date.now();
          if (video.files && video.files.length) {
            choose(video);
            return;
          }
          var mediaId = video.id || video.media_id;
          if (!mediaId) {
            unavailable('KinoPub не вернул media ID или ссылки.');
            return;
          }
          client.api(
            '/items/media-links',
            { mid: mediaId },
            function (error, json) {
              if (error) {
                unavailable(errorMessage(error));
              } else {
                choose(json);
              }
            }
          );
        }
        var previous = progress.get(playback.key);
        if (transition) {
          playback.time = previous && !previous.watched ? previous.time : 0;
          load();
          return;
        }
        if (!previous) {
          load();
          return;
        }
        var entries = [];
        if (!previous.watched) {
          entries.push({
            title: progress.label(playback.key),
            run: function () {
              if (tracker.supported) {
                playback.time = previous.time;
              } else {
                notify(
                  'Этот плеер не поддерживает продолжение Kinolamp. Видео начнётся сначала.'
                );
              }
              load();
            }
          });
        }
        entries.push({
          title: 'Начать сначала',
          run: function () {
            progress.clear(playback.key);
            load();
          }
        });
        entries.push({
          title: 'Сбросить прогресс',
          run: function () {
            progress.clear(playback.key);
            notify('Прогресс этого видео сброшен.');
            back();
          }
        });
        if (automatic) {
          entries[0].run();
          return;
        }
        menu(
          previous.watched ? 'Уже просмотрено' : 'Продолжить просмотр',
          entries,
          back
        );
      }
      // Only accept short-lived tickets from the explicitly configured proxy.
      function prepareProxy(
        item,
        video,
        data,
        stream,
        voice,
        height,
        playback,
        unavailable
      ) {
        var base = String(client.get('proxy_url')).replace(/\/+$/, '');
        var token = client.get('proxy_token');
        if (
          !httpsURL(base) ||
          !/^https:\/\/[^/]+$/.test(base) ||
          !token ||
          token.length < 32
        ) {
          unavailable(
            'Для HLS-прокси укажи HTTPS-адрес своего VPS и ключ минимум 32 символа.'
          );
          return;
        }
        transport(
          'POST',
          base + '/api/manifests',
          JSON.stringify({
            master: stream.url,
            voice: voice,
            maxHeight: height
          }),
          {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          function (error, json) {
            // A proxy response may only return a ticket at the configured origin.
            var prefix = base + '/hls/';
            if (
              error ||
              !json ||
              typeof json.url !== 'string' ||
              json.url.indexOf(prefix) !== 0 ||
              !/^[a-f0-9]{64}\.m3u8$/.test(json.url.slice(prefix.length))
            ) {
              unavailable(
                'HLS-прокси недоступен. Проверь ключ, ALLOWED_ORIGINS и CDN_HOSTS на VPS.'
              );
              return;
            }
            play(item, video, data, json.url, playback);
          }
        );
      }
      function play(item, video, data, url, playback, qualities) {
        var subtitles = (data.subtitles || video.subtitles || [])
          .filter(function (s) {
            return httpsURL(s.url);
          })
          .map(function (s) {
            return {
              label: String(s.lang || 'Subtitles'),
              language: String(s.lang || ''),
              url: s.url
            };
          });
        var work = {
          title:
            String(item.title || '') + (video.title ? ' · ' + video.title : ''),
          url: url
        };
        work._kinolampAudios =
          playback.mode === 'proxy'
            ? playback.selectedAudio
              ? [playback.selectedAudio]
              : []
            : playback.audios;
        work._kinolampDiagnostic = {
          requested: Date.now(),
          mode: playback.mode,
          format: playback.format
        };
        diagnostics.record('prepare', { ms: Date.now() - playback.preparedAt });
        if (qualities && qualities.length > 1) {
          work.quality = {};
          qualities.forEach(function (stream) {
            work.quality[stream.height ? stream.height + 'p' : 'Авто'] =
              stream.url;
          });
        }
        tracker.attach(work, playback);
        if (subtitles.length) {
          work.subtitles = subtitles;
        }
        if (playback.accept) {
          playback.accept(work, playback);
          return;
        }
        var entries = playlist(item, video, work, playback);
        try {
          Lampa.Player.play(work);
          Lampa.Player.playlist(entries);
        } catch (_) {
          notify('Не удалось запустить плеер Lampa.');
        }
      }
      // Native pages contain display data; signed playback links stay out of routes.
      function pageRows(route, done) {
        function imageURL(value) {
          return typeof value === 'string'
            ? value.replace(/^http:/, 'https:')
            : '';
        }
        function poster(item) {
          return imageURL(
            item.posters &&
              (item.posters.medium || item.posters.big || item.posters.small)
          );
        }
        function minutes(seconds) {
          return seconds > 0 ? Math.ceil(seconds / 60) + ' мин' : '';
        }
        function details(item) {
          return [
            item.year,
            (item.genres || [])
              .map(function (genre) {
                return genre.title;
              })
              .join(', '),
            (item.countries || [])
              .map(function (country) {
                return country.title;
              })
              .join(', ')
          ]
            .filter(Boolean)
            .join(' · ');
        }
        if (route.kp_view === 'search') {
          client.api(
            '/items/search',
            { q: route.kp_query },
            function (error, json) {
              if (error) {
                done(errorMessage(error));
                return;
              }
              done(null, {
                title: 'Результаты: «' + route.kp_query + '»',
                rows: (json.items || []).map(function (item) {
                  return {
                    title: item.title,
                    subtitle: [item.year, item.type]
                      .filter(Boolean)
                      .join(' · '),
                    poster: poster(item),
                    next: { view: 'item', id: item.id }
                  };
                })
              });
            }
          );
          return;
        }
        client.api(
          '/items/' + encodeURIComponent(String(route.kp_id)),
          { nolinks: 0 },
          function (error, json) {
            if (error || !json.item) {
              done(errorMessage(error));
              return;
            }
            var item = json.item;
            var image = poster(item);
            if (
              route.kp_view === 'item' &&
              item.seasons &&
              item.seasons.length
            ) {
              loadSeasonPosters(item, function (covers) {
                done(null, {
                  title: item.title,
                  description: item.plot,
                  details: details(item),
                  layout: 'seasons',
                  hint: 'Сезоны · ' + item.seasons.length,
                  rows: item.seasons.map(function (season, index) {
                    var number =
                      season.number === undefined ? index + 1 : season.number;
                    var cover = covers.filter(function (candidate) {
                      return Number(candidate.number) === Number(number);
                    })[0];
                    var own = poster(season);
                    var tmdb = cover && imageURL(cover.poster);
                    var frames = (season.episodes || [])
                      .map(function (episode) {
                        return imageURL(episode.thumbnail);
                      })
                      .filter(httpsURL);
                    return {
                      title: 'Сезон ' + number,
                      subtitle: [
                        season.title,
                        'Серий: ' + (season.episodes || []).length
                      ]
                        .filter(Boolean)
                        .join(' · '),
                      poster: httpsURL(own)
                        ? own
                        : httpsURL(tmdb)
                          ? tmdb
                          : frames[0] || image,
                      next: { view: 'season', id: item.id, season: index }
                    };
                  })
                });
              });
              return;
            }
            var season = (item.seasons || [])[route.kp_season];
            var episodes = route.kp_view === 'season';
            var videos = episodes
              ? (season && season.episodes) || []
              : item.videos || [];
            done(null, {
              title: item.title,
              description: item.plot,
              details: details(item),
              layout: 'episodes',
              hint: episodes
                ? 'Сезон ' +
                  (season && season.number !== undefined
                    ? season.number
                    : Number(route.kp_season) + 1) +
                  ' · Серий: ' +
                  videos.length
                : 'Выбери часть фильма.',
              rows: videos.map(function (video, index) {
                var context = {
                  kind: episodes ? 'episode' : 'part',
                  season: episodes
                    ? season.number === undefined
                      ? Number(route.kp_season) + 1
                      : season.number
                    : 0,
                  number: video.number || index + 1
                };
                return {
                  title: episodes
                    ? 'Серия ' +
                      context.number +
                      (video.title ? ' · ' + video.title : '')
                    : video.title || 'Видео ' + context.number,
                  subtitle: function () {
                    return [
                      minutes(video.duration),
                      progress.label(mediaKey(item, video, context))
                    ]
                      .filter(Boolean)
                      .join(' · ');
                  },
                  poster: imageURL(video.thumbnail) || image,
                  item: item,
                  video: video,
                  context: context
                };
              })
            });
          }
        );
      }
      function activatePageRow(row) {
        if (row.next && row.next.view === 'item') {
          openMatchedItem(row.next.id);
        } else if (row.next) {
          pages.show(row.next);
        } else {
          openVideo(row.item, row.video, pages.resume, row.context, {
            automatic: true
          });
        }
      }
      function resetProgress() {
        tracker.clear();
        progress.clear();
        notify('Прогресс Kinolamp сброшен.');
      }
      return {
        search: search,
        load: pageRows,
        activate: activatePageRow,
        resetProgress: resetProgress
      };
    }

    function createCatalog(Lampa, client, pages, ui) {
      var notify = ui.notify;
      var menu = ui.menu;
      var errorMessage = ui.errorMessage;
      // Cached folder pages reload after a bookmark mutation or account change.
      var bookmarkRevision = 0;
      function openCatalog() {
        if (!pages) {
          notify(
            'Для каталога обнови Lampa: нужны нативные страницы приложения.'
          );
          return;
        }
        if (!client.hasToken()) {
          Lampa.Controller.toggle('settings');
          Lampa.Settings.create('kp_self');
          notify('Сначала войди в KinoPub, затем открой каталог.');
          return;
        }
        pages.show({ view: 'catalog', section: 'new', page: 1 });
      }
      function catalogRoute(route, changes) {
        var result = {
          view: 'catalog',
          section: route.kp_section || 'new',
          page: route.kp_page || 1,
          query: route.kp_query || '',
          genre: route.kp_genre || '',
          genreTitle: route.kp_genre_title || '',
          quality: route.kp_quality || '',
          qualityTitle: route.kp_quality_title || '',
          sort: route.kp_sort || '',
          folder: route.kp_folder || ''
        };
        Object.keys(changes).forEach(function (key) {
          result[key] = changes[key];
        });
        return result;
      }
      function catalogSearch(route) {
        if (!Lampa.Input || !Lampa.Input.edit) {
          notify('В этой сборке Lampa недоступна клавиатура поиска.');
          return;
        }
        var owner = pages.current();
        Lampa.Input.edit(
          {
            title: 'Поиск в KinoPub',
            value: route.kp_query || '',
            free: true,
            nosave: true,
            nomic: true
          },
          function (value) {
            if (pages.current() !== owner) {
              return;
            }
            pages.resume();
            var query = String(value || '')
              .trim()
              .slice(0, 100);
            if (!query) {
              return;
            }
            if (query.length < 3) {
              notify('Введи минимум три символа.');
              return;
            }
            pages.show(
              catalogRoute(route, {
                section: 'search',
                query: query,
                page: 1,
                folder: '',
                genre: '',
                genreTitle: '',
                quality: '',
                qualityTitle: ''
              })
            );
          }
        );
      }
      function catalogFilters(route) {
        var owner = pages.current();
        menu('Фильтры KinoPub', [
          {
            title: 'Жанр: ' + (route.kp_genre_title || 'Все'),
            run: function () {
              choose('/genres', 'genre', 'genreTitle');
            }
          },
          {
            title: 'Качество: ' + (route.kp_quality_title || 'Любое'),
            run: function () {
              choose('/references/video-quality', 'quality', 'qualityTitle');
            }
          },
          {
            title: 'Сбросить фильтры',
            run: function () {
              pages.show(
                catalogRoute(route, {
                  page: 1,
                  genre: '',
                  genreTitle: '',
                  quality: '',
                  qualityTitle: ''
                })
              );
            }
          }
        ]);
        function choose(path, key, label) {
          client.api(path, {}, function (error, json) {
            if (pages.current() !== owner) {
              return;
            }
            if (error) {
              notify(errorMessage(error));
              return;
            }
            var values = Array.isArray(json) ? json : json.items || [];
            menu(
              key === 'genre' ? 'Жанр' : 'Качество',
              [
                {
                  title: 'Все',
                  run: function () {
                    select('', '');
                  }
                }
              ].concat(
                values.map(function (value) {
                  return {
                    title: value.title,
                    run: function () {
                      select(value.id, value.title);
                    }
                  };
                })
              )
            );
          });
          function select(id, title) {
            if (pages.current() !== owner) {
              return;
            }
            var changes = { page: 1 };
            changes[key] = id;
            changes[label] = title;
            pages.show(catalogRoute(route, changes));
          }
        }
      }
      function bookmarkMenu(item) {
        var owner = pages.current();
        client.api('/bookmarks', {}, function (error, json) {
          if (pages.current() !== owner) {
            return;
          }
          if (error) {
            notify(errorMessage(error));
            return;
          }
          var folders = json.items || [];
          client.api(
            '/bookmarks/get-item-folders',
            { item: item.id },
            function (error, memberships) {
              if (pages.current() !== owner) {
                return;
              }
              if (error) {
                notify(errorMessage(error));
                return;
              }
              var present = (memberships.folders || []).map(function (folder) {
                return String(folder.id);
              });
              var choices = folders.map(function (folder) {
                var contains = present.indexOf(String(folder.id)) !== -1;
                return {
                  title:
                    (contains ? '✓ Удалить из «' : 'Добавить в «') +
                    folder.title +
                    '»',
                  run: function () {
                    change(folder.id, contains);
                  }
                };
              });
              if (!choices.length) {
                choices.push({
                  title: 'Создать папку «Избранное» и добавить',
                  run: function () {
                    if (pages.current() !== owner) {
                      return;
                    }
                    client.api(
                      '/bookmarks/create',
                      { title: 'Избранное' },
                      function (error, result) {
                        if (!error && result.folder && result.folder.id) {
                          bookmarkRevision++;
                        }
                        if (pages.current() !== owner) {
                          return;
                        }
                        if (error || !result.folder || !result.folder.id) {
                          notify(
                            'Не удалось создать папку KinoPub. Повтори позже.'
                          );
                          return;
                        }
                        change(result.folder.id, false);
                      },
                      false,
                      true
                    );
                  }
                });
              }
              menu('Закладки KinoPub · ' + item.title, choices);
            }
          );
        });
        function change(folder, remove) {
          if (pages.current() !== owner) {
            return;
          }
          client.api(
            remove ? '/bookmarks/remove-item' : '/bookmarks/add',
            { item: item.id, folder: folder },
            function (error) {
              if (!error) {
                bookmarkRevision++;
              }
              if (pages.current() !== owner) {
                return;
              }
              if (error) {
                notify(errorMessage(error));
                return;
              }
              notify(
                remove
                  ? 'Удалено из папки KinoPub.'
                  : 'Добавлено в папку KinoPub.'
              );
              pages.refresh();
            },
            false,
            true
          );
        }
      }
      function catalogRows(route, done) {
        var loadedRevision = bookmarkRevision;
        var loadedGeneration = client.generation();
        var names = {
          new: 'Новинки',
          movies: 'Фильмы',
          series: 'Сериалы',
          documentaries: 'Документальные фильмы',
          docuseries: 'Документальные сериалы',
          concerts: 'Концерты',
          shows: 'ТВ-шоу',
          stereo: '3D-фильмы',
          search: 'Поиск',
          folders: 'Избранное',
          folder: 'Избранное'
        };
        var section = Object.prototype.hasOwnProperty.call(
          names,
          route.kp_section
        )
          ? route.kp_section
          : 'new';
        var page = Math.min(
          10000,
          Math.max(1, Math.floor(Number(route.kp_page) || 1))
        );
        var sorts = {
          'created-': 'По дате добавления',
          'updated-': 'По обновлению',
          'rating-': 'По рейтингу',
          'views-': 'По просмотрам'
        };
        var sort = Object.prototype.hasOwnProperty.call(sorts, route.kp_sort)
          ? route.kp_sort
          : section === 'new'
            ? 'created-'
            : 'updated-';
        var actions = ['new', 'movies', 'series', 'search', 'folders'].map(
          function (name) {
            return {
              title: (section === name ? '✓ ' : '') + names[name],
              run: function () {
                if (name === 'search') {
                  catalogSearch(route);
                } else {
                  pages.show(
                    catalogRoute(route, {
                      section: name,
                      page: 1,
                      query: '',
                      folder: '',
                      genre: '',
                      genreTitle: '',
                      quality: '',
                      qualityTitle: ''
                    })
                  );
                }
              }
            };
          }
        );
        var bookmarks = section === 'folder' || section === 'folders';
        actions.splice(3, 0, {
          title: 'Разделы',
          run: function () {
            menu(
              'Библиотека KinoPub',
              [
                'new',
                'movies',
                'series',
                'documentaries',
                'docuseries',
                'concerts',
                'shows',
                'stereo'
              ].map(function (name) {
                return {
                  title: (section === name ? '✓ ' : '') + names[name],
                  run: function () {
                    pages.show(
                      catalogRoute(route, {
                        section: name,
                        page: 1,
                        query: '',
                        folder: '',
                        genre: '',
                        genreTitle: '',
                        quality: '',
                        qualityTitle: '',
                        sort: ''
                      })
                    );
                  }
                };
              })
            );
          }
        });
        var params = { page: page, perpage: 20 };
        var path = '/items';
        if (section === 'search') {
          path += '/search';
          params.q = String(route.kp_query || '').slice(0, 100);
        } else if (bookmarks) {
          path =
            section === 'folders'
              ? '/bookmarks'
              : '/bookmarks/' + encodeURIComponent(String(route.kp_folder));
          params = {};
        } else {
          params.sort = sort;
          var sectionTypes = {
            movies: 'movie',
            series: 'serial',
            documentaries: 'documovie',
            docuseries: 'docuserial',
            concerts: 'concert',
            shows: 'tvshow',
            stereo: '3D'
          };
          if (sectionTypes[section]) {
            params.type = sectionTypes[section];
          }
          if (route.kp_genre) {
            params.genre = route.kp_genre;
          }
          if (route.kp_quality) {
            params['quality[]'] = route.kp_quality;
          }
          actions.push({
            title: 'Фильтры',
            run: function () {
              catalogFilters(route);
            }
          });
          actions.push({
            title: sorts[sort],
            run: function () {
              menu(
                'Сортировка KinoPub',
                Object.keys(sorts).map(function (value) {
                  return {
                    title: (value === sort ? '✓ ' : '') + sorts[value],
                    run: function () {
                      pages.show(catalogRoute(route, { sort: value, page: 1 }));
                    }
                  };
                })
              );
            }
          });
        }
        client.api(path, params, function (error, json) {
          if (error) {
            done(errorMessage(error));
            return;
          }
          var items = json.items || [];
          var total = Math.min(
            10000,
            Math.max(
              1,
              Math.floor(Number(json.pagination && json.pagination.total) || 1)
            )
          );
          if (bookmarks) {
            total = Math.max(1, Math.ceil(items.length / 20));
            items = items.slice((page - 1) * 20, page * 20);
          }
          done(null, {
            isStale: function () {
              return (
                loadedGeneration !== client.generation() ||
                (bookmarks && loadedRevision !== bookmarkRevision)
              );
            },
            title:
              'KinoPub · ' +
              (section === 'search'
                ? '«' + params.q + '»'
                : section === 'folder' && json.folder
                  ? json.folder.title
                  : names[section]),
            details: [
              !bookmarks && section !== 'search' && route.kp_genre_title,
              !bookmarks && section !== 'search' && route.kp_quality_title
            ]
              .filter(Boolean)
              .join(' · '),
            hint:
              section === 'folders'
                ? 'Выбери папку закладок своего аккаунта KinoPub.'
                : 'Удерживай OK на карточке, чтобы добавить в закладки.',
            empty: bookmarks
              ? 'Пока пусто. Добавляй материалы долгим нажатием на карточку в каталоге.'
              : 'Ничего не найдено. Измени поиск или фильтры.',
            layout: section === 'folders' ? 'folders' : 'catalog',
            actions: actions,
            more:
              page < total && items.length
                ? function (callback) {
                    var next = {};
                    Object.keys(route).forEach(function (key) {
                      next[key] = route[key];
                    });
                    next.kp_page = page + 1;
                    next.kp_section = section;
                    catalogRows(next, callback);
                  }
                : null,
            rows: items.map(function (item) {
              if (section === 'folders') {
                return {
                  key: 'folder:' + item.id,
                  title: item.title,
                  subtitle: 'Материалов: ' + (Number(item.count) || 0),
                  symbol: '★',
                  next: {
                    view: 'catalog',
                    section: 'folder',
                    folder: item.id,
                    page: 1
                  }
                };
              }
              var image = item.posters || {};
              var types = {
                movie: 'Фильм',
                serial: 'Сериал',
                documovie: 'Документальный фильм',
                docuserial: 'Документальный сериал',
                concert: 'Концерт',
                tvshow: 'ТВ-шоу',
                '3D': '3D'
              };
              var titles = String(item.title || '').split(' / ');
              var quality = Number(item.quality);
              var badges = [];
              if (quality > 100) {
                badges.push(quality === 2160 ? 'UHD 4K' : quality + 'p');
              }
              if (Number(item.ac3) > 0) {
                badges.push('AC3');
              }
              var rating = Number(item.imdb_rating);
              return {
                key:
                  item.id === undefined || item.id === null
                    ? ''
                    : 'item:' + item.id,
                title: titles[0],
                original: titles.slice(1).join(' / '),
                badges: badges,
                rating:
                  rating > 0 && rating <= 10 ? 'IMDb ' + rating.toFixed(1) : '',
                subtitle: [
                  item.year,
                  (item.genres || [])
                    .map(function (genre) {
                      return genre.title;
                    })
                    .filter(Boolean)
                    .join(', ') || types[String(item.type)]
                ]
                  .filter(Boolean)
                  .join(' · '),
                poster: String(
                  image.big || image.medium || image.small || ''
                ).replace(/^http:/, 'https:'),
                next: { view: 'item', id: item.id },
                menu: function () {
                  bookmarkMenu(item);
                }
              };
            })
          });
        });
      }
      return { open: openCatalog, load: catalogRows };
    }

    var icon =
      '<svg width="48" height="48" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="Kinolamp">\n  <rect x="1" y="1" width="94" height="94" rx="26" fill="#142329" stroke="#2b4249" stroke-width="2"/>\n  <path d="M22 8h35C35 8 19 23 15 42V24c0-9 3-13 7-16Z" fill="#fff" opacity=".035"/>\n  <path d="M48 18c-13.3 0-24 10.5-24 23.5 0 9 4.7 15.6 11.2 21.2l1.5 3.3h22.6l1.5-3.3C67.3 57.1 72 50.5 72 41.5 72 28.5 61.3 18 48 18Z" fill="#9cebc9"/>\n  <path d="M48 18c-13.3 0-24 10.5-24 23.5 0 3.1.6 5.9 1.6 8.4C25.2 34.4 36 23 49.4 23c8.2 0 15.4 3.6 20 9.2C65.7 23.8 57.5 18 48 18Z" fill="#d6ffed"/>\n  <path d="M43.7 31.1a2.4 2.4 0 0 0-3.7 2v19.8a2.4 2.4 0 0 0 3.7 2l15-9.9a2.4 2.4 0 0 0 0-4Z" fill="#142329"/>\n  <rect x="37" y="71" width="22" height="5" rx="2.5" fill="#9cebc9"/>\n  <path d="M41 81h14a7.7 7.7 0 0 1-14 0Z" fill="#68caa7"/>\n  <path d="m20 19-4-4m60 4 4-4M48 8V5" fill="none" stroke="#9cebc9" stroke-width="2.5" stroke-linecap="round" opacity=".45"/>\n</svg>\n';

    function installSettings(
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
      function setting(
        key,
        type,
        name,
        description,
        values,
        initial,
        advanced
      ) {
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

    function installWatch(Lampa, $, search, ui) {
      var notify = ui.notify;
      var menu = ui.menu;
      Lampa.Listener.follow('full', function (event) {
        if (
          !event ||
          event.type !== 'complite' ||
          !event.data ||
          !event.data.movie
        ) {
          return;
        }
        var holder =
          event.object &&
          event.object.activity &&
          event.object.activity.render();
        if (!holder || holder.find('.kp-self-button').length) {
          return;
        }
        var target = holder.find('.buttons--container').first();
        if (!target.length) {
          notify(
            'Не удалось подключить KinoPub к кнопке «Смотреть». Обнови Lampa.'
          );
          return;
        }
        var button = $('<div class="full-start__button kp-self-button"></div>');
        button.append($(icon)).append($('<span></span>').text('KinoPub'));
        button.on('hover:enter', function () {
          search(event.data.movie);
        });
        target.append(button);
        // Extend Lampa's button grouping after its own source handlers are installed.
        var start = event.link && event.link.items && event.link.items[0];
        if (start && start.use) {
          start.use({
            onGroupButtons: function () {
              var html = this.html;
              html
                .find('.button--play')
                .unbind('hover:enter hover:long')
                .on('hover:enter', function () {
                  search(event.data.movie);
                })
                .on('hover:long', function () {
                  var sources = [];
                  html
                    .find('.buttons--container > .full-start__button')
                    .not('.hide')
                    .each(function () {
                      var source = $(this);
                      sources.push({
                        title: source.text(),
                        run: function () {
                          source.trigger('hover:enter');
                        }
                      });
                    });
                  menu('Источники', sources);
                });
            }
          });
        }
      });
    }

    // Own only the status text for Kinolamp. Lampa keeps playback and HLS recovery.
    function installPlayerFeedback(Lampa) {
      if (
        !Lampa.Player.listener ||
        !Lampa.PlayerVideo ||
        !Lampa.PlayerVideo.listener ||
        !Lampa.PlayerInfo ||
        typeof Lampa.PlayerInfo.set !== 'function'
      ) {
        return;
      }
      var owned = false;
      var session = 0;
      var waiting = false;
      var longWait = false;
      var position = null;
      var warningTimer;
      var writeTimer;
      var recoverable = [
        'bufferFullError',
        'bufferStalledError',
        'fragLoadError',
        'fragLoadTimeOut'
      ];
      function cancel() {
        clearTimeout(warningTimer);
        clearTimeout(writeTimer);
        waiting = false;
        longWait = false;
      }
      function write(message) {
        clearTimeout(writeTimer);
        var expected = session;
        // PlayerInfo may subscribe after us and write raw HLS text synchronously.
        // Defer our text until all native handlers have finished without editing
        // the event that diagnostics and the recovery engine still need.
        writeTimer = setTimeout(function () {
          if (owned && session === expected) {
            Lampa.PlayerInfo.set('error', message);
          }
        }, 0);
      }
      function showWaiting() {
        if (!owned) {
          return;
        }
        if (!waiting) {
          waiting = true;
          var expected = session;
          warningTimer = setTimeout(function () {
            if (owned && waiting && session === expected) {
              longWait = true;
              write(
                'Видео не загружается. Попробуйте повторить воспроизведение.'
              );
            }
          }, 15000);
        }
        write(
          longWait
            ? 'Видео не загружается. Попробуйте повторить воспроизведение.'
            : 'Загрузка видео…'
        );
      }
      function resumed() {
        if (owned && waiting) {
          cancel();
          write('');
        }
      }
      Lampa.Player.listener.follow('start', function (work) {
        cancel();
        session++;
        position = null;
        owned = !!(work && work._kinolampDiagnostic);
      });
      Lampa.Player.listener.follow('destroy', function () {
        cancel();
        session++;
        position = null;
        owned = false;
      });
      Lampa.PlayerVideo.listener.follow('waiting', showWaiting);
      Lampa.PlayerVideo.listener.follow('stalled', showWaiting);
      Lampa.PlayerVideo.listener.follow('playing', resumed);
      Lampa.PlayerVideo.listener.follow('pause', resumed);
      Lampa.PlayerVideo.listener.follow('ended', resumed);
      Lampa.PlayerVideo.listener.follow('timeupdate', function (event) {
        if (
          !owned ||
          !event ||
          typeof event.current !== 'number' ||
          !isFinite(event.current) ||
          event.current < 0
        ) {
          return;
        }
        // Some native TV players report progress but omit a resumed/playing event.
        // A repeated timestamp is not evidence that playback has recovered.
        if (position !== null && event.current > position) {
          resumed();
        }
        position = event.current;
      });
      Lampa.PlayerVideo.listener.follow('error', function (event) {
        if (!owned || !event) {
          return;
        }
        if (event.fatal === true) {
          // A delayed buffering message must not overwrite a native fatal error.
          cancel();
          return;
        }
        if (event.fatal !== false || typeof event.error !== 'string') {
          return;
        }
        var match = event.error.match(
          /^details \[([a-zA-Z]+)\] fatal \[false\]$/
        );
        if (match && recoverable.indexOf(match[1]) !== -1) {
          showWaiting();
        }
      });
    }

    function language(value) {
      var code = String(value || '')
        .toLowerCase()
        .replace(/[^a-z].*$/, '');
      var aliases = {
        ru: 'rus',
        en: 'eng',
        uk: 'ukr',
        ja: 'jpn',
        de: 'deu',
        ger: 'deu',
        fr: 'fra',
        fre: 'fra',
        es: 'spa',
        it: 'ita',
        ko: 'kor',
        zh: 'zho',
        chi: 'zho'
      };
      return code === 'und' ? '' : aliases[code] || code;
    }
    // Translate names only. The original native track objects and their enabled
    // setters remain owned by Lampa, including Tizen AVPlay and WebOS audio handles.
    function installAudioLabels(Lampa) {
      if (
        !Lampa.Player.listener ||
        !Lampa.PlayerVideo ||
        !Lampa.PlayerVideo.listener ||
        !Lampa.PlayerPanel ||
        typeof Lampa.PlayerPanel.setTranslate !== 'function'
      ) {
        return;
      }
      var current = null;
      Lampa.Player.listener.follow('start', function (work) {
        current = work && Array.isArray(work._kinolampAudios) ? work : null;
      });
      Lampa.Player.listener.follow('destroy', function () {
        current = null;
      });
      function update(event) {
        if (
          !current ||
          !event ||
          !Array.isArray(event.tracks) ||
          !event.tracks.length
        ) {
          return;
        }
        var tracks = event.tracks;
        var audios = current._kinolampAudios.slice();
        if (
          audios.every(function (audio) {
            return Number(audio.index) > 0;
          })
        ) {
          audios.sort(function (a, b) {
            return Number(a.index) - Number(b.index);
          });
        }
        var labels = tracks.map(function (track, position) {
          var lang = language(track.language || track.lang);
          var audio = audios.length === tracks.length ? audios[position] : null;
          if (
            audio &&
            lang &&
            language(audio.lang) &&
            language(audio.lang) !== lang
          ) {
            audio = null;
          }
          if (!audio && lang) {
            var matches = audios.filter(function (candidate) {
              return language(candidate.lang) === lang;
            });
            var nativeMatches = tracks.filter(function (candidate) {
              return language(candidate.language || candidate.lang) === lang;
            });
            if (matches.length === 1 && nativeMatches.length === 1) {
              audio = matches[0];
            }
          }
          // A mismatch is not proof that every API voice exists in this stream.
          // Null keeps Lampa's own label instead of inventing a selectable track.
          return audio
            ? {
                name: escapeText(audioTitle(audio, position)),
                extra: track.extra
              }
            : null;
        });
        var translate = current.translate || {};
        translate.tracks = labels;
        current.translate = translate;
        Lampa.PlayerPanel.setTranslate(translate);
      }
      Lampa.PlayerVideo.listener.follow('tracks', update);
      Lampa.PlayerVideo.listener.follow('webos_tracks', update);
    }

    var catalogIcon =
      '<!-- KinoPub mark from https://m.staticpop.net/logo.svg, linked by https://kino.watch/user/login. Colour inherits the Lampa menu theme. -->\n<svg width="48" height="48" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">\n  <g transform="translate(-4.436480,132.430785) scale(0.106804,-0.106965)" fill="currentColor">\n        <path d="M492 1220 c-109 -29 -187 -74 -272 -160 -87 -86 -131 -163 -160 -276\n-50 -193 3 -400 139 -547 30 -32 74 -72 98 -88 l43 -30 0 296 0 296 29 57 c57\n111 153 172 271 172 119 0 217 -63 274 -177 38 -76 37 -172 -3 -251 -57 -112\n-153 -172 -273 -172 -44 1 -83 6 -98 15 -14 8 -30 14 -36 15 -11 0 -154 -233\n-154 -250 0 -12 91 -48 162 -65 130 -31 285 -9 411 57 81 42 203 164 245 245\n42 80 72 198 72 283 0 85 -30 203 -72 283 -42 81 -164 203 -245 245 -132 69\n-291 88 -431 52z"/>\n    <path d="M585 695 c-16 -15 -25 -36 -25 -55 0 -19 9 -40 25 -55 49 -50 135\n-15 135 55 0 19 -9 40 -25 55 -15 16 -36 25 -55 25 -19 0 -40 -9 -55 -25z"/>\n  </g>\n</svg>\n';

    function nameExtension(Lampa, root) {
      var script = root.document && root.document.currentScript;
      if (
        !script ||
        !script.src ||
        !Lampa.Plugins ||
        !Lampa.Plugins.get ||
        !Lampa.Plugins.save
      ) {
        return;
      }
      var scriptURL = script.src.split(/[?#]/)[0];
      var changed = false;
      Lampa.Plugins.get().forEach(function (entry) {
        if (
          entry.url &&
          entry.url.split(/[?#]/)[0] === scriptURL &&
          !entry.name
        ) {
          entry.name = 'Kinolamp';
          entry.author = 'zyab1ik';
          entry.descr = 'KinoPub для Lampa · собственная инфраструктура';
          changed = true;
        }
      });
      if (changed) {
        Lampa.Plugins.save();
      }
    }
    function install(Lampa, $, root) {
      if (!$ || !Lampa.SettingsApi || !Lampa.Select || !Lampa.Reguest) {
        return;
      }
      nameExtension(Lampa, root);
      installPlayerFeedback(Lampa);
      installAudioLabels(Lampa);
      var ui = createUi(Lampa);
      var diagnostics = createDiagnostics(Lampa.Storage, Date.now);
      var transport = createTransport(Lampa, diagnostics);
      var client = createClient(Lampa.Storage, transport);
      var authorization = createAuthorization(Lampa, $, client, ui);
      var playerDiagnostics = createPlayerDiagnostics(
        Lampa,
        $,
        root,
        client,
        transport,
        diagnostics,
        ui
      );
      // Page callbacks run after registration, when both controllers have been created.
      var playback;
      var catalog;
      var pages = createNativePages(
        Lampa,
        $,
        root.Navigator,
        function (route, done) {
          if (route.kp_view === 'catalog') {
            catalog.load(route, done);
          } else {
            playback.load(route, done);
          }
        },
        function (row) {
          playback.activate(row);
        }
      );
      playback = createPlayback(Lampa, {
        client: client,
        transport: transport,
        pages: pages,
        progress: createProgress(Lampa.Storage),
        diagnostics: diagnostics,
        recordSource: playerDiagnostics.source,
        authorization: authorization,
        ui: ui
      });
      catalog = createCatalog(Lampa, client, pages, ui);
      installSettings(
        Lampa,
        client,
        authorization,
        playback,
        catalog,
        playerDiagnostics,
        ui
      );
      installWatch(Lampa, $, playback.search, ui);
      if (pages && Lampa.Menu && Lampa.Menu.addButton) {
        var catalogMenuAdded = false;
        var addCatalogMenu = function () {
          if (catalogMenuAdded) {
            return;
          }
          catalogMenuAdded = true;
          Lampa.Menu.addButton(catalogIcon, 'KinoPub', catalog.open).attr(
            'data-action',
            'kinolamp'
          );
        };
        if (root.appready) {
          addCatalogMenu();
        } else {
          Lampa.Listener.follow('app', function (event) {
            if (event && event.type === 'ready') {
              addCatalogMenu();
            }
          });
        }
      }
      if (Lampa.Manifest) {
        Lampa.Manifest.plugins = {
          type: 'video',
          name: 'Kinolamp',
          version: VERSION,
          description: 'Личный источник KinoPub без телеметрии'
        };
      }
    }

    // Keep the public CommonJS API used by integration tests and existing consumers.
    var index = {
      install: install,
      createClient: createClient,
      escapeText: escapeText,
      httpsURL: httpsURL,
      streams: streams,
      audioTitle: audioTitle,
      matchItem: matchItem,
      createNativePages: createNativePages,
      nameExtension: nameExtension,
      mediaKey: mediaKey,
      createProgress: createProgress,
      episodeQueue: episodeQueue,
      voiceIdentity: voiceIdentity,
      createDiagnostics: createDiagnostics
    };

    return index;
  })();

  return plugin;
});
