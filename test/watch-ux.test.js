'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../web/static/kp');
const { harness, video } = require('./support/lampa');
const movie = { title: 'Надежда', original_title: 'Hope', release_date: '2026-07-15' };
const found = { id: 7, title: 'Надежда / Hope', year: 2026, type: 'movie' };

test('automatic matching requires an unambiguous identity, not the first search result', () => {
  assert.equal(plugin.matchItem(movie, [found]), found);
  assert.equal(plugin.matchItem({ name: 'Ёлки!', year: 2020 }, [{ title: 'елки', year: 2020, type: 'movie' }]).title, 'елки');
  const series = { id: 9, title: 'Show', year: 2020, type: 'serial' };
  assert.equal(plugin.matchItem({ name: 'Show', first_air_date: '2020-01-01' }, [series]), series);
  assert.equal(plugin.matchItem({ original_name: 'Show', year: 2020, media_type: 'tv' }, [series]), series);
  assert.equal(plugin.matchItem({ imdb_id: 'tt123' }, [{ imdb: 'tt123' }]).imdb, 'tt123');
  for (const items of [undefined, [], [found, { ...found, id: 8 }], [{ ...found, year: 2018 }], [{ ...found, type: 'serial' }], [{ ...found, title: undefined }]]) assert.equal(plugin.matchItem(movie, items), null);
  assert.equal(plugin.matchItem({}, [found]), null);
  assert.equal(plugin.matchItem({ name: 'Show', media_type: 'tv', year: 2020 }, [found]), null);
  assert.equal(plugin.matchItem({ imdb_id: 'tt123' }, [found]), null);
});

test('Watch opens a matched film directly, resumes automatically and offers quality inside the player', () => {
  const key = plugin.mediaKey({ id: 7 }, video(), { kind: 'part', season: 0, number: 1 });
  for (const saved of [undefined, { time: 123, duration: 1000 }, { time: 900, duration: 1000, watched: true }]) {
    const h = harness({ native: true, storage: { kp_self_progress: saved ? { [key]: saved } : {} }, respond(req) {
      return req.url.includes('/search') ? { items: [found, { id: 8, title: 'Земля надежды', year: 2018, type: 'movie' }] } : { item: { id: 7, title: 'Надежда', videos: [video()] } };
    } });
    h.click(movie);
    assert.equal(h.routes.length, 0); assert.equal(h.current, undefined); assert.equal(h.plays.length, 1);
    assert.equal(h.plays[0].url, 'https://edge.cdn.example/hls2/master');
    assert.deepEqual(Object.keys(h.plays[0].quality), ['1080p', '720p']);
    assert.equal(h.plays[0].timeline.time, saved && !saved.watched ? 123 : 0);
  }
  const h = harness({ native: true, noTracking: true, respond(req) { return req.url.includes('/search') ? { items: [found] } : { item: { id: 7, videos: [video()] } }; } });
  h.click(movie); assert.equal(h.plays.length, 1);
});

test('Watch opens seasons for a matched series and starts a selected episode without extra dialogs', () => {
  for (const native of [true, false]) {
    const h = harness({ native, respond(req) { return req.url.includes('/search') ? { items: [{ id: 7, title: 'Show', year: 2020, type: 'serial' }] } : { item: { id: 7, title: 'Show', seasons: [{ number: 1, episodes: [video()] }] } }; } });
    h.click({ name: 'Show', first_air_date: '2020-01-01' });
    if (native) { assert.equal(h.routes[0].kp_view, 'item'); h.openCard(0); assert.equal(h.routes[1].kp_view, 'season'); h.openCard(0); assert.equal(h.plays.length, 1); }
    else { assert.equal(h.current.title, 'Show'); h.back(); }
  }
});

test('unmatched films keep a choice, while selecting a single-video result skips the Video 1 page', () => {
  const h = harness({ native: true }); h.click(movie);
  assert.equal(h.routes[0].kp_view, 'search'); h.openCard(0);
  assert.equal(h.routes.length, 1); assert.equal(h.plays.length, 1);
  for (const native of [true, false]) {
    for (const videos of [undefined, [video(), video({ id: 78 })]]) {
      const h = harness({ native, respond(req) { return req.url.includes('/search') ? { items: [found] } : { item: { id: 7, videos } }; } });
      h.click(movie);
      if (native) assert.equal(h.routes[0].kp_view, 'item');
      else if (videos) h.back();
      assert.equal(h.plays.length, 0);
    }
  }
  for (const response of [{}, { failure: true, xhr: { status: 503, responseText: '{}' } }]) {
    const h = harness({ respond(req) { return req.url.includes('/search') ? { items: [found] } : response; } }); h.click(movie); assert.match(h.notices.at(-1), /Запрос не выполнен/);
  }
  const h2 = harness({ respond() { return { failure: true, xhr: { status: 503, responseText: '{}' } }; } }); h2.click(movie); assert.match(h2.notices.at(-1), /Запрос не выполнен/);
});

test('main settings show one account action and keep proxy and reset under Advanced', () => {
  for (const token of ['', 'test-access']) {
    for (const enabled of [false, true, 'true']) {
      const h = harness({ storage: { kp_self_access: token, kp_self_proxy_enabled: enabled } });
      const visible = h.settings.filter(setting => { const row = h.$('row'); setting.onRender(row); return !row.hidden; });
      assert.deepEqual(visible.filter(s => s.component === 'kp_self').map(s => s.param.name), ['kp_self_quality', token ? 'kp_self_logout' : 'kp_self_login', 'kp_self_advanced', 'kp_self_privacy']);
      assert.equal(visible.some(s => s.param.name === 'kp_self_proxy_url'), !!enabled);
      const quality = h.settings.find(s => s.param.name === 'kp_self_quality'); quality.onChange(); assert.equal(h.settingsUpdates, 1);
      h.action('advanced'); assert.equal(h.settingsPage, 'kp_self_advanced'); assert.equal(h.templates.settings_kp_self_advanced, '<div></div>');
      h.settingsParams.onBack(); assert.equal(h.settingsPage, 'kp_self');
    }
  }
});

test('native Watch grouping preserves Lampa focus and long press opens its source actions', () => {
  const h = harness();
  const watch = h.$('watch'); watch.unbind = function (events) { this.unbound = events; return this; };
  const source = h.$('source'); source.text = () => 'Trailers'; source.trigger = event => { h.sourceEvent = event; };
  const sources = { not(selector) { assert.equal(selector, '.hide'); return this; }, each(run) { run.call(source); } };
  const start = { html: { find(selector) { return selector === '.button--play' ? watch : sources; } }, use(module) { this.module = module; } };
  h.mount({ title: 'Film' }, { link: { items: [start] } });
  start.module.onGroupButtons.call(start);
  assert.equal(watch.unbound, 'hover:enter hover:long');
  watch.handlers['hover:enter'](); assert.equal(h.current.title, 'Результаты KinoPub');
  watch.handlers['hover:long'](); assert.equal(h.current.title, 'Источники'); h.select(); assert.equal(h.sourceEvent, 'hover:enter');
  for (const link of [{}, { items: [] }, { items: [{}] }]) { const h = harness(); h.mount(undefined, { link }); }
});

test('native page resume restores existing focus and is safe after destruction', () => {
  const h = harness({ native: true });
  const pages = plugin.createNativePages(h.Lampa, h.$, h.navigation, (_route, done) => done(null, { title: 'Test', rows: [] }), () => {});
  pages.resume(); pages.show({ view: 'search', query: 'Test' }); pages.resume();
  assert.equal(h.controllerName, 'content'); h.Lampa.Activity.backward(); pages.resume();
});

test('quality controls also accept an automatic unknown-resolution stream', () => {
  const h = harness({ respond(req) { return req.url.includes('/search') ? { items: [found] } : { item: { id: 7, videos: [video({ files: [{ url: { hls2: 'https://cdn.example/auto' } }, { quality: '720p', url: { hls2: 'https://cdn.example/720' } }] })] } }; } });
  h.click(movie); assert.ok(h.plays[0].quality['Авто']);
});

test('playback respects the native Lampa HLS preference without changing shared settings', () => {
  for (const method of [undefined, 'application', 'hlsjs']) {
    const initial = method === undefined ? {} : { player_hls_method: method };
    const h = harness({ storage: initial }); h.click(); h.select(); h.select();
    assert.equal(h.plays[0].hls_type, method === 'hlsjs' ? 'hlsjs' : 'native');
    assert.equal(h.storage.get('player_hls_method'), method);
    assert.equal(h.plays[0].url, 'https://edge.cdn.example/hls2/master');
  }
});
