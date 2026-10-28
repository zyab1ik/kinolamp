'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plugin = require('../web/static/kp');
const filename = path.resolve(__dirname, '../web/static/kp.js');
const source = fs.readFileSync(filename, 'utf8');

function store(values = {}) {
  return { values: { ...values }, get(k, fallback) { return Object.hasOwn(this.values, k) ? this.values[k] : fallback; }, set(k, v) { this.values[k] = v; } };
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
    Player: { play(work) { if (options.playerThrows) throw new Error('player failure'); h.plays.push(work); }, playlist(entries) { h.playlist = entries; } }
  };
  if (options.noManifest) delete h.Lampa.Manifest;
  plugin.install(h.Lampa, h.$, {});
  h.action = name => h.settings.find(s => s.param.name === 'kp_self_' + name).onChange();
  h.mount = (movie = { title: 'Film' }, extra = {}) => h.listeners.full({ type: 'complite', data: { movie }, object: { activity: { render() { return h.holder; } } }, ...extra });
  h.click = (movie) => { h.mount(movie); const button = h.nodes.find(n => typeof n.input === 'string' && n.input.includes('kp-self-button') && n.handlers['hover:enter']); if (button) button.handlers['hover:enter'](); };
  h.select = (index = 0) => h.current.onSelect(h.current.items[index]);
  h.back = () => h.current.onBack();
  return h;
}

test('helpers preserve text, reject unsafe URLs and select HTTPS streams', () => {
  assert.equal(plugin.escapeText('<img a="b">&\''), '&lt;img a=&quot;b&quot;&gt;&amp;&#39;');
  assert.equal(plugin.escapeText(null), '');
  for (const url of [null, 'http://cdn.example/a', 'https://u:p@cdn.example/a', 'https://cdn.example/a#b', 'https://cdn.example/\nx', 'https://cdn.example\\evil/a']) assert.equal(plugin.httpsURL(url), false);
  for (const url of ['https://cdn.example/a', 'https://cdn.example:443/?a=1']) assert.equal(plugin.httpsURL(url), true);
  assert.deepEqual(plugin.streams(null, false, 1080), []);
  assert.deepEqual(plugin.streams([{}], false, 1080), []);
  assert.equal(plugin.streams(video().files, false, 1080)[0].format, 'hls2');
  assert.equal(plugin.streams(video().files, true, 1080)[0].format, 'hls4');
  assert.equal(plugin.streams(video().files, true, 480)[0].height, 720);
  assert.equal(plugin.streams([{ h: 480, urls: { http: 'https://cdn.example/a' } }], false, 1080)[0].height, 480);
  assert.equal(plugin.streams([{ url: { hls: 'https://cdn.example/a' } }], false, 1080)[0].height, 0);
  assert.equal(plugin.audioTitle({}, 1), 'Дорожка 2');
  assert.equal(plugin.audioTitle({ type: { title: 'Dub' } }, 0), 'Dub');
});

test('OAuth goes only to KinoPub and stores tokens without logging', () => {
  const storage = clientStore(); const requests = []; let result;
  const client = plugin.createClient(storage, (method, url, body, headers, cb) => { requests.push({ method, url, body, headers }); cb(null, { items: [] }); });
  client.api('/items/search', { q: 'a & b' }, (e, json) => { assert.equal(e, null); result = json; });
  assert.deepEqual(result, { items: [] });
  assert.equal(requests[0].headers.Authorization, 'Bearer test-access');
  assert.equal(requests[0].url, 'https://api.service-kp.com/v1/items/search?q=a%20%26%20b');
  client.oauth('/oauth2/device', { grant_type: 'device_code' }, () => {});
  assert.match(requests[1].body, /client_id=test-client/);
  assert.equal(client.saveTokens({ access_token: 'next' }, client.generation()), true);
  assert.equal(storage.get('kp_self_refresh'), 'test-refresh');
  assert.equal(client.saveTokens({}, client.generation()), false);
  client.logout(); assert.equal(client.hasToken(), false);
  assert.equal(client.saveTokens({ access_token: 'old' }, 0), false);
  client.api('/user', null, e => assert.equal(e.code, 'login_required'));
  const missing = plugin.createClient(store(), () => assert.fail('missing credentials sent'));
  missing.oauth('/oauth2/device', {}, e => assert.equal(e.code, 'client_missing'));
});

test('401 refresh is shared and logout prevents delayed responses restoring a session', () => {
  const storage = clientStore(); const callbacks = []; let refreshCallback; let refreshes = 0; let calls = 0;
  const client = plugin.createClient(storage, (method, url, body, headers, cb) => {
    if (url.endsWith('/oauth2/token')) { refreshes++; refreshCallback = cb; }
    else if (headers.Authorization === 'Bearer test-access') callbacks.push(cb);
    else { calls++; cb(null, { ok: true }); }
  });
  client.api('/user', null, e => assert.equal(e, null));
  client.api('/user', {}, e => assert.equal(e, null));
  callbacks[0]({ status: 401 }); callbacks[1]({ status: 401 });
  assert.equal(refreshes, 1);
  refreshCallback(null, { access_token: 'new', refresh_token: 'new-refresh' });
  assert.equal(calls, 2);
  let delayed; const c2 = plugin.createClient(clientStore(), (m, u, b, h, cb) => { delayed = cb; });
  c2.api('/user', {}, e => assert.equal(e.code, 'session_changed')); c2.logout(); delayed(null, {});
  let finished; const c3 = plugin.createClient(clientStore(), (m, u, b, h, cb) => {
    if (u.endsWith('/token')) finished = cb; else cb({ status: 401 });
  });
  c3.api('/user', {}, e => assert.equal(e.code, 'session_changed')); c3.logout(); finished(null, { access_token: 'old' }); assert.equal(c3.hasToken(), false);
});

test('refresh failures stop retry loops and preserve tokens on temporary network failures', () => {
  for (const status of [400, 401, 503]) {
    const storage = clientStore(); let calls = 0;
    const client = plugin.createClient(storage, (m, u, b, h, cb) => { calls++; cb({ status: u.endsWith('/token') ? status : 401 }); });
    client.api('/user', {}, e => assert.equal(e.status, status));
    assert.equal(calls, 2); assert.equal(client.hasToken(), status === 503);
  }
  const noRefresh = plugin.createClient(clientStore({ kp_self_refresh: '' }), (m, u, b, h, cb) => cb({ status: 401 }));
  noRefresh.api('/user', {}, e => assert.equal(e.code, 'login_required'));
  let calls = 0; const looping = plugin.createClient(clientStore(), (m, u, b, h, cb) => { calls++; if (u.endsWith('/token')) cb(null, { access_token: 'new' }); else cb({ status: 401 }); });
  looping.api('/user', {}, e => assert.equal(e.status, 401)); assert.equal(calls, 3);
});

test('card workflow searches, escapes results, chooses quality and plays directly', () => {
  const h = harness(); h.click();
  assert.match(h.current.items[0].title, /&lt;unsafe&gt;/); h.select(); h.select();
  assert.equal(h.plays[0].url, 'https://edge.cdn.example/hls2/master');
  assert.equal(h.playlist.length, 1); assert.equal(h.plays[0].subtitles[0].language, 'eng');
  assert.equal(h.requests.some(r => !r.url.startsWith('https://api.service-kp.com/')), false);
  h.action('privacy'); assert.match(h.notices.at(-1), /без телеметрии/);
  h.action('logout'); assert.equal(h.storage.get('kp_self_access'), '');
});

test('serial navigation and media-links fallback work with back controls', () => {
  const h = harness({ respond(req) {
    if (req.url.includes('/search')) return { items: [{ id: 7, title: 'Show' }] };
    if (req.url.includes('/media-links')) return video();
    return { item: { title: 'Show', seasons: [{ episodes: [{ media_id: 77 }] }] } };
  } });
  h.click({ name: 'Show' }); h.select(); h.select(); h.select();
  h.back(); assert.equal(h.current.title, 'Серии'); h.back(); assert.equal(h.current.title, 'Show');
  h.select(); h.select(); h.select(); assert.equal(h.plays.length, 1);
  assert.equal(h.requests.some(r => r.url.includes('mid=77')), true);
});

test('multiple movie parts and navigation fallback', () => {
  const h = harness({ noContainer: true, noController: true, noManifest: true, respond(req) {
    if (req.url.includes('/search')) return { items: [{ id: 7 }] };
    return { item: { videos: [video({ title: '' }), video({ title: 'Part 2' })] } };
  } });
  h.click({ original_title: 'Original' }); h.back(); assert.deepEqual(h.toggles, []);
  h.select(); h.select(1); h.back(); h.select(1); h.select(); assert.equal(h.plays.length, 1);
  const normal = harness(); normal.click({ original_name: 'Original' }); normal.back(); assert.deepEqual(normal.toggles, ['full']);
});

test('single movie back reloads the item and empty seasons remain navigable', () => {
  const h = harness(); h.click(); h.select(); h.back();
  assert.equal(h.requests.filter(r => r.url.includes('/v1/items/7')).length, 2);
  const empty = harness({ respond(req) { return req.url.includes('/search') ? { items: [{ id: 7 }] } : { item: { seasons: [{}] } }; } });
  empty.click(); empty.select(); empty.select(); assert.equal(empty.current.items.length, 0); empty.back();
});

test('proxy handles unknown quality, empty audio and media-links audio metadata', () => {
  const storage = { kp_self_proxy_enabled: true, kp_self_proxy_url: 'https://plugin.example', kp_self_proxy_token: 'x'.repeat(64) };
  for (const audio of [undefined, [{ lang: 'rus' }]]) {
    const h = harness({ storage }); const normal = h.respond;
    h.respond = req => {
      if (req.url.includes('/v1/items/7')) return { item: { videos: [{ id: 77 }] } };
      if (req.url.includes('/media-links')) return { files: [{ url: { hls4: 'https://edge.cdn.example/master' } }], audios: audio };
      return normal(req);
    };
    h.click(); h.select(); assert.match(h.current.items[0].title, /Авто/); h.select(); if (audio) h.select();
    assert.equal(h.plays.length, 1);
    assert.equal(JSON.parse(h.requests.at(-1).body).voice, audio ? 1 : 0);
  }
  const missing = harness({ storage }); const normal = missing.respond;
  missing.respond = req => req.url.includes('/v1/items/7') ? { item: { videos: [video({ files: [{}] })] } } : normal(req);
  missing.click(); missing.select(); assert.match(missing.notices.at(-1), /Нет HTTPS HLS4/);
});

test('login defaults and cancellation handle callbacks already queued by the event loop', t => {
  const callbacks = [];
  t.mock.method(global, 'setTimeout', cb => { callbacks.push(cb); return 1; });
  t.mock.method(global, 'clearTimeout', () => {});
  const h = harness({ noController: true });
  h.respond = () => ({ code: 'device', user_code: 'CODE' });
  h.action('login'); h.modal.onBack(); h.modal.onBack(); callbacks.pop()();
  assert.equal(h.requests.length, 1);
});

test('HLS proxy is opt-in, uses separate authorization and validates returned ticket origin', () => {
  const storage = { kp_self_proxy_enabled: true, kp_self_proxy_url: 'https://plugin.example/', kp_self_proxy_token: 'x'.repeat(64) };
  const h = harness({ storage }); h.click(); h.select(); h.select(1); h.select();
  const req = h.requests.find(r => r.url.endsWith('/api/manifests'));
  assert.equal(req.headers.Authorization, 'Bearer ' + 'x'.repeat(64));
  assert.deepEqual(JSON.parse(req.body), { master: 'https://edge.cdn.example/hls4/720', voice: 1, maxHeight: 720 });
  assert.match(h.plays[0].url, /^https:\/\/plugin.example\/hls\/[a-f0-9]{64}\.m3u8$/);
  assert.equal(req.body.includes('test-access'), false);
  for (const bad of ['https://evil.example/hls/' + 'a'.repeat(64) + '.m3u8', 'https://plugin.example/hls/short', null]) {
    const f = harness({ storage }); const normal = f.respond; f.respond = req => req.url.endsWith('/api/manifests') ? { url: bad } : normal(req);
    f.click(); f.select(); f.select(); f.back(); f.select(); f.select();
    assert.equal(f.plays.length, 0); assert.match(f.notices.at(-1), /HLS-прокси недоступен/);
  }
});

test('proxy requires local config and handles missing tracks without leaking upstream data', () => {
  for (const config of [{}, { kp_self_proxy_url: 'http://bad.example' }, { kp_self_proxy_url: 'https://plugin.example', kp_self_proxy_token: 'short' }]) {
    const h = harness({ storage: { kp_self_proxy_enabled: 'true', ...config } }); h.click(); h.select(); h.select(); h.select();
    assert.match(h.notices.at(-1), /укажи HTTPS/); assert.equal(h.plays.length, 0);
  }
  const h = harness({ storage: { kp_self_proxy_enabled: 'true', kp_self_proxy_url: 'https://plugin.example', kp_self_proxy_token: 'x'.repeat(64) }, respond(req) {
    if (req.url.includes('/search')) return { items: [{ id: 7 }] };
    if (req.url.endsWith('/api/manifests')) return { failure: true, xhr: { status: 422, responseText: '{"error":"manifest_unavailable"}' } };
    return { item: { videos: [video({ audios: [] })] } };
  } }); h.click(); h.select(); h.select(); assert.match(h.notices.at(-1), /HLS-прокси недоступен/);
});

test('device login polls, handles pending/slowdown and continues after success', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const h = harness({ storage: { kp_self_access: '' } }); const base = h.respond; let polls = 0;
  h.respond = req => {
    if (String(req.body).includes('grant_type=device_code')) return { code: 'private-device-code', user_code: 'ABC123', interval: 5, expires_in: 60 };
    if (String(req.body).includes('grant_type=device_token')) { polls++; if (polls < 3) return { error: polls === 1 ? 'authorization_pending' : 'slow_down' }; }
    return base(req);
  };
  h.click(); h.action('login'); assert.equal(h.requests.length, 1);
  assert.equal(h.modal.html.children[1].value, 'ABC123');
  t.mock.timers.tick(5000); t.mock.timers.tick(5000); t.mock.timers.tick(10000);
  assert.equal(polls, 3); assert.equal(h.storage.get('kp_self_access'), 'new-test-access'); assert.equal(h.current.title, 'Результаты KinoPub');
  h.action('login'); t.mock.timers.tick(5000); assert.match(h.notices.at(-1), /вход выполнен/);
});

test('device login expires, cancels and discards in-flight replies', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const h = harness(); const base = h.respond;
  h.respond = req => String(req.body).includes('grant_type=device_token') ? { error: 'authorization_pending' } : base(req);
  h.action('login'); t.mock.timers.tick(20000); assert.match(h.notices.at(-1), /Код истёк/);
  h.action('login'); h.modal.onBack(); t.mock.timers.tick(30000); assert.ok(h.modalClosed > 0);
  h.respond = () => ({ defer: true }); h.action('login'); h.action('logout'); h.callbacks.pop().success({ code: 'late', user_code: 'late' }); assert.equal(h.storage.get('kp_self_access'), '');
  h.respond = base; h.action('login'); h.respond = () => ({ defer: true }); t.mock.timers.tick(5000);
  h.modal.onBack(); h.callbacks.pop().success({ access_token: 'late' }); assert.equal(h.storage.get('kp_self_access'), '');
});

test('device login rejects invalid client and OAuth errors', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const missing = harness({ storage: { kp_self_client_secret: '' } }); missing.action('login'); assert.match(missing.notices.at(-1), /Client ID/);
  const bad = harness({ respond() { return {}; } }); bad.action('login'); assert.match(bad.notices.at(-1), /Запрос не выполнен/);
  const h = harness(); h.action('login'); h.respond = () => ({ failure: true, xhr: { status: 401, responseText: '{"error":"invalid_client"}' } });
  t.mock.timers.tick(5000); assert.match(h.notices.at(-1), /Нужна авторизация/);
});

test('network and JSON failures are user-safe; missing or empty API data does not play', () => {
  for (const response of ['bad json', null, { failure: true, xhr: undefined }, { failure: true, xhr: { status: 503, responseText: 'bad json' } }, { failure: true, xhr: { status: 503, responseText: '{}' } }]) {
    const h = harness({ respond() { return response; } }); h.click(); assert.match(h.notices.at(-1), /Запрос не выполнен/); assert.equal(h.plays.length, 0);
  }
  const empty = harness({ respond() { return {}; } }); empty.click(); assert.match(empty.notices.at(-1), /ничего не найдено/);
  const noTitle = harness(); noTitle.click({}); assert.match(noTitle.notices.at(-1), /Открой карточку/);
  const stringJSON = harness({ respond() { return '{"items":[]}'; } }); stringJSON.click(); assert.match(stringJSON.notices.at(-1), /ничего не найдено/);
  for (const item of [undefined, {}, { videos: [] }, { videos: [{}] }, { videos: [{ files: [{}] }] }]) {
    const h = harness({ respond(req) { return req.url.includes('/search') ? { items: [{ id: 7 }] } : { item }; } }); h.click(); h.select(); assert.ok(h.notices.length > 0); assert.equal(h.plays.length, 0);
  }
});

test('detail/media errors, subtitles filtering and player exception paths', () => {
  for (const failPath of ['/v1/items/7', '/media-links']) {
    const h = harness({ respond(req) {
      if (req.url.includes('/search')) return { items: [{ id: 7 }] };
      if (req.url.includes(failPath)) return { error: 'service_error' };
      return { item: { videos: [{ id: 77 }] } };
    } }); h.click(); h.select(); assert.match(h.notices.at(-1), /Запрос не выполнен/);
  }
  const h = harness({ playerThrows: true }); h.click(); h.select(); h.select(); assert.match(h.notices.at(-1), /плеер/);
  const clean = harness({ respond(req) {
    if (req.url.includes('/search')) return { items: [{ id: 7 }] };
    return { item: { videos: [video({ title: '', subtitles: [{ url: 'http://cdn.example/a' }, { url: 'https://cdn.example/a' }] })] } };
  } }); clean.click(); clean.select(); clean.select(); assert.equal(clean.plays[0].title, ''); assert.equal(clean.plays[0].subtitles[0].label, 'Subtitles');
  const noSubs = harness({ respond(req) {
    if (req.url.includes('/search')) return { items: [{ id: 7 }] };
    return { item: { videos: [video({ subtitles: undefined })] } };
  } }); noSubs.click(); noSubs.select(); noSubs.select(); assert.equal(noSubs.plays[0].subtitles, undefined);
});

test('mounting guards, duplicate install guard and browser wrapper', () => {
  plugin.install({}, null, {}); plugin.install({}, () => {}, {});
  const h = harness({ duplicate: true });
  for (const event of [null, {}, { type: 'complite' }, { type: 'complite', data: {} }]) h.listeners.full(event);
  h.mount(); h.mount(undefined, { object: undefined });
  assert.equal(h.nodes.some(n => n.handlers['hover:enter']), false);
  vm.runInNewContext(source, {}, { filename });
  vm.runInNewContext(source, { window: {} }, { filename });
  vm.runInNewContext(source, { window: { Lampa: {}, kinolampInstalled: true } }, { filename });
  const w = { Lampa: {}, jQuery() {} }; vm.runInNewContext(source, { window: w }, { filename }); assert.equal(w.kinolampInstalled, true);
  vm.runInNewContext(source, { window: { Lampa: {}, $() {} } }, { filename });
});
