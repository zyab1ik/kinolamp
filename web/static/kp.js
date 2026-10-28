/* Kinolamp 0.2.0 — MIT. No telemetry or remote script loading. */
(function (root, factory) {
  'use strict';
  var plugin = factory();
  if (typeof module === 'object' && module.exports) module.exports = plugin;
  else if (root.Lampa && !root.kinolampInstalled) {
    root.kinolampInstalled = true;
    plugin.install(root.Lampa, root.jQuery || root.$, root);
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var VERSION = '0.2.0';
  var API = 'https://api.service-kp.com';
  var PREFIX = 'kp_self_';
  // Shared xbmc client distributed by open-source KinoPub clients; not an account token.
  var CLIENT_ID = 'xbmc';
  var CLIENT_SECRET = 'cgg3gtifu46urtfp2zp1nqtba0k2ezxh';

  function escapeText(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function form(values) {
    return Object.keys(values).map(function (key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(values[key]);
    }).join('&');
  }
  function httpsURL(raw) {
    // ES5-compatible validation. No URL constructor required on older televisions.
    if (typeof raw !== 'string' || /[\s\\\u0000-\u001f\u007f]/.test(raw)) return false;
    return /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?(?:[/?][^#]*)?$/i.test(raw);
  }
  function qualityOf(file) {
    return parseInt(String(file.quality || file.h || '').replace(/[^0-9]/g, ''), 10) || 0;
  }
  function streams(files, proxy, maxHeight) {
    var result = [];
    (files || []).forEach(function (file) {
      var urls = file.urls || file.url || {};
      var formats = proxy ? ['hls4'] : ['hls2', 'hls', 'hls4', 'http'];
      for (var i = 0; i < formats.length; i++) {
        var url = urls[formats[i]];
        if (httpsURL(url)) {
          result.push({ url: url, height: qualityOf(file), format: formats[i] });
          break;
        }
      }
    });
    result.sort(function (a, b) { return b.height - a.height; });
    var limited = result.filter(function (s) { return !s.height || s.height <= maxHeight; });
    return limited.length ? limited : result.slice(-1);
  }
  function audioTitle(audio, index) {
    return [audio.lang, audio.type && (audio.type.short_title || audio.type.title), audio.author && audio.author.title, audio.codec]
      .filter(Boolean).join(' · ') || ('Дорожка ' + (index + 1));
  }

  function nameExtension(Lampa, root) {
    var script = root.document && root.document.currentScript;
    if (!script || !script.src || !Lampa.Plugins || !Lampa.Plugins.get || !Lampa.Plugins.save) return;
    var own = script.src.split(/[?#]/)[0];
    var changed = false;
    Lampa.Plugins.get().forEach(function (entry) {
      if (entry.url && entry.url.split(/[?#]/)[0] === own && !entry.name) {
        entry.name = 'Kinolamp';
        entry.author = 'zyab1ik';
        entry.descr = 'KinoPub для Lampa · собственная инфраструктура';
        changed = true;
      }
    });
    if (changed) Lampa.Plugins.save();
  }

  function mediaKey(item, video, context) {
    if (item.id === undefined || item.id === null) return '';
    return 'media:' + JSON.stringify([String(item.id), context.kind, context.season, String(video.id || video.media_id || context.number)]);
  }
  function createProgress(storage) {
    var key = PREFIX + 'progress';
    function records() {
      var data = storage.get(key, {});
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    }
    function write(data) {
      try { storage.set(key, data); } catch (_) { /* A full local store must not stop playback. */ }
    }
    function get(id) {
      var entry = records()[id];
      return entry && typeof entry.time === 'number' && isFinite(entry.time) && entry.time > 0 &&
        typeof entry.duration === 'number' && isFinite(entry.duration) && entry.duration > 0 ? entry : null;
    }
    function save(id, time, duration, ended) {
      if (!id || typeof time !== 'number' || !isFinite(time) || time < 0 || typeof duration !== 'number' || !isFinite(duration) || duration <= 0) return;
      var data = records();
      time = Math.min(time, duration);
      data[id] = { time: time, duration: duration, watched: !!ended || time / duration >= 0.95, updated: Date.now() };
      var ids = Object.keys(data).sort(function (a, b) { return data[b].updated - data[a].updated; });
      ids.filter(function (old) { return old !== id; }).slice(499).forEach(function (old) { delete data[old]; });
      write(data);
    }
    function clear(id) {
      var data = records();
      if (id) delete data[id];
      else data = {};
      write(data);
    }
    function label(id) {
      var entry = get(id);
      return entry ? (entry.watched ? 'Просмотрено' : 'Продолжить с ' + Math.floor(entry.time / 60) + ':' + ('0' + Math.floor(entry.time % 60)).slice(-2)) : '';
    }
    return { get: get, save: save, clear: clear, label: label };
  }

  // Transport is injected to test OAuth without credentials or real network calls.
  function createClient(storage, transport) {
    var refreshing = false;
    var waiting = [];
    var generation = 0;
    function get(key) { return storage.get(PREFIX + key, '') || ''; }
    function set(key, value) { storage.set(PREFIX + key, value); }
    function save(json, expected) {
      if (expected !== generation || !json || typeof json.access_token !== 'string' || !json.access_token) return false;
      set('access', json.access_token);
      if (typeof json.refresh_token === 'string' && json.refresh_token) set('refresh', json.refresh_token);
      return true;
    }
    function logout() { generation++; set('access', ''); set('refresh', ''); }
    function oauth(path, grant, done) {
      grant.client_id = CLIENT_ID;
      grant.client_secret = CLIENT_SECRET;
      transport('POST', API + path, form(grant), { 'Content-Type': 'application/x-www-form-urlencoded' }, done);
    }
    function refresh(done) {
      if (!get('refresh')) { done({ code: 'login_required' }); return; }
      waiting.push(done);
      if (refreshing) return;
      refreshing = true;
      var expected = generation;
      oauth('/oauth2/token', { grant_type: 'refresh_token', refresh_token: get('refresh') }, function (error, json) {
        if (!error && !save(json, expected)) error = { code: 'session_changed' };
        if (error && expected === generation && (error.status === 400 || error.status === 401)) logout();
        refreshing = false;
        var callbacks = waiting;
        waiting = [];
        callbacks.forEach(function (cb) { cb(error); });
      });
    }
    function api(path, params, done, retried) {
      if (!get('access')) { done({ code: 'login_required' }); return; }
      var expected = generation;
      var query = form(params || {});
      transport('GET', API + '/v1' + path + (query ? '?' + query : ''), null,
        { Authorization: 'Bearer ' + get('access') }, function (error, json) {
          if (generation !== expected) { done({ code: 'session_changed' }); return; }
          if (error && error.status === 401 && !retried) {
            refresh(function (refreshError) {
              if (refreshError) done(refreshError);
              else api(path, params, done, true);
            });
          } else done(error, json);
        });
    }
    return {
      get: get, set: set, api: api, oauth: oauth, logout: logout,
      hasToken: function () { return !!get('access'); },
      generation: function () { return generation; },
      saveTokens: save
    };
  }

  function install(Lampa, $, root) {
    if (!$ || !Lampa.SettingsApi || !Lampa.Select || !Lampa.Reguest) return;
    nameExtension(Lampa, root);
    var auth = null;
    function notify(message) { Lampa.Noty.show(message); }
    function transport(method, url, body, headers, done) {
      var net = new Lampa.Reguest();
      net.timeout(15000);
      net.silent(url, function (json) {
        if (typeof json === 'string') {
          try { json = JSON.parse(json); } catch (_) { done({ code: 'bad_response' }); return; }
        }
        if (!json || typeof json !== 'object') { done({ code: 'bad_response' }); return; }
        if (json.error) { done({ code: String(json.error) }); return; }
        done(null, json);
      }, function (xhr) {
        var code = 'network_error';
        try { code = JSON.parse(xhr.responseText).error || code; } catch (_) {}
        done({ status: xhr && xhr.status, code: code });
      }, method === 'POST' ? body : false, { headers: headers });
    }
    var client = createClient(Lampa.Storage, transport);
    var progress = createProgress(Lampa.Storage);
    var session = null;
    var canTrack = !!(Lampa.Player.listener && Lampa.PlayerVideo && Lampa.PlayerVideo.listener && Lampa.PlayerVideo.to);
    function saveSession(ended) {
      if (session && session.ready) { session.ended = session.ended || ended; progress.save(session.key, session.time, session.duration, session.ended); }
    }
    if (canTrack) {
      Lampa.Player.listener.follow('create', function () { saveSession(false); session = null; });
      Lampa.Player.listener.follow('start', function (work) {
        saveSession(false);
        session = work && work._kinolampProgress ? { work: work, key: work._kinolampProgress.key, seek: work._kinolampProgress.time, time: 0, duration: 0, ready: false, savedAt: 0 } : null;
      });
      Lampa.PlayerVideo.listener.follow('timeupdate', function (event) {
        if (!session || !event || typeof event.current !== 'number' || !isFinite(event.current) || event.current < 0 || typeof event.duration !== 'number' || !isFinite(event.duration) || event.duration <= 0) return;
        if (session.seek > 0) {
          var seek = Math.min(session.seek, Math.max(0, event.duration - 1));
          session.waitForSeek = seek;
          session.seek = 0;
          Lampa.PlayerVideo.to(seek);
          return;
        }
        if (session.waitForSeek && event.current < session.waitForSeek - 2) return;
        session.waitForSeek = 0;
        session.time = event.current;
        session.duration = event.duration;
        session.ready = true;
        if (Date.now() - session.savedAt >= 5000) { saveSession(false); session.savedAt = Date.now(); }
      });
      Lampa.PlayerVideo.listener.follow('pause', function () { saveSession(false); });
      Lampa.PlayerVideo.listener.follow('ended', function () { saveSession(true); });
      Lampa.Player.listener.follow('destroy', function () { saveSession(false); session = null; });
    }

    function restore(name) {
      if (name) Lampa.Controller.toggle(name);
    }
    function menu(title, entries, back) {
      var previous = (Lampa.Controller.enabled() || {}).name;
      Lampa.Select.show({
        title: escapeText(title),
        items: entries.map(function (entry) {
          return { title: escapeText(entry.title), subtitle: escapeText(entry.subtitle || ''), run: entry.run };
        }),
        onSelect: function (item) { Lampa.Select.close(); item.run(); },
        onBack: function () { Lampa.Select.close(); if (back) back(); else restore(previous); }
      });
    }
    function errorMessage(error) {
      if (error && error.code === 'invalid_client') return 'KinoPub временно не принимает общий клиент. Повтори вход позже или проверь обновления Kinolamp.';
      if (error && (error.code === 'login_required' || error.status === 401)) return 'Нужна авторизация: Настройки → Kinolamp → Войти.';
      return 'Запрос не выполнен. Проверь сеть, подписку и настройки. Подробные данные не отправляются в логи.';
    }
    function stopLogin() {
      if (!auth) return;
      clearTimeout(auth.timer);
      auth.cancelled = true;
      auth = null;
    }
    function login(done) {
      if (auth) return;
      var state = { cancelled: false, timer: null, generation: client.generation() };
      auth = state;
      client.oauth('/oauth2/device', { grant_type: 'device_code' }, function (error, json) {
        if (state.cancelled) return;
        if (error || !json.code || !json.user_code) {
          stopLogin(); notify(errorMessage(error)); return;
        }
        var interval = Math.max(Number(json.interval) || 5, 5) * 1000;
        var expires = Date.now() + Math.min(Number(json.expires_in) || 600, 3600) * 1000;
        var previous = (Lampa.Controller.enabled() || {}).name;
        var content = $('<div></div>');
        var verification = /^https:\/\/(?:kino\.pub|kino\.watch)\/device\/?$/.test(json.verification_uri) ? json.verification_uri : 'https://kino.pub/device';
        content.append($('<p></p>').text('1. Открой на телефоне или в другой вкладке: ' + verification));
        content.append($('<h1></h1>').text(String(json.user_code)));
        content.append($('<p></p>').text('2. Войди в аккаунт KinoPub, введи этот код в поле «Код устройства» и нажми «Добавить».'));
        content.append($('<p></p>').text('3. Оставь это окно открытым — вход завершится автоматически.'));
        content.append($('<a target="_blank" rel="noopener noreferrer"></a>').attr('href', verification).text('Открыть страницу активации'));
        content.append($('<p></p>').text('Назад — отменить. Пароль остаётся на сайте KinoPub.'));
        function close() { stopLogin(); Lampa.Modal.close(); restore(previous); }
        Lampa.Modal.open({ title: 'Kinolamp', html: content, size: 'small', onBack: close });
        function poll() {
          if (state.cancelled) return;
          if (Date.now() >= expires) { close(); notify('Код истёк. Запусти вход ещё раз.'); return; }
          client.oauth('/oauth2/device', { grant_type: 'device_token', code: json.code }, function (error, token) {
            if (state.cancelled) return;
            if (!error && client.saveTokens(token, state.generation)) {
              close(); notify('KinoPub: вход выполнен.'); if (done) done(); return;
            }
            if (error && (error.code === 'authorization_pending' || error.code === 'slow_down')) {
              if (error.code === 'slow_down') interval += 5000;
              state.timer = setTimeout(poll, interval); return;
            }
            close(); notify(errorMessage(error));
          });
        }
        state.timer = setTimeout(poll, interval);
      });
    }
    function authorized(run) {
      if (client.hasToken()) run(); else login(run);
    }

    function search(movie) {
      var query = movie.title || movie.name || movie.original_title || movie.original_name || '';
      if (!query) { notify('Открой карточку фильма или сериала.'); return; }
      authorized(function () {
        client.api('/items/search', { q: query }, function (error, json) {
          if (error) { notify(errorMessage(error)); return; }
          var items = json.items || [];
          if (!items.length) { notify('В KinoPub ничего не найдено.'); return; }
          menu('Результаты KinoPub', items.map(function (item) {
            return { title: item.title, subtitle: [item.year, item.type].filter(Boolean).join(' · '), run: function () { openItem(item.id); } };
          }));
        });
      });
    }
    function openItem(id) {
      client.api('/items/' + encodeURIComponent(id), { nolinks: 0 }, function (error, json) {
        if (error) { notify(errorMessage(error)); return; }
        var item = json.item;
        if (!item) { notify('Нет данных о видео.'); return; }
        function seasons() {
          menu(item.title, item.seasons.map(function (season, index) {
            return { title: 'Сезон ' + (season.number || index + 1), run: function () { episodes(season); } };
          }));
        }
        function episodes(season) {
          menu('Серии', (season.episodes || []).map(function (episode, index) {
            var context = { kind: 'episode', season: season.number === undefined ? item.seasons.indexOf(season) + 1 : season.number, number: episode.number || index + 1 };
            return { title: (episode.number || index + 1) + '. ' + (episode.title || 'Серия'), subtitle: progress.label(mediaKey(item, episode, context)), run: function () {
              openVideo(item, episode, function () { episodes(season); }, context);
            } };
          }), seasons);
        }
        if (item.seasons && item.seasons.length) seasons();
        else {
          var videos = item.videos || [];
          if (videos.length === 1) openVideo(item, videos[0], function () { openItem(id); }, { kind: 'part', season: 0, number: 1 });
          else if (videos.length) menu(item.title, videos.map(function (video, index) {
            var context = { kind: 'part', season: 0, number: index + 1 };
            return { title: video.title || ('Видео ' + (index + 1)), subtitle: progress.label(mediaKey(item, video, context)), run: function () { openVideo(item, video, function () { openItem(id); }, context); } };
          }));
          else notify('У этого материала нет доступного видео.');
        }
      });
    }
    function openVideo(item, video, back, context) {
      var playback = { key: mediaKey(item, video, context), time: 0 };
      function choose(data) {
        var proxy = client.get('proxy_enabled') === true || client.get('proxy_enabled') === 'true';
        var maxHeight = Number(client.get('quality')) || 1080;
        var options = streams(data.files, proxy, maxHeight);
        if (!options.length) { notify(proxy ? 'Нет HTTPS HLS4-ссылок. Отключи HLS-прокси или проверь данные KinoPub.' : 'Нет HTTPS-ссылок на видео.'); return; }
        menu('Качество', options.map(function (stream) {
          return { title: (stream.height ? stream.height + 'p' : 'Авто') + ' · ' + stream.format.toUpperCase(), run: function () {
            if (!proxy) { play(item, video, data, stream.url, playback); return; }
            var audios = video.audios || data.audios || [];
            var tracks = audios.map(function (audio, index) {
              return { title: audioTitle(audio, index), run: function () {
                prepareProxy(item, video, data, stream, Number(audio.index) || index + 1, Math.min(stream.height || maxHeight, maxHeight), playback);
              } };
            });
            if (tracks.length) menu('Озвучка', tracks, function () { choose(data); });
            else prepareProxy(item, video, data, stream, 0, Math.min(stream.height || maxHeight, maxHeight), playback);
          } };
        }), back);
      }
      function load() {
        if (video.files && video.files.length) { choose(video); return; }
        var mediaId = video.id || video.media_id;
        if (!mediaId) { notify('KinoPub не вернул media ID или ссылки.'); return; }
        client.api('/items/media-links', { mid: mediaId }, function (error, json) {
          if (error) notify(errorMessage(error)); else choose(json);
        });
      }
      var previous = progress.get(playback.key);
      if (!previous) { load(); return; }
      var entries = [];
      if (!previous.watched) entries.push({ title: progress.label(playback.key), run: function () {
        if (canTrack) playback.time = previous.time;
        else notify('Этот плеер не поддерживает продолжение Kinolamp. Видео начнётся сначала.');
        load();
      } });
      entries.push({ title: 'Начать сначала', run: function () { progress.clear(playback.key); load(); } });
      entries.push({ title: 'Сбросить прогресс', run: function () { progress.clear(playback.key); notify('Прогресс этого видео сброшен.'); back(); } });
      menu(previous.watched ? 'Уже просмотрено' : 'Продолжить просмотр', entries, back);
    }
    function prepareProxy(item, video, data, stream, voice, height, playback) {
      var base = String(client.get('proxy_url')).replace(/\/+$/, '');
      var token = client.get('proxy_token');
      if (!httpsURL(base) || !/^https:\/\/[^/]+$/.test(base) || !token || token.length < 32) {
        notify('Для HLS-прокси укажи HTTPS-адрес своего VPS и ключ минимум 32 символа.'); return;
      }
      transport('POST', base + '/api/manifests', JSON.stringify({ master: stream.url, voice: voice, maxHeight: height }),
        { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, function (error, json) {
          // A proxy response may only return a ticket at the configured origin.
          var prefix = base + '/hls/';
          if (error || !json || typeof json.url !== 'string' || json.url.indexOf(prefix) !== 0 || !/^[a-f0-9]{64}\.m3u8$/.test(json.url.slice(prefix.length))) {
            notify('HLS-прокси недоступен. Проверь ключ, ALLOWED_ORIGINS и CDN_HOSTS на VPS.'); return;
          }
          play(item, video, data, json.url, playback);
        });
    }
    function play(item, video, data, url, playback) {
      var subtitles = (data.subtitles || video.subtitles || []).filter(function (s) { return httpsURL(s.url); }).map(function (s) {
        return { label: String(s.lang || 'Subtitles'), language: String(s.lang || ''), url: s.url };
      });
      var work = { title: String(item.title || '') + (video.title ? ' · ' + video.title : ''), url: url };
      if (canTrack && playback.key) {
        work._kinolampProgress = playback;
        work.timeline = { time: playback.time, duration: 0, percent: 0, handler: function (_percent, time, duration) {
          if (session && session.work === work && session.seek === 0 && session.ready) progress.save(playback.key, time, duration, session.ended);
        } };
      }
      if (subtitles.length) work.subtitles = subtitles;
      try { Lampa.Player.play(work); Lampa.Player.playlist([work]); }
      catch (_) { notify('Не удалось запустить плеер Lampa.'); }
    }

    var icon = '<svg viewBox="0 0 64 64" width="48" height="48"><rect width="64" height="64" rx="16" fill="#14232b"/><path d="M22 43v-5a18 18 0 1 1 20 0v5" fill="#7ce8c3"/><path d="m28 15 15 10-15 10Z" fill="#14232b"/><path d="M23 47h18m-15 7h12" fill="none" stroke="#7ce8c3" stroke-width="4" stroke-linecap="round"/></svg>';
    Lampa.SettingsApi.addComponent({ component: 'kp_self', name: 'Kinolamp', icon: icon });
    function setting(key, type, name, description, values, initial) {
      Lampa.SettingsApi.addParam({
        component: 'kp_self',
        param: { name: PREFIX + key, type: type, placeholder: 'Не задано', values: values || '', 'default': initial === undefined ? '' : initial },
        field: { name: name, description: description }
      });
    }
    function action(key, name, run) {
      Lampa.SettingsApi.addParam({ component: 'kp_self', param: { name: PREFIX + key, type: 'button' }, field: { name: name }, onChange: run });
    }
    setting('quality', 'select', 'Максимальное качество', 'Для HLS-прокси также ограничивает вариант внутри master.', { '480': '480p', '720': '720p', '1080': '1080p', '2160': '2160p' }, '1080');
    setting('proxy_enabled', 'trigger', 'Использовать свой HLS-прокси', 'Выключено по умолчанию. Для Samsung Tizen с проблемными HLS4.', '', false);
    setting('proxy_url', 'input', 'HTTPS-адрес своего HLS-прокси', 'Например https://lampa.example.com. Без завершающего пути.');
    setting('proxy_token', 'input', 'Ключ своего HLS-прокси', 'PROXY_TOKEN из .env на VPS. Минимум 32 символа.');
    action('login', 'Войти в KinoPub', function () { login(); });
    action('logout', 'Выйти из KinoPub', function () {
      if (auth) { stopLogin(); Lampa.Modal.close(); }
      client.logout(); notify('Локальная сессия удалена. Отзыв устройства доступен на kino.pub.');
    });
    action('privacy', 'О плагине и приватности', function () {
      notify('Kinolamp ' + VERSION + ': без телеметрии и облачной синхронизации. Токены на устройстве. HLS-прокси получает только ссылку на поток.');
    });
    action('reset_progress', 'Сбросить весь прогресс Kinolamp', function () {
      menu('Сбросить локальный прогресс?', [{ title: 'Удалить прогресс Kinolamp', run: function () {
        session = null; progress.clear(); notify('Прогресс Kinolamp сброшен.');
      } }]);
    });
    Lampa.Listener.follow('full', function (event) {
      if (!event || event.type !== 'complite' || !event.data || !event.data.movie) return;
      var holder = event.object && event.object.activity && event.object.activity.render();
      if (!holder || holder.find('.kp-self-button').length) return;
      var button = $('<div class="full-start__button selector kp-self-button"></div>');
      button.append($(icon)).append($('<span></span>').text('Kinolamp'));
      button.on('hover:enter', function () { search(event.data.movie); });
      var target = holder.find('.full-start-new__buttons, .full-start__buttons').first();
      if (target.length) target.append(button);
      else holder.find('.full-start__button').first().after(button);
    });
    if (Lampa.Manifest) Lampa.Manifest.plugins = { type: 'video', name: 'Kinolamp', version: VERSION, description: 'Личный источник KinoPub без телеметрии' };
    // A direct stream keeps native Lampa audio controls; proxy mode selects before playback.
  }
  return { install: install, createClient: createClient, escapeText: escapeText, httpsURL: httpsURL, streams: streams, audioTitle: audioTitle, nameExtension: nameExtension, mediaKey: mediaKey, createProgress: createProgress };
});
