'use strict';
const assert = require('node:assert/strict');
const plugin = require('../../web/static/kp');

function store(values = {}) {
  return { values: structuredClone(values), get(k, fallback) { return Object.hasOwn(this.values, k) ? this.values[k] : fallback; }, set(k, v) { this.values[k] = v; } };
}
function clientStore(values = {}) {
  return store({ kp_self_client_id: 'test-client', kp_self_client_secret: 'test-client-secret', kp_self_access: 'test-access', kp_self_refresh: 'test-refresh', ...values });
}
function video(overrides = {}) {
  return { id: 77, title: 'Part 1', audios: [{ index: 1, lang: 'rus', type: { short_title: 'MVO' }, author: { title: 'Studio' }, codec: 'aac' }], files: [{ quality: '1080p', url: { hls2: 'https://edge.cdn.example/hls2/master', hls4: 'https://edge.cdn.example/hls4/master' } }, { quality: '720p', urls: { hls2: 'https://edge.cdn.example/720/master', hls4: 'https://edge.cdn.example/hls4/720' } }], subtitles: [{ lang: 'eng', url: 'https://edge.cdn.example/en.srt' }], ...overrides };
}
function harness(options = {}) {
  const h = { nodes: [], settings: [], notices: [], requests: [], menus: [], toggles: [], plays: [], closes: 0, callbacks: [], listeners: {}, storage: clientStore(options.storage) };
  h.$ = function (input) {
    const n = { input, length: 1, children: [], handlers: {}, value: '',
      append(node) { this.children.push(node); return this; },
      text(value) { this.value = value; return this; },
      on(event, run) { this.handlers[event] = run; return this; },
      first() { return this; }, after(node) { this.children.push(node); return this; },
      find(selector) {
        const found = h.$(selector);
        if (selector === '.kp-self-button') found.length = options.duplicate ? 1 : 0;
        if (selector.includes('.full-start-new__buttons')) found.length = options.noContainer ? 0 : 1;
        return found;
      }
    };
    h.nodes.push(n); return n;
  };
  h.holder = h.$('holder');
  h.respond = options.respond || function (request) {
    if (request.url.includes('/items/search')) return { items: [{ id: 7, title: 'Film <unsafe>', year: 2026, type: 'movie' }] };
    if (request.url.includes('/items/media-links')) return video();
    if (request.url.includes('/v1/items/7')) return { item: { id: 7, title: 'Film', videos: [video()] } };
    if (request.url.endsWith('/api/manifests')) return { url: 'https://plugin.example/hls/' + 'a'.repeat(64) + '.m3u8' };
    if (String(request.body).includes('grant_type=device_code')) return { code: 'private-device-code', user_code: 'ABC123', interval: 5, expires_in: 20 };
    if (String(request.body).includes('grant_type=device_token')) return { access_token: 'new-test-access', refresh_token: 'new-test-refresh' };
    throw new Error('Unexpected request: ' + request.url);
  };
  function events() {
    const callbacks = {};
    return { follow(name, callback) { (callbacks[name] ||= []).push(callback); }, emit(name, data) { (callbacks[name] || []).slice().forEach(cb => cb(data)); } };
  }
  h.playerEvents = events(); h.videoEvents = events(); h.seeks = [];
  h.Lampa = {
    Storage: h.storage,
    Reguest: function () {
      this.timeout = function (value) { assert.equal(value, 15000); };
      this.silent = function (url, success, error, body, params) {
        const req = { url, body, headers: params.headers, success, error };
        h.requests.push(req);
        const result = h.respond(req);
        if (result && result.defer) { h.callbacks.push(req); return; }
        if (result && result.failure) error(result.xhr);
        else success(result);
      };
    },
    SettingsApi: { addComponent(c) { h.component = c; }, addParam(p) { h.settings.push(p); } },
    Select: { show(menu) { h.current = menu; h.menus.push(menu); }, close() { h.closes++; } },
    Controller: { enabled() { return options.noController ? null : { name: 'full' }; }, toggle(name) { h.toggles.push(name); } },
    Noty: { show(message) { h.notices.push(message); } },
    Modal: { open(modal) { h.modal = modal; }, close() { h.modalClosed = (h.modalClosed || 0) + 1; } },
    Listener: { follow(event, cb) { h.listeners[event] = cb; } },
    Manifest: {},
    PlayerVideo: { listener: h.videoEvents, to(time) { h.seeks.push(time); } },
    Player: { listener: h.playerEvents, play(work) { if (options.playerThrows) throw new Error('player failure'); h.playerEvents.emit('create', { data: work }); h.plays.push(work); h.work = work; h.playerEvents.emit('start', work); }, playlist(entries) { h.playlist = entries; }, playdata() { return h.work; }, close() { h.playerEvents.emit('destroy'); h.closed = true; } }
  };
  if (options.noClose) delete h.Lampa.Player.close;
  h.next = function () {
    const position = h.playlist.indexOf(h.work);
    const entry = h.playlist[position + 1];
    if (!entry) return;
    const ready = function () { const list = h.playlist; h.playerEvents.emit('destroy'); h.Lampa.Player.play(entry); h.Lampa.Player.playlist(list); };
    if (typeof entry.url === 'function') entry.url(ready); else ready();
  };
  h.ended = function () { h.videoEvents.emit('ended'); if (h.storage.get('playlist_next', false)) h.next(); };
  if (options.noTracking) delete h.Lampa.PlayerVideo;
  if (options.noPlayerListener) delete h.Lampa.Player.listener;
  if (options.noManifest) delete h.Lampa.Manifest;
  plugin.install(h.Lampa, h.$, {});
  h.action = name => h.settings.find(s => s.param.name === 'kp_self_' + name).onChange();
  h.mount = (movie = { title: 'Film' }, extra = {}) => h.listeners.full({ type: 'complite', data: { movie }, object: { activity: { render() { return h.holder; } } }, ...extra });
  h.click = (movie) => { h.mount(movie); const button = h.nodes.find(n => typeof n.input === 'string' && n.input.includes('kp-self-button') && n.handlers['hover:enter']); if (button) button.handlers['hover:enter'](); };
  h.select = (index = 0) => h.current.onSelect(h.current.items[index]);
  h.back = () => h.current.onBack();
  return h;
}

module.exports = { store, clientStore, video, harness };
