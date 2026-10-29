'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../web/static/kp');
const { harness, store } = require('./support/lampa');
const enabled = { kp_self_diagnostics_enabled: true };
const secret = 'PRIVATE_ACCESS_REFRESH_PROXY_AND_DEVICE_CODE';
function report(h) { h.action('diagnostics_report'); return JSON.parse(h.modal.html.children[1].value); }
function probe(h, index) { h.action('diagnostics_probe'); h.select(index); }
function start(h) { h.click(); h.select(); h.select(); }
function video() {
  const handlers = {};
  return { currentTime: 20, readyState: 4, videoWidth: 1920, videoHeight: 1080,
    buffered: { length: 3, start(i) { return [0, 15, 90][i]; }, end(i) { return [10, 50, 100][i]; } },
    addEventListener(name, run) { handlers[name] = run; },
    removeEventListener(name) { delete handlers[name]; },
    emit(name) { handlers[name]?.(); }, handlers
  };
}

test('diagnostic reports allowlist fields, reject secrets and bound memory; asynchronous work respects reset', () => {
  const storage = store(); let clock = 100;
  const d = plugin.createDiagnostics(storage, () => clock);
  const stopped = d.begin('api');
  d.record('api', { status: 200 }); assert.equal(d.report().events.length, 0);
  storage.set('kp_self_diagnostics_enabled', 'true'); stopped({ status: 200 });
  assert.equal(d.report().events.length, 0);
  d.record('unknown', { url: secret }); d.record('source');
  const untrusted = { url: 'https://edge.example/' + secret, authorization: secret, nested: { access_token: secret }, ms: 1.234, status: '200', current: -1, buffer: Infinity, readyState: NaN, width: 86400001, height: 1080, mode: 'direct', format: 'hls2', result: 'ok', detail: 'fragLoadError', fatal: false };
  untrusted.cycle = untrusted;
  d.record('error', untrusted);
  assert.deepEqual(d.report().events[1], { event: 'error', at: 0, ms: 1.23, height: 1080, mode: 'direct', format: 'hls2', result: 'ok', detail: 'fragLoadError', fatal: false });
  assert.equal(JSON.stringify(d.report()).includes(secret), false);
  const finish = d.begin('api'); clock += 15; finish({ status: 503, result: 'error' });
  assert.equal(d.report().events.at(-1).ms, 15);
  const late = d.begin('api'); d.clear(); late({ status: 200 });
  assert.deepEqual(d.report().events, []);
  for (let i = 0; i < 125; i++) d.record('sample', { current: i, mode: secret, format: secret, detail: secret, result: secret, fatal: secret });
  assert.equal(d.report().events.length, 120); assert.equal(d.report().events[0].current, 5);
  const copy = d.report(); copy.events[0].url = secret;
  assert.equal(JSON.stringify(d.report()).includes(secret), false);
  storage.set('kp_self_diagnostics_enabled', false); d.record('error', untrusted);
  assert.equal(d.report().events.length, 120);
});

test('disabled diagnostics adds no requests and settings expose opt-in, report, clear and safe export', () => {
  const normal = harness(); const h = harness(); start(normal); start(h);
  assert.deepEqual(h.requests.map(r => r.url), normal.requests.map(r => r.url));
  assert.deepEqual(report(h).events, []);
  h.modal.onBack(); assert.equal(h.modalClosed, 1);
  h.action('diagnostics'); assert.equal(h.settingsPage, 'kp_self_diagnostics');
  h.settingsParams.onBack(); assert.equal(h.settingsPage, 'kp_self_advanced');
  h.action('diagnostics_probe'); assert.match(h.notices.at(-1), /Сначала включи/);
  h.action('diagnostics_export'); assert.match(h.notices.at(-1), /Скачивание недоступно/);
  const badDocument = harness({ root: { document: {} } }); badDocument.action('diagnostics_export');
  const badLink = harness({ root: { document: { createElement() { return {}; } } } }); badLink.action('diagnostics_export');
  const blockedDownload = harness({ root: { document: { createElement() { return { download: '', click() { throw new Error(secret); } }; } } } }); blockedDownload.action('diagnostics_export');
  let downloaded;
  const link = { download: '', click() { downloaded = JSON.parse(decodeURIComponent(this.href.split(',')[1])); } };
  const exporting = harness({ storage: enabled, root: { document: { createElement() { return link; } } } });
  start(exporting); exporting.action('diagnostics_export');
  assert.equal(downloaded.schema, 1); assert.equal(JSON.stringify(downloaded).includes('test-access'), false);
  const toggle = h.settings.find(s => s.param.name === 'kp_self_diagnostics_enabled');
  assert.equal(toggle.param.default, false); assert.equal(toggle.component, 'kp_self_diagnostics');
  h.storage.set('kp_self_diagnostics_enabled', true); toggle.onChange(); start(h);
  assert.ok(report(h).events.length); h.action('diagnostics_clear'); assert.deepEqual(report(h).events, []);
  start(h); h.storage.set('kp_self_diagnostics_enabled', false); toggle.onChange();
  assert.deepEqual(report(h).events, []);
});

test('only owned playback is sampled and HLS errors retain safe codes, not raw messages or URLs', () => {
  const v = video(); const h = harness({ storage: enabled, diagnosticVideo: () => v });
  h.videoEvents.emit('error', { error: secret });
  start(h); h.playerEvents.emit('ready');
  v.emit('playing'); v.emit('playing'); v.emit('waiting'); v.emit('stalled');
  h.videoEvents.emit('timeupdate', { current: 20, duration: 100 });
  h.videoEvents.emit('timeupdate', { current: 21, duration: 100 });
  h.videoEvents.emit('pause'); h.videoEvents.emit('ended');
  for (const error of [undefined, { error: 'details [fragLoadError] https://edge.example/' + secret, fatal: false }, { error: { access_token: secret }, fatal: true }, { error: 'details [' + secret + ']' }]) h.videoEvents.emit('error', error);
  const r = report(h);
  assert.equal(r.events.filter(e => e.event === 'sample').length, 1);
  assert.equal(r.events.find(e => e.event === 'playing').buffer, 30);
  assert.equal(r.events.find(e => e.event === 'playing').height, 1080);
  assert.ok(r.events.some(e => e.detail === 'fragLoadError' && e.fatal === false));
  v.currentSrc = 'blob:https://lampa.example/' + secret; v.canPlayType = () => '';
  v.emit('waiting'); assert.equal(report(h).events.at(-1).path, 'mse'); assert.equal(report(h).events.at(-1).nativeHls, false);
  v.currentSrc = 'https://edge.example/' + secret; v.canPlayType = () => 'probably';
  v.emit('waiting'); assert.equal(report(h).events.at(-1).path, 'direct_src'); assert.equal(report(h).events.at(-1).nativeHls, true);
  v.currentSrc = ''; v.emit('waiting');
  assert.equal(JSON.stringify(r).includes(secret), false);
  h.Lampa.Player.close(); assert.deepEqual(v.handlers, {});
  const count = report(h).events.length;
  h.videoEvents.emit('timeupdate'); h.videoEvents.emit('pause');
  h.playerEvents.emit('start', { url: 'https://another.example/' + secret });
  h.playerEvents.emit('start', null); assert.equal(report(h).events.length, count);
});

test('buffer measurements tolerate gaps, unavailable APIs, video replacement and throwing platform accessors', () => {
  for (const candidate of [null, {}, { addEventListener() {} }]) {
    const h = harness({ storage: enabled, diagnosticVideo: () => candidate }); start(h); h.videoEvents.emit('timeupdate');
    assert.ok(report(h).events.some(e => e.event === 'sample'));
  }
  let v = video(); const h = harness({ storage: enabled, diagnosticVideo: () => v }); start(h);
  const previous = v; v = video(); v.currentTime = 70; h.playerEvents.emit('ready'); v.emit('waiting');
  assert.deepEqual(previous.handlers, {}); assert.equal(report(h).events.at(-1).buffer, 0);
  delete v.buffered; v.emit('waiting'); assert.equal(report(h).events.at(-1).buffer, undefined);
  Object.defineProperty(v, 'currentTime', { get() { throw new Error(secret); } });
  v.emit('waiting'); assert.equal(report(h).events.at(-1).result, 'unsupported');
});

function xhrRoot() {
  const requests = [];
  return { requests, XMLHttpRequest: function () {
    const xhr = { status: 0, open(method, url, async) { assert.equal(method, 'HEAD'); assert.equal(async, true); this.url = url; }, send() {}, abort() { this.onabort(); } };
    requests.push(xhr); return xhr;
  } };
}

test('manual API and proxy probes give safe bounded results and discard callbacks after cancellation', () => {
  for (const failed of [false, true]) {
    const h = harness({ storage: enabled, respond() { return failed ? { failure: true, xhr: { status: 503, responseText: '{}' } } : {}; } });
    probe(h, 0); assert.equal(report(h).events.at(-1).result, failed ? 'error' : 'ok');
    probe(h, 1); assert.equal(report(h).events.at(-1).result, 'not_configured');
    h.storage.set('kp_self_proxy_url', 'https://plugin.example');
    h.respond = () => failed ? { failure: true, xhr: { responseText: '{}' } } : { ok: true };
    probe(h, 1); assert.equal(report(h).events.at(-1).result, failed ? 'error' : 'ok');
    assert.equal(h.requests.at(-1).headers.Authorization, undefined);
    h.respond = () => ({ ok: false }); probe(h, 1); assert.equal(report(h).events.at(-1).result, 'error');
  }
  const h = harness({ storage: enabled, respond() { return { defer: true }; } });
  probe(h, 0); h.action('diagnostics_clear'); const notices = h.notices.length;
  h.callbacks.pop().success({ url: secret }); assert.equal(h.notices.length, notices);
  assert.deepEqual(report(h).events, []);
  h.storage.set('kp_self_diagnostics_enabled', false); h.current.items[0].run(); assert.equal(h.requests.length, 1);
  const network = harness({ storage: enabled, respond() { return { error: 'unavailable' }; } });
  probe(network, 0); assert.equal(report(network).events.at(-1).status, 0);
});

test('CDN HEAD probes are explicit, omit credentials and distinguish HTTP, timeout and CORS/network failures', () => {
  const root = xhrRoot(); const h = harness({ storage: enabled, root });
  probe(h, 2); assert.equal(report(h).events.at(-1).result, 'not_configured');
  start(h); assert.equal(root.requests.length, 0);
  for (const [event, status, result] of [['onload', 204, 'ok'], ['onload', 403, 'error'], ['onerror', 0, 'network_or_cors'], ['ontimeout', 0, 'timeout'], ['onabort', 0, 'cancelled']]) {
    probe(h, 2); const xhr = root.requests.at(-1);
    assert.equal(xhr.withCredentials, false); assert.equal(xhr.timeout, 15000);
    xhr.status = status; xhr[event](); assert.equal(report(h).events.at(-1).result, result);
  }
  probe(h, 2); const xhr = root.requests.at(-1); probe(h, 2); assert.match(h.notices.at(-1), /уже выполняется/);
  h.action('diagnostics_clear'); assert.deepEqual(report(h).events, []);
  xhr.onload(); assert.deepEqual(report(h).events, []);
  const unsupported = harness({ storage: enabled }); start(unsupported); probe(unsupported, 2);
  assert.equal(report(unsupported).events.at(-1).result, 'unsupported');
  const throwing = harness({ storage: enabled, root: { XMLHttpRequest: function () { throw new Error(secret); } } }); start(throwing); probe(throwing, 2);
  assert.equal(report(throwing).events.at(-1).result, 'unsupported');
});
