'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../web/static/kp');
const { store, video, harness } = require('./support/lampa');

const part = { kind: 'part', season: 0, number: 1 };
const key = plugin.mediaKey({ id: 7 }, video(), part);
const saved = { [key]: { time: 123, duration: 1000, watched: false, updated: 1 } };
function start(h) { h.click(); h.select(); h.select(); }

test('progress uses stable media identity, not expiring URLs or display titles', () => {
  assert.equal(key, plugin.mediaKey({ id: 7, title: 'Renamed' }, video({ files: [] }), part));
  assert.equal(plugin.mediaKey({}, {}, part), '');
  assert.equal(plugin.mediaKey({ id: null }, {}, part), '');
  assert.notEqual(key, plugin.mediaKey({ id: 8 }, video(), part));
  assert.notEqual(key, plugin.mediaKey({ id: 7 }, video({ id: 78 }), part));
  assert.notEqual(plugin.mediaKey({ id: 7 }, {}, part), plugin.mediaKey({ id: 7 }, {}, { ...part, number: 2 }));
  assert.notEqual(plugin.mediaKey({ id: 7 }, {}, { kind: 'episode', season: 0, number: 1 }), plugin.mediaKey({ id: 7 }, {}, { kind: 'episode', season: 1, number: 1 }));
  assert.equal(plugin.mediaKey({ id: 7 }, { media_id: 77 }, part), key);
});

test('bounded local progress validates numeric data, completion and storage failures', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const storage = store(); const progress = plugin.createProgress(storage);
  assert.equal(progress.get(key), null); assert.equal(progress.label(key), '');
  for (const data of [null, [], 'bad']) { storage.set('kp_self_progress', data); assert.equal(progress.get(key), null); }
  for (const time of [undefined, NaN, Infinity, -1, '10']) progress.save(key, time, 100);
  for (const duration of [undefined, NaN, Infinity, 0, -1, '100']) progress.save(key, 10, duration);
  progress.save('', 10, 100); assert.equal(progress.get(key), null);
  for (const entry of [{ time: '10', duration: 100 }, { time: Infinity, duration: 100 }, { time: -1, duration: 100 }, { time: 10, duration: '100' }, { time: 10, duration: Infinity }, { time: 10, duration: 0 }]) {
    storage.set('kp_self_progress', { [key]: entry }); assert.equal(progress.get(key), null);
  }
  progress.save(key, 123, 1000); assert.equal(progress.label(key), 'Продолжить с 2:03');
  progress.save(key, 950, 1000); assert.equal(progress.label(key), 'Просмотрено');
  progress.save(key, 20, 1000, true); assert.equal(progress.get(key).watched, true);
  progress.save(key, 1100, 1000); assert.equal(progress.get(key).time, 1000);
  for (let i = 0; i < 501; i++) progress.save('media:' + i, 10, 100);
  assert.equal(Object.keys(storage.get('kp_self_progress')).length, 500);
  assert.equal(progress.get('media:500').time, 10);
  progress.clear('media:500'); assert.equal(progress.get('media:500'), null);
  progress.clear(); assert.deepEqual(storage.get('kp_self_progress'), {});
  const full = plugin.createProgress({ get() { return {}; }, set() { throw new Error('quota exceeded'); } });
  assert.doesNotThrow(() => full.save(key, 10, 100));
});

test('player events persist progress, throttle writes and ignore unrelated playback', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 10000 });
  const h = harness(); const progress = plugin.createProgress(h.storage);
  h.videoEvents.emit('timeupdate', { current: 10, duration: 1000 });
  start(h); h.videoEvents.emit('pause');
  for (const event of [null, {}, { current: '10', duration: 100 }, { current: NaN, duration: 100 }, { current: -1, duration: 100 }, { current: 10, duration: '100' }, { current: 10, duration: NaN }, { current: 10, duration: 0 }]) h.videoEvents.emit('timeupdate', event);
  assert.equal(progress.get(key), null);
  h.videoEvents.emit('timeupdate', { current: 10, duration: 1000 });
  assert.equal(progress.get(key).time, 10);
  h.videoEvents.emit('timeupdate', { current: 11, duration: 1000 });
  assert.equal(progress.get(key).time, 10);
  h.videoEvents.emit('pause'); assert.equal(progress.get(key).time, 11);
  h.videoEvents.emit('timeupdate', { current: 12, duration: 1000 });
  h.playerEvents.emit('destroy'); assert.equal(progress.get(key).time, 12);
  h.videoEvents.emit('timeupdate', { current: 999, duration: 1000 }); assert.equal(progress.get(key).time, 12);
  h.playerEvents.emit('start', { url: 'other-source' }); h.videoEvents.emit('timeupdate', { current: 100, duration: 1000 });
  h.playerEvents.emit('start'); assert.equal(progress.get(key).time, 12);
  h.plays[0].timeline.handler(20, 200, 1000); assert.equal(progress.get(key).time, 12);
});

test('resume seeks once, preserves the old position until ready and handles native timeline saves', () => {
  const h = harness({ storage: { kp_self_progress: saved } }); const progress = plugin.createProgress(h.storage);
  h.click(); h.select(); assert.equal(h.current.title, 'Продолжить просмотр');
  h.select(); h.select(); assert.equal(h.plays[0].timeline.time, 123);
  h.plays[0].timeline.handler(0, 0, 1000); assert.equal(progress.get(key).time, 123);
  h.videoEvents.emit('timeupdate', { current: 0, duration: 1000 }); assert.deepEqual(h.seeks, [123]);
  h.videoEvents.emit('timeupdate', { current: 0, duration: 1000 });
  h.plays[0].timeline.handler(0, 0, 1000); assert.equal(progress.get(key).time, 123);
  h.videoEvents.emit('timeupdate', { current: 124, duration: 1000 }); assert.deepEqual(h.seeks, [123]);
  h.plays[0].timeline.handler(15, 150, 1000); assert.equal(progress.get(key).time, 150);
  h.videoEvents.emit('timeupdate', { current: 999, duration: 1000 }); h.videoEvents.emit('ended');
  h.plays[0].timeline.handler(99, 999, 1000); h.playerEvents.emit('destroy'); assert.equal(progress.get(key).watched, true);
});

test('start over, per-video reset, watched markers and global reset are explicit', () => {
  const h = harness({ storage: { kp_self_progress: saved } }); const progress = plugin.createProgress(h.storage);
  h.click(); h.select(); h.select(1); h.select(); assert.equal(progress.get(key), null);
  assert.equal(h.plays[0].timeline.time, 0);
  h.videoEvents.emit('timeupdate', { current: 100, duration: 1000 });
  h.action('reset_progress'); h.select(); h.playerEvents.emit('destroy'); assert.equal(progress.get(key), null);
  const reset = harness({ storage: { kp_self_progress: saved } }); reset.click(); reset.select(); reset.select(2);
  assert.match(reset.notices.at(-1), /сброшен/); assert.equal(plugin.createProgress(reset.storage).get(key), null);
  const watched = harness({ storage: { kp_self_progress: { [key]: { ...saved[key], watched: true } } } });
  watched.click(); watched.select(); assert.equal(watched.current.title, 'Уже просмотрено');
  assert.equal(watched.current.items.length, 2); watched.select(); watched.select();
});

test('completion remains watched after destroy, including ended before the threshold', () => {
  const h = harness(); start(h);
  h.videoEvents.emit('timeupdate', { current: 700, duration: 1000 }); h.videoEvents.emit('ended');
  h.plays[0].timeline.handler(70, 700, 1000); h.playerEvents.emit('destroy');
  assert.equal(plugin.createProgress(h.storage).get(key).watched, true);
});

test('resume clamps to changed duration and unsupported players show a limitation', () => {
  const h = harness({ storage: { kp_self_progress: saved } }); start(h); h.select();
  h.videoEvents.emit('timeupdate', { current: 0, duration: 90 }); assert.deepEqual(h.seeks, [89]);
  for (const option of ['noTracking', 'noPlayerListener']) {
    const limited = harness({ [option]: true, storage: { kp_self_progress: saved } }); start(limited); limited.select();
    assert.match(limited.notices.at(-1), /не поддерживает/); assert.equal(limited.plays[0].timeline, undefined);
  }
});

test('episode and multipart menus expose their own local watched state', () => {
  for (const seasons of [true, false]) {
    const item = seasons ? { id: 7, title: 'Show', seasons: [{ number: 0, episodes: [video()] }] } : { id: 7, title: 'Parts', videos: [video(), video({ id: 78 })] };
    const storage = store(); plugin.createProgress(storage).save(plugin.mediaKey(item, video(), seasons ? { kind: 'episode', season: 0, number: 1 } : part), 1000, 1000);
    const h = harness({ storage: storage.values, respond(req) { return req.url.includes('/search') ? { items: [{ id: 7 }] } : { item }; } });
    h.click(); h.select(); if (seasons) h.select(); assert.equal(h.current.items[0].subtitle, 'Просмотрено');
    h.select(); h.select(); h.select(); assert.equal(h.plays.length, 1);
  }
});
