'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../web/static/kp');
const { harness, video } = require('./support/lampa');

test('native page capabilities fall back for older Lampa builds', () => {
  for (const Lampa of [{}, { Component: {} }, { Component: {}, Activity: {} }, { Component: {}, Activity: {}, Scroll() {} }]) {
    assert.equal(plugin.createNativePages(Lampa, null, null, null, null), null);
  }
});

test('search opens a real Activity with safe poster cards and serializable history', () => {
  const h = harness({ native: true });
  h.click();
  assert.equal(h.routes[0].component, 'kinolamp');
  assert.equal(h.routes[0].kp_view, 'search');
  assert.equal(h.routes[0].kp_query, 'Film');
  assert.equal(h.current, undefined);
  assert.equal(h.pageCards().length, 1);
  assert.equal(h.loading, false);
  const card = h.pageCards()[0];
  assert.equal(card.children[1].value, 'Film <unsafe>');
  card.handlers['hover:focus']();
  assert.equal(h.scrollFocus, card);
  h.pages[0].start();
  assert.equal(h.focus, card[0]);
  for (const direction of ['down', 'right']) h.controllers.content[direction]();
  h.controllers.content.up(); h.controllers.content.left();
  assert.ok(h.toggles.includes('head')); assert.ok(h.toggles.includes('menu'));
  h.canMove = true; h.controllers.content.up(); h.controllers.content.left();
  assert.deepEqual(h.moves, ['down', 'right', 'up', 'left']);
  h.openCard(0);
  assert.equal(h.routes[1].kp_view, 'item');
  h.openCard(0);
  assert.equal(h.current.title, 'Качество');
  h.back();
  assert.equal(h.routes.length, 2);
  h.openCard(0); h.select();
  assert.equal(h.plays.length, 1);
  h.controllers.content.back();
  assert.equal(h.pages.length, 1);
  h.pages[0].pause(); h.pages[0].stop();
  const back = h.descendants(h.pages[0].render()).find(node => String(node.input).includes('kp-page__back'));
  back.handlers['hover:enter']();
  assert.equal(h.pages.length, 0);
  assert.equal(h.scrollDestroyed, 2);
});

test('native pages handle empty/error results, safe images and callbacks after destruction', () => {
  const empty = harness({ native: true, respond() { return {}; } });
  empty.click(); assert.equal(empty.pageCards().length, 0);
  assert.ok(empty.nodes.some(node => /Ничего не найдено/.test(node.value)));
  const failed = harness({ native: true, respond() { return { failure: true, xhr: { status: 503, responseText: '{}' } }; } });
  failed.click(); assert.ok(failed.nodes.some(node => /Запрос не выполнен/.test(node.value)));
  const late = harness({ native: true, respond() { return { defer: true }; } });
  late.click(); const page = late.pages[0]; late.Lampa.Activity.backward(); page.start();
  late.callbacks.pop().success({ items: [{ title: 'Late' }] });
  assert.equal(late.nodes.some(node => node.value === 'Late'), false);
  const image = harness({ native: true, respond() { return { items: [{ title: '<unsafe>', posters: { medium: 'https://cdn.example/poster.jpg' } }, { title: 'No poster', posters: { big: 'javascript:alert(1)' } }] }; } });
  image.click();
  const img = image.nodes.find(node => node.attributes?.src);
  assert.equal(img.attributes.src, 'https://cdn.example/poster.jpg');
  img.handlers.error.call(img); assert.equal(img.removed, true);
  assert.equal(image.nodes.filter(node => node.attributes?.src).length, 1);
});

test('native seasons and episode pages retain routes through Back and open the normal player', () => {
  for (const number of [undefined, 0, 2]) {
    const h = harness({ native: true, respond(req) {
      if (req.url.includes('/search')) return { items: [{ id: 7, title: 'Series', year: 2026 }] };
      return { item: { id: 7, title: 'Series', posters: { big: 'https://cdn.example/poster.jpg' }, seasons: [{ number, episodes: [video({ title: '', number: 0 })] }] } };
    } });
    h.click(); h.openCard(0); assert.equal(h.pageCards().length, 1);
    h.openCard(0); assert.equal(h.routes[2].kp_view, 'season');
    assert.equal(h.routes[2].kp_season, 0);
    h.openCard(0); h.select(); assert.equal(h.plays.length, 1);
    h.Lampa.Activity.backward(); assert.equal(h.pages.length, 2);
  }
});

test('item and season pages tolerate unavailable details and empty video lists', () => {
  for (const result of [{}, { failure: true, xhr: { status: 503, responseText: '{}' } }, { item: { title: 'Empty' } }, { item: { title: 'Empty', seasons: [] } }]) {
    const h = harness({ native: true, respond(req) { return req.url.includes('/search') ? { items: [{ id: 7 }] } : result; } });
    h.click(); h.openCard(0); assert.equal(h.pageCards().length, 0);
  }
  const h = harness({ native: true, respond(req) { return req.url.includes('/search') ? { items: [{ id: 7 }] } : { item: { id: 7, title: 'Empty', seasons: [{}] } }; } });
  h.click(); h.openCard(0); h.openCard(0); assert.equal(h.pageCards().length, 0);
});

test('native movie pages provide a fallback video title and stable numbering', () => {
  const h = harness({ native: true, respond(req) { return req.url.includes('/search') ? { items: [{ id: 7 }] } : { item: { id: 7, title: 'Movie', videos: [video({ title: '', number: 2 })] } }; } });
  h.click(); h.openCard(0);
  assert.equal(h.pageCards()[0].children[1].value, 'Видео 2');
});


test('posters use HTTPS and progress labels refresh when returning from playback', () => {
  const h = harness({ native: true, respond(req) {
    if (req.url.includes('/search')) return { items: [{ id: 7, posters: { small: 'http://cdn.example/small.jpg' } }, { id: 8, posters: { medium: {} } }] };
    return { item: { id: 7, title: 'Movie', videos: [video({ thumbnail: 'http://cdn.example/thumbnail.jpg' })] } };
  } });
  h.click(); assert.ok(h.nodes.some(node => node.attributes?.src === 'https://cdn.example/small.jpg'));
  h.openCard(0); assert.ok(h.nodes.some(node => node.attributes?.src === 'https://cdn.example/thumbnail.jpg'));
  const key = plugin.mediaKey({ id: 7 }, video(), { kind: 'part', season: 0, number: 1 });
  h.storage.set('kp_self_progress', { [key]: { time: 95, duration: 200 } });
  h.pages.at(-1).start();
  assert.match(h.pageCards()[0].children[2].value, /Продолжить с 1:35/);
});

test('a native Activity route can be restored after plugin reload without callback registries', () => {
  const first = harness({ native: true }); first.click(); first.openCard(0);
  const route = JSON.parse(JSON.stringify(first.routes[1]));
  const restored = harness({ native: true });
  restored.Lampa.Activity.push(route);
  assert.equal(restored.pageCards().length, 1);
  restored.openCard(0); restored.select();
  assert.equal(restored.plays.length, 1);
});
