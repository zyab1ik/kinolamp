/* Kinolamp 0.3.6 — MIT. No telemetry or remote script loading. */
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
  var VERSION = '0.3.6';
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
  function voiceIdentity(audio) {
    return JSON.stringify([audio.lang || '', audio.type && (audio.type.id || audio.type.title) || '', audio.author && (audio.author.id || audio.author.title) || '', audio.codec || '']).toLowerCase();
  }
  function episodeQueue(item) {
    var result = [];
    (item.seasons || []).forEach(function (season, si) {
      (season.episodes || []).forEach(function (video, ei) {
        result.push({ video: video, context: { kind: 'episode', season: season.number === undefined ? si + 1 : season.number, number: video.number || ei + 1 } });
      });
    });
    return result.sort(function (a, b) { return a.context.season - b.context.season || a.context.number - b.context.number; });
  }

  // Diagnostics is an allowlist, not a scrubber: arbitrary URLs, messages, titles
  // and request/response objects can never enter the report, even as nested fields.
  function createDiagnostics(storage, now) {
    var entries = [];
    var generation = 0;
    var started = now();
    var events = ['api', 'proxy', 'source', 'prepare', 'start', 'playing', 'waiting', 'stalled', 'sample', 'pause', 'ended', 'error', 'stop', 'probe_api', 'probe_proxy', 'probe_cdn'];
    var details = ['fragLoadError', 'fragLoadTimeOut', 'manifestLoadError', 'manifestLoadTimeOut', 'manifestParsingError', 'levelLoadError', 'levelLoadTimeOut', 'bufferStalledError', 'bufferFullError', 'bufferAppendError', 'other'];
    function enabled() { var value = storage.get(PREFIX + 'diagnostics_enabled', false); return value === true || value === 'true'; }
    function record(event, data) {
      if (!enabled() || events.indexOf(event) === -1) return;
      data = data || {};
      var entry = { event: event, at: Math.max(0, now() - started) };
      ['ms', 'status', 'current', 'buffer', 'readyState', 'width', 'height'].forEach(function (key) {
        var value = data[key];
        if (typeof value === 'number' && isFinite(value) && value >= 0 && value <= 86400000) entry[key] = Math.round(value * 100) / 100;
      });
      if (['direct', 'proxy'].indexOf(data.mode) !== -1) entry.mode = data.mode;
      if (['hls2', 'hls4', 'hls', 'http'].indexOf(data.format) !== -1) entry.format = data.format;
      if (['mse', 'direct_src'].indexOf(data.path) !== -1) entry.path = data.path;
      if (typeof data.nativeHls === 'boolean') entry.nativeHls = data.nativeHls;
      if (['ok', 'error', 'timeout', 'network_or_cors', 'not_configured', 'unsupported', 'cancelled'].indexOf(data.result) !== -1) entry.result = data.result;
      if (details.indexOf(data.detail) !== -1) entry.detail = data.detail;
      if (typeof data.fatal === 'boolean') entry.fatal = data.fatal;
      entries.push(entry);
      if (entries.length > 120) entries.shift();
      return true;
    }
    function begin(event) {
      var time = now();
      var current = generation;
      var collecting = enabled();
      return function (data) {
        if (!collecting || current !== generation) return;
        return record(event, { ms: Math.max(0, now() - time), status: data.status, result: data.result });
      };
    }
    return {
      enabled: enabled, record: record, begin: begin,
      clear: function () { entries = []; generation++; started = now(); },
      report: function () { return JSON.parse(JSON.stringify({ schema: 1, version: VERSION, enabled: enabled(), scope: 'local-session-last-120-events', events: entries })); }
    };
  }

  function matchItem(movie, items) {
    function title(value) { return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim(); }
    var names = [movie.title, movie.name, movie.original_title, movie.original_name].map(title).filter(Boolean);
    var year = String(movie.release_date || movie.first_air_date || movie.year || '').slice(0, 4);
    var series = !!movie.first_air_date || movie.media_type === 'tv';
    var exact = (items || []).filter(function (item) {
      if (movie.imdb_id && item.imdb === movie.imdb_id) return true;
      if (!year || String(item.year) !== year) return false;
      if (series ? item.type !== 'serial' : item.type !== 'movie') return false;
      return String(item.title || '').split('/').some(function (part) { return names.indexOf(title(part)) !== -1; });
    });
    return exact.length === 1 ? exact[0] : null;
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

  var PAGE_STYLES = '.kp-page{height:100%;display:flex;flex-direction:column;padding:1.5em 2em;box-sizing:border-box}.kp-page__head{display:flex;align-items:center;gap:1em;margin-bottom:.7em}.kp-page__title{font-size:1.8em;font-weight:600;line-height:1.2}.kp-page__status{opacity:.65;margin-bottom:1em}.kp-page>.scroll{flex:1;min-height:0}.kp-page__grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1.5em;padding:.4em}.kp-page__card{min-width:0}.kp-page__poster{height:0;padding-bottom:150%;position:relative;border-radius:.6em;background:rgba(255,255,255,.07);overflow:hidden;outline:.18em solid transparent;outline-offset:.25em}.kp-page__poster img{position:absolute;width:100%;height:100%;object-fit:cover}.kp-page__placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:.4;font-size:2em}.kp-page__card.focus .kp-page__poster{outline-color:currentColor}.kp-page__name{margin-top:.85em;font-size:.95em;line-height:1.35}.kp-page__meta{opacity:.55;font-size:.75em;margin-top:.3em}@media(max-width:800px){.kp-page{padding:1em}.kp-page__grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:480px){.kp-page__grid{grid-template-columns:repeat(2,minmax(0,1fr))}}.kp-page__details{font-size:1em;opacity:.8;line-height:1.5}.kp-page__description{max-width:65em;font-size:1.05em;line-height:1.55;white-space:pre-line;margin:.6em 0 1.5em}.kp-page__description:empty,.kp-page__details:empty{display:none}.kp-page__grid[data-layout=seasons]{grid-template-columns:repeat(4,minmax(0,1fr))}.kp-page__grid[data-layout=seasons] .kp-page__poster{padding-bottom:56.25%}.kp-page__grid[data-layout=episodes]{grid-template-columns:repeat(3,minmax(0,1fr))}.kp-page__grid[data-layout=episodes] .kp-page__poster{padding-bottom:56.25%}.kp-page__grid[data-layout=episodes] .kp-page__name,.kp-page__grid[data-layout=seasons] .kp-page__name{font-size:1.15em;font-weight:600}.kp-page__meta{font-size:.95em;opacity:.75;line-height:1.4}@media(max-width:800px){.kp-page__grid[data-layout=episodes],.kp-page__grid[data-layout=seasons]{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:480px){.kp-page__grid[data-layout=episodes]{grid-template-columns:1fr}}.kp-page__toolbar{display:flex;flex-wrap:wrap;gap:.6em;margin:.2em 0 1.2em}.kp-page__action{font-size:1em;padding:.6em 1em;border-radius:.35em;background:rgba(255,255,255,.09);line-height:1.2}.kp-page__action.focus{background:#fff;color:#1d1f20}.kp-page__grid[data-layout=folders]{grid-template-columns:repeat(4,minmax(0,1fr))}.kp-page__grid[data-layout=folders] .kp-page__poster{padding-bottom:56.25%}.kp-page__grid[data-layout=folders] .kp-page__placeholder{font-size:3em;color:#9cebc9}';

  function createNativePages(Lampa, $, navigation, load, activate) {
    if (!Lampa.Component || !Lampa.Activity || !Lampa.Scroll || !navigation) return null;
    var active = null;
    $('body').append($('<style></style>').text(PAGE_STYLES));
    Lampa.Component.add('kinolamp', function (object) {
      var self = this;
      var alive = true;
      var suspended = false;
      var request = 0;
      var last = false;
      var labels = [];
      var isStale = null;
      var view = $('<div class="kp-page"></div>');
      var head = $('<div class="kp-page__head"></div>');
      var title = $('<div class="kp-page__title"></div>').text('KinoPub');
      var status = $('<div class="kp-page__status" role="status"></div>').text('Загрузка…');
      var grid = $('<div class="kp-page__grid"></div>');
      var toolbar = $('<div class="kp-page__toolbar"></div>');
      var details = $('<div class="kp-page__details"></div>');
      var description = $('<div class="kp-page__description"></div>');
      var scroll = new Lampa.Scroll({ mask: true, over: true });
      head.append(title);
      scroll.append(toolbar);
      scroll.append(details);
      scroll.append(description);
      scroll.append(grid);
      view.append(head).append(status).append(scroll.render());
      this.create = function () {
        var expected = ++request;
        status.text('Загрузка…');
        self.activity.loader(true);
        load(object, function (error, data) {
          if (!alive || expected !== request) return;
          self.activity.loader(false);
          grid.empty();
          toolbar.empty(); last = false;
          labels = [];
          isStale = null;
          function buttons(actions) {
            actions.forEach(function (action) {
              var button = $('<div class="simple-button selector kp-page__action"></div>').text(action.title);
              button.on('hover:focus', function () { last = button[0]; scroll.update(button, true); });
              button.on('hover:enter', function () { if (alive && !suspended) action.run(); });
              toolbar.append(button);
              if (!last) last = button[0];
            });
          }
          if (error) { title.text('KinoPub'); details.text(''); description.text(''); status.text(error); buttons([{ title: 'Повторить', run: self.create }]); }
          else {
            isStale = data.isStale || null;
            title.text(data.title);
            details.text(data.details || '');
            description.text(data.description || '');
            grid.attr('data-layout', data.layout || 'posters');
            buttons(data.actions || []);
            status.text(data.rows.length ? (data.hint || 'Выбери подходящий результат.') : data.empty || 'Ничего не найдено. Вернись назад и выбери другой материал.');
            data.rows.forEach(function (row) {
              var card = $('<div class="kp-page__card selector"></div>');
              var poster = $('<div class="kp-page__poster"></div>');
              poster.append($('<span class="kp-page__placeholder"></span>').text(row.symbol || '▶'));
              if (httpsURL(row.poster)) {
                poster.append($('<img loading="lazy" alt="">').attr('src', row.poster).on('error', function () { $(this).remove(); }));
              }
              card.append(poster).append($('<div class="kp-page__name"></div>').text(row.title));
              var meta = $('<div class="kp-page__meta"></div>');
              card.append(meta);
              labels.push({ node: meta, row: row });
              if (!last) last = card[0];
              card.on('hover:focus', function () { last = card[0]; scroll.update(card, true); });
              card.on('hover:enter', function () { if (alive && !suspended) activate(row); });
              if (row.menu) card.on('hover:long', function () { if (alive && !suspended) row.menu(); });
              grid.append(card);
            });
          }
          if (!suspended) self.activity.toggle();
        });
      };
      this.start = function () {
        if (!alive) return;
        suspended = false;
        active = self;
        if (isStale && isStale()) { self.create(); return; }
        labels.forEach(function (label) { label.node.text(typeof label.row.subtitle === 'function' ? label.row.subtitle() : label.row.subtitle); });
        Lampa.Controller.add('content', {
          toggle: function () { Lampa.Controller.collectionSet(view); Lampa.Controller.collectionFocus(last, view); },
          up: function () { if (navigation.canmove('up')) navigation.move('up'); else Lampa.Controller.toggle('head'); },
          down: function () { navigation.move('down'); },
          right: function () { navigation.move('right'); },
          left: function () { if (navigation.canmove('left')) navigation.move('left'); else Lampa.Controller.toggle('menu'); },
          back: function () { Lampa.Activity.backward(); }
        });
        Lampa.Controller.toggle('content');
      };
      this.render = function () { return view; };
      this.pause = function () { suspended = true; if (active === self) active = null; };
      this.stop = function () {};
      this.destroy = function () { alive = false; if (active === self) active = null; scroll.destroy(); view.remove(); };
    });
    return {
      show: function (route) {
        // Activity history must contain only route data, never DOM nodes, callbacks or API tokens.
        Lampa.Activity.push({ component: 'kinolamp', title: 'KinoPub', kp_view: route.view, kp_query: route.query, kp_id: route.id, kp_season: route.season, kp_section: route.section, kp_page: route.page, kp_genre: route.genre, kp_genre_title: route.genreTitle, kp_quality: route.quality, kp_quality_title: route.qualityTitle, kp_folder: route.folder });
      },
      current: function () { return active; },
      refresh: function () { if (active) active.create(); },
      resume: function () { if (active) active.start(); }
    };
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
    function api(path, params, done, retried, post) {
      if (!get('access')) { done({ code: 'login_required' }); return; }
      var expected = generation;
      var query = form(params || {});
      var headers = { Authorization: 'Bearer ' + get('access') };
      if (post) headers['Content-Type'] = 'application/x-www-form-urlencoded';
      transport(post ? 'POST' : 'GET', API + '/v1' + path + (!post && query ? '?' + query : ''), post ? query : null,
        headers, function (error, json) {
          if (generation !== expected) { done({ code: 'session_changed' }); return; }
          if (error && error.status === 401 && !retried) {
            refresh(function (refreshError) {
              if (refreshError) done(refreshError);
              else api(path, params, done, true, post);
            });
          } else done(error, json);
        });
    }
    return {
      get: get, set: set, api: api, oauth: oauth, logout: logout,
      hasToken: function () { return !!get('access'); },
      generation: function () { return generation; },
      saveTokens: save,
      notifyDevice: function (info, done) { api('/device/notify', info, done, false, true); }
    };
  }

  function install(Lampa, $, root) {
    if (!$ || !Lampa.SettingsApi || !Lampa.Select || !Lampa.Reguest) return;
    nameExtension(Lampa, root);
    var auth = null;
    var diagnostics = createDiagnostics(Lampa.Storage, Date.now);
    var diagnosticWork = null;
    var diagnosticVideo = null;
    var diagnosticHandlers = [];
    var diagnosticFirst = true;
    var diagnosticSample = -Infinity;
    var lastCDN = '';
    var pendingProbe = null;
    function detachDiagnosticVideo() {
      diagnosticHandlers.forEach(function (binding) { diagnosticVideo.removeEventListener(binding.event, binding.run); });
      diagnosticHandlers = [];
      diagnosticVideo = null;
    }
    function captureDiagnostic(event) {
      if (!diagnostics.enabled() || !diagnosticWork) return;
      var data = { mode: diagnosticWork.mode, format: diagnosticWork.format };
      try {
        if (diagnosticVideo) {
          data.current = diagnosticVideo.currentTime;
          data.readyState = diagnosticVideo.readyState;
          data.width = diagnosticVideo.videoWidth;
          data.height = diagnosticVideo.videoHeight;
          if (typeof diagnosticVideo.currentSrc === 'string' && diagnosticVideo.currentSrc) data.path = diagnosticVideo.currentSrc.indexOf('blob:') === 0 ? 'mse' : 'direct_src';
          if (typeof diagnosticVideo.canPlayType === 'function') data.nativeHls = !!diagnosticVideo.canPlayType('application/vnd.apple.mpegurl');
          var ranges = diagnosticVideo.buffered;
          if (ranges) {
            data.buffer = 0;
            for (var i = 0; i < ranges.length; i++) {
              if (ranges.start(i) <= data.current && ranges.end(i) >= data.current) data.buffer = ranges.end(i) - data.current;
            }
          }
        }
      } catch (_) { data.result = 'unsupported'; }
      if (event === 'playing' && diagnosticFirst) { data.ms = Date.now() - diagnosticWork.requested; diagnosticFirst = false; }
      diagnostics.record(event, data);
    }
    function bindDiagnosticVideo() {
      if (!diagnostics.enabled() || !diagnosticWork || !Lampa.PlayerVideo || typeof Lampa.PlayerVideo.video !== 'function') return;
      var video = Lampa.PlayerVideo.video();
      if (video === diagnosticVideo) return;
      detachDiagnosticVideo();
      if (!video || !video.addEventListener || !video.removeEventListener) return;
      diagnosticVideo = video;
      ['playing', 'waiting', 'stalled'].forEach(function (event) {
        var run = function () { captureDiagnostic(event); };
        video.addEventListener(event, run);
        diagnosticHandlers.push({ event: event, run: run });
      });
    }
    if (Lampa.Player.listener) {
      Lampa.Player.listener.follow('start', function (work) {
        detachDiagnosticVideo();
        diagnosticWork = work && work._kinolampDiagnostic;
        diagnosticFirst = true; diagnosticSample = -Infinity;
        captureDiagnostic('start'); bindDiagnosticVideo();
      });
      Lampa.Player.listener.follow('ready', bindDiagnosticVideo);
      Lampa.Player.listener.follow('destroy', function () { captureDiagnostic('stop'); detachDiagnosticVideo(); diagnosticWork = null; });
    }
    if (Lampa.PlayerVideo && Lampa.PlayerVideo.listener) {
      Lampa.PlayerVideo.listener.follow('timeupdate', function () {
        if (!diagnostics.enabled() || !diagnosticWork || Date.now() - diagnosticSample < 5000) return;
        diagnosticSample = Date.now(); bindDiagnosticVideo(); captureDiagnostic('sample');
      });
      ['pause', 'ended'].forEach(function (event) { Lampa.PlayerVideo.listener.follow(event, function () { captureDiagnostic(event); }); });
      Lampa.PlayerVideo.listener.follow('error', function (event) {
        if (!diagnosticWork || !diagnostics.enabled()) return;
        event = event || {};
        var match = typeof event.error === 'string' && event.error.match(/details \[([a-zA-Z]+)\]/);
        diagnostics.record('error', { detail: match ? match[1] : 'other', fatal: event.fatal });
      });
    }
    function clearDiagnostics() {
      diagnostics.clear(); lastCDN = ''; detachDiagnosticVideo();
      if (pendingProbe) { pendingProbe.abort(); pendingProbe = null; }
    }
    function notify(message) { Lampa.Noty.show(message); }
    function transport(method, url, body, headers, done) {
      var complete = done;
      var finish = diagnostics.begin(url.indexOf(API + '/v1/') === 0 ? 'api' : url.indexOf('/api/manifests') !== -1 ? 'proxy' : '');
      done = function (error, json) {
        finish({ status: error ? Number(error.status) || 0 : 200, result: error ? 'error' : 'ok' });
        complete(error, json);
      };
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
    function updateDevice() {
      if (!client.hasToken()) return;
      var platform = Lampa.Platform && typeof Lampa.Platform.get === 'function' ? Lampa.Platform.get() : '';
      client.notifyDevice({ title: 'Kinolamp / Lampa', hardware: String(platform || 'Lampa'), software: 'Kinolamp ' + VERSION }, function () {});
    }
    updateDevice();
    var progress = createProgress(Lampa.Storage);
    var pages = null;
    var session = null;
    var navigation = 0;
    var queueOwner = null;
    if (Lampa.Player.listener) {
      Lampa.Player.listener.follow('create', function () { navigation++; });
      Lampa.Player.listener.follow('destroy', function () { navigation++; });
      Lampa.Player.listener.follow('start', function (work) {
        if (queueOwner && work && work._kinolampQueueId === queueOwner.id) {
          queueOwner.entries.forEach(function (entry) { if (entry !== work) entry.url = entry._kinolampLoad; });
        }
      });
    }
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
        // Native Select hides before onSelect, and close() itself invokes onBack.
        onSelect: function (item) { item.run(); },
        onBack: function () { if (back) back(); else restore(previous); }
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
              updateDevice();
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
        if (movie.release_date || movie.first_air_date || movie.year || movie.imdb_id) {
          client.api('/items/search', { q: query }, function (error, json) {
            if (error) { notify(errorMessage(error)); return; }
            var match = matchItem(movie, json.items);
            if (match) openMatchedItem(match.id);
            else showResults();
          });
          return;
        }
        showResults();
      });
      function showResults() {
        if (pages) { pages.show({ view: 'search', query: query }); return; }
        client.api('/items/search', { q: query }, function (error, json) {
          if (error) { notify(errorMessage(error)); return; }
          var items = json.items || [];
          if (!items.length) { notify('В KinoPub ничего не найдено.'); return; }
          function results() {
            menu('Результаты KinoPub', items.map(function (item) {
              return { title: item.title, subtitle: [item.year, item.type].filter(Boolean).join(' · '), run: function () { openItem(item.id, results); } };
            }));
          }
          results();
        });
      }
    }
    function openMatchedItem(id) {
      client.api('/items/' + encodeURIComponent(id), { nolinks: 0 }, function (error, json) {
        if (error || !json.item) { notify(errorMessage(error)); return; }
        var item = json.item;
        if (item.seasons && item.seasons.length) {
          if (pages) pages.show({ view: 'item', id: id });
          else openItem(id, function () { restore('full'); });
        } else if (item.videos && item.videos.length === 1) {
          openVideo(item, item.videos[0], null, { kind: 'part', season: 0, number: 1 }, true);
        } else if (pages) pages.show({ view: 'item', id: id });
        else openItem(id, function () { restore('full'); });
      });
    }
    function openItem(id, back) {
      client.api('/items/' + encodeURIComponent(id), { nolinks: 0 }, function (error, json) {
        if (error) { notify(errorMessage(error)); return; }
        var item = json.item;
        if (!item) { notify('Нет данных о видео.'); return; }
        function seasons() {
          menu(item.title, item.seasons.map(function (season, index) {
            return { title: 'Сезон ' + (season.number || index + 1), run: function () { episodes(season); } };
          }), back);
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
          if (videos.length === 1) openVideo(item, videos[0], back, { kind: 'part', season: 0, number: 1 });
          else if (videos.length) menu(item.title, videos.map(function (video, index) {
            var context = { kind: 'part', season: 0, number: index + 1 };
            return { title: video.title || ('Видео ' + (index + 1)), subtitle: progress.label(mediaKey(item, video, context)), run: function () { openVideo(item, video, function () { openItem(id, back); }, context); } };
          }), back);
          else notify('У этого материала нет доступного видео.');
        }
      });
    }
    function openVideo(item, video, back, context, automatic) {
      if (pages) back = pages.resume;
      var transition = automatic && typeof automatic === 'object' ? automatic : null;
      var playback = { key: mediaKey(item, video, context), time: 0, context: context, voice: '', accept: transition && transition.accept };
      function unavailable(message) { if (transition && !transition.valid()) return; notify(message); if (transition) transition.fail(); }
      function choose(data) {
        if (transition && !transition.valid()) return;
        var proxy = client.get('proxy_enabled') === true || client.get('proxy_enabled') === 'true';
        var maxHeight = transition ? transition.height : Number(client.get('quality')) || 1080;
        var options = streams(data.files, proxy, maxHeight);
        if (!options.length) { unavailable(proxy ? 'Нет HTTPS HLS4-ссылок. Отключи HLS-прокси или проверь данные KinoPub.' : 'Нет HTTPS-ссылок на видео.'); return; }
        if (transition && options[0].height > maxHeight) { unavailable('В следующей серии нет качества в выбранном ограничении.'); return; }
        function selectStream(stream) {
            playback.mode = proxy ? 'proxy' : 'direct'; playback.format = stream.format;
            diagnostics.record('source', { mode: proxy ? 'proxy' : 'direct', format: stream.format, height: stream.height });
            if (diagnostics.enabled()) lastCDN = stream.url;
            playback.height = stream.height || maxHeight;
            var audios = video.audios || data.audios || [];
            playback.audios = audios;
            if (transition) {
              var matching = transition.voice ? audios.filter(function (audio) { return voiceIdentity(audio) === transition.voice; }) : [];
              if (transition.voice && !matching.length) notify('Предыдущая озвучка недоступна в этой серии. Выбрана первая доступная.');
              var selected = matching[0] || audios[0];
              playback.voice = selected ? voiceIdentity(selected) : '';
              if (proxy) { prepareProxy(item, video, data, stream, selected ? Number(selected.index) || audios.indexOf(selected) + 1 : 0, Math.min(playback.height, maxHeight), playback, unavailable); return; }
            }
            if (!proxy) { play(item, video, data, stream.url, playback, options); return; }
            var tracks = audios.map(function (audio, index) {
              return { title: audioTitle(audio, index), run: function () {
                playback.voice = voiceIdentity(audio);
                prepareProxy(item, video, data, stream, Number(audio.index) || index + 1, Math.min(stream.height || maxHeight, maxHeight), playback, unavailable);
              } };
            });
            if (tracks.length) menu('Озвучка', tracks, function () { choose(data); });
            else prepareProxy(item, video, data, stream, 0, Math.min(stream.height || maxHeight, maxHeight), playback, unavailable);
        }
        if (automatic) selectStream(options[0]);
        else menu('Качество', options.map(function (stream) {
          return { title: (stream.height ? stream.height + 'p' : 'Авто') + ' · ' + stream.format.toUpperCase(), run: function () { selectStream(stream); } };
        }), back);
      }
      function load() {
        playback.preparedAt = Date.now();
        if (video.files && video.files.length) { choose(video); return; }
        var mediaId = video.id || video.media_id;
        if (!mediaId) { unavailable('KinoPub не вернул media ID или ссылки.'); return; }
        client.api('/items/media-links', { mid: mediaId }, function (error, json) {
          if (error) unavailable(errorMessage(error)); else choose(json);
        });
      }
      var previous = progress.get(playback.key);
      if (transition) { playback.time = previous && !previous.watched ? previous.time : 0; load(); return; }
      if (!previous) { load(); return; }
      var entries = [];
      if (!previous.watched) entries.push({ title: progress.label(playback.key), run: function () {
        if (canTrack) playback.time = previous.time;
        else notify('Этот плеер не поддерживает продолжение Kinolamp. Видео начнётся сначала.');
        load();
      } });
      entries.push({ title: 'Начать сначала', run: function () { progress.clear(playback.key); load(); } });
      entries.push({ title: 'Сбросить прогресс', run: function () { progress.clear(playback.key); notify('Прогресс этого видео сброшен.'); back(); } });
      if (automatic) { entries[0].run(); return; }
      menu(previous.watched ? 'Уже просмотрено' : 'Продолжить просмотр', entries, back);
    }
    function prepareProxy(item, video, data, stream, voice, height, playback, unavailable) {
      var base = String(client.get('proxy_url')).replace(/\/+$/, '');
      var token = client.get('proxy_token');
      if (!httpsURL(base) || !/^https:\/\/[^/]+$/.test(base) || !token || token.length < 32) {
        unavailable('Для HLS-прокси укажи HTTPS-адрес своего VPS и ключ минимум 32 символа.'); return;
      }
      transport('POST', base + '/api/manifests', JSON.stringify({ master: stream.url, voice: voice, maxHeight: height }),
        { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, function (error, json) {
          // A proxy response may only return a ticket at the configured origin.
          var prefix = base + '/hls/';
          if (error || !json || typeof json.url !== 'string' || json.url.indexOf(prefix) !== 0 || !/^[a-f0-9]{64}\.m3u8$/.test(json.url.slice(prefix.length))) {
            unavailable('HLS-прокси недоступен. Проверь ключ, ALLOWED_ORIGINS и CDN_HOSTS на VPS.'); return;
          }
          play(item, video, data, json.url, playback);
        });
    }
    function play(item, video, data, url, playback, qualities) {
      var subtitles = (data.subtitles || video.subtitles || []).filter(function (s) { return httpsURL(s.url); }).map(function (s) {
        return { label: String(s.lang || 'Subtitles'), language: String(s.lang || ''), url: s.url };
      });
      var work = { title: String(item.title || '') + (video.title ? ' · ' + video.title : ''), url: url };
      work._kinolampDiagnostic = { requested: Date.now(), mode: playback.mode, format: playback.format };
      diagnostics.record('prepare', { ms: Date.now() - playback.preparedAt });
      if (qualities && qualities.length > 1) {
        work.quality = {};
        qualities.forEach(function (stream) { work.quality[stream.height ? stream.height + 'p' : 'Авто'] = stream.url; });
      }
      if (canTrack && playback.key) {
        work._kinolampProgress = { key: playback.key, time: playback.time };
        work.timeline = { time: playback.time, duration: 0, percent: 0, handler: function (_percent, time, duration) {
          if (session && session.work.timeline === work.timeline && session.seek === 0 && session.ready) progress.save(playback.key, time, duration, session.ended);
        } };
      }
      if (subtitles.length) work.subtitles = subtitles;
      if (playback.accept) { playback.accept(work, playback); return; }
      var entries = [work];
      if (playback.context.kind === 'episode' && Lampa.Player.listener && Lampa.Player.close && playback.key) {
        var owner = { id: navigation + 1, height: playback.height, voice: playback.voice, current: work, video: video, loading: false };
        queueOwner = owner;
        entries = episodeQueue(item).map(function (entry) {
          var id = mediaKey(item, entry.video, entry.context);
          var target = id === playback.key ? work : { title: escapeText('s' + entry.context.season + 'e' + entry.context.number + ' · ' + (entry.video.title || '')) };
          target.season = entry.context.season; target.episode = entry.context.number;
          target._kinolampQueueId = owner.id;
          target._kinolampLoad = function (ready) {
            if (owner.loading || queueOwner !== owner) return;
            owner.loading = true;
            var expected = navigation;
            function current() { return expected === navigation && queueOwner === owner; }
            function failed() { owner.loading = false; if (current()) Lampa.Player.close(); }
            client.api('/items/' + encodeURIComponent(item.id), { nolinks: 0 }, function (error, json) {
              if (!current()) { owner.loading = false; return; }
              var next = !error && json.item && episodeQueue(json.item).filter(function (candidate) { return mediaKey(json.item, candidate.video, candidate.context) === id; })[0];
              if (!next) { notify('Следующая серия недоступна. Воспроизведение остановлено.'); failed(); return; }
              openVideo(json.item, next.video, null, next.context, {
                height: owner.height, voice: owner.voice, fail: failed, valid: current,
                accept: function (prepared, options) {
                  owner.loading = false;
                  if (!current()) return;
                  Object.keys(prepared).forEach(function (key) { target[key] = prepared[key]; });
                  owner.current = target; owner.video = next.video; owner.height = options.height; owner.voice = options.voice;
                  ready();
                }
              });
            });
          };
          if (target !== work) target.url = target._kinolampLoad;
          return target;
        });
        owner.entries = entries;
      }
      try { Lampa.Player.play(work); Lampa.Player.playlist(entries); }
      catch (_) { notify('Не удалось запустить плеер Lampa.'); }
    }

    var bookmarkRevision = 0;
    function openCatalog() {
      if (!pages) { notify('Для каталога обнови Lampa: нужны нативные страницы приложения.'); return; }
      if (!client.hasToken()) { Lampa.Controller.toggle('settings'); Lampa.Settings.create('kp_self'); notify('Сначала войди в KinoPub, затем открой каталог.'); return; }
      pages.show({ view: 'catalog', section: 'new', page: 1 });
    }
    function catalogRoute(route, changes) {
      var result = { view: 'catalog', section: route.kp_section || 'new', page: route.kp_page || 1, query: route.kp_query || '', genre: route.kp_genre || '', genreTitle: route.kp_genre_title || '', quality: route.kp_quality || '', qualityTitle: route.kp_quality_title || '', folder: route.kp_folder || '' };
      Object.keys(changes).forEach(function (key) { result[key] = changes[key]; });
      return result;
    }
    function catalogSearch(route) {
      if (!Lampa.Input || !Lampa.Input.edit) { notify('В этой сборке Lampa недоступна клавиатура поиска.'); return; }
      var owner = pages.current();
      Lampa.Input.edit({ title: 'Поиск в KinoPub', value: route.kp_query || '', free: true, nosave: true, nomic: true }, function (value) {
        if (pages.current() !== owner) return;
        pages.resume();
        var query = String(value || '').trim().slice(0, 100);
        if (!query) return;
        if (query.length < 3) { notify('Введи минимум три символа.'); return; }
        pages.show(catalogRoute(route, { section: 'search', query: query, page: 1, folder: '', genre: '', genreTitle: '', quality: '', qualityTitle: '' }));
      });
    }
    function catalogFilters(route) {
      var owner = pages.current();
      menu('Фильтры KinoPub', [
        { title: 'Жанр: ' + (route.kp_genre_title || 'Все'), run: function () { choose('/genres', 'genre', 'genreTitle'); } },
        { title: 'Качество: ' + (route.kp_quality_title || 'Любое'), run: function () { choose('/references/video-quality', 'quality', 'qualityTitle'); } },
        { title: 'Сбросить фильтры', run: function () { pages.show(catalogRoute(route, { page: 1, genre: '', genreTitle: '', quality: '', qualityTitle: '' })); } }
      ]);
      function choose(path, key, label) {
        client.api(path, {}, function (error, json) {
          if (pages.current() !== owner) return;
          if (error) { notify(errorMessage(error)); return; }
          var values = Array.isArray(json) ? json : json.items || [];
          menu(key === 'genre' ? 'Жанр' : 'Качество', [{ title: 'Все', run: function () { select('', ''); } }].concat(values.map(function (value) {
            return { title: value.title, run: function () { select(value.id, value.title); } };
          })));
        });
        function select(id, title) { if (pages.current() !== owner) return; var changes = { page: 1 }; changes[key] = id; changes[label] = title; pages.show(catalogRoute(route, changes)); }
      }
    }
    function bookmarkMenu(item) {
      var owner = pages.current();
      client.api('/bookmarks', {}, function (error, json) {
        if (pages.current() !== owner) return;
        if (error) { notify(errorMessage(error)); return; }
        var folders = json.items || [];
        client.api('/bookmarks/get-item-folders', { item: item.id }, function (error, memberships) {
          if (pages.current() !== owner) return;
          if (error) { notify(errorMessage(error)); return; }
          var present = (memberships.folders || []).map(function (folder) { return String(folder.id); });
          var choices = folders.map(function (folder) {
            var contains = present.indexOf(String(folder.id)) !== -1;
            return { title: (contains ? '✓ Удалить из «' : 'Добавить в «') + folder.title + '»', run: function () { change(folder.id, contains); } };
          });
          if (!choices.length) choices.push({ title: 'Создать папку «Избранное» и добавить', run: function () {
            if (pages.current() !== owner) return;
            client.api('/bookmarks/create', { title: 'Избранное' }, function (error, result) {
              if (!error && result.folder && result.folder.id) bookmarkRevision++;
              if (pages.current() !== owner) return;
              if (error || !result.folder || !result.folder.id) { notify('Не удалось создать папку KinoPub. Повтори позже.'); return; }
              change(result.folder.id, false);
            }, false, true);
          } });
          menu('Закладки KinoPub · ' + item.title, choices);
        });
      });
      function change(folder, remove) {
        if (pages.current() !== owner) return;
        client.api(remove ? '/bookmarks/remove-item' : '/bookmarks/add', { item: item.id, folder: folder }, function (error) {
          if (!error) bookmarkRevision++;
          if (pages.current() !== owner) return;
          if (error) { notify(errorMessage(error)); return; }
          notify(remove ? 'Удалено из папки KinoPub.' : 'Добавлено в папку KinoPub.');
          pages.refresh();
        }, false, true);
      }
    }
    function catalogRows(route, done) {
      var loadedRevision = bookmarkRevision;
      var loadedGeneration = client.generation();
      var names = { new: 'Новинки', movies: 'Фильмы', series: 'Сериалы', search: 'Поиск', folders: 'Избранное', folder: 'Избранное' };
      var section = Object.prototype.hasOwnProperty.call(names, route.kp_section) ? route.kp_section : 'new';
      var page = Math.min(10000, Math.max(1, Math.floor(Number(route.kp_page) || 1)));
      var actions = ['new', 'movies', 'series', 'search', 'folders'].map(function (name) {
        return { title: (section === name ? '✓ ' : '') + names[name], run: function () {
          if (name === 'search') catalogSearch(route);
          else pages.show(catalogRoute(route, { section: name, page: 1, query: '', folder: '', genre: '', genreTitle: '', quality: '', qualityTitle: '' }));
        } };
      });
      var bookmarks = section === 'folder' || section === 'folders';
      var params = { page: page, perpage: 20 };
      var path = '/items';
      if (section === 'search') { path += '/search'; params.q = String(route.kp_query || '').slice(0, 100); }
      else if (bookmarks) { path = section === 'folders' ? '/bookmarks' : '/bookmarks/' + encodeURIComponent(route.kp_folder); params = {}; }
      else {
        params.sort = section === 'new' ? 'created-' : 'updated-';
        if (section === 'movies') params.type = 'movie';
        if (section === 'series') params.type = 'serial';
        if (route.kp_genre) params.genre = route.kp_genre;
        if (route.kp_quality) params['quality[]'] = route.kp_quality;
        actions.push({ title: 'Фильтры', run: function () { catalogFilters(route); } });
      }
      client.api(path, params, function (error, json) {
        if (error) { done(errorMessage(error)); return; }
        var items = json.items || [];
        var total = Math.min(10000, Math.max(1, Math.floor(Number(json.pagination && json.pagination.total) || 1)));
        if (bookmarks) { total = Math.max(1, Math.ceil(items.length / 20)); items = items.slice((page - 1) * 20, page * 20); }
        function pagination(number, title) { actions.push({ title: title, run: function () { pages.show(catalogRoute(route, { section: section, page: number })); } }); }
        if (page > 1) pagination(page - 1, '← Предыдущая страница');
        if (page < total) pagination(page + 1, 'Следующая страница →');
        done(null, { isStale: function () { return loadedGeneration !== client.generation() || bookmarks && loadedRevision !== bookmarkRevision; }, title: 'KinoPub · ' + (section === 'search' ? '«' + params.q + '»' : section === 'folder' && json.folder ? json.folder.title : names[section]), details: ['Страница ' + page + ' из ' + total, !bookmarks && section !== 'search' && route.kp_genre_title, !bookmarks && section !== 'search' && route.kp_quality_title].filter(Boolean).join(' · '), hint: section === 'folders' ? 'Выбери папку закладок своего аккаунта KinoPub.' : 'Долгое нажатие на карточку — закладки KinoPub. Озвучку выбирай в плеере.', empty: bookmarks ? 'Пока пусто. Добавляй материалы долгим нажатием на карточку в каталоге.' : 'Ничего не найдено. Измени поиск или фильтры.', layout: section === 'folders' ? 'folders' : 'posters', actions: actions, rows: items.map(function (item) {
          if (section === 'folders') return { title: item.title, subtitle: 'Материалов: ' + (Number(item.count) || 0), symbol: '★', next: { view: 'catalog', section: 'folder', folder: item.id, page: 1 } };
          var image = item.posters || {};
          var types = { movie: 'Фильм', serial: 'Сериал', documovie: 'Документальный фильм', docuserial: 'Документальный сериал', concert: 'Концерт', tvshow: 'ТВ-шоу', '3D': '3D' };
          return { title: item.title, subtitle: [item.year, types[item.type], Number(item.quality) > 100 ? item.quality + 'p' : ''].filter(Boolean).join(' · '), poster: String(image.medium || image.big || image.small || '').replace(/^http:/, 'https:'), next: { view: 'item', id: item.id }, menu: function () { bookmarkMenu(item); } };
        }) });
      });
    }

    function pageRows(route, done) {
      if (route.kp_view === 'catalog') { catalogRows(route, done); return; }
      function imageURL(value) { return typeof value === 'string' ? value.replace(/^http:/, 'https:') : ''; }
      function poster(item) { return imageURL(item.posters && (item.posters.medium || item.posters.big || item.posters.small)); }
      function minutes(seconds) { return seconds > 0 ? Math.ceil(seconds / 60) + ' мин' : ''; }
      function details(item) {
        return [item.year, (item.genres || []).map(function (genre) { return genre.title; }).join(', '), (item.countries || []).map(function (country) { return country.title; }).join(', ')].filter(Boolean).join(' · ');
      }
      if (route.kp_view === 'search') {
        client.api('/items/search', { q: route.kp_query }, function (error, json) {
          if (error) { done(errorMessage(error)); return; }
          done(null, { title: 'Результаты: «' + route.kp_query + '»', rows: (json.items || []).map(function (item) {
            return { title: item.title, subtitle: [item.year, item.type].filter(Boolean).join(' · '), poster: poster(item), next: { view: 'item', id: item.id } };
          }) });
        });
        return;
      }
      client.api('/items/' + encodeURIComponent(route.kp_id), { nolinks: 0 }, function (error, json) {
        if (error || !json.item) { done(errorMessage(error)); return; }
        var item = json.item;
        var image = poster(item);
        if (route.kp_view === 'item' && item.seasons && item.seasons.length) {
          done(null, { title: item.title, description: item.plot, details: details(item), layout: 'seasons', hint: 'Сезоны · ' + item.seasons.length, rows: item.seasons.map(function (season, index) {
            return { title: 'Сезон ' + (season.number === undefined ? index + 1 : season.number), subtitle: [season.title, 'Серий: ' + (season.episodes || []).length].filter(Boolean).join(' · '), poster: image, next: { view: 'season', id: item.id, season: index } };
          }) });
          return;
        }
        var season = (item.seasons || [])[route.kp_season];
        var episodes = route.kp_view === 'season';
        var videos = episodes ? season && season.episodes || [] : item.videos || [];
        done(null, { title: item.title, description: item.plot, details: details(item), layout: 'episodes', hint: episodes ? 'Сезон ' + (season && season.number !== undefined ? season.number : Number(route.kp_season) + 1) + ' · Серий: ' + videos.length : 'Выбери часть фильма.', rows: videos.map(function (video, index) {
          var context = { kind: episodes ? 'episode' : 'part', season: episodes ? (season.number === undefined ? Number(route.kp_season) + 1 : season.number) : 0, number: video.number || index + 1 };
          return { title: (episodes ? 'Серия ' + context.number + (video.title ? ' · ' + video.title : '') : video.title || 'Видео ' + context.number), subtitle: function () { return [minutes(video.duration), progress.label(mediaKey(item, video, context))].filter(Boolean).join(' · '); }, poster: imageURL(video.thumbnail) || image, item: item, video: video, context: context };
        }) });
      });
    }
    function activatePageRow(row) {
      if (row.next && row.next.view === 'item') openMatchedItem(row.next.id);
      else if (row.next) pages.show(row.next);
      else openVideo(row.item, row.video, pages.resume, row.context, true);
    }

    var icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="48" height="48" role="img" aria-label="Kinolamp"><rect x="1" y="1" width="94" height="94" rx="26" fill="#142329" stroke="#2b4249" stroke-width="2"/><path d="M22 8h35C35 8 19 23 15 42V24c0-9 3-13 7-16Z" fill="#fff" opacity=".035"/><path d="M48 18c-13.3 0-24 10.5-24 23.5 0 9 4.7 15.6 11.2 21.2l1.5 3.3h22.6l1.5-3.3C67.3 57.1 72 50.5 72 41.5 72 28.5 61.3 18 48 18Z" fill="#9cebc9"/><path d="M48 18c-13.3 0-24 10.5-24 23.5 0 3.1.6 5.9 1.6 8.4C25.2 34.4 36 23 49.4 23c8.2 0 15.4 3.6 20 9.2C65.7 23.8 57.5 18 48 18Z" fill="#d6ffed"/><path d="M43.7 31.1a2.4 2.4 0 0 0-3.7 2v19.8a2.4 2.4 0 0 0 3.7 2l15-9.9a2.4 2.4 0 0 0 0-4Z" fill="#142329"/><rect x="37" y="71" width="22" height="5" rx="2.5" fill="#9cebc9"/><path d="M41 81h14a7.7 7.7 0 0 1-14 0Z" fill="#68caa7"/><path d="m20 19-4-4m60 4 4-4M48 8V5" fill="none" stroke="#9cebc9" stroke-width="2.5" stroke-linecap="round" opacity=".45"/></svg>';
    Lampa.SettingsApi.addComponent({ component: 'kp_self', name: 'Kinolamp', icon: icon });
    Lampa.Template.add('settings_kp_self_advanced', '<div></div>');
    function setting(key, type, name, description, values, initial, advanced) {
      Lampa.SettingsApi.addParam({
        component: typeof advanced === 'string' ? advanced : advanced ? 'kp_self_advanced' : 'kp_self',
        param: { name: PREFIX + key, type: type, placeholder: 'Не задано', values: values || '', 'default': initial },
        field: { name: name, description: description },
        onChange: function () { if (key === 'diagnostics_enabled') clearDiagnostics(); Lampa.Settings.update(); },
        onRender: function (item) {
          if (type === 'input' && client.get('proxy_enabled') !== true && client.get('proxy_enabled') !== 'true') item.hide().removeClass('selector');
        }
      });
    }
    function action(key, name, run, advanced) {
      Lampa.SettingsApi.addParam({ component: typeof advanced === 'string' ? advanced : advanced ? 'kp_self_advanced' : 'kp_self', param: { name: PREFIX + key, type: 'button' }, field: { name: name }, onChange: run,
        onRender: function (item) {
          if (key === 'login' && client.hasToken() || key === 'logout' && !client.hasToken()) item.hide().removeClass('selector');
        }
      });
    }
    setting('quality', 'select', 'Максимальное качество', 'Лучшее доступное качество в пределах выбранного значения.', { '480': '480p', '720': '720p', '1080': '1080p', '2160': '2160p' }, '1080');
    setting('proxy_enabled', 'trigger', 'Использовать свой HLS-прокси', 'Включай только при проблемах воспроизведения HLS на телевизоре.', '', false, true);
    setting('proxy_url', 'input', 'HTTPS-адрес своего HLS-прокси', 'Адрес твоего сервера без завершающего пути.', '', '', true);
    setting('proxy_token', 'input', 'Ключ своего HLS-прокси', 'Ключ доступа к твоему прокси. Минимум 32 символа.', '', '', true);
    action('login', 'Войти в KinoPub', function () { login(function () { Lampa.Settings.update(); }); });
    action('logout', 'Выйти из KinoPub', function () {
      if (auth) { stopLogin(); Lampa.Modal.close(); }
      client.logout(); Lampa.Settings.update(); notify('Локальная сессия удалена. Отзыв устройства доступен на kino.pub.');
    });
    action('advanced', 'Дополнительно', function () { Lampa.Settings.create('kp_self_advanced', { onBack: function () { Lampa.Settings.create('kp_self'); } }); });
    action('catalog', 'Открыть каталог KinoPub', openCatalog, true);
    Lampa.Template.add('settings_kp_self_diagnostics', '<div></div>');
    action('diagnostics', 'Диагностика воспроизведения', function () {
      Lampa.Settings.create('kp_self_diagnostics', { onBack: function () { Lampa.Settings.create('kp_self_advanced'); } });
    }, true);
    setting('diagnostics_enabled', 'trigger', 'Локальная диагностика', 'До 120 событий в памяти до перезапуска. Без URL и токенов. Выключение очищает отчёт.', '', false, 'kp_self_diagnostics');
    action('diagnostics_report', 'Показать отчёт', function () {
      var report = diagnostics.report();
      var errors = report.events.filter(function (entry) { return entry.event === 'error'; }).length;
      var waiting = report.events.filter(function (entry) { return entry.event === 'waiting' || entry.event === 'stalled'; }).length;
      Lampa.Modal.open({ title: 'Диагностика Kinolamp', html: $('<div></div>').append($('<p></p>').text('Сбор ' + (report.enabled ? 'включён' : 'выключен') + ' · Событий: ' + report.events.length + ' · Ошибок: ' + errors + ' · Ожиданий: ' + waiting + '. Только эта сессия и события доступного плеера. ms — миллисекунды, buffer — запас в секундах. Отсутствие события не означает отсутствие проблемы. HEAD/CORS-проверка CDN не измеряет скорость и загрузку сегментов.')).append($('<pre style="white-space:pre-wrap;font-size:1em;line-height:1.5"></pre>').text(JSON.stringify(report, null, 2))), onBack: function () { Lampa.Modal.close(); restore('settings_component'); } });
    }, 'kp_self_diagnostics');
    action('diagnostics_clear', 'Очистить отчёт', function () { clearDiagnostics(); notify('Локальный отчёт очищен.'); }, 'kp_self_diagnostics');
    action('diagnostics_export', 'Скачать отчёт JSON', function () {
      if (!root.document || !root.document.createElement) { notify('Скачивание недоступно в этом плеере. Открой отчёт на экране.'); return; }
      var link = root.document.createElement('a');
      if (!('download' in link)) { notify('Скачивание недоступно в этом плеере. Открой отчёт на экране.'); return; }
      link.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(diagnostics.report(), null, 2));
      link.download = 'kinolamp-diagnostics.json';
      try { link.click(); } catch (_) { notify('Скачивание недоступно в этом плеере. Открой отчёт на экране.'); }
    }, 'kp_self_diagnostics');
    action('diagnostics_probe', 'Проверить доступность API / прокси / CDN', function () {
      if (!diagnostics.enabled()) { notify('Сначала включи локальную диагностику.'); return; }
      menu('Проверка доступности · запускается вручную', ['api', 'proxy', 'cdn'].map(function (kind, index) {
        return { title: ['KinoPub API', 'Свой прокси: health', 'Последний выбранный CDN: HEAD'][index], run: function () { probeDiagnostic(kind); } };
      }));
    }, 'kp_self_diagnostics');
    function probeDiagnostic(kind) {
      if (!diagnostics.enabled()) return;
      var finish = diagnostics.begin('probe_' + kind);
      function done(status, result) { if (finish({ status: status, result: result })) notify('Проверка завершена. Результат в локальном отчёте.'); }
      if (kind === 'api') { client.api('/types', {}, function (error) { done(error ? Number(error.status) || 0 : 200, error ? 'error' : 'ok'); }); return; }
      var base = String(client.get('proxy_url')).replace(/\/+$/, '');
      if (kind === 'proxy') {
        if (!httpsURL(base) || !/^https:\/\/[^/]+$/.test(base)) { done(0, 'not_configured'); return; }
        transport('GET', base + '/health', null, {}, function (error, json) { done(error ? Number(error.status) || 0 : 200, !error && json.ok === true ? 'ok' : 'error'); }); return;
      }
      if (!lastCDN) { done(0, 'not_configured'); return; }
      if (!root.XMLHttpRequest) { done(0, 'unsupported'); return; }
      if (pendingProbe) { notify('Проверка CDN уже выполняется.'); return; }
      try {
        var xhr = new root.XMLHttpRequest(); pendingProbe = xhr;
        xhr.open('HEAD', lastCDN, true); xhr.timeout = 15000; xhr.withCredentials = false;
        function result(code) { if (pendingProbe === xhr) pendingProbe = null; done(Number(xhr.status) || 0, code); }
        xhr.onload = function () { result(xhr.status >= 200 && xhr.status < 400 ? 'ok' : 'error'); };
        xhr.onerror = function () { result('network_or_cors'); };
        xhr.ontimeout = function () { result('timeout'); };
        xhr.onabort = function () { result('cancelled'); };
        xhr.send();
      } catch (_) { pendingProbe = null; done(0, 'unsupported'); }
    }
    action('privacy', 'О плагине и приватности', function () {
      notify('Kinolamp ' + VERSION + ': без телеметрии и облачной синхронизации. Токены на устройстве. HLS-прокси получает только ссылку на поток.');
    });
    action('reset_progress', 'Сбросить весь прогресс Kinolamp', function () {
      menu('Сбросить локальный прогресс?', [{ title: 'Удалить прогресс Kinolamp', run: function () {
        session = null; progress.clear(); notify('Прогресс Kinolamp сброшен.');
      } }]);
    }, true);
    Lampa.Listener.follow('full', function (event) {
      if (!event || event.type !== 'complite' || !event.data || !event.data.movie) return;
      var holder = event.object && event.object.activity && event.object.activity.render();
      if (!holder || holder.find('.kp-self-button').length) return;
      var target = holder.find('.buttons--container').first();
      if (!target.length) { notify('Не удалось подключить KinoPub к кнопке «Смотреть». Обнови Lampa.'); return; }
      var button = $('<div class="full-start__button kp-self-button"></div>');
      button.append($(icon)).append($('<span></span>').text('KinoPub'));
      button.on('hover:enter', function () { search(event.data.movie); });
      target.append(button);
      // Extend Lampa's button grouping after its own source handlers are installed.
      var start = event.link && event.link.items && event.link.items[0];
      if (start && start.use) start.use({ onGroupButtons: function () {
        var html = this.html;
        html.find('.button--play').unbind('hover:enter hover:long').on('hover:enter', function () { search(event.data.movie); }).on('hover:long', function () {
          var sources = [];
          html.find('.buttons--container > .full-start__button').not('.hide').each(function () {
            var source = $(this);
            sources.push({ title: source.text(), run: function () { source.trigger('hover:enter'); } });
          });
          menu('Источники', sources);
        });
      } });
    });
    pages = createNativePages(Lampa, $, root.Navigator, pageRows, activatePageRow);
    if (pages && Lampa.Menu && Lampa.Menu.addButton) {
      var catalogMenuAdded = false;
      function addCatalogMenu() {
        if (catalogMenuAdded) return;
        catalogMenuAdded = true;
        Lampa.Menu.addButton(icon, 'KinoPub', openCatalog).attr('data-action', 'kinolamp');
      }
      if (root.appready) addCatalogMenu();
      else Lampa.Listener.follow('app', function (event) { if (event && event.type === 'ready') addCatalogMenu(); });
    }
    if (Lampa.Manifest) Lampa.Manifest.plugins = { type: 'video', name: 'Kinolamp', version: VERSION, description: 'Личный источник KinoPub без телеметрии' };
    // A direct stream keeps native Lampa audio controls; proxy mode selects before playback.
  }
  return { install: install, createClient: createClient, escapeText: escapeText, httpsURL: httpsURL, streams: streams, audioTitle: audioTitle, matchItem: matchItem, createNativePages: createNativePages, nameExtension: nameExtension, mediaKey: mediaKey, createProgress: createProgress, episodeQueue: episodeQueue, voiceIdentity: voiceIdentity, createDiagnostics: createDiagnostics };
});
