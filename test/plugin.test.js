'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plugin = require('../web/static/kp');
const filename = path.resolve(__dirname, '../web/static/kp.js');
const source = fs.readFileSync(filename, 'utf8');

const { store, clientStore, video, harness } = require('./support/lampa');

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
  assert.match(requests[1].body, /client_id=xbmc/);
  assert.equal(client.saveTokens({ access_token: 'next' }, client.generation()), true);
  assert.equal(storage.get('kp_self_refresh'), 'test-refresh');
  assert.equal(client.saveTokens({}, client.generation()), false);
  client.logout(); assert.equal(client.hasToken(), false);
  assert.equal(client.saveTokens({ access_token: 'old' }, 0), false);
  client.api('/user', null, e => assert.equal(e.code, 'login_required'));
  let shared;
  const fresh = plugin.createClient(store(), (method, url, body, headers, done) => { shared = new URLSearchParams(body); done(null, {}); });
  fresh.oauth('/oauth2/device', { grant_type: 'device_code' }, e => assert.equal(e, null));
  assert.equal(shared.get('client_id'), 'xbmc');
  assert.ok(shared.get('client_secret'));
  assert.equal(shared.get('grant_type'), 'device_code');
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
  const unauthorized = harness({ respond() { return { failure: true, xhr: { status: 401, responseText: '{}' } }; } });
  unauthorized.action('login'); assert.match(unauthorized.notices.at(-1), /Нужна авторизация/);
  const bad = harness({ respond() { return {}; } }); bad.action('login'); assert.match(bad.notices.at(-1), /Запрос не выполнен/);
  const h = harness(); h.action('login'); h.respond = () => ({ failure: true, xhr: { status: 401, responseText: '{"error":"invalid_client"}' } });
  t.mock.timers.tick(5000); assert.match(h.notices.at(-1), /не принимает общий клиент/);
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

test('extension metadata names only its own unnamed entry and preserves custom names', () => {
  const url = 'https://kinolamp.example/kp.js'; const root = { document: { currentScript: { src: url + '?reset=1' } } };
  const entries = [{ url }, { url: 'https://other.example/kp.js' }, { url, name: 'My custom name' }, {}]; let saves = 0;
  const Lampa = { Plugins: { get() { return entries; }, save() { saves++; } } };
  plugin.nameExtension(Lampa, root);
  assert.equal(entries[0].name, 'Kinolamp'); assert.equal(entries[0].author, 'zyab1ik'); assert.equal(saves, 1);
  assert.equal(entries[1].name, undefined); assert.equal(entries[2].name, 'My custom name');
  plugin.nameExtension(Lampa, root); assert.equal(saves, 1);
  for (const current of [{}, { document: {} }, { document: { currentScript: {} } }]) plugin.nameExtension(Lampa, current);
  for (const api of [{}, { Plugins: {} }, { Plugins: { get() { return []; } } }]) plugin.nameExtension(api, root);
});


test('empty input settings provide a real Lampa placeholder without storing it as credentials', () => {
  const h = harness({ storage: { kp_self_client_id: '', kp_self_client_secret: '' } });
  const inputs = h.settings.filter(entry => entry.param.type === 'input');
  assert.equal(inputs.length, 2);
  for (const entry of inputs) {
    // Lampa interpolates param.placeholder into the DOM, then uses it for an empty value.
    const placeholder = String(entry.param.placeholder);
    const stored = h.storage.get(entry.param.name, entry.param.default);
    const display = stored || placeholder;
    assert.equal(placeholder, 'Не задано');
    assert.equal(display, 'Не задано');
    assert.equal(stored, '');
  }
  h.action('login');
  assert.equal(h.requests.length, 1);
  assert.equal(h.modal.html.children[1].value, 'ABC123');
  assert.equal(h.settings.some(entry => /client_id|client_secret/.test(entry.param.name)), false);
  h.modal.onBack();
});


test('device login uses trusted activation URLs and explains where to obtain and enter the code', () => {
  for (const url of ['https://kino.watch/device', 'https://kino.pub/device/', 'https://evil.example/device', 'javascript:alert(1)', undefined]) {
    const h = harness({ storage: { kp_self_client_id: 'obsolete', kp_self_client_secret: 'obsolete' }, respond() { return { code: 'private', user_code: 'ABCDE', verification_uri: url }; } });
    h.action('login');
    const body = new URLSearchParams(h.requests[0].body);
    assert.equal(body.get('client_id'), 'xbmc');
    assert.notEqual(body.get('client_secret'), 'obsolete');
    const expected = url === 'https://kino.watch/device' || url === 'https://kino.pub/device/' ? url : 'https://kino.pub/device';
    const children = h.modal.html.children;
    assert.ok(children[0].value.includes(expected));
    assert.equal(children[1].value, 'ABCDE');
    assert.match(children[2].value, /Код устройства.*Добавить/);
    assert.equal(children.find(node => node.attributes).attributes.href, expected);
    assert.equal(h.settings.find(entry => entry.param.name === 'kp_self_login').param.type, 'button');
    h.modal.onBack();
  }
});
