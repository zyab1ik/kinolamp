'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../web/static/kp');
const { harness, video } = require('./support/lampa');
const item = { id: 7, title: 'Film <unsafe>', year: 2026, type: 'movie', quality: 1080, posters: { small: 'http://cdn.example/poster.jpg' } };
function catalog(options = {}) {
  return harness({ native: true, catalogMenu: true, keyboard: true, respond(req) {
    const path = new URL(req.url).pathname;
    if (path === '/v1/items') return { items: [item], pagination: { total: 2 } };
    if (path === '/v1/items/search') return { items: [item], pagination: { total: 2 } };
    if (path === '/v1/items/7') return { item: { ...item, videos: [video()] } };
    if (path === '/v1/genres') return [{ id: 10, title: 'Драма' }];
    if (path === '/v1/references/video-quality') return { items: [{ id: 3, title: '1080p' }] };
    if (path === '/v1/bookmarks') return { items: [{ id: 1, title: 'Любимое', count: 1 }] };
    if (path === '/v1/bookmarks/1') return { folder: { title: 'Любимое' }, items: [item] };
    if (path === '/v1/bookmarks/get-item-folders') return { folders: [] };
    if (path.startsWith('/v1/bookmarks/')) return {};
    throw new Error('Unexpected catalog request: ' + path);
  }, ...options });
}
function open(h, route = {}) { h.Lampa.Activity.push({ component: 'kinolamp', kp_view: 'catalog', ...route }); }
function long(h) { h.pageCards()[0].handlers['hover:long'](); }

test('catalog has its own native menu entry, safe cards and native player; unsupported builds and login are clear', () => {
  const h = catalog(); h.menuButton.run();
  assert.equal(h.menuButton.title, 'KinoPub'); assert.equal(h.routes[0].kp_section, 'new');
  assert.match(h.menuButton.icon, /fill="currentColor"/);
  assert.match(h.menuButton.icon, /viewBox="0 0 128 128"/);
  assert.notEqual(h.menuButton.icon, h.component.icon, 'catalog uses the KinoPub mark; settings keep the Kinolamp logo');
  assert.equal(new URL(h.requests.at(-1).url).searchParams.get('sort'), 'created-');
  assert.equal(h.pageCards()[0].children[1].value, item.title);
  assert.equal(h.pageCards()[0].children[2].value, '2026 · Фильм · 1080p');
  assert.ok(h.nodes.some(node => node.attributes?.src === 'https://cdn.example/poster.jpg'));
  const action = h.pageActions()[0]; action.handlers['hover:focus'](); assert.equal(h.scrollFocus, action);
  h.openCard(0); assert.equal(h.plays.length, 1); assert.equal(h.menus.length, 0);
  assert.equal(JSON.stringify(h.routes).includes('test-access'), false);
  for (const options of [{}, { emptyMenu: true }]) { const old = harness(options); old.action('catalog'); assert.match(old.notices.at(-1), /обнови Lampa/); }
  const loggedOut = catalog({ storage: { kp_self_access: '' } }); loggedOut.action('catalog');
  assert.equal(loggedOut.settingsPage, 'kp_self'); assert.equal(loggedOut.requests.length, 0);
  const early = catalog({ root: { appready: false } }); assert.equal(early.menuButton, undefined);
  early.listeners.app(); early.listeners.app({ type: 'start' }); assert.equal(early.menuButton, undefined);
  early.listeners.app({ type: 'ready' }); early.listeners.app({ type: 'ready' });
  assert.equal(early.nodes.filter(n => n.attributes?.['data-action'] === 'kinolamp').length, 1);
});

test('catalog sections, filters and pagination preserve serializable query state', () => {
  const h = catalog(); h.action('catalog');
  h.pageAction('Фильмы'); assert.equal(new URL(h.requests.at(-1).url).searchParams.get('type'), 'movie');
  h.pageAction('Сериалы'); assert.equal(new URL(h.requests.at(-1).url).searchParams.get('type'), 'serial');
  h.pageAction('Фильтры'); h.select(0); h.select(1);
  assert.equal(new URL(h.requests.at(-1).url).searchParams.get('genre'), '10');
  h.pageAction('Фильтры'); h.select(1); h.select(1);
  assert.equal(new URL(h.requests.at(-1).url).searchParams.get('quality[]'), '3');
  h.pageAction('Следующая страница →'); assert.equal(h.routes.at(-1).kp_page, 2);
  assert.equal(h.routes.at(-1).kp_genre_title, 'Драма'); assert.equal(h.routes.at(-1).kp_quality_title, '1080p');
  h.pageAction('← Предыдущая страница'); assert.equal(h.routes.at(-1).kp_page, 1);
  h.pageAction('Фильтры'); h.select(0); h.select(0); assert.equal(h.routes.at(-1).kp_genre, '');
  h.pageAction('Фильтры'); h.select(2); assert.equal(h.routes.at(-1).kp_quality, '');
  h.pageAction('Новинки'); assert.equal(h.routes.at(-1).kp_section, 'new');
  for (const page of [0, -1, 'invalid', 100000]) open(h, { kp_section: '__proto__', kp_page: page });
  assert.equal(new URL(h.requests.at(-1).url).searchParams.get('page'), '10000');
});

test('independent search uses the native keyboard with cancellation, minimum length and bounded text', () => {
  const h = catalog(); open(h); h.pageAction('Поиск');
  assert.equal(h.keyboard.params.nosave, true); assert.equal(h.keyboard.params.free, true);
  const count = h.routes.length;
  for (const value of [undefined, '', '  ', 'AB']) h.keyboard.done(value);
  assert.equal(h.routes.length, count); assert.match(h.notices.at(-1), /три символа/);
  h.keyboard.done('  Film <unsafe>  '); assert.equal(h.routes.at(-1).kp_query, item.title);
  h.pageAction('Следующая страница →'); assert.equal(new URL(h.requests.at(-1).url).searchParams.get('q'), item.title);
  h.pageAction('Поиск'); assert.equal(h.keyboard.params.value, item.title); h.keyboard.done('x'.repeat(150));
  assert.equal(h.routes.at(-1).kp_query.length, 100);
  h.pageAction('Поиск'); h.Lampa.Activity.backward(); const before = h.routes.length; h.keyboard.done('late'); assert.equal(h.routes.length, before);
  for (const options of [{ keyboard: false }, { keyboard: false, emptyKeyboard: true }]) {
    const old = catalog(options); open(old); old.pageAction('Поиск'); assert.match(old.notices.at(-1), /клавиатура/);
  }
  open(h, { kp_section: 'search' }); assert.equal(new URL(h.requests.at(-1).url).searchParams.get('q'), '');
});

test('bookmark folders and contents are account-backed with local pagination and empty/error states', () => {
  const h = catalog(); open(h); h.pageAction('Избранное');
  assert.equal(h.pageCards()[0].children[1].value, 'Любимое');
  h.openCard(0); assert.equal(h.routes.at(-1).kp_folder, 1);
  h.openCard(0); assert.equal(h.plays.length, 1);
  for (const result of [{}, { items: [{}] }, { items: Array.from({ length: 21 }, (_, id) => ({ id: id + 1, title: 'Folder' })) }]) {
    const folders = catalog({ respond() { return result; } }); open(folders, { kp_section: 'folders' });
    if (result.items?.length === 21) { assert.equal(folders.pageCards().length, 20); folders.pageAction('Следующая страница →'); assert.equal(folders.pageCards().length, 1); }
  }
  const unknown = catalog({ respond() { return { items: [{ id: 7 }] }; } }); open(unknown, { kp_section: 'folder', kp_folder: 1 });
  assert.equal(unknown.pageCards()[0].children[2].value, '');
  const failed = catalog({ respond() { return { failure: true, xhr: { status: 503, responseText: '{}' } }; } });
  open(failed); assert.ok(failed.nodes.some(n => /Запрос не выполнен/.test(n.value)));
  failed.respond = () => ({ items: [] }); failed.pageAction('Повторить'); assert.equal(failed.loading, false);
  assert.ok(failed.nodes.some(n => /Ничего не найдено/.test(n.value)));
});

test('bookmarks are added and removed with explicit POST actions and reload after server success', () => {
  let saved = false;
  const h = catalog(); const normal = h.respond;
  h.respond = req => {
    const path = new URL(req.url).pathname;
    if (path.endsWith('/get-item-folders')) return { folders: saved ? [{ id: '1' }] : [] };
    if (path === '/v1/bookmarks') return { items: [{ id: 1, title: 'Любимое', count: saved ? 1 : 0 }] };
    if (path.endsWith('/add') || path.endsWith('/remove-item')) {
      assert.equal(req.body, 'item=7&folder=1'); assert.equal(req.headers['Content-Type'], 'application/x-www-form-urlencoded');
      saved = path.endsWith('/add'); return { status: 200 };
    }
    if (path === '/v1/bookmarks/1') return { folder: { title: 'Любимое' }, items: saved ? [item] : [] };
    return normal(req);
  };
  open(h); long(h); assert.match(h.current.items[0].title, /Добавить/); h.select(); assert.equal(saved, true);
  h.pageAction('Избранное'); h.openCard(0); assert.equal(h.pageCards().length, 1);
  long(h); assert.match(h.current.items[0].title, /Удалить/); h.select(); assert.equal(saved, false);
  assert.equal(h.pageCards().length, 0); assert.match(h.notices.at(-1), /Удалено/);
  h.Lampa.Activity.backward();
  assert.equal(h.pageCards()[0].children[2].value, 'Материалов: 0');
});

test('the empty account can explicitly create its first folder, while errors never report false success', () => {
  for (const mode of ['ok', 'folders', 'memberships', 'create', 'missing-folder', 'missing-id', 'add']) {
    const h = catalog(); const normal = h.respond;
    h.respond = req => {
      const path = new URL(req.url).pathname;
      if (path === '/v1/bookmarks') return mode === 'folders' ? { error: 'unavailable' } : {};
      if (path.endsWith('/get-item-folders')) return mode === 'memberships' ? { error: 'unavailable' } : {};
      if (path.endsWith('/create')) return mode === 'create' ? { error: 'unavailable' } : mode === 'missing-folder' ? {} : { folder: mode === 'missing-id' ? {} : { id: 1 } };
      if (path.endsWith('/add')) return mode === 'add' ? { error: 'unavailable' } : {};
      return normal(req);
    };
    open(h); long(h);
    if (mode === 'folders' || mode === 'memberships') { assert.match(h.notices.at(-1), /Запрос не выполнен/); continue; }
    assert.match(h.current.items[0].title, /Создать папку/); h.select();
    assert.match(h.notices.at(-1), mode === 'ok' ? /Добавлено/ : mode === 'add' ? /Запрос не выполнен/ : /Не удалось создать/);
  }
});

test('late catalog reloads, filters and bookmark requests cannot update a destroyed or replaced page', () => {
  const h = catalog({ respond() { return { defer: true }; } }); open(h);
  h.pages.at(-1).create(); h.callbacks[0].success({ items: [item] }); assert.equal(h.pageCards().length, 0);
  h.callbacks[1].success({ items: [item] }); assert.equal(h.pageCards().length, 1);
  const button = h.pageActions()[0]; h.Lampa.Activity.backward(); const routes = h.routes.length;
  button.handlers['hover:enter'](); assert.equal(h.routes.length, routes);
  for (const stage of ['folders', 'memberships', 'create', 'add', 'filters']) {
    const h = catalog(); const normal = h.respond;
    h.respond = req => {
      const path = new URL(req.url).pathname;
      if (stage === 'folders' && path === '/v1/bookmarks' || stage === 'memberships' && path.endsWith('/get-item-folders') || stage === 'create' && path.endsWith('/create') || stage === 'add' && path.endsWith('/add') || stage === 'filters' && path.endsWith('/genres')) return { defer: true };
      if (stage === 'create' && path === '/v1/bookmarks') return {};
      return normal(req);
    };
    open(h);
    if (stage === 'filters') { h.pageAction('Фильтры'); h.select(0); }
    else { long(h); if (stage === 'create' || stage === 'add') h.select(); }
    h.Lampa.Activity.backward(); const calls = h.requests.length;
    h.callbacks.pop().success({ items: [], folder: { id: 1 }, folders: [] });
    assert.equal(h.requests.length, calls); assert.deepEqual(h.notices, []);
  }
  for (const create of [true, false]) {
    const h = catalog(); if (create) { const normal = h.respond; h.respond = req => new URL(req.url).pathname === '/v1/bookmarks' ? {} : normal(req); }
    open(h); long(h); const action = h.current.items[0].run; h.Lampa.Activity.backward(); const count = h.requests.length; action(); assert.equal(h.requests.length, count);
  }
  const filters = catalog(); open(filters); filters.pageAction('Фильтры'); filters.select(0); const select = filters.current.items[1].run; filters.Lampa.Activity.backward(); const before = filters.routes.length; select(); assert.equal(filters.routes.length, before);
});

test('filter reference failures and empty dictionary results remain usable', () => {
  for (const response of [{ error: 'unavailable' }, {}]) {
    const h = catalog(); const normal = h.respond; h.respond = req => new URL(req.url).pathname === '/v1/genres' ? response : normal(req);
    open(h); h.pageAction('Фильтры'); h.select(0);
    if (response.error) assert.match(h.notices.at(-1), /Запрос не выполнен/);
    else assert.equal(h.current.items.length, 1);
  }
  const h = catalog(); const pages = plugin.createNativePages(h.Lampa, h.$, h.navigation, (_route, done) => done(null, { title: 'Empty', rows: [] }), () => {});
  pages.refresh(); assert.equal(pages.current(), null);
});

test('cached background pages cannot steal focus or activate old controls when a delayed response arrives', () => {
  const h = catalog({ respond() { return { defer: true }; } });
  open(h); const previous = h.pages[0];
  open(h, { kp_section: 'movies' });
  let toggled = false; previous.activity.toggle = () => { toggled = true; };
  h.callbacks[0].success({ items: [item] });
  assert.equal(toggled, false);
  const oldNodes = h.descendants(previous.render()); const calls = h.requests.length;
  oldNodes.find(n => String(n.input).includes('kp-page__action')).handlers['hover:enter']();
  const card = oldNodes.find(n => String(n.input).includes('kp-page__card selector'));
  card.handlers['hover:enter'](); card.handlers['hover:long']();
  assert.equal(h.requests.length, calls); assert.equal(h.plays.length, 0);
  h.callbacks[1].success({ items: [] });
  assert.equal(h.pageCards().length, 0);
  const logout = catalog(); open(logout, { kp_section: 'folders' });
  assert.equal(logout.pageCards().length, 1); logout.action('logout'); logout.pages.at(-1).start();
  assert.equal(logout.pageCards().length, 0);
  assert.ok(logout.nodes.some(node => /Нужна авторизация/.test(node.value)));
});
