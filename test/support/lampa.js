'use strict';
const assert = require('node:assert/strict');
const plugin = require('../../web/static/kp');

function store(values = {}) {
  return { values: structuredClone(values), get(k, fallback) { return Object.hasOwn(this.values, k) ? this.values[k] : fallback; }, set(k, v) { this.values[k] = v; } };
}
function clientStore(values = {}) {
  return store({ kp_self_access: 'test-access', kp_self_refresh: 'test-refresh', ...values });
}
function video(overrides = {}) {
  return { id: 77, title: 'Part 1', audios: [{ index: 1, lang: 'rus', type: { short_title: 'MVO' }, author: { title: 'Studio' }, codec: 'aac' }], files: [{ quality: '1080p', url: { hls2: 'https://edge.cdn.example/hls2/master', hls4: 'https://edge.cdn.example/hls4/master' } }, { quality: '720p', urls: { hls2: 'https://edge.cdn.example/720/master', hls4: 'https://edge.cdn.example/hls4/720' } }], subtitles: [{ lang: 'eng', url: 'https://edge.cdn.example/en.srt' }], ...overrides };
}
function harness(options = {}) {
  const h = { controllers: {}, pages: [], routes: [], moves: [], nodes: [], settings: [], notices: [], requests: [], deviceRequests: [], menus: [], toggles: [], plays: [], closes: 0, callbacks: [], listeners: {}, storage: clientStore(options.storage) };
  h.$ = function (input) {
    if (input && input.mockNode) return input;
    const n = { input, mockNode: true, length: 1, children: [], handlers: {}, value: '',
      empty() { this.children = []; return this; },
      remove() { this.removed = true; return this; },
      append(node) { this.children.push(node); return this; },
      attr(name, value) { (this.attributes ||= {})[name] = value; return this; },
      text(value) { this.value = value; return this; },
      on(event, run) { this.handlers[event] = run; return this; },
      first() { return this; }, after(node) { this.children.push(node); return this; },
      find(selector) {
        const found = h.$(selector);
        if (selector === '.kp-self-button') found.length = options.duplicate ? 1 : 0;
        if (selector === '.buttons--container') found.length = options.noContainer ? 0 : 1;
        return found;
      }
    };
    n[0] = n; h.nodes.push(n); return n;
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
    Platform: { get() { return options.platform || ''; } },
    Reguest: function () {
      this.timeout = function (value) { assert.equal(value, 15000); };
      this.silent = function (url, success, error, body, params) {
        const req = { url, body, headers: params.headers, success, error };
        if (url.endsWith('/device/notify')) {
          h.deviceRequests.push(req);
          if (options.deviceNotifyFailure) error({ status: 503, responseText: '{}' });
          else success({ status: 200 });
          return;
        }
        h.requests.push(req);
        const result = h.respond(req);
        if (result && result.defer) { h.callbacks.push(req); return; }
        if (result && result.failure) error(result.xhr);
        else success(result);
      };
    },
    SettingsApi: { addComponent(c) { h.component = c; }, addParam(p) { h.settings.push(p); } },
    Select: { show(menu) { h.current = menu; h.menus.push(menu); }, close() { h.closes++; h.current.onBack(); } },
    Controller: { enabled() { return options.noController ? null : { name: options.native ? h.controllerName || 'full' : 'full' }; }, add(name, handlers) { h.controllers[name] = handlers; }, toggle(name) { h.controllerName = name; h.toggles.push(name); if (h.controllers[name]) h.controllers[name].toggle(); }, collectionSet(view) { h.collection = view; }, collectionFocus(last) { h.focus = last; } },
    Noty: { show(message) { h.notices.push(message); } },
    Modal: { open(modal) { h.modal = modal; }, close() { h.modalClosed = (h.modalClosed || 0) + 1; } },
    Listener: { follow(event, cb) { h.listeners[event] = cb; } },
    Manifest: {},
    PlayerVideo: { listener: h.videoEvents, to(time) { h.seeks.push(time); } },
    Player: { listener: h.playerEvents, play(work) { if (options.playerThrows) throw new Error('player failure'); h.playerEvents.emit('create', { data: work }); h.plays.push(work); h.playerEvents.emit('start', work); }, playlist(entries) { h.playlist = entries; } }
  };
  if (options.noPlatform) delete h.Lampa.Platform;
  if (options.noPlatformGet) h.Lampa.Platform = {};
  if (options.noTracking) delete h.Lampa.PlayerVideo;
  if (options.noPlayerListener) delete h.Lampa.Player.listener;
  if (options.noManifest) delete h.Lampa.Manifest;
  h.navigation = { canmove() { return !!h.canMove; }, move(direction) { h.moves.push(direction); } };
  if (options.native) {
    h.components = {};
    h.Lampa.Component = { add(name, component) { h.components[name] = component; } };
    h.Lampa.Scroll = function () {
      const node = h.$('scroll');
      this.append = child => node.append(child);
      this.render = () => node;
      this.update = card => { h.scrollFocus = card; };
      this.destroy = () => { h.scrollDestroyed = (h.scrollDestroyed || 0) + 1; };
    };
    h.Lampa.Activity = {
      push(route) {
        h.routes.push(JSON.parse(JSON.stringify(route)));
        const page = new h.components[route.component](route);
        page.activity = { loader(value) { h.loading = value; }, toggle() { if (h.pages.at(-1) === page) page.start(); } };
        h.pages.push(page); page.create(); page.start();
      },
      backward() { const page = h.pages.pop(); page.destroy(); h.pages.at(-1)?.start(); }
    };
  }
  plugin.install(h.Lampa, h.$, options.native ? { Navigator: h.navigation } : {});
  h.descendants = function descendants(node) { return [node, ...node.children.flatMap(child => descendants(child))]; };
  h.pageCards = () => h.descendants(h.pages.at(-1).render()).filter(node => String(node.input).includes('kp-page__card selector'));
  h.openCard = index => h.pageCards()[index].handlers['hover:enter']();
  h.action = name => h.settings.find(s => s.param.name === 'kp_self_' + name).onChange();
  h.mount = (movie = { title: 'Film' }, extra = {}) => h.listeners.full({ type: 'complite', data: { movie }, object: { activity: { render() { return h.holder; } } }, ...extra });
  h.click = (movie) => { h.mount(movie); const button = h.nodes.find(n => typeof n.input === 'string' && n.input.includes('kp-self-button') && n.handlers['hover:enter']); if (button) button.handlers['hover:enter'](); };
  h.select = (index = 0) => h.current.onSelect(h.current.items[index]);
  h.back = () => h.Lampa.Select.close();
  return h;
}

module.exports = { store, clientStore, video, harness };
