'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./support/lampa');

function start(h) { h.click(); h.select(); h.select(); }

test('native player warning text is readable, scoped to Kinolamp and independent of diagnostic opt-in', () => {
  const shown = [];
  const h = harness({ playerInfo: { set(key, text) { shown.push({ key, text }); } } });
  const error = detail => ({ fatal: false, error: `details [${detail}] fatal [false]` });
  h.videoEvents.emit('error', error('bufferFullError'));
  assert.deepEqual(shown, []);
  start(h);
  for (const [detail, phrase] of [['bufferFullError', /Буфер плеера переполнен/], ['bufferStalledError', /Буферизация/], ['fragLoadError', /Не удалось загрузить фрагмент/], ['fragLoadTimeOut', /слишком долго/]]) {
    h.videoEvents.emit('error', error(detail));
    assert.equal(shown.at(-1).key, 'error');
    assert.match(shown.at(-1).text, phrase);
    assert.doesNotMatch(shown.at(-1).text, /details|fatal/);
  }
  const count = shown.length;
  for (const event of [undefined, { fatal: true, error: error('bufferFullError').error }, { fatal: false, error: {} }, error('unknownError'), error('constructor'), { fatal: false, error: 'https://private.example/TOKEN' }, { fatal: false, error: error('bufferFullError').error + ' TOKEN' }]) h.videoEvents.emit('error', event);
  assert.equal(shown.length, count, 'fatal, unknown and arbitrary messages must remain under native Lampa control');
  h.playerEvents.emit('destroy'); h.videoEvents.emit('error', error('bufferFullError'));
  h.playerEvents.emit('start', undefined); h.videoEvents.emit('error', error('bufferFullError'));
  h.playerEvents.emit('start', { url: 'other-source' }); h.videoEvents.emit('error', error('bufferFullError'));
  assert.equal(shown.length, count);
});

test('older Lampa builds without the native info API or player events retain their existing behavior', () => {
  for (const options of [{ playerInfo: {} }, { playerInfo: { set: true } }, { noPlayerListener: true }, { noPlayerVideo: true }, { noVideoListener: true }]) {
    const h = harness({ playerInfo: { set() { assert.fail('unexpected player info write'); } }, ...options });
    assert.ok(h.component);
  }
});

test('readable warnings preserve the original error event and safe diagnostic code', () => {
  const shown = [];
  const h = harness({ storage: { kp_self_diagnostics_enabled: true }, playerInfo: { set(key, text) { shown.push(text); } } });
  start(h);
  const event = { fatal: false, error: 'details [bufferFullError] fatal [false]' };
  h.videoEvents.emit('error', event);
  assert.deepEqual(event, { fatal: false, error: 'details [bufferFullError] fatal [false]' });
  assert.match(shown.at(-1), /переполнен/);
  h.action('diagnostics_report');
  const report = JSON.parse(h.modal.html.children[1].value);
  assert.ok(report.events.some(entry => entry.event === 'error' && entry.detail === 'bufferFullError' && entry.fatal === false));
});
