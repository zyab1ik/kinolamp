'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./support/lampa');

function setup(options = {}) {
  const calls = [];
  const item = { id: 7, title: 'Клиника / Scrubs', imdb: 285403, posters: { medium: 'https://kp.example/series.jpg' }, seasons: [{ number: 0, episodes: [] }, { number: 1, episodes: [] }, { number: 2, episodes: [] }], ...options.item };
  const source = { get(method, params, success, failure, cache) {
    calls.push({ method, params, cache });
    if (method.startsWith('find/')) {
      if (options.find) return options.find(success, failure);
      success({ tv_results: [{ id: 4556 }] });
    } else {
      if (options.show) return options.show(success, failure);
      success({ seasons: [{ season_number: 2, poster_path: '/season2.jpg' }, { season_number: 0, poster_path: '/specials.jpg' }, { season_number: 1, poster_path: '/season1.jpg' }] });
    }
  } };
  const h = harness({ native: true, api: { sources: { tmdb: source } }, tmdb: { image(path) { return 'https://image.example/' + path; } }, ...options.lampa, respond() { return { item }; } });
  h.Lampa.Activity.push({ component: 'kinolamp', kp_view: 'item', kp_id: 7 });
  const posters = () => h.pageCards().map(card => card.children[0].children.find(node => String(node.input).startsWith('<img'))?.attributes.src);
  return { h, item, calls, posters };
}

test('Scrubs season artwork resolves by IMDb and season number, including specials, without account tokens', () => {
  const { calls, posters, h } = setup();
  assert.deepEqual(calls.map(call => call.method), ['find/tt0285403?external_source=imdb_id', 'tv/4556']);
  assert.deepEqual(posters(), ['specials', 'season1', 'season2'].map(name => 'https://image.example/t/p/w500/' + name + '.jpg'));
  assert.ok(calls.every(call => Object.keys(call.params).length === 0 && call.cache.life > 0));
  assert.doesNotMatch(JSON.stringify(calls), /test-access|refresh|Authorization/);
  h.openCard(1); assert.equal(h.routes.at(-1).kp_season, 1, 'artwork must not reorder KinoPub seasons');
});

test('season-specific KinoPub covers win; missing artwork falls back to a frame of that season, then the series poster', () => {
  const { posters } = setup({ item: { seasons: [
    { posters: { medium: 'http://kp.example/own.jpg' } },
    { number: 2, episodes: [{ thumbnail: 'javascript:bad' }, { thumbnail: 'http://kp.example/frame.jpg' }] },
    { number: 3 }, { number: 4 }, { number: 5 }
  ] }, show(success) { success({ seasons: [{ season_number: 2, poster_path: null }, { season_number: 3, poster_path: 'https://untrusted.example/x.jpg' }, { season_number: 4 }] }); } });
  assert.deepEqual(posters(), ['https://kp.example/own.jpg','https://kp.example/frame.jpg', ...Array(3).fill('https://kp.example/series.jpg')]);
  const unexpectedImage = setup({ lampa: { tmdb: { image() { return {}; } } } });
  assert.ok(unexpectedImage.posters().every(url => url === 'https://kp.example/series.jpg'));
});

test('missing or invalid IDs and incomplete Lampa metadata APIs safely retain the season page', () => {
  for (const imdb of [undefined, '', 0, 'tt0', 'not-an-id', '1/../../private']) {
    const { calls, posters } = setup({ item: { imdb } }); assert.equal(calls.length, 0); assert.equal(posters().length, 3);
  }
  for (const lampa of [{ api: {} }, { api: { sources: {} } }, { api: { sources: { tmdb: {} } } }, { tmdb: null }, { tmdb: {} }]) {
    const { calls, posters } = setup({ lampa }); assert.equal(calls.length, 0); assert.equal(posters().length, 3);
  }
  assert.equal(setup({ item: { imdb: 'tt12345678' } }).calls[0].method, 'find/tt12345678?external_source=imdb_id');
});

test('failed, missing, ambiguous and malformed metadata never prevent season selection', () => {
  for (const found of [null, {}, { tv_results: [] }, { tv_results: [null] }, { tv_results: [{ id: 1 }, { id: 2 }] }, { tv_results: [{ id: 'bad/path' }] }]) {
    const { calls, posters } = setup({ find(success) { success(found); } }); assert.equal(calls.length, 1); assert.equal(posters().length, 3);
  }
  for (const show of [null, {}, { seasons: {} }]) assert.equal(setup({ show(success) { success(show); } }).posters().length, 3);
  for (const find of [(_success, failure) => failure(), () => { throw new Error('unsupported adapter'); }]) assert.equal(setup({ find }).posters().length, 3);
  assert.equal(setup({ show(_success, failure) { failure(); } }).posters().length, 3);
});

test('slow artwork is bounded and late callbacks cannot replace a rendered season page', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let find;
  const first = setup({ find(success) { find = success; } });
  assert.equal(first.h.loading, true);
  t.mock.timers.tick(2500); assert.equal(first.posters().length, 3);
  find({ tv_results: [{ id: 4556 }] }); assert.equal(first.calls.length, 1);
  let show;
  const second = setup({ show(success) { show = success; } });
  t.mock.timers.tick(2500); const cards = second.h.pageCards();
  show({ seasons: [{ season_number: 1, poster_path: '/late.jpg' }] });
  assert.deepEqual(second.h.pageCards(), cards);
});
