/* Kinolamp 0.4.3 — MIT. Generated from web/plugin/index.ts; edit sources and run make build-plugin. */
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

    var VERSION = '0.4.3';
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

    function cleanDescription(value) {
      // eslint-disable-next-line no-control-regex -- Device descriptions must not contain control characters.
      var controls = /[\x00-\x1f\x7f]/g;
      return value.replace(controls, '').trim().slice(0, 80);
    }
    // These are UA signatures, not a device allowlist. Unknown platforms are retained.
    function systemInfo(agent) {
      var signatures = [
        { name: 'iOS', pattern: /(?:CPU(?: iPhone)? OS|iPhone OS) ([\d_]+)/i },
        { name: 'Android', pattern: /Android[ /]([\d.]+)/i },
        { name: 'Tizen', pattern: /Tizen[ /]([\d.]+)/i },
        { name: 'webOS', pattern: /(?:webOS|Web0S)[ /]([\d.]+)/i },
        { name: 'Windows NT', pattern: /Windows NT ([\d.]+)/i },
        { name: 'macOS', pattern: /Mac OS X[ /]([\d_.]+)/i },
        { name: 'Chrome OS', pattern: /CrOS [^; )]+ ([\d.]+)/i }
      ];
      for (var index = 0; index < signatures.length; index++) {
        var signature = signatures[index];
        var match = signature.pattern.exec(agent);
        if (match) {
          return { name: signature.name, version: match[1].replace(/_/g, '.') };
        }
      }
      return { name: /Linux/i.test(agent) ? 'Linux' : '', version: '' };
    }
    // Use available descriptions only; never send the complete UA or device IDs.
    function deviceInfo(Lampa, root, customName) {
      var platform =
        Lampa.Platform && typeof Lampa.Platform.get === 'function'
          ? Lampa.Platform.get()
          : '';
      var navigator = root.navigator;
      var agent = navigator ? navigator.userAgent : '';
      var system = systemInfo(agent);
      var hints = navigator && navigator.userAgentData;
      // Browser-provided platform descriptions also cover systems unknown to us.
      var availablePlatform = hints ? cleanDescription(hints.platform) : '';
      if (!availablePlatform && navigator) {
        availablePlatform = cleanDescription(navigator.platform || '');
      }
      var operatingSystem = system.name || availablePlatform;
      var androidModel = /Android[^)]*;\s*([^;()]+?)\s+Build\//i.exec(agent);
      var appleDevice = /\b(iPhone|iPad|iPod)\b/.exec(agent);
      var model = androidModel
        ? cleanDescription(androidModel[1])
        : appleDevice
          ? appleDevice[1]
          : '';
      var description = model || operatingSystem || cleanDescription(platform);
      return {
        title:
          cleanDescription(customName) ||
          (description ? description + ' · Kinolamp' : 'Устройство с Lampa'),
        hardware: description || 'Устройство с Lampa',
        software:
          'Kinolamp ' +
          VERSION +
          (operatingSystem ? ' · ' + operatingSystem : '') +
          (system.version ? ' ' + system.version : '')
      };
    }

    function createAuthorization(Lampa, $, client, ui, root) {
      var notify = ui.notify;
      var restore = ui.restore;
      var errorMessage = ui.errorMessage;
      var pendingLogin = null;
      function updateDevice() {
        if (!client.hasToken()) {
          return;
        }
        client.notifyDevice(
          deviceInfo(Lampa, root, client.get('device_name')),
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
      return {
        login: login,
        logout: logout,
        authorized: authorized,
        updateDevice: updateDevice
      };
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
      ".kp-page {\n  font-family: inherit;\n  height: 100%;\n  display: flex;\n  flex-direction: column;\n  padding: 0.65em 2em;\n  box-sizing: border-box;\n}\n.kp-page__head {\n  display: flex;\n  align-items: center;\n  margin-bottom: 0.35em;\n}\n.kp-page__title {\n  font-size: 1.8em;\n  font-weight: 600;\n  line-height: 1.2;\n}\n.kp-page__status {\n  opacity: 0.65;\n  margin-bottom: 0.45em;\n}\n.kp-page > .scroll {\n  flex: 1;\n  min-height: 0;\n}\n.kp-page__grid {\n  display: grid;\n  grid-template-columns: repeat(5, minmax(0, 1fr));\n  /* Older TV engines understand grid-gap but ignore the newer gap alias. */\n  grid-gap: 2em 1.5em;\n  align-items: start;\n  padding: 0.4em;\n}\n.kp-page__card {\n  min-width: 0;\n  box-sizing: border-box;\n}\n.kp-page__poster {\n  height: 0;\n  padding-bottom: 150%;\n  position: relative;\n  border-radius: 0.6em;\n  background: rgba(255, 255, 255, 0.07);\n  overflow: hidden;\n  outline: 0.18em solid transparent;\n  outline-offset: 0.25em;\n}\n.kp-page__poster img {\n  position: absolute;\n  width: 100%;\n  height: 100%;\n  object-fit: cover;\n}\n.kp-page__placeholder {\n  position: absolute;\n  top: 0;\n  right: 0;\n  bottom: 0;\n  left: 0;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  opacity: 0.4;\n  font-size: 2em;\n}\n.kp-page__card.focus .kp-page__poster {\n  outline-color: currentColor;\n}\n.kp-page__name {\n  margin-top: 0.85em;\n  word-wrap: break-word;\n}\n.kp-page__meta {\n  opacity: 0.55;\n  font-size: 0.75em;\n  margin-top: 0.3em;\n}\n@media (max-width: 800px) {\n  .kp-page {\n    padding: 1em;\n  }\n  .kp-page__grid {\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n  }\n}\n@media (max-width: 480px) {\n  .kp-page__grid {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n}\n.kp-page__details {\n  font-size: 1em;\n  opacity: 0.8;\n  line-height: 1.5;\n}\n.kp-page__description {\n  max-width: 65em;\n  font-size: 1.05em;\n  line-height: 1.55;\n  white-space: pre-line;\n  margin: 0.6em 0 1.5em;\n}\n.kp-page__description:empty,\n.kp-page__details:empty {\n  display: none;\n}\n.kp-page__grid[data-layout='seasons'] {\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n}\n.kp-page__grid[data-layout='episodes'] {\n  grid-template-columns: repeat(3, minmax(0, 1fr));\n}\n.kp-page__grid[data-layout='episodes'] .kp-page__poster {\n  padding-bottom: 56.25%;\n}\n.kp-page__grid[data-layout='episodes'] .kp-page__name,\n.kp-page__grid[data-layout='seasons'] .kp-page__name {\n  font-size: 1.15em;\n  font-weight: 600;\n}\n.kp-page__meta {\n  font-size: 0.95em;\n  opacity: 0.75;\n  line-height: 1.4;\n}\n@media (max-width: 800px) {\n  .kp-page__grid[data-layout='episodes'],\n  .kp-page__grid[data-layout='seasons'] {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n}\n@media (max-width: 480px) {\n  .kp-page__grid[data-layout='episodes'] {\n    grid-template-columns: 1fr;\n  }\n}\n.kp-page__toolbar {\n  display: flex;\n  flex-wrap: wrap;\n  margin: 0.2em 0 0.6em;\n}\n.kp-page__action {\n  /* Margins also work on TV browsers without flex gap support. */\n  margin: 0 0.6em 0.6em 0;\n  font-size: 1em;\n  padding: 0.6em 1em;\n  border-radius: 0.35em;\n  background: rgba(255, 255, 255, 0.09);\n  line-height: 1.2;\n}\n.kp-page__action.focus {\n  background: #fff;\n  color: #1d1f20;\n}\n.kp-page__grid[data-layout='folders'] {\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n}\n.kp-page__grid[data-layout='folders'] .kp-page__poster {\n  padding-bottom: 56.25%;\n}\n.kp-page__grid[data-layout='folders'] .kp-page__placeholder {\n  font-size: 3em;\n  color: #9cebc9;\n}\n.kp-page__grid[data-layout='catalog'] .kp-page__card {\n  display: flex;\n  flex-direction: column;\n}\n.kp-page__grid[data-layout='catalog'] .kp-page__poster {\n  border-radius: 0.4em;\n}\n.kp-page__grid[data-layout='catalog'] .kp-page__name {\n  order: 1;\n}\n.kp-page__original {\n  order: 2;\n  font-size: 0.85em;\n  line-height: 1.35;\n  margin-top: 0.25em;\n  opacity: 0.55;\n  word-wrap: break-word;\n}\n.kp-page__grid[data-layout='catalog'] .kp-page__meta {\n  order: 3;\n  font-size: 0.85em;\n  line-height: 1.4;\n  opacity: 0.75;\n}\n.kp-page__badges {\n  position: absolute;\n  top: 0.55em;\n  left: 0.55em;\n  right: 0.55em;\n}\n.kp-page__badge {\n  display: inline-block;\n  margin: 0 0.35em 0.35em 0;\n  padding: 0.25em 0.45em;\n  border-radius: 0.3em;\n  background: #143b2c;\n  color: #b6f4cf;\n  font-size: 0.75em;\n  font-weight: 600;\n}\n.kp-page__rating {\n  position: absolute;\n  bottom: 0.55em;\n  left: 0.55em;\n  padding: 0.3em 0.5em;\n  border-radius: 0.3em;\n  background: rgba(0, 0, 0, 0.8);\n  color: #fff;\n  font-size: 0.8em;\n}\n.kp-page__pagination {\n  margin-top: 1.8em;\n  justify-content: center;\n}\n.kp-page__pagination:empty {\n  display: none;\n}\n\n.kp-page__loading {\n  font: inherit;\n  width: 100%;\n  text-align: center;\n  opacity: 0.7;\n  padding: 0.6em;\n}\n\n.kp-page__grid[data-layout='collections'] .kp-page__card {\n  padding: 0.65em;\n  border: 1px solid rgba(255, 255, 255, 0.1);\n  border-radius: 1.5em;\n  background: rgba(255, 255, 255, 0.025);\n}\n.kp-page__grid[data-layout='collections'] .kp-page__poster {\n  border-radius: 1em;\n}\n.kp-page__grid[data-layout='collections'] .kp-page__name {\n  margin: 0.65em 0.3em 0;\n  font-weight: 600;\n}\n.kp-page__grid[data-layout='collections'] .kp-page__meta {\n  margin: 0.4em 0.3em;\n  font-size: 0.8em;\n}\n\n.kp-page__catalog-body {\n  display: flex;\n  align-items: flex-start;\n}\n.kp-page__catalog-body > .kp-page__grid {\n  flex: 1;\n  min-width: 0;\n}\n.kp-page__categories {\n  width: 15em;\n  flex-shrink: 0;\n  margin: 0.4em 1.7em 0 0;\n  padding: 0.65em;\n  border-radius: 1em;\n  background: rgba(0, 0, 0, 0.2);\n}\n.kp-page__categories:empty {\n  display: none;\n}\n.kp-page__categories .kp-page__action {\n  margin: 0 0 0.2em;\n  line-height: 1.5;\n  background: transparent;\n}\n.kp-page__categories .kp-page__action.focus {\n  background: #fff;\n}\n.kp-page__categories:not(:empty) + .kp-page__grid {\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n}\n@media (max-width: 1100px) {\n  .kp-page__categories:not(:empty) + .kp-page__grid {\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n  }\n  .kp-page__catalog-body {\n    display: block;\n  }\n  .kp-page__categories {\n    display: flex;\n    width: auto;\n    overflow-x: auto;\n    margin: 0 0 1em;\n    padding: 0.4em;\n  }\n  .kp-page__categories .kp-page__action {\n    flex: 0 0 auto;\n    max-width: 18em;\n    margin: 0 0.4em 0 0;\n  }\n}\n@media (max-width: 480px) {\n  .kp-page__categories:not(:empty) + .kp-page__grid {\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n  }\n}\n\n.kp-page__stats {\n  position: absolute;\n  bottom: 0.65em;\n  left: 0.35em;\n  right: 0.35em;\n  display: flex;\n  justify-content: center;\n}\n.kp-page__stats:empty {\n  display: none;\n}\n.kp-page__stat {\n  padding: 0.22em 0.45em;\n  margin: 0 0.12em;\n  border: 1px solid rgba(255, 255, 255, 0.18);\n  border-radius: 1em;\n  background: rgba(10, 13, 18, 0.9);\n  color: #d3d9e0;\n  font-size: 0.85em;\n  white-space: nowrap;\n}\n.kp-page__grid[data-layout='collections'] .kp-page__name {\n  display: -webkit-box;\n  -webkit-line-clamp: 2;\n  -webkit-box-orient: vertical;\n  overflow: hidden;\n  min-height: 2.7em;\n  max-height: 2.7em;\n  line-height: 1.35;\n}\n.kp-page__grid[data-layout='collections'] .kp-page__meta:empty,\n.kp-page__tabs:empty {\n  display: none;\n}\n\n/* Lampa reserves fading space around native lists; this page has its own header. */\n.kp-page > .scroll {\n  -webkit-mask-image: none;\n  mask-image: none;\n}\n.kp-page > .scroll > .scroll__content {\n  padding: 0.3em 0 1em;\n}\n.kp-page__controls {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: flex-start;\n  margin-bottom: 0.25em;\n}\n.kp-page__controls > .kp-page__toolbar {\n  margin: 0 0.8em 0 0;\n}\n.kp-page__controls .kp-page__action {\n  margin-bottom: 0.4em;\n}\n.kp-page__grid[data-layout='collections'] .kp-page__name {\n  display: block;\n  -webkit-line-clamp: unset;\n  max-height: none;\n}\n";

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
        var catalogBody = $('<div class="kp-page__catalog-body"></div>');
        var sidebar = $('<div class="kp-page__categories"></div>');
        catalogBody.append(sidebar).append(grid);
        var toolbar = $('<div class="kp-page__toolbar"></div>');
        var tabs = $('<div class="kp-page__toolbar kp-page__tabs"></div>');
        var controls = $('<div class="kp-page__controls"></div>');
        controls.append(toolbar).append(tabs);
        var pagination = $(
          '<div class="kp-page__toolbar kp-page__pagination"></div>'
        );
        var details = $('<div class="kp-page__details"></div>');
        var description = $('<div class="kp-page__description"></div>');
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        head.append(title);
        scroll.append(controls);
        scroll.append(details);
        scroll.append(description);
        scroll.append(catalogBody);
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
            var stats = $('<div class="kp-page__stats"></div>');
            (row.stats || []).forEach(function (stat) {
              stats.append(
                $('<span class="kp-page__stat"></span>')
                  .attr('title', stat.title)
                  .attr('aria-label', stat.title + ': ' + stat.text)
                  .text(stat.text)
              );
            });
            poster.append(stats);
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
            tabs.empty();
            sidebar.empty();
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
              buttons(data.tabs || [], tabs);
              buttons(data.sidebar || [], sidebar);
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
            kp_folder: route.folder,
            kp_collection: route.collection,
            kp_category: route.category
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

    // Public category membership and card order from kino.watch/selection/categories.
    // Snapshot: 2026-11-01. Refresh with scripts/import-collection-categories.py.
    // No account, session, CSRF, or subscription data is included.
    var collectionCategories = [
      {
        id: '4',
        title: 'Антологии',
        items: [
          {
            id: 210,
            title: 'Освобождение: киноэпопея',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/210-a735909aada9-5a40.jpg'
            },
            watchers: 55,
            count: 5,
            views: '1 K'
          },
          {
            id: 264,
            title: 'Рождённые в СССР: докуфильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/264-43bab318edaa-f347.jpg'
            },
            watchers: 87,
            count: 5,
            views: '3 K'
          },
          {
            id: 314,
            title: 'Приключения великолепной семёрки',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/314-0a226d4b7e84-7172.jpg'
            },
            watchers: 11,
            count: 5,
            views: '2 K'
          },
          {
            id: 323,
            title: 'Kozure Okami',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/323-9e73e64910a3-09ca.jpg'
            },
            watchers: 13,
            count: 6,
            views: '971'
          },
          {
            id: 329,
            title: 'Банда Ольсена: коллекция 1968-2001',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/329-16f3bbab3e29-3eed.jpg'
            },
            watchers: 14,
            count: 15,
            views: '972'
          },
          {
            id: 886,
            title: 'Зловещие мертвецы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/886-8a8a692a2dd6-7f39.jpg'
            },
            watchers: 50,
            count: 9,
            views: '4 K'
          },
          {
            id: 973,
            title: 'Факеры',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/973-c96ac491e1b7-60f6.jpg'
            },
            watchers: 3,
            count: 3,
            views: '586'
          }
        ]
      },
      {
        id: '16',
        title: 'Герои мифов и фольклора',
        items: [
          {
            id: 14,
            title: 'Зомби',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/14-dfab3caadadc-f3ab.jpg'
            },
            watchers: 159,
            count: 67,
            views: '19 K'
          },
          {
            id: 15,
            title: 'Фильмы о вампирах',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/15-026ac9f1df14-8926.jpg'
            },
            watchers: 87,
            count: 97,
            views: '11 K'
          },
          {
            id: 104,
            title: 'Фильмы о ведьмах, колдунах и прочих чародеях',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/104-d0ddffdea691-9c8e.jpg'
            },
            watchers: 65,
            count: 88,
            views: '9 K'
          },
          {
            id: 478,
            title: 'Демоны',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/478-82295a9a3f1c-18d5.jpg'
            },
            watchers: 42,
            count: 77,
            views: '7 K'
          },
          {
            id: 479,
            title: 'Драконы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/479-31d7ef022e67-d885.jpg'
            },
            watchers: 14,
            count: 38,
            views: '4 K'
          },
          {
            id: 480,
            title: 'Мифология',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/480-43b38cc36ab9-1efe.jpg'
            },
            watchers: 29,
            count: 56,
            views: '9 K'
          },
          {
            id: 481,
            title: 'Монстры',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/481-a6a0b765f4c7-645c.jpg'
            },
            watchers: 29,
            count: 119,
            views: '7 K'
          },
          {
            id: 482,
            title: 'Мумия',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/482-1e574d10521b-16fb.jpg'
            },
            watchers: 13,
            count: 18,
            views: '2 K'
          },
          {
            id: 483,
            title: 'Оборотни',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/483-ca64ee7ada57-0c28.jpg'
            },
            watchers: 23,
            count: 65,
            views: '5 K'
          },
          {
            id: 484,
            title: 'Русалка',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/484-e604438b7195-6ee6.jpg'
            },
            watchers: 7,
            count: 24,
            views: '2 K'
          },
          {
            id: 485,
            title: 'Привидение',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/485-c2aa357fa2cc-c64b.jpg'
            },
            watchers: 46,
            count: 109,
            views: '8 K'
          }
        ]
      },
      {
        id: '22',
        title: 'Даты и события',
        items: [
          {
            id: 3,
            title: 'Любимые новогодние фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/3-0e0959abed96-32be.jpg'
            },
            watchers: 601,
            count: 40,
            views: '53 K'
          },
          {
            id: 5,
            title: 'Любимые новогодние мультфильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/5-f0966605d9ec-6064.jpg'
            },
            watchers: 362,
            count: 39,
            views: '17 K'
          },
          {
            id: 169,
            title: '11 сентября 2001',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/169-c3146794877e-d183.jpg'
            },
            watchers: 29,
            count: 16,
            views: '2 K'
          },
          {
            id: 301,
            title: 'Рождественская феерия',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/301-63ebbd3130eb-8bcf.jpg'
            },
            watchers: 331,
            count: 35,
            views: '31 K'
          },
          {
            id: 341,
            title: 'Русская революция',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/341-a607dd0e4310-9cbe.jpg'
            },
            watchers: 24,
            count: 17,
            views: '2 K'
          },
          {
            id: 376,
            title: 'Хеллоуин',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/376-a81821f7dcd0-2117.jpg'
            },
            watchers: 49,
            count: 46,
            views: '4 K'
          },
          {
            id: 432,
            title: 'Война в Афганистане',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/432-7d9048d0bf33-9367.jpg'
            },
            watchers: 24,
            count: 28,
            views: '3 K'
          },
          {
            id: 433,
            title: 'Война во Вьетнаме',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/433-e988f40fddc9-9f3e.jpg'
            },
            watchers: 23,
            count: 24,
            views: '2 K'
          },
          {
            id: 434,
            title: 'Война в Чечне',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/434-654900e88632-09fb.jpg'
            },
            watchers: 27,
            count: 22,
            views: '3 K'
          },
          {
            id: 562,
            title: 'Великая французская революция',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/562-17dee1b0ecc8-2dbc.jpg'
            },
            watchers: 14,
            count: 15,
            views: '1 K'
          },
          {
            id: 565,
            title: 'Наполеоновские войны',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/565-9e20eecb6859-705c.jpg'
            },
            watchers: 15,
            count: 26,
            views: '2 K'
          },
          {
            id: 568,
            title: 'Великая депрессия',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/568-eba0011bc0c9-3138.jpg'
            },
            watchers: 28,
            count: 22,
            views: '3 K'
          }
        ]
      },
      {
        id: '36',
        title: 'Детское',
        items: [
          {
            id: 37,
            title: 'История Игрушек',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/37-3405558f5b7c-fbde.jpg'
            },
            watchers: 71,
            count: 13,
            views: '4 K'
          },
          {
            id: 38,
            title: 'Мультфильмы PIXAR',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/38-722032702c0c-1bde.jpg'
            },
            watchers: 913,
            count: 38,
            views: '69 K'
          },
          {
            id: 81,
            title: 'Лучшие короткометражные мультфильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/81-0f5e6dc5eba7-eddf.jpg'
            },
            watchers: 162,
            count: 12,
            views: '10 K'
          },
          {
            id: 116,
            title: 'Мультфильмы: экранизация детской литературы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/116-91cd5818f1ab-07f6.jpg'
            },
            watchers: 303,
            count: 72,
            views: '17 K'
          },
          {
            id: 163,
            title: 'Экранизация детской литературы: фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/163-5fa7f16018a5-06ab.jpg'
            },
            watchers: 157,
            count: 71,
            views: '11 K'
          },
          {
            id: 177,
            title: 'Миньоны',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/177-a890505d8510-f888.jpg'
            },
            watchers: 56,
            count: 4,
            views: '3 K'
          },
          {
            id: 216,
            title: 'Земля до начала времен ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/216-0ec3d7a0e5ff-3f2a.jpg'
            },
            watchers: 85,
            count: 13,
            views: '3 K'
          },
          {
            id: 256,
            title: 'Monster High',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/256-e673bf0e01f3-dd03.jpg'
            },
            watchers: 15,
            count: 11,
            views: '2 K'
          },
          {
            id: 278,
            title: 'Скуби-Ду ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/278-211dd6a27cb7-ec78.jpg'
            },
            watchers: 63,
            count: 39,
            views: '4 K'
          },
          {
            id: 283,
            title: 'Уоллес и Громит',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/283-664a34dd6a45-8a33.jpg'
            },
            watchers: 48,
            count: 5,
            views: '2 K'
          },
          {
            id: 333,
            title: "Коллекция немецких сказок 'Sechs auf einen Streich'",
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/333-aebc37ec71ce-7204.jpg'
            },
            watchers: 97,
            count: 39,
            views: '3 K'
          },
          {
            id: 409,
            title: 'Русская сказка',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/409-3a2187e0c23f-12a4.jpg'
            },
            watchers: 195,
            count: 61,
            views: '7 K'
          },
          {
            id: 619,
            title: 'My Little Pony',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/619-039c7f20ed94-0f92.jpg'
            },
            watchers: 46,
            count: 9,
            views: '3 K'
          },
          {
            id: 622,
            title: 'Lego',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/622-70376a075dc0-eb27.jpg'
            },
            watchers: 83,
            count: 24,
            views: '6 K'
          },
          {
            id: 892,
            title: 'Illumination Entertainment',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/892-eb5252292254-f165.jpg'
            },
            watchers: 74,
            count: 27,
            views: '15 K'
          },
          {
            id: 928,
            title: 'Мультфильмы студии «Пилот»',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/928-aaff2b3497c1-4024.jpg'
            },
            watchers: 27,
            count: 26,
            views: '2 K'
          }
        ]
      },
      {
        id: '20',
        title: 'Животные',
        items: [
          {
            id: 212,
            title: 'Фильмы о динозаврах',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/212-b541baa40149-c850.jpg'
            },
            watchers: 49,
            count: 53,
            views: '5 K'
          },
          {
            id: 348,
            title: 'Дельфины',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/348-ee8e32dd3ff4-f067.jpg'
            },
            watchers: 5,
            count: 7,
            views: '1 K'
          },
          {
            id: 438,
            title: 'Акула',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/438-cb1a04564549-191a.jpg'
            },
            watchers: 25,
            count: 18,
            views: '3 K'
          },
          {
            id: 439,
            title: 'Фильмы про лошадей',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/439-85be95b5a79c-a82d.jpg'
            },
            watchers: 12,
            count: 21,
            views: '1 K'
          },
          {
            id: 440,
            title: 'Пауки',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/440-bc05f2085d36-601f.jpg'
            },
            watchers: 3,
            count: 10,
            views: '826'
          },
          {
            id: 441,
            title: 'Собаки',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/441-76f23d7c268a-c13f.jpg'
            },
            watchers: 35,
            count: 70,
            views: '5 K'
          }
        ]
      },
      {
        id: '19',
        title: 'Известные персонажи',
        items: [
          {
            id: 84,
            title: 'Легендарный стрелок Шарп',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/84-bd6c7d59fcc6-ebdf.jpg'
            },
            watchers: 67,
            count: 16,
            views: '2 K'
          },
          {
            id: 95,
            title: 'Фантоцци',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/95-5cb1a2aeb523-4cb5.jpg'
            },
            watchers: 35,
            count: 10,
            views: '911'
          },
          {
            id: 166,
            title: 'Кинг Конг',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/166-5fb86779ac24-0c3e.jpg'
            },
            watchers: 12,
            count: 5,
            views: '771'
          },
          {
            id: 176,
            title: 'Франкенштейн',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/176-55a50a0fb5b5-bbc2.jpg'
            },
            watchers: 3,
            count: 9,
            views: '538'
          },
          {
            id: 251,
            title: 'Бугимен ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/251-0565b6037312-601b.jpg'
            },
            watchers: 8,
            count: 5,
            views: '861'
          },
          {
            id: 255,
            title: 'Василий Ливанов в роли Шерлока Холмса',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/255-4611aec269dc-a715.jpg'
            },
            watchers: 199,
            count: 8,
            views: '5 K'
          },
          {
            id: 286,
            title: 'Наруто',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/286-812ac82ac88c-4215.jpg'
            },
            watchers: 43,
            count: 11,
            views: '1 K'
          },
          {
            id: 311,
            title: 'Немезида',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/311-2deb1321443d-1b08.jpg'
            },
            watchers: 12,
            count: 4,
            views: '2 K'
          },
          {
            id: 312,
            title: 'Анжелика',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/312-a9dfab2216bb-eab6.jpg'
            },
            watchers: 48,
            count: 5,
            views: '2 K'
          },
          {
            id: 316,
            title: 'Приключения Антуана Дуанеля',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/316-a9a895dc7311-0540.jpg'
            },
            watchers: 10,
            count: 5,
            views: '1 K'
          },
          {
            id: 336,
            title: 'Мегрэ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/336-9e36ed6ae99c-039d.jpg'
            },
            watchers: 31,
            count: 7,
            views: '2 K'
          },
          {
            id: 598,
            title: 'Пуаро',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/598-819bba5b0166-9d22.jpg'
            },
            watchers: 48,
            count: 6,
            views: '5 K'
          }
        ]
      },
      {
        id: '11',
        title: 'Искусство',
        items: [
          {
            id: 57,
            title: 'Основанное на реальных событиях',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/57-4d4a868446cb-a57c.jpg'
            },
            watchers: 348,
            count: 372,
            views: '59 K'
          },
          {
            id: 181,
            title: 'Cоветские фильмы: ностальгия о прошлом',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/181-ab2618ef9f29-1f00.jpg'
            },
            watchers: 375,
            count: 140,
            views: '18 K'
          },
          {
            id: 859,
            title: 'Экранизации Бориса Акунина',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/859-f696e3a81c87-1915.jpg'
            },
            watchers: 32,
            count: 5,
            views: '9 K'
          }
        ]
      },
      {
        id: '2',
        title: 'История',
        items: [
          {
            id: 229,
            title: 'Фильмы о Великой Отечественной войне',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/229-903323fc2663-cb24.jpg'
            },
            watchers: 99,
            count: 107,
            views: '8 K'
          },
          {
            id: 342,
            title: 'Древний Рим',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/342-41d7aff58b1b-2142.jpg'
            },
            watchers: 59,
            count: 31,
            views: '6 K'
          },
          {
            id: 343,
            title: 'Древний Египет',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/343-d4f18d2b8810-bd86.jpg'
            },
            watchers: 36,
            count: 20,
            views: '4 K'
          },
          {
            id: 344,
            title: 'Радзинский Эдвард',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/344-101cb9fdb7a3-64f1.jpg'
            },
            watchers: 51,
            count: 22,
            views: '1 K'
          },
          {
            id: 353,
            title: '10й век',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/353-061af2058666-2acd.jpg'
            },
            watchers: 14,
            count: 3,
            views: '3 K'
          },
          {
            id: 354,
            title: '11й век',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/354-e75b54deb788-cbf1.jpg'
            },
            watchers: 13,
            count: 13,
            views: '2 K'
          },
          {
            id: 355,
            title: '12й век',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/355-45bb4319e318-68d4.jpg'
            },
            watchers: 13,
            count: 26,
            views: '2 K'
          },
          {
            id: 356,
            title: '13й век',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/356-d754adac3be9-67e9.jpg'
            },
            watchers: 13,
            count: 25,
            views: '2 K'
          },
          {
            id: 357,
            title: '14й век',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/357-2bff46974816-7e6f.jpg'
            },
            watchers: 21,
            count: 37,
            views: '3 K'
          },
          {
            id: 358,
            title: '15й век',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/358-c96378bfe18a-ae6a.jpg'
            },
            watchers: 15,
            count: 23,
            views: '2 K'
          },
          {
            id: 435,
            title: 'Россия начала 90-х',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/435-960e5b4f5dde-7e60.jpg'
            },
            watchers: 40,
            count: 16,
            views: '4 K'
          },
          {
            id: 436,
            title: 'Первая мировая война',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/436-e12f13431f26-0455.jpg'
            },
            watchers: 31,
            count: 81,
            views: '2 K'
          },
          {
            id: 520,
            title: 'Вторая мировая война',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/520-bd340e766a3b-b4be.jpg'
            },
            watchers: 46,
            count: 96,
            views: '7 K'
          },
          {
            id: 532,
            title: '16й век',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/532-bf4decff0fa5-18a6.jpg'
            },
            watchers: 16,
            count: 10,
            views: '2 K'
          },
          {
            id: 535,
            title: '17й век',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/535-cd4b496d8d0f-f240.jpg'
            },
            watchers: 9,
            count: 5,
            views: '1 K'
          },
          {
            id: 559,
            title: '18й век',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/559-dc97d5ad113c-5822.jpg'
            },
            watchers: 12,
            count: 7,
            views: '2 K'
          },
          {
            id: 592,
            title: '19й век',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/592-0d07e3108934-d1f4.jpg'
            },
            watchers: 33,
            count: 8,
            views: '10 K'
          },
          {
            id: 895,
            title: 'Российские фильмы о ВОВ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/895-83522a195e24-8da2.jpg'
            },
            watchers: 20,
            count: 67,
            views: '8 K'
          }
        ]
      },
      {
        id: '26',
        title: 'Катастрофы и стихийные бедствия',
        items: [
          {
            id: 268,
            title: 'Конец света',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/268-dec0a6b95251-9623.jpg'
            },
            watchers: 113,
            count: 37,
            views: '19 K'
          },
          {
            id: 347,
            title: 'Землетрясение',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/347-090a0d89ccad-cd95.jpg'
            },
            watchers: 18,
            count: 18,
            views: '4 K'
          },
          {
            id: 448,
            title: 'Ураганы и штормы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/448-42e159843b9d-9e8f.jpg'
            },
            watchers: 48,
            count: 11,
            views: '8 K'
          },
          {
            id: 967,
            title: 'Титаник и всё о нём',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/967-d8a2bc388ea2-0da5.jpg'
            },
            watchers: 9,
            count: 30,
            views: '732'
          }
        ]
      },
      {
        id: '27',
        title: 'Киножанры',
        items: [
          {
            id: 46,
            title: 'Фильмы от первого лица',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/46-58e2f099edaf-6f8d.jpg'
            },
            watchers: 23,
            count: 6,
            views: '2 K'
          },
          {
            id: 87,
            title: 'Лучшие фильмы жанра нуар',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/87-31a6a0de03f3-73f4.jpg'
            },
            watchers: 85,
            count: 9,
            views: '2 K'
          },
          {
            id: 93,
            title: 'Лучшие спагетти-вестерны',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/93-4fd3279832c7-6885.jpg'
            },
            watchers: 87,
            count: 11,
            views: '2 K'
          },
          {
            id: 94,
            title: 'Лучшие фильмы эпохи немого кино',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/94-1817e29dbc20-ed83.jpg'
            },
            watchers: 37,
            count: 14,
            views: '760'
          },
          {
            id: 127,
            title: 'Лучшие стимпанк фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/127-4d8d68acfda7-882c.jpg'
            },
            watchers: 110,
            count: 17,
            views: '7 K'
          },
          {
            id: 151,
            title: 'Псевдодокументалистика или мокьюментари',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/151-63ea83d251ba-8f73.jpg'
            },
            watchers: 44,
            count: 35,
            views: '3 K'
          },
          {
            id: 174,
            title: 'Японские фильмы ужасов',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/174-9f67830fc91d-d21a.jpg'
            },
            watchers: 78,
            count: 33,
            views: '4 K'
          },
          {
            id: 182,
            title: 'Фильмы - головоломки',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/182-7cb58c18ac67-8a35.jpg'
            },
            watchers: 674,
            count: 37,
            views: '62 K'
          },
          {
            id: 185,
            title: 'Фильмы - ремейки',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/185-e2cabb2765db-6a0b.jpg'
            },
            watchers: 29,
            count: 84,
            views: '4 K'
          },
          {
            id: 187,
            title: 'Байопик: фильмы - биографии',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/187-371522f6710a-e1d0.jpg'
            },
            watchers: 72,
            count: 112,
            views: '6 K'
          },
          {
            id: 198,
            title: 'Фильмы - слэшеры',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/198-6609ae9819b2-78d2.jpg'
            },
            watchers: 53,
            count: 48,
            views: '4 K'
          },
          {
            id: 205,
            title: 'Фильмы движения «Догма 95»',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/205-3259216f8fa1-661b.jpg'
            },
            watchers: 37,
            count: 9,
            views: '1 K'
          },
          {
            id: 206,
            title: 'Роуд-муви: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/206-d84fc667b64b-dd84.jpg'
            },
            watchers: 83,
            count: 58,
            views: '7 K'
          },
          {
            id: 231,
            title: 'Аниме "Для всей семьи"',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/231-3f8e8e870221-ea65.jpg'
            },
            watchers: 181,
            count: 16,
            views: '8 K'
          },
          {
            id: 252,
            title: 'Театр одного актёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/252-0a1e69d1dfbf-3132.jpg'
            },
            watchers: 25,
            count: 26,
            views: '2 K'
          },
          {
            id: 266,
            title: 'Фильмы-катастрофы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/266-b6dbc85e4dde-cf0f.jpg'
            },
            watchers: 185,
            count: 33,
            views: '25 K'
          },
          {
            id: 288,
            title: 'Артхаус по-советски',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/288-f3099f381413-e090.jpg'
            },
            watchers: 199,
            count: 27,
            views: '5 K'
          },
          {
            id: 308,
            title: 'Советское детективное кино',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/308-9de757776f7c-8e87.jpg'
            },
            watchers: 73,
            count: 29,
            views: '5 K'
          },
          {
            id: 337,
            title: '25 идеальных комедий для большой компании',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/337-75161fccc5bd-440d.jpg'
            },
            watchers: 125,
            count: 25,
            views: '24 K'
          },
          {
            id: 351,
            title: 'Футуристика в кино',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/351-b38b37888219-64ad.jpg'
            },
            watchers: 114,
            count: 30,
            views: '10 K'
          },
          {
            id: 580,
            title: 'Неонуар',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/580-2361b5a0a4bc-244d.jpg'
            },
            watchers: 177,
            count: 35,
            views: '10 K'
          },
          {
            id: 649,
            title: 'Сюрреалистическое кино',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/649-edc40a11e46b-7efa.jpg'
            },
            watchers: 203,
            count: 142,
            views: '9 K'
          },
          {
            id: 733,
            title: 'Французская новая волна',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/733-7b7700a6e9a1-5183.jpg'
            },
            watchers: 251,
            count: 28,
            views: '10 K'
          },
          {
            id: 739,
            title: 'Берлинская школа',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/739-a6087d62aec9-5e0a.jpg'
            },
            watchers: 54,
            count: 7,
            views: '3 K'
          },
          {
            id: 742,
            title: 'Корейская волна',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/742-445d038815b6-9514.jpg'
            },
            watchers: 249,
            count: 179,
            views: '20 K'
          },
          {
            id: 745,
            title: 'Французское новое трансгрессивное кино',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/745-40a3f42ab754-e2c8.jpg'
            },
            watchers: 113,
            count: 20,
            views: '7 K'
          },
          {
            id: 748,
            title: 'Французский поэтический реализм',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/748-23397ccf5212-6318.jpg'
            },
            watchers: 25,
            count: 8,
            views: '2 K'
          },
          {
            id: 751,
            title: 'Догма 95',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/751-2a9ce2ca9897-6e5a.jpg'
            },
            watchers: 97,
            count: 9,
            views: '10 K'
          },
          {
            id: 754,
            title: 'Первая оттепель',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/754-7518dddb569f-87d3.jpg'
            },
            watchers: 14,
            count: 7,
            views: '1 K'
          },
          {
            id: 757,
            title: 'Немецкий экспрессионизм',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/757-ad41af743cc9-f1d9.jpg'
            },
            watchers: 60,
            count: 7,
            views: '2 K'
          },
          {
            id: 760,
            title: 'Новое румынское кино',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/760-3144f3b8298e-ebdc.jpg'
            },
            watchers: 72,
            count: 9,
            views: '3 K'
          },
          {
            id: 763,
            title: 'Новое немецкое кино',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/763-0de4c00eb688-4367.jpg'
            },
            watchers: 64,
            count: 5,
            views: '4 K'
          },
          {
            id: 766,
            title: 'Британская новая волна',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/766-2e5ce2373afb-fc5b.jpg'
            },
            watchers: 66,
            count: 12,
            views: '5 K'
          },
          {
            id: 769,
            title: 'Мамблкор',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/769-524eb335e398-88fa.jpg'
            },
            watchers: 98,
            count: 15,
            views: '6 K'
          },
          {
            id: 772,
            title: 'Японская новая волна',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/772-ee9c5d0bbb39-0e63.jpg'
            },
            watchers: 122,
            count: 6,
            views: '5 K'
          },
          {
            id: 775,
            title: 'Иранская вторая волна',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/775-d1cad612bcd6-e506.jpg'
            },
            watchers: 96,
            count: 5,
            views: '3 K'
          },
          {
            id: 778,
            title: 'Чехословацкая новая волна',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/778-f76e9df75a8c-2265.jpg'
            },
            watchers: 67,
            count: 5,
            views: '3 K'
          },
          {
            id: 781,
            title: 'Оттепель',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/781-ce3f178c3f63-f968.jpg'
            },
            watchers: 127,
            count: 55,
            views: '7 K'
          }
        ]
      },
      {
        id: '35',
        title: 'Кинокомиксы',
        items: [
          {
            id: 33,
            title: 'MARVEL',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/33-b4e7df74e499-96dd.jpg'
            },
            watchers: 2196,
            count: 71,
            views: '171 K'
          },
          {
            id: 36,
            title: 'Люди Икс',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/36-198c040ca3c7-71a5.jpg'
            },
            watchers: 434,
            count: 9,
            views: '18 K'
          },
          {
            id: 167,
            title: 'DC Comics',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/167-33275ccd551f-70e8.jpg'
            },
            watchers: 376,
            count: 110,
            views: '19 K'
          },
          {
            id: 196,
            title: 'Черепашки-ниндзя',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/196-58dfc6856d4f-e30a.jpg'
            },
            watchers: 31,
            count: 7,
            views: '1 K'
          },
          {
            id: 202,
            title: 'Хеллбой',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/202-06386b99e94e-eea5.jpg'
            },
            watchers: 14,
            count: 5,
            views: '1 K'
          },
          {
            id: 277,
            title: 'Бэтмен',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/277-dfe7c41afc9f-5e97.jpg'
            },
            watchers: 119,
            count: 27,
            views: '7 K'
          },
          {
            id: 324,
            title: 'Халк',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/324-72fa1abba645-c337.jpg'
            },
            watchers: 11,
            count: 5,
            views: '1 K'
          },
          {
            id: 414,
            title: 'По мотивам комикса',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/414-52b21dc8ac99-9c52.jpg'
            },
            watchers: 148,
            count: 167,
            views: '16 K'
          }
        ]
      },
      {
        id: '9',
        title: 'Кинофестивали',
        items: [
          {
            id: 11,
            title: 'Каннский Кинофестиваль. Золотая пальмовая ветвь',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/11-180c8a3db1dd-18d8.jpg'
            },
            watchers: 228,
            count: 46,
            views: '10 K'
          },
          {
            id: 20,
            title: 'Международный Каннский Кинофестиваль. Большой приз жюри',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/20-9a8aa50bd5fc-171f.jpg'
            },
            watchers: 130,
            count: 31,
            views: '5 K'
          },
          {
            id: 88,
            title: 'Венецианский кинофестиваль. Победитель',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/88-90939cb94e89-901f.jpg'
            },
            watchers: 86,
            count: 23,
            views: '2 K'
          },
          {
            id: 89,
            title: 'Сандэнс. Победитель',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/89-21397491f026-897a.jpg'
            },
            watchers: 77,
            count: 12,
            views: '2 K'
          },
          {
            id: 90,
            title: 'Сезар. Победитель',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/90-f18af150f1a4-3033.jpg'
            },
            watchers: 30,
            count: 17,
            views: '1 K'
          },
          {
            id: 91,
            title: 'Берлинский кинофестиваль. Золотой медведь',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/91-95a1134d6736-06f0.jpg'
            },
            watchers: 69,
            count: 19,
            views: '2 K'
          },
          {
            id: 793,
            title: 'Лондонский фестиваль анимации 2021',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/793-3abefe64e980-687f.jpg'
            },
            watchers: 313,
            count: 20,
            views: '9 K'
          }
        ]
      },
      {
        id: '33',
        title: 'Кинофраншизы',
        items: [
          {
            id: 34,
            title: 'STAR WARS',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/34-3478698216e6-d994.jpg'
            },
            watchers: 1282,
            count: 23,
            views: '44 K'
          },
          {
            id: 35,
            title: 'Гарри Поттер',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/35-097f22fc13c3-d024.jpg'
            },
            watchers: 1445,
            count: 14,
            views: '83 K'
          },
          {
            id: 39,
            title: 'Властелин Колец + Хоббит',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/39-d826efee5893-7f51.jpg'
            },
            watchers: 790,
            count: 13,
            views: '29 K'
          },
          {
            id: 41,
            title: 'Чужие, Хищник, Прометей',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/41-c830822f79a6-c52f.jpg'
            },
            watchers: 393,
            count: 17,
            views: '23 K'
          },
          {
            id: 42,
            title: 'Голодные Игры',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/42-b16c132fa7d0-130e.jpg'
            },
            watchers: 142,
            count: 5,
            views: '9 K'
          },
          {
            id: 44,
            title: 'Трансформеры',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/44-0012273ade6e-28a4.jpg'
            },
            watchers: 120,
            count: 19,
            views: '5 K'
          },
          {
            id: 58,
            title: 'БОНДИАНА(007)',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/58-1d71beeb123f-63ff.jpg'
            },
            watchers: 1296,
            count: 26,
            views: '64 K'
          },
          {
            id: 99,
            title: 'Ледниковый период от и до',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/99-976d972bc4a3-71a5.jpg'
            },
            watchers: 94,
            count: 13,
            views: '3 K'
          },
          {
            id: 113,
            title: 'Сумерки',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/113-ed9d60376ce4-7270.jpg'
            },
            watchers: 90,
            count: 5,
            views: '9 K'
          },
          {
            id: 118,
            title: 'Star Trek',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/118-f6666a52a08e-c5f3.jpg'
            },
            watchers: 205,
            count: 14,
            views: '7 K'
          },
          {
            id: 122,
            title: 'Полицейская академия',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/122-b6cf85a3b0d3-c798.jpg'
            },
            watchers: 125,
            count: 7,
            views: '2 K'
          },
          {
            id: 149,
            title: 'Рокки ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/149-e67085861587-36a3.jpg'
            },
            watchers: 54,
            count: 7,
            views: '1 K'
          },
          {
            id: 152,
            title: 'Квартет И: фильмы и спектакли',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/152-183f92b68250-5723.jpg'
            },
            watchers: 159,
            count: 12,
            views: '7 K'
          },
          {
            id: 232,
            title: 'Пятница 13-е',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/232-6a43900148f0-7d4f.jpg'
            },
            watchers: 38,
            count: 10,
            views: '1 K'
          },
          {
            id: 238,
            title: 'Граница пустоты: Сад грешников',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/238-be3c677216e1-87a6.jpg'
            },
            watchers: 44,
            count: 8,
            views: '1 K'
          },
          {
            id: 248,
            title: 'Джейсон Борн',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/248-49a15f1eccf6-8be3.jpg'
            },
            watchers: 288,
            count: 5,
            views: '12 K'
          },
          {
            id: 254,
            title: 'Индиана Джонс ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/254-6d1cfd6b8629-4278.jpg'
            },
            watchers: 281,
            count: 6,
            views: '6 K'
          },
          {
            id: 258,
            title: 'Смертельное оружие ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/258-b42f0f104ea1-2227.jpg'
            },
            watchers: 90,
            count: 4,
            views: '2 K'
          },
          {
            id: 260,
            title: 'Терминатор',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/260-28417f262d22-6180.jpg'
            },
            watchers: 127,
            count: 8,
            views: '4 K'
          },
          {
            id: 289,
            title: 'Годзилла ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/289-eba5f7502563-bc71.jpg'
            },
            watchers: 36,
            count: 14,
            views: '2 K'
          },
          {
            id: 305,
            title: 'Пункт назначения',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/305-0100cbc4dac4-0b5f.jpg'
            },
            watchers: 101,
            count: 6,
            views: '5 K'
          },
          {
            id: 307,
            title: 'Грязный Гарри ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/307-80c58d8f1d70-4630.jpg'
            },
            watchers: 33,
            count: 5,
            views: '1 K'
          },
          {
            id: 309,
            title: 'Пираты Карибского моря',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/309-d1c78b7dd1ec-8d27.jpg'
            },
            watchers: 449,
            count: 5,
            views: '15 K'
          },
          {
            id: 320,
            title: 'Затойчи',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/320-4f508a9df96a-002c.jpg'
            },
            watchers: 50,
            count: 26,
            views: '2 K'
          },
          {
            id: 321,
            title: 'Ганнибал Лектер',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/321-d7b8b06c68ae-f209.jpg'
            },
            watchers: 75,
            count: 4,
            views: '4 K'
          },
          {
            id: 325,
            title: 'xXx - трилогия',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/325-9d73f41e6ef7-e52d.jpg'
            },
            watchers: 23,
            count: 3,
            views: '2 K'
          },
          {
            id: 326,
            title: 'Обитель зла ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/326-6c1de29d3394-a82c.jpg'
            },
            watchers: 115,
            count: 6,
            views: '4 K'
          },
          {
            id: 332,
            title: 'Вселенная Мертвого Космоса',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/332-2ec4c34770de-9005.jpg'
            },
            watchers: 44,
            count: 3,
            views: '6 K'
          },
          {
            id: 410,
            title: ' Инициал Ди',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/410-909ef0d9cb6f-4e18.jpg'
            },
            watchers: 31,
            count: 4,
            views: '1 K'
          },
          {
            id: 437,
            title: 'Пила',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/437-3b611c1b0ab6-83e6.jpg'
            },
            watchers: 80,
            count: 10,
            views: '4 K'
          },
          {
            id: 574,
            title: 'Волшебник страны Оз',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/574-2c2f1ebda373-f3d1.jpg'
            },
            watchers: 18,
            count: 14,
            views: '3 K'
          },
          {
            id: 799,
            title: 'Форсаж',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/799-462fd7a0ac72-efb8.jpg'
            },
            watchers: 251,
            count: 11,
            views: '16 K'
          },
          {
            id: 802,
            title: 'Миссия невыполнима',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/802-142bfc124d1b-b9dc.jpg'
            },
            watchers: 396,
            count: 9,
            views: '22 K'
          },
          {
            id: 835,
            title: 'Slam Dunk',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/835-c2e0eecfeebb-b49d.jpg'
            },
            watchers: 16,
            count: 6,
            views: '2 K'
          },
          {
            id: 856,
            title: 'MonsterVerse',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/856-e77a95fa7bd1-f45b.jpg'
            },
            watchers: 84,
            count: 7,
            views: '7 K'
          },
          {
            id: 868,
            title: 'Kingsman',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/868-7173b24f504a-28ae.jpg'
            },
            watchers: 58,
            count: 3,
            views: '8 K'
          }
        ]
      },
      {
        id: '15',
        title: 'Любовные истории',
        items: [
          {
            id: 12,
            title: 'Жрицы любви',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/12-634ea58c7a66-7b29.jpg'
            },
            watchers: 68,
            count: 35,
            views: '20 K'
          },
          {
            id: 16,
            title: 'Свадьба-свадьба, кольца-кольца',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/16-3c3c47877342-6325.jpg'
            },
            watchers: 14,
            count: 21,
            views: '3 K'
          },
          {
            id: 96,
            title: 'Любовные треугольники и измены',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/96-cf0b995a7719-1eb4.jpg'
            },
            watchers: 40,
            count: 77,
            views: '12 K'
          },
          {
            id: 114,
            title: '14 историй о любви',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/114-caab08dcddf9-16f7.jpg'
            },
            watchers: 63,
            count: 14,
            views: '10 K'
          },
          {
            id: 115,
            title: 'Фильмы о женщинах с сильным характером',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/115-c13a68536b53-93cc.jpg'
            },
            watchers: 43,
            count: 20,
            views: '5 K'
          },
          {
            id: 128,
            title: 'Роковая страсть',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/128-e202dc7b7a96-5121.jpg'
            },
            watchers: 60,
            count: 45,
            views: '10 K'
          },
          {
            id: 172,
            title: 'Однополая любовь',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/172-ef0c8c0fcc6b-e874.jpg'
            },
            watchers: 243,
            count: 139,
            views: '31 K'
          },
          {
            id: 814,
            title: 'The Hallmark Channel',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/814-a4e22d4dcbb4-73c6.jpg'
            },
            watchers: 101,
            count: 72,
            views: '11 K'
          }
        ]
      },
      {
        id: '24',
        title: 'Люди',
        items: [
          {
            id: 156,
            title: 'Викинги',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/156-122efca50b15-e897.jpg'
            },
            watchers: 31,
            count: 40,
            views: '3 K'
          },
          {
            id: 189,
            title: 'Индейцы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/189-a59d3c2f7360-1717.jpg'
            },
            watchers: 35,
            count: 43,
            views: '2 K'
          },
          {
            id: 449,
            title: 'Афроамериканцы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/449-9560102e1337-ed58.jpg'
            },
            watchers: 7,
            count: 45,
            views: '1 K'
          },
          {
            id: 459,
            title: 'Беженцы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/459-655cd217e943-93ac.jpg'
            },
            watchers: 6,
            count: 20,
            views: '1 K'
          },
          {
            id: 460,
            title: 'Близнецы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/460-baf44908b589-992d.jpg'
            },
            watchers: 6,
            count: 24,
            views: '1 K'
          },
          {
            id: 461,
            title: 'Встреча выпускников',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/461-2f2e33fef433-7ab5.jpg'
            },
            watchers: 6,
            count: 39,
            views: '2 K'
          },
          {
            id: 462,
            title: 'Выживание',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/462-ecb38da3363a-7b6b.jpg'
            },
            watchers: 80,
            count: 132,
            views: '20 K'
          },
          {
            id: 463,
            title: 'Девушки',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/463-1f618226c519-e492.jpg'
            },
            watchers: 24,
            count: 18,
            views: '6 K'
          },
          {
            id: 601,
            title: 'Самураи',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/601-15a0d4813fca-ba0a.jpg'
            },
            watchers: 38,
            count: 52,
            views: '4 K'
          }
        ]
      },
      {
        id: '14',
        title: 'Медицина и исследования',
        items: [
          {
            id: 9,
            title: 'Эпидемия и заражение',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/9-980042117a73-9618.jpg'
            },
            watchers: 137,
            count: 27,
            views: '17 K'
          },
          {
            id: 48,
            title: 'Наркотики',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/48-eb3a9cc28111-cb54.jpg'
            },
            watchers: 115,
            count: 86,
            views: '11 K'
          },
          {
            id: 103,
            title: 'Фильмы про онкобольных людей',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/103-ac580a0a99a1-a0a0.jpg'
            },
            watchers: 12,
            count: 45,
            views: '1 K'
          },
          {
            id: 345,
            title: 'Аутизм',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/345-fb5b0d4abe54-42dc.jpg'
            },
            watchers: 15,
            count: 20,
            views: '1 K'
          },
          {
            id: 346,
            title: 'СПИД',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/346-828cde90e2f1-9c94.jpg'
            },
            watchers: 11,
            count: 24,
            views: '1 K'
          },
          {
            id: 464,
            title: 'Алкоголизм',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/464-11401fd6dabf-9c32.jpg'
            },
            watchers: 15,
            count: 38,
            views: '3 K'
          },
          {
            id: 465,
            title: 'Клонирование',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/465-4a79638c36b2-2e77.jpg'
            },
            watchers: 10,
            count: 36,
            views: '2 K'
          },
          {
            id: 466,
            title: 'Медицина',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/466-b2a4257dc927-98d6.jpg'
            },
            watchers: 14,
            count: 41,
            views: '2 K'
          },
          {
            id: 467,
            title: 'Мутанты',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/467-c5b2efaa1467-144d.jpg'
            },
            watchers: 40,
            count: 58,
            views: '7 K'
          },
          {
            id: 469,
            title: 'Патология',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/469-44a68c4afb85-f24d.jpg'
            },
            watchers: 7,
            count: 27,
            views: '2 K'
          },
          {
            id: 470,
            title: 'Помутнение рассудка',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/470-a91bcb3e289b-540b.jpg'
            },
            watchers: 55,
            count: 91,
            views: '6 K'
          },
          {
            id: 471,
            title: 'Потеря памяти',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/471-23184c54c051-23b6.jpg'
            },
            watchers: 15,
            count: 48,
            views: '4 K'
          },
          {
            id: 472,
            title: 'Психиатрическая больница',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/472-48e2fe19b4e7-6d57.jpg'
            },
            watchers: 35,
            count: 26,
            views: '4 K'
          },
          {
            id: 547,
            title: 'Болезнь',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/547-bc993eb44cea-3726.jpg'
            },
            watchers: 7,
            count: 52,
            views: '2 K'
          },
          {
            id: 625,
            title: 'Фильмы о душевнобольных',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/625-e89a08734014-6bde.jpg'
            },
            watchers: 58,
            count: 71,
            views: '7 K'
          }
        ]
      },
      {
        id: '29',
        title: 'Международные и внутренние отношения',
        items: [
          {
            id: 171,
            title: 'Выборы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/171-caa22264abf6-66af.jpg'
            },
            watchers: 7,
            count: 26,
            views: '781'
          },
          {
            id: 262,
            title: 'Нацизм',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/262-081e6ff64acb-f60f.jpg'
            },
            watchers: 51,
            count: 55,
            views: '6 K'
          },
          {
            id: 350,
            title: 'Пропаганда',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/350-c7f9e590e5a7-94f1.jpg'
            },
            watchers: 19,
            count: 31,
            views: '1 K'
          },
          {
            id: 474,
            title: 'Апартеид',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/474-af0c21b9a629-8de7.jpg'
            },
            watchers: 8,
            count: 20,
            views: '896'
          },
          {
            id: 475,
            title: 'Концентрационный лагерь',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/475-20c59ad99d44-afde.jpg'
            },
            watchers: 16,
            count: 37,
            views: '2 K'
          },
          {
            id: 476,
            title: 'Политика',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/476-c91f37e0950e-d962.jpg'
            },
            watchers: 57,
            count: 72,
            views: '6 K'
          },
          {
            id: 477,
            title: 'Преследования евреев',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/477-207b7d2ba7d7-937d.jpg'
            },
            watchers: 23,
            count: 29,
            views: '3 K'
          }
        ]
      },
      {
        id: '17',
        title: 'Место действия',
        items: [
          {
            id: 18,
            title: 'Подводная лодка',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/18-ff038607ed64-f324.jpg'
            },
            watchers: 32,
            count: 22,
            views: '4 K'
          },
          {
            id: 267,
            title: 'Необитаемый остров',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/267-85eefac8fa38-86ea.jpg'
            },
            watchers: 18,
            count: 12,
            views: '5 K'
          },
          {
            id: 442,
            title: 'Деревня',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/442-0fa8cee79077-bff7.jpg'
            },
            watchers: 17,
            count: 12,
            views: '1 K'
          },
          {
            id: 443,
            title: 'Маленький город',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/443-e5d7f4c913fe-f72b.jpg'
            },
            watchers: 12,
            count: 44,
            views: '2 K'
          },
          {
            id: 444,
            title: 'Метро',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/444-46b63110af3b-b965.jpg'
            },
            watchers: 6,
            count: 14,
            views: '1 K'
          },
          {
            id: 445,
            title: 'Праздник и вечеринка',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/445-c4ff3d738b05-5ecc.jpg'
            },
            watchers: 11,
            count: 29,
            views: '2 K'
          },
          {
            id: 446,
            title: 'Ресторан',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/446-359b3d678e08-d2f3.jpg'
            },
            watchers: 24,
            count: 14,
            views: '3 K'
          },
          {
            id: 447,
            title: 'Самолет',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/447-2f3301e22fa2-510c.jpg'
            },
            watchers: 21,
            count: 26,
            views: '4 K'
          },
          {
            id: 826,
            title: 'Фильмы про остров сокровищ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/826-126f032996e2-4ff7.jpg'
            },
            watchers: 7,
            count: 19,
            views: '5 K'
          }
        ]
      },
      {
        id: '30',
        title: 'Необъяснимые явления',
        items: [
          {
            id: 263,
            title: 'Дом со сверхъестественной силой',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/263-46de8e87bd0e-0db2.jpg'
            },
            watchers: 33,
            count: 22,
            views: '5 K'
          },
          {
            id: 287,
            title: 'Обмен телами',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/287-18e3fc2a7885-2817.jpg'
            },
            watchers: 27,
            count: 13,
            views: '6 K'
          },
          {
            id: 458,
            title: 'Чтение мыслей',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/458-85c4a13e87cd-3f2d.jpg'
            },
            watchers: 23,
            count: 31,
            views: '5 K'
          }
        ]
      },
      {
        id: '3',
        title: 'Переводы',
        items: [
          {
            id: 310,
            title: 'В озвучке Goblina',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/310-fc943f11445a-acb5.jpg'
            },
            watchers: 951,
            count: 108,
            views: '59 K'
          },
          {
            id: 361,
            title: 'Гаврилов: авторский перевод',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/361-a219120c6f44-bcf0.jpg'
            },
            watchers: 55,
            count: 668,
            views: '7 K'
          },
          {
            id: 362,
            title: 'Живов: авторский перевод',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/362-1e4871ce1e59-2f1d.jpg'
            },
            watchers: 18,
            count: 540,
            views: '2 K'
          },
          {
            id: 363,
            title: 'Горчаков: авторский перевод',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/363-324c28338c14-20ec.jpg'
            },
            watchers: 14,
            count: 199,
            views: '976'
          },
          {
            id: 364,
            title: 'Визгунов: авторский перевод',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/364-40d4bf0c06cb-015b.jpg'
            },
            watchers: 9,
            count: 225,
            views: '888'
          },
          {
            id: 365,
            title: 'Санаев: авторский перевод',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/365-323442496b53-5004.jpg'
            },
            watchers: 4,
            count: 43,
            views: '809'
          },
          {
            id: 366,
            title: 'Кузнецов: авторский перевод',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/366-649346f73eb7-c346.jpg'
            },
            watchers: 6,
            count: 55,
            views: '465'
          },
          {
            id: 367,
            title: 'Сербин: авторский перевод',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/367-91bcc38f5987-df1e.jpg'
            },
            watchers: 44,
            count: 204,
            views: '2 K'
          },
          {
            id: 368,
            title: 'Украинский перевод',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/368-952e6b76d404-edb3.jpg'
            },
            watchers: 65,
            count: 642,
            views: '4 K'
          },
          {
            id: 369,
            title: 'Михалёв: авторский перевод',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/369-9d2a59327bae-24dc.jpg'
            },
            watchers: 53,
            count: 212,
            views: '2 K'
          },
          {
            id: 370,
            title: 'Королёв: авторский перевод',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/370-62b50e034dfd-0c34.jpg'
            },
            watchers: 3,
            count: 56,
            views: '640'
          },
          {
            id: 371,
            title: 'Карцев: авторский перевод',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/371-0f207fd9ffb6-d281.jpg'
            },
            watchers: 8,
            count: 41,
            views: '648'
          },
          {
            id: 372,
            title: 'Дольский: авторский перевод',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/372-b265cf0112e8-6e43.jpg'
            },
            watchers: 5,
            count: 58,
            views: '733'
          },
          {
            id: 373,
            title: 'Володарский: авторский перевод',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/373-6a22af71db75-47b8.jpg'
            },
            watchers: 28,
            count: 123,
            views: '2 K'
          },
          {
            id: 374,
            title: 'Либергал: авторский перевод',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/374-266f35b632d2-0fe7.jpg'
            },
            watchers: 8,
            count: 29,
            views: '666'
          }
        ]
      },
      {
        id: '13',
        title: 'Правонарушители',
        items: [
          {
            id: 19,
            title: 'Хакеры и компьтерные технологии',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/19-72c1dccf77d2-5f35.jpg'
            },
            watchers: 287,
            count: 61,
            views: '22 K'
          },
          {
            id: 21,
            title: 'Ограбления',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/21-b8f91db486de-85ee.jpg'
            },
            watchers: 171,
            count: 32,
            views: '23 K'
          },
          {
            id: 78,
            title: 'Побег из тюрьмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/78-0cb2b1d2b663-b986.jpg'
            },
            watchers: 26,
            count: 19,
            views: '3 K'
          },
          {
            id: 178,
            title: '22 фильма о криминальной России',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/178-15b470dd6b30-7bf0.jpg'
            },
            watchers: 91,
            count: 22,
            views: '7 K'
          },
          {
            id: 230,
            title: 'Фильмы про гангстеров',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/230-2f2afeabbf98-919f.jpg'
            },
            watchers: 106,
            count: 80,
            views: '10 K'
          },
          {
            id: 271,
            title: 'Жизнь в тюрьме',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/271-58cf2c3d85df-d73d.jpg'
            },
            watchers: 27,
            count: 35,
            views: '5 K'
          },
          {
            id: 541,
            title: 'Похищение / Исчезновение',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/541-e633b3408430-246d.jpg'
            },
            watchers: 22,
            count: 8,
            views: '6 K'
          }
        ]
      },
      {
        id: '7',
        title: 'Премия «Оскар»',
        items: [
          {
            id: 10,
            title: 'Лучший фильм: Премия «Оскар»',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/10-82ec39623354-18ff.jpg'
            },
            watchers: 618,
            count: 92,
            views: '58 K'
          },
          {
            id: 119,
            title: 'Оскар 2016. Номинация «Лучший фильм»',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/119-0b1f2bc5d18b-e227.jpg'
            },
            watchers: 47,
            count: 8,
            views: '7 K'
          },
          {
            id: 123,
            title: 'Оскар 2016. Номинация «Лучший документальный фильм»',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/123-301f7adde704-4240.jpg'
            },
            watchers: 26,
            count: 5,
            views: '2 K'
          },
          {
            id: 133,
            title: 'Оскар 2016. Номинация «Лучший анимационный фильм»',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/133-d982dede8d3d-bc3c.jpg'
            },
            watchers: 24,
            count: 5,
            views: '2 K'
          },
          {
            id: 136,
            title: 'Лучший анимационный фильм: Премия «Оскар»',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/136-5570f716824f-af12.jpg'
            },
            watchers: 152,
            count: 19,
            views: '10 K'
          },
          {
            id: 190,
            title: 'Лучшая мужская роль: Премия «Оскар»',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/190-611f77454cc3-5a1c.jpg'
            },
            watchers: 56,
            count: 51,
            views: '4 K'
          },
          {
            id: 191,
            title: 'Лучшая женская роль: Премия «Оскар»',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/191-c40d818120c5-401a.jpg'
            },
            watchers: 51,
            count: 48,
            views: '3 K'
          },
          {
            id: 317,
            title: 'Оскар 2017. Номинация «Лучший фильм на иностранном языке» ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/317-e97115713023-99ff.jpg'
            },
            watchers: 35,
            count: 5,
            views: '6 K'
          },
          {
            id: 318,
            title: 'Оскар 2017. Номинация «Лучший фильм» ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/318-dcb97faa56a1-0a4a.jpg'
            },
            watchers: 90,
            count: 9,
            views: '22 K'
          },
          {
            id: 319,
            title: 'Оскар 2017. Номинация «Лучший анимационный фильм» ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/319-20a4e3f1d637-c20d.jpg'
            },
            watchers: 40,
            count: 5,
            views: '10 K'
          },
          {
            id: 509,
            title: 'Оскар 2018. Номинация «Лучший фильм»',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/509-db9ca9487a39-47c0.jpg'
            },
            watchers: 74,
            count: 8,
            views: '22 K'
          },
          {
            id: 510,
            title: 'Оскар 2018. Номинация «Лучший анимационный фильм» ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/510-a0a4c0cd1856-44ec.jpg'
            },
            watchers: 27,
            count: 4,
            views: '12 K'
          }
        ]
      },
      {
        id: '18',
        title: 'Преступления',
        items: [
          {
            id: 168,
            title: 'Серийный убийца',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/168-75f81730a9b2-f92d.jpg'
            },
            watchers: 211,
            count: 137,
            views: '32 K'
          },
          {
            id: 269,
            title: 'Эксперименты над людьми',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/269-c44ecade027f-7e14.jpg'
            },
            watchers: 28,
            count: 27,
            views: '5 K'
          },
          {
            id: 272,
            title: 'Изнасилование',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/272-c1597ef718e1-4a03.jpg'
            },
            watchers: 22,
            count: 21,
            views: '12 K'
          },
          {
            id: 628,
            title: 'Террористы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/628-95e2b6489838-a550.jpg'
            },
            watchers: 51,
            count: 73,
            views: '14 K'
          }
        ]
      },
      {
        id: '40',
        title: 'Психология',
        items: [
          {
            id: 473,
            title: 'Психотерапия',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/473-0a17a8b084e5-73e7.jpg'
            },
            watchers: 102,
            count: 59,
            views: '9 K'
          },
          {
            id: 529,
            title: 'Травля',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/529-5f49d0be66af-f4b9.jpg'
            },
            watchers: 13,
            count: 10,
            views: '3 K'
          },
          {
            id: 595,
            title: 'Расизм',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/595-36caef9f6a1b-718d.jpg'
            },
            watchers: 20,
            count: 8,
            views: '4 K'
          },
          {
            id: 616,
            title: 'Взаимоотношения поколений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/616-1f3616869628-0996.jpg'
            },
            watchers: 23,
            count: 29,
            views: '2 K'
          },
          {
            id: 652,
            title: 'В конце фильма вы не будете прежним',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/652-1e574eb02275-f366.jpg'
            },
            watchers: 1206,
            count: 189,
            views: '103 K'
          },
          {
            id: 664,
            title: 'Смотрим в плохие дни',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/664-ebced5556c88-3a31.jpg'
            },
            watchers: 514,
            count: 35,
            views: '60 K'
          },
          {
            id: 670,
            title: 'Жесткий. Чёрствый. Негативный',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/670-3f85cce37d3a-eac5.jpg'
            },
            watchers: 178,
            count: 88,
            views: '18 K'
          },
          {
            id: 673,
            title: 'Психологический триллер. Лучшее',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/673-f0fee00efdf0-a30e.jpg'
            },
            watchers: 655,
            count: 56,
            views: '77 K'
          },
          {
            id: 916,
            title: 'Фильмы про семью',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/916-4d76b39fc126-7b8f.jpg'
            },
            watchers: 5,
            count: 28,
            views: '4 K'
          }
        ]
      },
      {
        id: '12',
        title: 'Работа',
        items: [
          {
            id: 54,
            title: 'Про шпионов',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/54-fe747278fbb5-848b.jpg'
            },
            watchers: 156,
            count: 43,
            views: '23 K'
          },
          {
            id: 55,
            title: 'Фильмы о фотографии и фотографах',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/55-3f0adc3b0bce-e2e6.jpg'
            },
            watchers: 53,
            count: 24,
            views: '2 K'
          },
          {
            id: 61,
            title: 'Фильмы про юристов',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/61-a6f9b2d87683-c637.jpg'
            },
            watchers: 63,
            count: 87,
            views: '8 K'
          },
          {
            id: 66,
            title: 'Фокусники и иллюзионисты',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/66-989a04592f10-85db.jpg'
            },
            watchers: 28,
            count: 27,
            views: '2 K'
          },
          {
            id: 108,
            title: 'Фильмы о еде, кулинарии, рецептах и поварах',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/108-de385519407d-796f.jpg'
            },
            watchers: 60,
            count: 16,
            views: '5 K'
          },
          {
            id: 109,
            title: 'Фильмы о барменах ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/109-eb529ae99a5e-f3e8.jpg'
            },
            watchers: 9,
            count: 13,
            views: '875'
          },
          {
            id: 117,
            title: 'Фильмы о журналистах и журналистике',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/117-f94f16e24e2b-9da7.jpg'
            },
            watchers: 20,
            count: 26,
            views: '2 K'
          },
          {
            id: 160,
            title: 'Фильмы про снайперов',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/160-1855d557e8a3-c81f.jpg'
            },
            watchers: 29,
            count: 13,
            views: '4 K'
          },
          {
            id: 162,
            title: 'Лётчики',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/162-05cee4c4aa35-617e.jpg'
            },
            watchers: 11,
            count: 16,
            views: '1 K'
          },
          {
            id: 270,
            title: 'Адвокаты',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/270-de5401b3fd2a-4e78.jpg'
            },
            watchers: 22,
            count: 13,
            views: '3 K'
          },
          {
            id: 273,
            title: 'Учитель',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/273-1cae9f996c4d-85a4.jpg'
            },
            watchers: 10,
            count: 32,
            views: '2 K'
          },
          {
            id: 284,
            title: 'Фильмы о пилотах',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/284-c475c3f95bcb-172d.jpg'
            },
            watchers: 7,
            count: 9,
            views: '2 K'
          },
          {
            id: 862,
            title: 'Про шпионов, разведку и OSINT',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/862-cb39bfb3c67b-28e8.jpg'
            },
            watchers: 133,
            count: 27,
            views: '32 K'
          }
        ]
      },
      {
        id: '25',
        title: 'Религия',
        items: [
          {
            id: 188,
            title: 'Экзорцизм',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/188-b5a55547322f-e953.jpg'
            },
            watchers: 29,
            count: 13,
            views: '3 K'
          },
          {
            id: 450,
            title: 'Ангел',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/450-a628f867658d-39b7.jpg'
            },
            watchers: 8,
            count: 14,
            views: '2 K'
          },
          {
            id: 451,
            title: 'Ад',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/451-c3e1a39927d1-6766.jpg'
            },
            watchers: 20,
            count: 17,
            views: '3 K'
          },
          {
            id: 452,
            title: 'Оккультизм',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/452-f42ea9c6c849-4b51.jpg'
            },
            watchers: 30,
            count: 27,
            views: '5 K'
          }
        ]
      },
      {
        id: '37',
        title: 'Сериалы',
        items: [
          {
            id: 631,
            title: 'Лучшие откровенные сериалы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/631-1f47ac020cc4-6407.jpg'
            },
            watchers: 81,
            count: 11,
            views: '20 K'
          },
          {
            id: 633,
            title: 'Лучшие сериалы для подростков',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/633-3c0dc046c9fc-a2eb.jpg'
            },
            watchers: 44,
            count: 13,
            views: '8 K'
          },
          {
            id: 635,
            title: 'Сериалы о спорте',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/635-2ce685a8f445-be0c.jpg'
            },
            watchers: 20,
            count: 24,
            views: '4 K'
          },
          {
            id: 637,
            title: 'Сериалы про мир моды и стиля',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/637-36b9a0e8eb67-850d.jpg'
            },
            watchers: 54,
            count: 10,
            views: '5 K'
          },
          {
            id: 639,
            title: 'Сверхъестественное. Сериалы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/639-4cedca815b15-2775.jpg'
            },
            watchers: 45,
            count: 10,
            views: '8 K'
          },
          {
            id: 641,
            title: 'Богатые и избалованные школьники. Сериалы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/641-dfc0d1db85d0-d266.jpg'
            },
            watchers: 25,
            count: 8,
            views: '5 K'
          },
          {
            id: 643,
            title: 'Короли и королевы. Сериалы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/643-ae844c778854-5003.jpg'
            },
            watchers: 94,
            count: 48,
            views: '13 K'
          },
          {
            id: 645,
            title: 'Комедийный детектив. Сериалы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/645-79d9a4ab8bcc-15ad.jpg'
            },
            watchers: 88,
            count: 19,
            views: '17 K'
          },
          {
            id: 700,
            title: 'Netflix сериалы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/700-7867701d8501-405e.jpg'
            },
            watchers: 1644,
            count: 101,
            views: '182 K'
          },
          {
            id: 715,
            title: 'Черный юмор. Сериалы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/715-16be879e2140-8d6f.jpg'
            },
            watchers: 170,
            count: 47,
            views: '25 K'
          },
          {
            id: 718,
            title: 'Вампиры. Сериалы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/718-186574b7eb5e-76c5.jpg'
            },
            watchers: 38,
            count: 36,
            views: '10 K'
          },
          {
            id: 721,
            title: 'Медицина. Сериалы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/721-d854876eb70f-7a6a.jpg'
            },
            watchers: 71,
            count: 42,
            views: '12 K'
          },
          {
            id: 724,
            title: 'HBO сериалы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/724-c7d512dbccfd-0f69.jpg'
            },
            watchers: 611,
            count: 104,
            views: '89 K'
          },
          {
            id: 919,
            title: 'Сериалы про психологию',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/919-efe50e661780-f89b.jpg'
            },
            watchers: 62,
            count: 79,
            views: '10 K'
          }
        ]
      },
      {
        id: '1',
        title: 'Спорт',
        items: [
          {
            id: 4,
            title: 'Футбол',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/4-877b83509fb6-0bfb.jpg'
            },
            watchers: 57,
            count: 227,
            views: '6 K'
          },
          {
            id: 6,
            title: 'Альпинизм',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/6-7fa34cdf874f-9b69.jpg'
            },
            watchers: 92,
            count: 58,
            views: '6 K'
          },
          {
            id: 7,
            title: 'Американский футбол (регби)',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/7-1ae484976ae6-12d0.jpg'
            },
            watchers: 23,
            count: 66,
            views: '2 K'
          },
          {
            id: 8,
            title: 'Бокс',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/8-7f8c6835914e-8681.jpg'
            },
            watchers: 29,
            count: 113,
            views: '2 K'
          },
          {
            id: 170,
            title: 'Сёрфинг',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/170-d9b963fd7b01-7989.jpg'
            },
            watchers: 51,
            count: 19,
            views: '2 K'
          },
          {
            id: 192,
            title: 'Фильмы про паркур',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/192-7c4a8630beb1-1210.jpg'
            },
            watchers: 15,
            count: 40,
            views: '1 K'
          },
          {
            id: 338,
            title: 'Баскетбол',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/338-cd20b45b6c16-de88.jpg'
            },
            watchers: 50,
            count: 79,
            views: '4 K'
          },
          {
            id: 339,
            title: 'Бег (Легкая атлетика)',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/339-2b036d6a0f1f-2b9b.jpg'
            },
            watchers: 23,
            count: 23,
            views: '1 K'
          },
          {
            id: 340,
            title: 'Бейсбол',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/340-41cfe5bf4ef0-db8d.jpg'
            },
            watchers: 12,
            count: 41,
            views: '931'
          },
          {
            id: 349,
            title: 'Олимпийские игры',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/349-38104e0144ca-28c8.jpg'
            },
            watchers: 6,
            count: 30,
            views: '1 K'
          },
          {
            id: 415,
            title: 'Гольф',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/415-6ecf49f25369-4a80.jpg'
            },
            watchers: 5,
            count: 12,
            views: '533'
          },
          {
            id: 416,
            title: 'Единоборства',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/416-050f4a76ecfe-4e6d.jpg'
            },
            watchers: 24,
            count: 52,
            views: '2 K'
          },
          {
            id: 417,
            title: 'Фильмы про спортивные гонки',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/417-edf5158b3109-011f.jpg'
            },
            watchers: 72,
            count: 54,
            views: '5 K'
          },
          {
            id: 418,
            title: 'Теннис',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/418-37fa001db404-dbe5.jpg'
            },
            watchers: 12,
            count: 21,
            views: '1 K'
          },
          {
            id: 419,
            title: 'Тренер',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/419-3fb3d6f82027-ab13.jpg'
            },
            watchers: 4,
            count: 24,
            views: '1 K'
          },
          {
            id: 421,
            title: 'Хоккей',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/421-3e4f2c3b9cf6-06d3.jpg'
            },
            watchers: 17,
            count: 40,
            views: '1 K'
          },
          {
            id: 422,
            title: 'Шахматы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/422-57a6e7f580a6-768c.jpg'
            },
            watchers: 24,
            count: 21,
            views: '2 K'
          },
          {
            id: 517,
            title: 'Формула-1',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/517-2154f6a764b1-b880.jpg'
            },
            watchers: 155,
            count: 30,
            views: '6 K'
          },
          {
            id: 691,
            title: 'Рестлинг',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/691-e41c708856a0-8e80.jpg'
            },
            watchers: 8,
            count: 16,
            views: '1 K'
          },
          {
            id: 694,
            title: 'Спортивная гимнастика',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/694-946a44fc2a47-1218.jpg'
            },
            watchers: 12,
            count: 13,
            views: '5 K'
          }
        ]
      },
      {
        id: '10',
        title: 'Территории',
        items: [
          {
            id: 274,
            title: 'Марс',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/274-9192486befe9-479c.jpg'
            },
            watchers: 36,
            count: 17,
            views: '6 K'
          },
          {
            id: 423,
            title: 'Аляска',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/423-002548a4aa23-3179.jpg'
            },
            watchers: 10,
            count: 11,
            views: '1 K'
          },
          {
            id: 424,
            title: 'Англия',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/424-0269cd68c8de-25b7.jpg'
            },
            watchers: 23,
            count: 28,
            views: '3 K'
          },
          {
            id: 425,
            title: 'Антарктида и Арктика',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/425-7054bac6ab3b-9cdd.jpg'
            },
            watchers: 13,
            count: 12,
            views: '1 K'
          },
          {
            id: 426,
            title: 'Ближний Восток',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/426-74446eff38ae-43fd.jpg'
            },
            watchers: 23,
            count: 28,
            views: '3 K'
          },
          {
            id: 427,
            title: 'Голливуд',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/427-10e4ab3b2b2a-4cb6.jpg'
            },
            watchers: 10,
            count: 9,
            views: '1 K'
          },
          {
            id: 428,
            title: 'Другая планета',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/428-e870941c159e-b5ab.jpg'
            },
            watchers: 32,
            count: 28,
            views: '5 K'
          },
          {
            id: 429,
            title: 'Луна',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/429-4bea6e1535f3-ca71.jpg'
            },
            watchers: 11,
            count: 18,
            views: '1 K'
          },
          {
            id: 431,
            title: 'Солнце',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/431-ff04c0164c66-d4b2.jpg'
            },
            watchers: 9,
            count: 6,
            views: '1 K'
          },
          {
            id: 682,
            title: 'Космос: последний рубеж',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/682-bf03c0713bec-df37.jpg'
            },
            watchers: 417,
            count: 156,
            views: '67 K'
          },
          {
            id: 904,
            title: 'Ватикан',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/904-a0eab1236f0e-8684.jpg'
            },
            watchers: 14,
            count: 30,
            views: '3 K'
          }
        ]
      },
      {
        id: '28',
        title: 'Технологии',
        items: [
          {
            id: 161,
            title: 'Искусственный интеллект',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/161-3d7e8a5d7d67-2c41.jpg'
            },
            watchers: 73,
            count: 31,
            views: '6 K'
          },
          {
            id: 456,
            title: 'Виртуальная реальность',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/456-89ab1aecca3d-25ca.jpg'
            },
            watchers: 59,
            count: 14,
            views: '4 K'
          },
          {
            id: 457,
            title: 'IT-технология',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/457-80a3003e9a90-7993.jpg'
            },
            watchers: 59,
            count: 13,
            views: '6 K'
          },
          {
            id: 550,
            title: 'Компьютеры / Интернет',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/550-f584409c7457-5073.jpg'
            },
            watchers: 72,
            count: 11,
            views: '7 K'
          }
        ]
      },
      {
        id: '8',
        title: 'Топ лучших и худших',
        items: [
          {
            id: 22,
            title: 'Лучшее ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/22-ac656e92eeb1-8403.jpg'
            },
            watchers: 145,
            count: 16,
            views: '29 K'
          },
          {
            id: 82,
            title: 'Лучшие фильмы современности по мнению режиссёров',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/82-b52493c3731a-0ba4.jpg'
            },
            watchers: 351,
            count: 83,
            views: '20 K'
          },
          {
            id: 85,
            title: 'Самые сексуальные фильмы всех времён по версии Filmsite',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/85-24c1b1161a24-e77f.jpg'
            },
            watchers: 447,
            count: 57,
            views: '51 K'
          },
          {
            id: 86,
            title: '50 лучших фильмов по версии КиноПоиска',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/86-8e408a611e45-5b8c.jpg'
            },
            watchers: 481,
            count: 50,
            views: '57 K'
          },
          {
            id: 92,
            title: 'Самые скандальные фильмы всех времен по мнению Filmsite',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/92-55b36d447490-a7c5.jpg'
            },
            watchers: 255,
            count: 60,
            views: '27 K'
          },
          {
            id: 138,
            title: 'Самые женские фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/138-a0cf40eca5de-52b1.jpg'
            },
            watchers: 54,
            count: 13,
            views: '7 K'
          },
          {
            id: 147,
            title: 'Лучшие японские фильмы по версии КиноПоиска ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/147-9ae422d19bd3-a0d0.jpg'
            },
            watchers: 192,
            count: 55,
            views: '7 K'
          },
          {
            id: 165,
            title: 'Лучшие фильмы ХХ века по мнению кинокритика Антона Долина',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/165-20946b8bea34-6d49.jpg'
            },
            watchers: 570,
            count: 89,
            views: '26 K'
          },
          {
            id: 184,
            title:
              'Рейтинг Forbes: самые провальные голливудские фильмы 2015 года',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/184-ff89627873ca-da18.jpg'
            },
            watchers: 5,
            count: 13,
            views: '1 K'
          },
          {
            id: 195,
            title: '100 фильмов снятых женщинами-режиссёрами',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/195-00b1c88d323f-bbab.jpg'
            },
            watchers: 54,
            count: 100,
            views: '4 K'
          },
          {
            id: 214,
            title: '10 фильмов, расширяющих сознание',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/214-07eee99d257c-968e.jpg'
            },
            watchers: 184,
            count: 10,
            views: '14 K'
          },
          {
            id: 241,
            title: '10 фильмов, которые заставили время остановиться',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/241-5da8a8bba78c-5b6c.jpg'
            },
            watchers: 86,
            count: 8,
            views: '8 K'
          },
          {
            id: 280,
            title: '50 лучших фильмов XXI века по версии кинокритиков',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/280-5f879a71076c-2b14.jpg'
            },
            watchers: 434,
            count: 50,
            views: '43 K'
          },
          {
            id: 281,
            title: '50 лучших фильмов XXI века по версии зрителей',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/281-042816157d70-ed62.jpg'
            },
            watchers: 510,
            count: 50,
            views: '70 K'
          },
          {
            id: 292,
            title: '65 лучших фильмов по версии Британского института кино',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/292-c874df9256bd-a73d.jpg'
            },
            watchers: 192,
            count: 65,
            views: '11 K'
          },
          {
            id: 295,
            title: 'Лучшие премьеры — 2016: выбор редакции КиноПоиска',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/295-1b6057fd5425-07de.jpg'
            },
            watchers: 113,
            count: 22,
            views: '22 K'
          },
          {
            id: 297,
            title: 'Лучшие премьеры Российского Года Кино',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/297-aef64e4c8693-efa2.jpg'
            },
            watchers: 44,
            count: 20,
            views: '6 K'
          },
          {
            id: 330,
            title: '250 лучших фильмов по версии imdb',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/330-346fef9f3c0d-7310.jpg'
            },
            watchers: 964,
            count: 247,
            views: '126 K'
          },
          {
            id: 404,
            title: 'Лучшие фильмы 2017 года: выбор редакции КиноПоиска',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/404-fe24432accb4-1429.jpg'
            },
            watchers: 62,
            count: 14,
            views: '11 K'
          },
          {
            id: 556,
            title:
              '100 лучших фильмов XX века по версии American Society of Cinematographers',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/556-0aebe4d86fb1-5479.jpg'
            },
            watchers: 511,
            count: 100,
            views: '37 K'
          },
          {
            id: 667,
            title: 'Вестерны. Топ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/667-c012f53d0029-3d66.jpg'
            },
            watchers: 216,
            count: 64,
            views: '14 K'
          },
          {
            id: 685,
            title: 'Корея. Топ по сборам',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/685-443272aecb7c-4a62.jpg'
            },
            watchers: 163,
            count: 62,
            views: '15 K'
          },
          {
            id: 688,
            title: 'Испания. Топ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/688-0d0479b6dc6e-6fe0.jpg'
            },
            watchers: 123,
            count: 24,
            views: '13 K'
          },
          {
            id: 811,
            title:
              'Подборка классических фильмов для правильной настройки праздничного духа',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/811-aa4592c0b03a-8dfc.jpg'
            },
            watchers: 424,
            count: 16,
            views: '37 K'
          },
          {
            id: 838,
            title: '100 лучших фильмов последних 10 десятилетий',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/838-69994324201a-e943.jpg'
            },
            watchers: 156,
            count: 98,
            views: '38 K'
          },
          {
            id: 925,
            title: 'Лучшие фильмы 2025 года по версии Rolling Stone',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/925-9944f24faa1d-c638.jpg'
            },
            watchers: 195,
            count: 19,
            views: '30 K'
          }
        ]
      },
      {
        id: '23',
        title: 'Фантастика и Мир будущего',
        items: [
          {
            id: 43,
            title: 'Путешествия во времени',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/43-fa152f005bba-40a2.jpg'
            },
            watchers: 172,
            count: 15,
            views: '18 K'
          },
          {
            id: 45,
            title: 'Постапокалипсис',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/45-2c50b904ea1a-6212.jpg'
            },
            watchers: 328,
            count: 16,
            views: '42 K'
          },
          {
            id: 105,
            title: 'Земляне vs Пришельцы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/105-547dab6bbc87-3edc.jpg'
            },
            watchers: 148,
            count: 63,
            views: '26 K'
          },
          {
            id: 204,
            title: 'Фильмы о будущем',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/204-24c5ef3925f6-a8d9.jpg'
            },
            watchers: 177,
            count: 30,
            views: '26 K'
          },
          {
            id: 276,
            title: 'Параллельные миры',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/276-e4007aaffa78-ffff.jpg'
            },
            watchers: 57,
            count: 17,
            views: '13 K'
          },
          {
            id: 282,
            title: 'Человечество против машин',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/282-5d3315789b8f-e345.jpg'
            },
            watchers: 42,
            count: 19,
            views: '7 K'
          },
          {
            id: 334,
            title: 'Киберпанк',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/334-bf177052babd-f92e.jpg'
            },
            watchers: 478,
            count: 75,
            views: '40 K'
          },
          {
            id: 360,
            title: 'Роботы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/360-87a5eaa53619-253e.jpg'
            },
            watchers: 54,
            count: 52,
            views: '8 K'
          },
          {
            id: 413,
            title: 'Предсказание будущего',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/413-a93e1c876214-6cfe.jpg'
            },
            watchers: 47,
            count: 25,
            views: '10 K'
          },
          {
            id: 898,
            title:
              'Космический хоррор и научная фантастика: путешествие в неизведанное',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/898-87ca50cbb630-9271.jpg'
            },
            watchers: 144,
            count: 15,
            views: '28 K'
          }
        ]
      },
      {
        id: '6',
        title: 'Фильмографии актёров',
        items: [
          {
            id: 65,
            title: 'Луи де Фюнес: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/65-a4827a6f4201-8c74.jpg'
            },
            watchers: 188,
            count: 36,
            views: '5 K'
          },
          {
            id: 100,
            title: 'Брюс Ли: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/100-8d551ae23540-8a09.jpg'
            },
            watchers: 58,
            count: 6,
            views: '1 K'
          },
          {
            id: 131,
            title: 'Клинт Иствуд: фильмография ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/131-17e18d810fc4-e9c3.jpg'
            },
            watchers: 54,
            count: 35,
            views: '3 K'
          },
          {
            id: 132,
            title: 'Том Хэнкс: фильмография ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/132-053c785132da-8f02.jpg'
            },
            watchers: 83,
            count: 47,
            views: '8 K'
          },
          {
            id: 137,
            title: 'Кира Найтли: от дочери Робин Гуда до Анны Карениной',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/137-7200b30d2206-d442.jpg'
            },
            watchers: 18,
            count: 28,
            views: '3 K'
          },
          {
            id: 143,
            title: 'Майкл Кейн: лучшие фильмы ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/143-03ec04dd5342-39ca.jpg'
            },
            watchers: 31,
            count: 65,
            views: '3 K'
          },
          {
            id: 148,
            title: 'Легендарный Чингачгук - Гойко Митич',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/148-2e8e720dc096-bab0.jpg'
            },
            watchers: 39,
            count: 20,
            views: '779'
          },
          {
            id: 150,
            title: 'Брюс Уиллис: крепкий орешек',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/150-9e46a189ccd4-ffd3.jpg'
            },
            watchers: 90,
            count: 64,
            views: '6 K'
          },
          {
            id: 153,
            title: 'Леонардо ДиКаприо: оскароносец 2016',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/153-30914d90a4db-5125.jpg'
            },
            watchers: 62,
            count: 28,
            views: '5 K'
          },
          {
            id: 173,
            title: 'Бенедикт Камбербэтч: от Шерлока до Франкенштейна',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/173-e0bf6bb64310-6491.jpg'
            },
            watchers: 69,
            count: 21,
            views: '5 K'
          },
          {
            id: 175,
            title: 'Мэттью МакКонахи: настоящий детектив',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/175-1ddde793f892-7f76.jpg'
            },
            watchers: 65,
            count: 33,
            views: '8 K'
          },
          {
            id: 179,
            title: 'Роберт Де Ниро: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/179-c7263295e781-01f2.jpg'
            },
            watchers: 86,
            count: 66,
            views: '6 K'
          },
          {
            id: 180,
            title: 'Рассел Кроу: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/180-f1b06ad1e21a-bdc5.jpg'
            },
            watchers: 45,
            count: 16,
            views: '4 K'
          },
          {
            id: 183,
            title: 'Аль Пачино: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/183-03f327a1a5e5-7667.jpg'
            },
            watchers: 78,
            count: 45,
            views: '3 K'
          },
          {
            id: 197,
            title: 'Джек Николсон: лучшие роли',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/197-ce796d516dfd-293d.jpg'
            },
            watchers: 51,
            count: 36,
            views: '3 K'
          },
          {
            id: 199,
            title: 'Джеймс МакЭвой: особо опасен',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/199-1ede76592053-1346.jpg'
            },
            watchers: 24,
            count: 22,
            views: '3 K'
          },
          {
            id: 201,
            title: 'Дензел Вашингтон: дежа вю',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/201-d5ecc8fdc166-4f71.jpg'
            },
            watchers: 61,
            count: 34,
            views: '6 K'
          },
          {
            id: 209,
            title: 'Хит Леджер: от рыцаря до Джокера',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/209-51c3ffc3af65-328f.jpg'
            },
            watchers: 31,
            count: 17,
            views: '2 K'
          },
          {
            id: 215,
            title: 'Джордж Клуни: лучшие роли',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/215-a368c8a27eee-455c.jpg'
            },
            watchers: 24,
            count: 32,
            views: '4 K'
          },
          {
            id: 233,
            title: 'Кейт Бланшетт: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/233-5be564ebf3bd-4631.jpg'
            },
            watchers: 21,
            count: 40,
            views: '2 K'
          },
          {
            id: 236,
            title: 'Тим Рот: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/236-5066b7012215-26b3.jpg'
            },
            watchers: 40,
            count: 42,
            views: '5 K'
          },
          {
            id: 237,
            title: 'Александр Абдулов: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/237-d202ec4b4b7c-974a.jpg'
            },
            watchers: 25,
            count: 25,
            views: '1 K'
          },
          {
            id: 240,
            title: 'Анджелина Джоли: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/240-cc713d849c5f-db38.jpg'
            },
            watchers: 45,
            count: 30,
            views: '4 K'
          },
          {
            id: 245,
            title: 'Томми Ли Джонс:  фильмография ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/245-d11d76862bdb-9b79.jpg'
            },
            watchers: 17,
            count: 43,
            views: '3 K'
          },
          {
            id: 246,
            title: 'Николь Кидман: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/246-aea6947fb547-a1d4.jpg'
            },
            watchers: 41,
            count: 45,
            views: '5 K'
          },
          {
            id: 249,
            title: 'Сильвестр Сталлоне: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/249-7b14a200c352-fe5c.jpg'
            },
            watchers: 45,
            count: 40,
            views: '3 K'
          },
          {
            id: 250,
            title: 'Брэд Питт: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/250-669965e88b7e-c563.jpg'
            },
            watchers: 71,
            count: 45,
            views: '8 K'
          },
          {
            id: 257,
            title: 'Робин Уильямс: «Эйнштейн комедии»',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/257-7babd6e334f7-6694.jpg'
            },
            watchers: 75,
            count: 51,
            views: '5 K'
          },
          {
            id: 275,
            title: ' Одри Тоту: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/275-41c41f7ecc21-a084.jpg'
            },
            watchers: 21,
            count: 23,
            views: '2 K'
          },
          {
            id: 285,
            title: 'Джеки Чан: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/285-d2b734166f45-b80f.jpg'
            },
            watchers: 345,
            count: 64,
            views: '13 K'
          },
          {
            id: 290,
            title: 'Юрий Никулин: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/290-3a1ea1cc78d3-d139.jpg'
            },
            watchers: 40,
            count: 18,
            views: '1 K'
          },
          {
            id: 291,
            title: 'Сэмюэл Л. Джексон: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/291-f27fd13ca09b-71f1.jpg'
            },
            watchers: 27,
            count: 67,
            views: '5 K'
          },
          {
            id: 296,
            title: 'Адриано Челентано: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/296-c7c981ab01bf-e5a9.jpg'
            },
            watchers: 137,
            count: 9,
            views: '3 K'
          },
          {
            id: 298,
            title: 'Мэл Гибсон: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/298-007327b8e4f5-c6f9.jpg'
            },
            watchers: 53,
            count: 35,
            views: '6 K'
          },
          {
            id: 302,
            title: 'Данила Козловский: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/302-f7ebd3f3e27e-480f.jpg'
            },
            watchers: 14,
            count: 19,
            views: '3 K'
          },
          {
            id: 304,
            title: 'Мэрил Стрип',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/304-6d1e566105f4-27c0.jpg'
            },
            watchers: 60,
            count: 43,
            views: '6 K'
          },
          {
            id: 306,
            title: 'Жан-Клод Ван Дамм',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/306-35aa4d651e42-6a68.jpg'
            },
            watchers: 48,
            count: 29,
            views: '3 K'
          },
          {
            id: 313,
            title: 'Фёдор Добронравов: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/313-a85eab77ee72-8b09.jpg'
            },
            watchers: 8,
            count: 16,
            views: '2 K'
          },
          {
            id: 335,
            title: 'Бен Аффлек: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/335-e6640a9cdfa9-68c3.jpg'
            },
            watchers: 26,
            count: 39,
            views: '6 K'
          },
          {
            id: 407,
            title: 'Сергей Бодров-мл.',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/407-ad450954dc24-ecc9.jpg'
            },
            watchers: 29,
            count: 10,
            views: '1 K'
          },
          {
            id: 408,
            title: 'Харрисон Форд: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/408-d96bdde07ee8-83d9.jpg'
            },
            watchers: 41,
            count: 48,
            views: '4 K'
          },
          {
            id: 411,
            title: 'Шер - Фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/411-2377c410a977-c54f.jpg'
            },
            watchers: 5,
            count: 12,
            views: '930'
          },
          {
            id: 784,
            title: 'Шон Коннери: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/784-ea98f3b96e6e-6ca6.jpg'
            },
            watchers: 33,
            count: 49,
            views: '8 K'
          }
        ]
      },
      {
        id: '5',
        title: 'Фильмографии режиссёров',
        items: [
          {
            id: 56,
            title: 'Квентин Тарантино: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/56-d2f9be3aad9d-17d2.jpg'
            },
            watchers: 780,
            count: 14,
            views: '33 K'
          },
          {
            id: 59,
            title: 'Стивен Спилберг: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/59-abf2400ff85a-71f2.jpg'
            },
            watchers: 202,
            count: 30,
            views: '15 K'
          },
          {
            id: 63,
            title: 'Мартин Скорсезе: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/63-f411d3876d23-9e03.jpg'
            },
            watchers: 180,
            count: 25,
            views: '8 K'
          },
          {
            id: 68,
            title: 'Фильмография братьев Коэн',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/68-cb66020d5809-5ec9.jpg'
            },
            watchers: 374,
            count: 23,
            views: '18 K'
          },
          {
            id: 69,
            title: 'Творчество Хаяо Миядзаки',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/69-0953136f0036-f01c.jpg'
            },
            watchers: 1011,
            count: 19,
            views: '28 K'
          },
          {
            id: 70,
            title: 'Кристофер Нолан: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/70-f18de07b4914-9030.jpg'
            },
            watchers: 284,
            count: 10,
            views: '15 K'
          },
          {
            id: 73,
            title: 'Дэвид Финчер: крутой экранизатор',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/73-1d3bed38a9b1-56f6.jpg'
            },
            watchers: 212,
            count: 10,
            views: '16 K'
          },
          {
            id: 74,
            title: 'Линч, какой он есть',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/74-2b5fc321c2e7-9f5d.jpg'
            },
            watchers: 143,
            count: 10,
            views: '4 K'
          },
          {
            id: 75,
            title: 'Бесподобный Уэс Андерсон',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/75-246a0791b93e-b240.jpg'
            },
            watchers: 369,
            count: 16,
            views: '12 K'
          },
          {
            id: 79,
            title: 'Альфред  Хичкок: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/79-c2d08863c794-d921.jpg'
            },
            watchers: 151,
            count: 34,
            views: '3 K'
          },
          {
            id: 80,
            title: 'Алехандро Гонсалес Иньярриту: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/80-da2f55951bec-d52a.jpg'
            },
            watchers: 59,
            count: 9,
            views: '2 K'
          },
          {
            id: 97,
            title: 'В одном из снятых фильмов Федерико Феллини...',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/97-30dd2563dfe4-fc23.jpg'
            },
            watchers: 78,
            count: 15,
            views: '1 K'
          },
          {
            id: 98,
            title: 'Ричард Линклейтер и его фильмы ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/98-e5c7976a7e97-4211.jpg'
            },
            watchers: 35,
            count: 17,
            views: '2 K'
          },
          {
            id: 101,
            title: 'Эмир Кустурица: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/101-ad09844c6ec0-1389.jpg'
            },
            watchers: 87,
            count: 12,
            views: '2 K'
          },
          {
            id: 106,
            title: 'Ларс  фон Триер: фильмография режиссёра ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/106-e3ed403b6edc-bfcc.jpg'
            },
            watchers: 118,
            count: 13,
            views: '3 K'
          },
          {
            id: 121,
            title: 'Фильмы Тарковского',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/121-f999d10cb1ec-cce7.jpg'
            },
            watchers: 138,
            count: 6,
            views: '2 K'
          },
          {
            id: 125,
            title: 'Джеймс Кэмерон: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/125-f93a7657ef2b-7365.jpg'
            },
            watchers: 90,
            count: 9,
            views: '6 K'
          },
          {
            id: 129,
            title: 'Педро Альмодовар: фильмография режиссёра ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/129-279e646c381c-1d7a.jpg'
            },
            watchers: 105,
            count: 20,
            views: '3 K'
          },
          {
            id: 130,
            title: 'Ридли Скотт: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/130-5dd853d3b8ca-72b1.jpg'
            },
            watchers: 173,
            count: 24,
            views: '17 K'
          },
          {
            id: 134,
            title: 'Мультфильмы Александра Петрова',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/134-ee684fc7bbdb-6bc7.jpg'
            },
            watchers: 24,
            count: 5,
            views: '777'
          },
          {
            id: 139,
            title: 'Мир Тима Бёртона',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/139-edb02f775809-00ef.jpg'
            },
            watchers: 177,
            count: 18,
            views: '8 K'
          },
          {
            id: 140,
            title: 'Гай Ричи: режиссёр, сценарист, продюсер',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/140-ac01a4ff760f-9f0a.jpg'
            },
            watchers: 510,
            count: 10,
            views: '28 K'
          },
          {
            id: 141,
            title: 'Люк Бессон: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/141-81877693438e-11d6.jpg'
            },
            watchers: 107,
            count: 22,
            views: '7 K'
          },
          {
            id: 142,
            title: 'Такеши Китано: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/142-4e22b482e9a4-8313.jpg'
            },
            watchers: 84,
            count: 18,
            views: '2 K'
          },
          {
            id: 145,
            title: 'Акира Куросава: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/145-02ab1c59f127-8b55.jpg'
            },
            watchers: 125,
            count: 19,
            views: '2 K'
          },
          {
            id: 155,
            title: 'Роман Полански: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/155-3655d807c216-6986.jpg'
            },
            watchers: 81,
            count: 22,
            views: '4 K'
          },
          {
            id: 164,
            title: 'Тинто Брасс - мэтр киноэротики',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/164-6cb1bc7fec5c-a383.jpg'
            },
            watchers: 136,
            count: 15,
            views: '19 K'
          },
          {
            id: 186,
            title: 'Зак Снайдер: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/186-95002b72a940-9bb1.jpg'
            },
            watchers: 33,
            count: 6,
            views: '3 K'
          },
          {
            id: 194,
            title: 'Гильермо дель Торо: режиссёр, сценарист, продюсер',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/194-2801eafbb9ef-9c5b.jpg'
            },
            watchers: 77,
            count: 25,
            views: '5 K'
          },
          {
            id: 203,
            title: 'Стэнли Кубрик: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/203-52e43fa9e144-4e0f.jpg'
            },
            watchers: 144,
            count: 13,
            views: '3 K'
          },
          {
            id: 208,
            title: 'Орсон Уэллс: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/208-721d80c2a004-31aa.jpg'
            },
            watchers: 26,
            count: 11,
            views: '778'
          },
          {
            id: 234,
            title: 'Роберт Земекис: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/234-f18430bc8451-ae99.jpg'
            },
            watchers: 119,
            count: 18,
            views: '9 K'
          },
          {
            id: 235,
            title: 'София Коппола: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/235-69e2ce9f99a7-5472.jpg'
            },
            watchers: 38,
            count: 6,
            views: '2 K'
          },
          {
            id: 239,
            title: 'Йос Стеллинг: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/239-291d3b817d4a-8d4d.jpg'
            },
            watchers: 11,
            count: 6,
            views: '1 K'
          },
          {
            id: 244,
            title: 'Вуди Аллен: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/244-79fee81d494b-8068.jpg'
            },
            watchers: 269,
            count: 42,
            views: '10 K'
          },
          {
            id: 247,
            title: 'Роберт Родригес: фильмография',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/247-62f005d16111-b8eb.jpg'
            },
            watchers: 45,
            count: 17,
            views: '2 K'
          },
          {
            id: 261,
            title: 'Сэм Мендес: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/261-eba93981f2aa-1ba4.jpg'
            },
            watchers: 17,
            count: 7,
            views: '3 K'
          },
          {
            id: 279,
            title: 'Ингрид Бергман: лучшие фильмы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/279-f6e8ace2b1b6-538e.jpg'
            },
            watchers: 31,
            count: 9,
            views: '1 K'
          },
          {
            id: 322,
            title: 'Карел Земан: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/322-e2a3fe0d6827-a08b.jpg'
            },
            watchers: 13,
            count: 6,
            views: '861'
          },
          {
            id: 331,
            title: 'Брайан де Пальма: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/331-1d8b08bf5c7c-c65e.jpg'
            },
            watchers: 26,
            count: 19,
            views: '4 K'
          },
          {
            id: 352,
            title: 'Мир Майка Флэнегана',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/352-2e1e0a5b9ef3-c51f.jpg'
            },
            watchers: 25,
            count: 6,
            views: '2 K'
          },
          {
            id: 406,
            title: 'Киномир Питера Джексона',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/406-e9896f4b109e-176f.jpg'
            },
            watchers: 29,
            count: 16,
            views: '3 K'
          },
          {
            id: 412,
            title: 'Мартин МакДона: фильмография режиссёера',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/412-08bccd8cdc76-e93f.jpg'
            },
            watchers: 33,
            count: 4,
            views: '2 K'
          },
          {
            id: 420,
            title: 'Леонид Гайдай: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/420-90e2376a9297-a7d2.jpg'
            },
            watchers: 89,
            count: 18,
            views: '2 K'
          },
          {
            id: 489,
            title: 'Стивен Содерберг: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/489-07abd236c207-7ff2.jpg'
            },
            watchers: 50,
            count: 25,
            views: '6 K'
          },
          {
            id: 513,
            title: 'Милош Форман: фильмография режиссёра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/513-025e476d87d3-9c01.jpg'
            },
            watchers: 35,
            count: 13,
            views: '2 K'
          },
          {
            id: 703,
            title: 'Сегундо де Шомон - инженер короткого метра',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/703-c2b4188fe1f7-865b.jpg'
            },
            watchers: 35,
            count: 27,
            views: '1 K'
          }
        ]
      },
      {
        id: '34',
        title: 'Фильмы об известных личностях',
        items: [
          {
            id: 243,
            title: 'Фильмы про Кеннеди',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/243-f184ff4de51a-4f35.jpg'
            },
            watchers: 10,
            count: 5,
            views: '709'
          },
          {
            id: 253,
            title: 'Никола Тесла: человек из будущего',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/253-ad054bf0c05a-b8bd.jpg'
            },
            watchers: 30,
            count: 8,
            views: '2 K'
          },
          {
            id: 300,
            title: 'Annika Bengtzon',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/300-e64eefa484ed-5d55.jpg'
            },
            watchers: 15,
            count: 7,
            views: '1 K'
          }
        ]
      },
      {
        id: '21',
        title: 'Экранизации литературных произведений',
        items: [
          {
            id: 13,
            title: 'Зарубежная классика: лучшие экранизации',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/13-42c1f4ebed77-16a1.jpg'
            },
            watchers: 122,
            count: 46,
            views: '8 K'
          },
          {
            id: 67,
            title: 'Фильмы по Джейн Остин',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/67-d861bdd2f157-812f.jpg'
            },
            watchers: 52,
            count: 11,
            views: '3 K'
          },
          {
            id: 72,
            title: 'Экранизации книг Стивена Кинга',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/72-de7ab49d05e6-b972.jpg'
            },
            watchers: 586,
            count: 81,
            views: '52 K'
          },
          {
            id: 76,
            title: 'Экранизации романа Булгакова «Мастер и Маргарита»',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/76-9b812375f7e1-ea3c.jpg'
            },
            watchers: 19,
            count: 4,
            views: '1 K'
          },
          {
            id: 112,
            title: 'Экранизации трилогии «Миллениум» Стига Ларссона',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/112-adbcfbd367db-0ce1.jpg'
            },
            watchers: 79,
            count: 5,
            views: '3 K'
          },
          {
            id: 126,
            title: 'Фильмы, снятые по мотивам произведений Говарда Лавкрафта',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/126-e2f0a7102514-3440.jpg'
            },
            watchers: 113,
            count: 27,
            views: '5 K'
          },
          {
            id: 135,
            title: 'Фильмы, снятые по мотивам произведений Дина Кунца',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/135-2d696d080494-521a.jpg'
            },
            watchers: 27,
            count: 10,
            views: '1 K'
          },
          {
            id: 154,
            title: 'Фильмы, снятые по мотивам произведений братьев Стругацких',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/154-c17df6ceffb5-cc14.jpg'
            },
            watchers: 69,
            count: 9,
            views: '4 K'
          },
          {
            id: 157,
            title: 'Русская классика: лучшие экранизации',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/157-9320bca2e50a-f7d4.jpg'
            },
            watchers: 91,
            count: 24,
            views: '3 K'
          },
          {
            id: 158,
            title: 'Зарубежная современная проза: лучшие экранизации',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/158-a7b89ad168cc-3ba9.jpg'
            },
            watchers: 91,
            count: 46,
            views: '5 K'
          },
          {
            id: 159,
            title: 'Русская современная проза: лучшие экранизации',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/159-e991b74070d9-376a.jpg'
            },
            watchers: 61,
            count: 19,
            views: '3 K'
          },
          {
            id: 211,
            title: 'Воображариум Терри Гиллиама',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/211-3fbe0fac1674-28e9.jpg'
            },
            watchers: 68,
            count: 13,
            views: '3 K'
          },
          {
            id: 359,
            title: 'Экранизации произведений Филипа Дика',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/359-7605544c0ff4-9b15.jpg'
            },
            watchers: 127,
            count: 19,
            views: '9 K'
          },
          {
            id: 405,
            title: 'Топ-20 книжных экранизаций 2017 года ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/405-ea1f7711e19f-eb7d.jpg'
            },
            watchers: 39,
            count: 18,
            views: '9 K'
          },
          {
            id: 488,
            title: 'Габриэль Гарсиа Маркес: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/488-bff65fd7936f-ed7f.jpg'
            },
            watchers: 32,
            count: 7,
            views: '3 K'
          },
          {
            id: 490,
            title: 'Жюль Верн: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/490-c7493e81d95b-2e4b.jpg'
            },
            watchers: 50,
            count: 24,
            views: '4 K'
          },
          {
            id: 491,
            title: 'Александр Дюма: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/491-b88591186f3a-9471.jpg'
            },
            watchers: 18,
            count: 29,
            views: '2 K'
          },
          {
            id: 492,
            title: 'Джек Лондон: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/492-0aa61985824c-8909.jpg'
            },
            watchers: 16,
            count: 7,
            views: '2 K'
          },
          {
            id: 493,
            title: 'Виктор Гюго: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/493-66d88a9f82fd-d304.jpg'
            },
            watchers: 15,
            count: 13,
            views: '1 K'
          },
          {
            id: 494,
            title: 'Лев Толстой: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/494-5902124ec1c1-796a.jpg'
            },
            watchers: 17,
            count: 10,
            views: '1 K'
          },
          {
            id: 495,
            title: 'Рэй Брэдбери: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/495-95310438511a-daee.jpg'
            },
            watchers: 68,
            count: 9,
            views: '6 K'
          },
          {
            id: 496,
            title: 'Артур Конан Дойл: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/496-0a97b81019d3-337a.jpg'
            },
            watchers: 56,
            count: 36,
            views: '3 K'
          },
          {
            id: 497,
            title: 'Агата Кристи: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/497-61976f9a32b1-38b3.jpg'
            },
            watchers: 95,
            count: 18,
            views: '8 K'
          },
          {
            id: 498,
            title: 'Жорж Сименон: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/498-ded3561db017-6dd4.jpg'
            },
            watchers: 26,
            count: 11,
            views: '2 K'
          },
          {
            id: 499,
            title: 'Чарльз Диккенс: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/499-37a8c4e5757b-60c6.jpg'
            },
            watchers: 20,
            count: 21,
            views: '2 K'
          },
          {
            id: 500,
            title: 'Редьярд Киплинг: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/500-ca53b02fb7d0-e45d.jpg'
            },
            watchers: 19,
            count: 10,
            views: '1 K'
          },
          {
            id: 501,
            title: 'Александр Пушкин: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/501-ef3ac5cdffb8-5eea.jpg'
            },
            watchers: 24,
            count: 17,
            views: '1 K'
          },
          {
            id: 502,
            title: 'Роберт Стивенсон: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/502-9d6b6edef00e-8627.jpg'
            },
            watchers: 13,
            count: 14,
            views: '2 K'
          },
          {
            id: 503,
            title: 'Марк Твен: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/503-2ba352e4af27-1707.jpg'
            },
            watchers: 18,
            count: 13,
            views: '2 K'
          },
          {
            id: 504,
            title: 'Уильям Шекспир: экранизации произведений',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/504-b4d34ef11429-f13f.jpg'
            },
            watchers: 50,
            count: 35,
            views: '3 K'
          },
          {
            id: 577,
            title: 'Астрид Линдгрен. Экранизации',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/577-98d701fcfadf-fc9a.jpg'
            },
            watchers: 35,
            count: 9,
            views: '2 K'
          },
          {
            id: 583,
            title: 'Амадей Гофман. Экранизации',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/583-7d371b711083-c9e6.jpg'
            },
            watchers: 9,
            count: 5,
            views: '1 K'
          },
          {
            id: 589,
            title: 'Патриция Хайсмит. Экранизации',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/589-987064c6ba38-c4f4.jpg'
            },
            watchers: 27,
            count: 11,
            views: '2 K'
          },
          {
            id: 865,
            title: 'По произведениям Эдгара Уоллеса',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/865-5af95a7870ce-69c8.jpg'
            },
            watchers: 9,
            count: 22,
            views: '2 K'
          },
          {
            id: 910,
            title: 'По произведениям Риты Фальк',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/910-d561e2cfdc79-377c.jpg'
            },
            watchers: 48,
            count: 9,
            views: '3 K'
          }
        ]
      },
      {
        id: '31',
        title: 'Юмор',
        items: [
          {
            id: 193,
            title: 'Чёрные-пречёрные комедии',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/193-3dfbb1a12816-bdb3.jpg'
            },
            watchers: 378,
            count: 22,
            views: '37 K'
          },
          {
            id: 207,
            title: 'Английский юмор',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/207-3aeb05e54c18-7b60.jpg'
            },
            watchers: 145,
            count: 36,
            views: '12 K'
          },
          {
            id: 242,
            title: 'Очень страшное кино ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/242-df4ef5f1de69-7de7.jpg'
            },
            watchers: 41,
            count: 4,
            views: '3 K'
          },
          {
            id: 453,
            title: 'Юмор ниже пояса',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/453-625d86ccb8d2-61fb.jpg'
            },
            watchers: 166,
            count: 31,
            views: '17 K'
          },
          {
            id: 454,
            title: 'Пародия',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/454-141f53a011ad-2e85.jpg'
            },
            watchers: 100,
            count: 57,
            views: '9 K'
          },
          {
            id: 455,
            title: 'Сатира',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/455-e9b7f3e9f5f0-2645.jpg'
            },
            watchers: 51,
            count: 44,
            views: '8 K'
          }
        ]
      },
      {
        id: 'none',
        title: 'Без категории',
        items: [
          {
            id: 17,
            title: 'Модные штучки',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/17-34d35e4572c9-d6ba.jpg'
            },
            watchers: 70,
            count: 25,
            views: '5 K'
          },
          {
            id: 60,
            title: 'Страсть танца ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/60-b57ee275fc55-0bad.jpg'
            },
            watchers: 41,
            count: 34,
            views: '2 K'
          },
          {
            id: 62,
            title:
              'Фильмы, попавшие под запрет согласно изданию “The Independent”',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/62-c2634cc1d011-2626.jpg'
            },
            watchers: 122,
            count: 24,
            views: '11 K'
          },
          {
            id: 64,
            title: 'Взаперти: фильмы о людях в замкнутых пространствах',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/64-662503ca5fe1-ad53.jpg'
            },
            watchers: 32,
            count: 12,
            views: '2 K'
          },
          {
            id: 77,
            title: 'Стендап в озвучке RUMBLE',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/77-a9f00db9e8f9-b34c.jpg'
            },
            watchers: 480,
            count: 51,
            views: '13 K'
          },
          {
            id: 107,
            title: 'По-настоящему брутальная подборка',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/107-05d66f9de8c2-6a25.jpg'
            },
            watchers: 55,
            count: 16,
            views: '5 K'
          },
          {
            id: 111,
            title: 'Фильмы, снятые по играм',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/111-f56d1fbea4cb-fb6e.jpg'
            },
            watchers: 97,
            count: 63,
            views: '11 K'
          },
          {
            id: 146,
            title: 'Жажда скорости',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/146-2b29b6537545-7891.jpg'
            },
            watchers: 41,
            count: 41,
            views: '3 K'
          },
          {
            id: 213,
            title:
              'Шикарные фильмы, о которых вы, скорее всего, никогда не слышали',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/213-5b801be35d4b-23d3.jpg'
            },
            watchers: 271,
            count: 9,
            views: '26 K'
          },
          {
            id: 259,
            title: 'Околофутбол',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/259-c14c8d09eccf-6934.jpg'
            },
            watchers: 36,
            count: 15,
            views: '2 K'
          },
          {
            id: 299,
            title: ' Мультфильмы, которые способны перевернуть сознание',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/299-ee132b1438ba-0629.jpg'
            },
            watchers: 207,
            count: 15,
            views: '11 K'
          },
          {
            id: 523,
            title: 'Война',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/523-7e3c19466cff-5714.jpg'
            },
            watchers: 9,
            count: 5,
            views: '3 K'
          },
          {
            id: 538,
            title: 'Фильмы о полицейских',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/538-5e5350754930-ddf0.jpg'
            },
            watchers: 10,
            count: 10,
            views: '3 K'
          },
          {
            id: 544,
            title: 'Подростки',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/544-ff04d5f60ebe-8a48.jpg'
            },
            watchers: 18,
            count: 9,
            views: '5 K'
          },
          {
            id: 553,
            title: 'Космическое приключение',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/553-0425aaf0a948-d175.jpg'
            },
            watchers: 62,
            count: 6,
            views: '14 K'
          },
          {
            id: 571,
            title: 'Цирк',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/571-220825c5531e-e3b5.jpg'
            },
            watchers: 6,
            count: 15,
            views: '709'
          },
          {
            id: 607,
            title: 'Про путешественников',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/607-9d8fe16f70a0-9773.jpg'
            },
            watchers: 43,
            count: 193,
            views: '15 K'
          },
          {
            id: 610,
            title: 'Месть',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/610-6171958254f2-9bea.jpg'
            },
            watchers: 19,
            count: 33,
            views: '4 K'
          },
          {
            id: 613,
            title: 'Армия',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/613-7bf1bfd60214-3807.jpg'
            },
            watchers: 24,
            count: 10,
            views: '4 K'
          },
          {
            id: 646,
            title: 'Сумасшедшая концовка в последние 15 минут',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/646-858e5fa9fb5d-7d3e.jpg'
            },
            watchers: 503,
            count: 134,
            views: '56 K'
          },
          {
            id: 655,
            title: 'Любимые фильмы Уэса Андерсона',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/655-ebb9128a9979-53c4.jpg'
            },
            watchers: 198,
            count: 32,
            views: '7 K'
          },
          {
            id: 661,
            title: 'Netflix в жанре стенд-ап',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/661-6113d821a071-7e01.jpg'
            },
            watchers: 293,
            count: 41,
            views: '9 K'
          },
          {
            id: 676,
            title: 'Disney+',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/676-9458ab7811cd-2b21.jpg'
            },
            watchers: 295,
            count: 13,
            views: '27 K'
          },
          {
            id: 679,
            title: 'Креатив при низких бюджетах',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/679-53cd470a9deb-5378.jpg'
            },
            watchers: 101,
            count: 34,
            views: '5 K'
          },
          {
            id: 697,
            title: 'Женщины. Документальное кино',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/697-328a12a672d5-5796.jpg'
            },
            watchers: 54,
            count: 64,
            views: '4 K'
          },
          {
            id: 706,
            title: 'Временная петля',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/706-5101d8552c72-7297.jpg'
            },
            watchers: 212,
            count: 35,
            views: '30 K'
          },
          {
            id: 709,
            title: 'Сломанный меч',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/709-f2d151b4e5d2-315f.jpg'
            },
            watchers: 41,
            count: 6,
            views: '3 K'
          },
          {
            id: 712,
            title:
              'Аниме-полнометражки начала 2000-х, которые стоит посмотреть',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/712-fd7e59623843-61ca.jpg'
            },
            watchers: 347,
            count: 18,
            views: '19 K'
          },
          {
            id: 727,
            title: 'Музыка. Сериалы',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/727-5b451af1a945-bae9.jpg'
            },
            watchers: 25,
            count: 38,
            views: '4 K'
          },
          {
            id: 730,
            title: 'Такси',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/730-629e178db162-f23c.jpg'
            },
            watchers: 68,
            count: 4,
            views: '5 K'
          },
          {
            id: 736,
            title: 'Фильмы про школу',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/736-50c60363f642-cbda.jpg'
            },
            watchers: 12,
            count: 29,
            views: '6 K'
          },
          {
            id: 787,
            title:
              'Что смотреть онлайн, если все надоело. Подборка самого неожиданного',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/787-183afe5216e3-703a.jpg'
            },
            watchers: 89,
            count: 5,
            views: '23 K'
          },
          {
            id: 790,
            title: '50 фильмов, которые нужно посмотреть, прежде чем умереть',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/790-1ce6327850a9-a465.jpg'
            },
            watchers: 536,
            count: 51,
            views: '87 K'
          },
          {
            id: 796,
            title:
              'Лучшие полнометражные аниме 90-х: от постапокалиптики и антиутопии до социальной сатиры',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/796-9e7d1b01c546-4221.jpg'
            },
            watchers: 213,
            count: 5,
            views: '16 K'
          },
          {
            id: 805,
            title:
              'Запретный плод: фильмы, которые впору показывать на уроках полового воспитания ',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/805-f5d9b2038a8f-c807.jpg'
            },
            watchers: 131,
            count: 12,
            views: '29 K'
          },
          {
            id: 808,
            title: 'Не пойман — не вор: самые обаятельные экранные мошенники',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/808-8e324cf83bca-932a.jpg'
            },
            watchers: 119,
            count: 14,
            views: '35 K'
          },
          {
            id: 817,
            title: 'Заблокированные Роскомнадзором аниме',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/817-1707658e143d-6847.jpg'
            },
            watchers: 342,
            count: 23,
            views: '55 K'
          },
          {
            id: 820,
            title: 'Фильмы про круиз',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/820-29b5a8478c79-daf3.jpg'
            },
            watchers: 17,
            count: 33,
            views: '11 K'
          },
          {
            id: 823,
            title: 'Юра Борисов и наследие «Бригады»',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/823-60bb5a953fdb-b1b9.jpg'
            },
            watchers: 37,
            count: 10,
            views: '13 K'
          },
          {
            id: 829,
            title: 'Экранизации «Трех мушкетеров»',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/829-01c1f7358242-58e2.jpg'
            },
            watchers: 17,
            count: 25,
            views: '3 K'
          },
          {
            id: 832,
            title: 'Исекаи с попаданцем в фентези или альтернативный мир',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/832-82098f2fbea4-cd49.jpg'
            },
            watchers: 234,
            count: 52,
            views: '24 K'
          },
          {
            id: 841,
            title:
              'О чем снимают в России, когда о главном говорить запрещено? О тайге, такси и сектах',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/841-ec0975df4180-795f.jpg'
            },
            watchers: 75,
            count: 4,
            views: '13 K'
          },
          {
            id: 844,
            title: 'Фильмы с сильными женскими персонажами',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/844-d2d294c662cf-2ba2.jpg'
            },
            watchers: 47,
            count: 96,
            views: '12 K'
          },
          {
            id: 847,
            title: 'Главная героиня - девочка',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/847-5e69b0660d9f-a6b6.jpg'
            },
            watchers: 20,
            count: 105,
            views: '6 K'
          },
          {
            id: 850,
            title: 'Про женщин, которые добились, чего хотели',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/850-d102e04e3247-8e0d.jpg'
            },
            watchers: 52,
            count: 48,
            views: '13 K'
          },
          {
            id: 853,
            title: 'Лучшие мультфильмы всех времен',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/853-92dd1141c403-30d7.jpg'
            },
            watchers: 268,
            count: 82,
            views: '28 K'
          },
          {
            id: 883,
            title: 'Аборт в российском и советском кино',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/883-1169909997cf-d9db.jpg'
            },
            watchers: 7,
            count: 21,
            views: '2 K'
          },
          {
            id: 907,
            title:
              'Топ небанальных фильмов и сериалов для новогодних праздников, если «Гарри Поттер» и «Один дома» уже надоели',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/907-246b3f2f8c7c-0eb6.jpg'
            },
            watchers: 29,
            count: 6,
            views: '13 K'
          },
          {
            id: 913,
            title: 'Аниме: Юные сердца и первые чувства',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/913-e0db81433cd6-49ad.jpg'
            },
            watchers: 33,
            count: 11,
            views: '4 K'
          },
          {
            id: 931,
            title: 'Клуб Веселых человечков',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/931-b0e0fbeeaaa0-f1f9.jpg'
            },
            watchers: 10,
            count: 9,
            views: '717'
          },
          {
            id: 934,
            title: 'Вселенная Warhammer',
            posters: {
              medium:
                'https://m.staticpop.net/selection/medium/934-b39bdf955b2c-b68b.jpg'
            },
            watchers: 161,
            count: 10,
            views: '7 K'
          }
        ]
      }
    ];

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
          folder: route.kp_folder || '',
          collection: route.kp_collection || '',
          category: route.kp_category || ''
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
          folder: 'Избранное',
          collections: 'Подборки',
          'collection-categories': 'Подборки',
          collection: 'Подборка'
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
        var actions = [
          'new',
          'movies',
          'series',
          'collections',
          'search',
          'folders'
        ].map(function (name) {
          return {
            title: (section === name ? '✓ ' : '') + names[name],
            run: function () {
              if (name === 'search') {
                catalogSearch(route);
              } else {
                pages.show(
                  catalogRoute(route, {
                    section:
                      name === 'collections' ? 'collection-categories' : name,
                    page: 1,
                    query: '',
                    folder: '',
                    collection: '',
                    sort: '',
                    genre: '',
                    genreTitle: '',
                    quality: '',
                    qualityTitle: ''
                  })
                );
              }
            }
          };
        });
        var bookmarks = section === 'folder' || section === 'folders';
        var collections = section === 'collections';
        var collection = section === 'collection';
        var categorized = section === 'collection-categories';
        var category =
          collectionCategories.filter(function (value) {
            return value.id === route.kp_category;
          })[0] || collectionCategories[0];
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
                        collection: '',
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
        var collectionTabs = [];
        var params = { page: page, perpage: 20 };
        var path = '/items';
        if (section === 'search') {
          path += '/search';
          params.q = String(route.kp_query || '').slice(0, 100);
        } else if (collections || categorized) {
          path = '/collections';
          var collectionSorts = {
            'created-': 'Новые',
            'watchers-': 'Популярные',
            'views-': 'Просматриваемые'
          };
          var collectionSort = Object.prototype.hasOwnProperty.call(
            collectionSorts,
            route.kp_sort
          )
            ? route.kp_sort
            : 'created-';
          params.sort = collectionSort;
          actions = [
            {
              title: 'Каталог',
              run: function () {
                pages.show({ view: 'catalog', section: 'new', page: 1 });
              }
            },
            actions[3],
            actions[5],
            actions[6]
          ];
          Object.keys(collectionSorts).forEach(function (value) {
            collectionTabs.push({
              title:
                (collections && collectionSort === value ? '✓ ' : '') +
                collectionSorts[value],
              run: function () {
                pages.show(
                  catalogRoute(route, {
                    section: 'collections',
                    page: 1,
                    sort: value
                  })
                );
              }
            });
          });
          collectionTabs.push({
            title: (categorized ? '✓ ' : '') + 'Категории',
            run: function () {
              pages.show(
                catalogRoute(route, {
                  section: 'collection-categories',
                  page: 1
                })
              );
            }
          });
        } else if (collection) {
          path = '/collections/view';
          params = { id: route.kp_collection };
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
        function loaded(error, json) {
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
          // Older API responses omit pagination; request another page after a full batch.
          if (collections && !json.pagination && items.length === 20) {
            total = page + 1;
          }
          if (bookmarks || collection || categorized) {
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
                  : collection && json.collection
                    ? json.collection.title
                    : categorized
                      ? category.title + ' · ' + category.items.length
                      : names[section]),
            details: [
              !bookmarks &&
                !collections &&
                !categorized &&
                !collection &&
                section !== 'search' &&
                route.kp_genre_title,
              !bookmarks &&
                !collections &&
                !categorized &&
                !collection &&
                section !== 'search' &&
                route.kp_quality_title
            ]
              .filter(Boolean)
              .join(' · '),
            hint: categorized
              ? 'Подборки kino.watch · 37 категорий · 51 без категории'
              : collections
                ? 'Выбери подборку, чтобы открыть фильмы и сериалы.'
                : section === 'folders'
                  ? 'Выбери папку закладок своего аккаунта KinoPub.'
                  : 'Удерживай OK на карточке, чтобы добавить в закладки.',
            empty: collections
              ? 'Список подборок пуст.'
              : collection
                ? 'В этой подборке пока нет материалов.'
                : bookmarks
                  ? 'Пока пусто. Добавляй материалы долгим нажатием на карточку в каталоге.'
                  : 'Ничего не найдено. Измени поиск или фильтры.',
            layout:
              section === 'folders'
                ? 'folders'
                : collections || categorized
                  ? 'collections'
                  : 'catalog',
            actions: actions,
            tabs: collectionTabs,
            sidebar: categorized
              ? collectionCategories.map(function (value) {
                  return {
                    title:
                      (category.id === value.id ? '✓ ' : '') +
                      value.title +
                      ' · ' +
                      value.items.length,
                    run: function () {
                      pages.show(
                        catalogRoute(route, { category: value.id, page: 1 })
                      );
                    }
                  };
                })
              : [],
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
              if (collections || categorized) {
                var posters = item.posters || {};
                return {
                  key: 'collection:' + item.id,
                  title: item.title,
                  stats: [
                    {
                      title: 'Смотрят',
                      text: '✓ ' + (Number(item.watchers) || 0)
                    },
                    {
                      title: 'Фильмов',
                      text: '▤ ' + (Number(item.count) || 0)
                    },
                    {
                      title: 'Просмотров',
                      text:
                        '◉ ' +
                        (categorized ? item.views : Number(item.views) || 0)
                    }
                  ].filter(function (stat) {
                    return stat.title !== 'Фильмов' || item.count !== undefined;
                  }),
                  poster: String(
                    posters.big || posters.medium || posters.small || ''
                  ).replace(/^http:/, 'https:'),
                  next: {
                    view: 'catalog',
                    section: 'collection',
                    collection: item.id,
                    page: 1
                  }
                };
              }
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
        }
        if (categorized) {
          loaded(null, { items: category.items });
        } else {
          client.api(path, params, loaded);
        }
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
            if (key === 'device_name') {
              authorization.updateDevice();
            }
            if (key === 'diagnostics_enabled') {
              playerDiagnostics.clear();
            }
            Lampa.Settings.update();
          },
          onRender: function (item) {
            if (
              (key === 'proxy_url' || key === 'proxy_token') &&
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
      setting(
        'device_name',
        'input',
        'Название устройства в KinoPub',
        'Например, «Телевизор в гостиной». Пустое поле — определить автоматически. Название, платформа и доступные сведения о модели и ОС отправляются в KinoPub.',
        '',
        '',
        true
      );
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
      var authorization = createAuthorization(Lampa, $, client, ui, root);
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
