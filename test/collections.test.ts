import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  harness,
  video,
  type MockReply,
  type MockRequest,
  type Harness
} from './support/lampa.js';
import type { MockItem, MockRoute } from './support/lampa.js';

const collection: MockItem = {
  id: 19,
  title: 'Освобождение: киноэпопея',
  watchers: 55,
  views: 1000,
  posters: { big: 'http://cdn.example/collection.jpg' }
};
const film: MockItem = {
  id: 7,
  title: 'Освобождение',
  type: 'movie',
  year: 1970
};
function setup(respond?: (request: MockRequest) => MockReply) {
  return harness({
    native: true,
    catalogMenu: true,
    respond:
      respond ||
      ((req) => {
        const url = new URL(req.url);
        if (url.pathname === '/v1/items') return { items: [] };
        if (url.pathname === '/v1/collections')
          return { items: [collection], pagination: { total: 2 } };
        if (url.pathname === '/v1/collections/view')
          return { collection, items: [film] };
        if (url.pathname === '/v1/items/7')
          return { item: { ...film, videos: [video()] } };
        throw new Error('Unexpected request: ' + url.pathname);
      })
  });
}
const open = (h: Harness, route: MockRoute = {}) =>
  h.Lampa.Activity.push({
    component: 'kinolamp',
    kp_view: 'catalog',
    kp_section: 'collections',
    ...route
  });

test('collections open from KinoPub, show safe posters and counts, and open films with native Back', () => {
  const h = setup();
  h.menuButton.run();
  h.pageAction('Подборки');
  assert.equal(new URL(h.requests.at(-1)!.url).pathname, '/v1/collections');
  assert.equal(
    new URL(h.requests.at(-1)!.url).searchParams.get('sort'),
    'created-'
  );
  assert.equal(h.pageCards()[0].children[1].value, collection.title);
  assert.ok(h.nodes.some((n) => n.value === '✓ 55'));
  assert.ok(h.nodes.some((n) => n.value === '◉ 1000'));
  assert.ok(
    h.nodes.some(
      (n) => n.attributes?.src === 'https://cdn.example/collection.jpg'
    )
  );
  assert.equal(h.pageCards()[0].handlers['hover:long'], undefined);
  assert.equal(
    h.pageActions().some((n) => n.value === 'Фильтры'),
    false
  );
  h.openCard(0);
  assert.equal(h.routes.at(-1)!.kp_collection, 19);
  assert.equal(new URL(h.requests.at(-1)!.url).searchParams.get('id'), '19');
  assert.ok(h.nodes.some((n) => n.value === 'KinoPub · ' + collection.title));
  h.openCard(0);
  assert.equal(h.plays.length, 1);
  h.Lampa.Activity.backward();
  assert.equal(h.pageCards()[0].children[1].value, collection.title);
  assert.equal(JSON.stringify(h.routes).includes('test-access'), false);
});

test('collection sorts and infinite loading use documented API parameters and preserve the selected sort', () => {
  const h = setup();
  open(h, { kp_sort: '__proto__', kp_genre: 10, kp_quality: 3 });
  for (const [title, sort] of [
    ['Популярные', 'watchers-'],
    ['Просматриваемые', 'views-'],
    ['Новые', 'created-']
  ]) {
    h.pageAction(title);
    const url = new URL(h.requests.at(-1)!.url);
    assert.equal(url.searchParams.get('sort'), sort);
    assert.equal(url.searchParams.has('genre'), false);
    assert.equal(url.searchParams.has('quality[]'), false);
    h.scrolls.at(-1)!.onEnd();
    assert.equal(
      new URL(h.requests.at(-1)!.url).searchParams.get('sort'),
      sort
    );
    assert.equal(new URL(h.requests.at(-1)!.url).searchParams.get('page'), '2');
  }
});

test('collection contents are sliced locally without dropping items or duplicating route history', () => {
  const h = setup(() => ({
    collection,
    items: Array.from({ length: 23 }, (_, id) => ({ ...film, id }))
  }));
  open(h, { kp_section: 'collection', kp_collection: 19 });
  assert.equal(h.pageCards().length, 20);
  const card = h.pageCards()[0];
  h.scrolls.at(-1)!.onEnd();
  assert.equal(h.pageCards().length, 23);
  assert.equal(h.pageCards()[0], card);
  assert.equal(h.routes.length, 1);
  assert.equal(new URL(h.requests.at(-1)!.url).search, '?id=19');
});

test('collection missing posters, metadata, empty responses and server errors remain usable', () => {
  for (const posters of [
    undefined,
    {},
    { small: 'https://cdn.example/s.jpg' },
    { medium: 'https://cdn.example/m.jpg' }
  ]) {
    const h = setup(() => ({
      items: [{ id: 1, title: '<img onerror=alert(1)>', posters }]
    }));
    open(h);
    assert.equal(h.pageCards()[0].children[1].value, '<img onerror=alert(1)>');
    assert.ok(h.nodes.some((n) => n.value === '✓ 0'));
    assert.ok(h.nodes.some((n) => n.value === '◉ 0'));
  }
  for (const section of ['collections', 'collection']) {
    const h = setup(() => ({}));
    open(h, { kp_section: section });
    assert.equal(h.pageCards().length, 0);
    assert.ok(
      h.nodes.some((n) =>
        /пока нет материалов|Список подборок пуст/.test(n.value)
      )
    );
  }
  const h = setup(() => ({
    failure: true,
    xhr: { status: 503, responseText: '{}' }
  }));
  open(h);
  h.respond = () => ({ items: [collection] });
  h.pageAction('Повторить');
  assert.equal(h.pageCards().length, 1);
});

test('a full collections response without pagination still loads the next page and stops on empty', () => {
  const h = setup((req) => ({
    items:
      new URL(req.url).searchParams.get('page') === '2'
        ? []
        : Array.from({ length: 20 }, (_, id) => ({ ...collection, id }))
  }));
  open(h);
  h.scrolls.at(-1)!.onEnd();
  assert.equal(new URL(h.requests.at(-1)!.url).searchParams.get('page'), '2');
  const count = h.requests.length;
  h.scrolls.at(-1)!.onEnd();
  assert.equal(h.requests.length, count);
});

test('collection toolbar returns to the regular KinoPub catalog', () => {
  const h = setup();
  open(h);
  h.pageAction('Каталог');
  assert.equal(h.routes.at(-1)!.kp_section, 'new');
  assert.equal(new URL(h.requests.at(-1)!.url).pathname, '/v1/items');
});

test('collection cards always reflect the current API response', () => {
  let title = 'First server title';
  const h = setup(() => ({ items: [{ ...collection, title }] }));
  open(h);
  assert.equal(h.pageCards()[0].children[1].value, title);
  title = 'Updated server title';
  open(h);
  assert.equal(h.pageCards()[0].children[1].value, title);
  assert.equal(h.requests.length, 2);
});
