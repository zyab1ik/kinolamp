'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./support/lampa');

function start(h) { h.click(); h.select(); h.select(); }
const error = detail => ({ fatal: false, error: `details [${detail}] fatal [false]` });
function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const shown = [];
  const h = harness({ playerInfo: { set(key, text) { shown.push({ key, text }); } }, ...options });
  return { h, shown, tick(ms = 0) { t.mock.timers.tick(ms); } };
}

test('buffering text wins over a later native handler, without mutating HLS events', t => {
  const { h, shown, tick } = setup(t);
  h.videoEvents.emit('error', error('bufferFullError')); tick();
  assert.deepEqual(shown, []);
  start(h);
  h.videoEvents.follow('error', event => { shown.push({ key: 'error', text: event.error }); });
  for (const detail of ['bufferFullError', 'bufferStalledError', 'fragLoadError', 'fragLoadTimeOut']) {
    const event = error(detail);
    h.videoEvents.emit('error', event);
    assert.equal(shown.at(-1).text, event.error, 'native handler writes after the plugin listener');
    tick();
    assert.deepEqual(shown.at(-1), { key: 'error', text: 'Загрузка видео…' });
    assert.deepEqual(event, error(detail), 'diagnostics and recovery retain the original event');
  }
  h.videoEvents.emit('playing'); tick(); assert.equal(shown.at(-1).text, '');
});

test('continuous buffering escalates after 15 seconds and repeated errors do not postpone the warning', t => {
  const { h, shown, tick } = setup(t); start(h);
  h.videoEvents.emit('waiting'); tick(); assert.equal(shown.at(-1).text, 'Загрузка видео…');
  tick(10000); h.videoEvents.emit('error', error('bufferStalledError')); tick();
  tick(5000); tick();
  assert.equal(shown.at(-1).text, 'Видео не загружается. Попробуйте повторить воспроизведение.');
  h.videoEvents.emit('stalled'); tick(); assert.match(shown.at(-1).text, /Попробуйте/);
  h.videoEvents.emit('playing'); tick(); assert.equal(shown.at(-1).text, '');
  const count = shown.length; tick(30000); assert.equal(shown.length, count);
  h.videoEvents.emit('waiting'); tick(); assert.equal(shown.at(-1).text, 'Загрузка видео…');
  h.playerEvents.emit('destroy');
});

test('native progress clears buffering only when playback advances; pause and end cancel waiting', t => {
  const { h, shown, tick } = setup(t);
  for (const event of [undefined, {}, { current: NaN }, { current: Infinity }, { current: -1 }, { current: '1' }]) h.videoEvents.emit('timeupdate', event);
  h.videoEvents.emit('waiting'); tick(); assert.equal(shown.length, 0);
  start(h);
  for (const event of [undefined, {}, { current: NaN }, { current: Infinity }, { current: -1 }, { current: '1' }]) h.videoEvents.emit('timeupdate', event);
  h.videoEvents.emit('timeupdate', { current: 10 });
  h.videoEvents.emit('waiting'); tick();
  h.videoEvents.emit('timeupdate', { current: 10 }); tick(); assert.equal(shown.at(-1).text, 'Загрузка видео…');
  h.videoEvents.emit('timeupdate', { current: 11 }); tick(); assert.equal(shown.at(-1).text, '');
  h.videoEvents.emit('playing');
  for (const name of ['pause', 'ended']) {
    h.videoEvents.emit('waiting'); tick(); h.videoEvents.emit(name); tick(); assert.equal(shown.at(-1).text, '');
  }
  h.playerEvents.emit('destroy'); tick(30000);
});

test('fatal and foreign playback retain native control and cancel pending buffering writes', t => {
  const { h, shown, tick } = setup(t); start(h);
  for (const event of [undefined, {}, { fatal: false, error: {} }, error('unknownError'), error('constructor'), { fatal: false, error: 'https://private.example/TOKEN' }, { fatal: false, error: error('bufferFullError').error + ' TOKEN' }]) h.videoEvents.emit('error', event);
  tick(); assert.equal(shown.length, 0);
  h.videoEvents.emit('waiting');
  h.videoEvents.emit('error', { fatal: true, error: 'native fatal error' }); tick(30000); assert.equal(shown.length, 0);
  h.videoEvents.emit('waiting'); h.playerEvents.emit('start', { url: 'other-source' }); tick(30000);
  h.videoEvents.emit('waiting'); h.videoEvents.emit('playing'); h.videoEvents.emit('error', error('bufferFullError'));
  h.playerEvents.emit('start', undefined); tick(); assert.equal(shown.length, 0);
});

test('already queued callbacks cannot write into another episode or resurrect recovered buffering', t => {
  const callbacks = [];
  t.mock.method(global, 'setTimeout', (run, ms) => { callbacks.push({ run, ms }); return callbacks.length; });
  t.mock.method(global, 'clearTimeout', () => {});
  const shown = [];
  const h = harness({ playerInfo: { set(_key, text) { shown.push(text); } } });
  start(h); h.videoEvents.emit('waiting');
  const first = callbacks.slice(); h.playerEvents.emit('destroy'); first.forEach(c => c.run()); assert.deepEqual(shown, []);
  start(h); first.forEach(c => c.run()); assert.deepEqual(shown, [], 'new owned playback has another generation');
  h.videoEvents.emit('waiting'); const pending = callbacks.at(-2); h.videoEvents.emit('playing'); pending.run();
  assert.deepEqual(shown, []);
  callbacks.at(-1).run(); assert.deepEqual(shown, ['']);
});

test('older Lampa builds without the native info API or player events retain their existing behavior', () => {
  for (const options of [{ playerInfo: {} }, { playerInfo: { set: true } }, { noPlayerListener: true }, { noPlayerVideo: true }, { noVideoListener: true }]) {
    const h = harness({ playerInfo: { set() { assert.fail('unexpected player info write'); } }, ...options });
    assert.ok(h.component);
  }
});

test('readable status does not depend on diagnostic opt-in and preserves the safe diagnostic code', t => {
  const { h, shown, tick } = setup(t, { storage: { kp_self_diagnostics_enabled: true } }); start(h);
  const event = error('bufferFullError'); h.videoEvents.emit('error', event); tick();
  assert.deepEqual(event, error('bufferFullError'));
  assert.equal(shown.at(-1).text, 'Загрузка видео…');
  h.action('diagnostics_report');
  const report = JSON.parse(h.modal.html.children[1].value);
  assert.ok(report.events.some(entry => entry.event === 'error' && entry.detail === 'bufferFullError' && entry.fatal === false));
  h.playerEvents.emit('destroy');
});
