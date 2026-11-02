import { test } from 'node:test';
import assert from 'node:assert/strict';
import { harness, type MockReply, type Harness } from './support/lampa.js';

const endpoint = 'https://plugin.example/api/collections/categories';
const group = (id = 'dynamic', title = 'Live category', count = 1) => ({
  id,
  title,
  items: Array.from({ length: count }, (_, i) => ({
    id: 800 + i,
    title: 'Live collection ' + i,
    watchers: '12',
    count: '3',
    views: '1 K',
    posters: { medium: 'https://images.example/poster.jpg' }
  }))
});
function setup(reply: () => MockReply) {
  return harness({
    native: true,
    catalogMenu: true,
    root: {
      document: { currentScript: { src: 'https://plugin.example/kp.js?v=123' } }
    },
    respond(req) {
      if (req.url === endpoint) {
        assert.deepEqual(req.headers, {});
        assert.equal(req.body, false);
        return reply();
      }
      return { items: [] };
    }
  });
}
function open(h: Harness, category?: string) {
  h.Lampa.Activity.push({
    component: 'kinolamp',
    kp_view: 'catalog',
    kp_section: 'collection-categories',
    kp_category: category
  });
}
test('website categories retain live order, titles, cards, and open API collection films', () => {
  const h = setup(() => ({
    categories: [
      group('second', 'Second category'),
      group('first', 'First category', 0)
    ]
  }));
  open(h);
  assert.equal(h.pageCards().length, 1);
  const labels = h.pageActions().map((a) => a.value);
  assert.ok(
    labels.indexOf('✓ Second category · 1') <
      labels.indexOf('First category · 0')
  );
  assert.ok(h.nodes.some((n) => n.value === '◉ 1 K'));
  h.openCard(0);
  assert.equal(h.routes.at(-1)!.kp_collection, 800);
  assert.equal(
    new URL(h.requests.at(-1)!.url).pathname,
    '/v1/collections/view'
  );
  h.Lampa.Activity.backward();
  h.pageAction('First category · 0');
  assert.equal(h.routes.at(-1)!.kp_category, 'first');
  assert.equal(h.pageCards().length, 0);
  h.pageAction('Новые');
  assert.equal(h.routes.at(-1)!.kp_section, 'collections');
  h.pageAction('Категории');
  assert.equal(h.routes.at(-1)!.kp_section, 'collection-categories');
});
test('categories use current upstream results, recover unknown selection, paginate and preserve route', () => {
  let current = group('old', 'Old', 21);
  const h = setup(() => ({ categories: [current] }));
  open(h, 'removed');
  assert.equal(h.pageCards().length, 20);
  h.scrolls.at(-1)!.onEnd();
  assert.equal(h.pageCards().length, 21);
  current = group('new', 'New title', 2);
  open(h);
  assert.equal(h.pageCards().length, 2);
  assert.ok(h.pageActions().some((n) => n.value === '✓ New title · 2'));
});
test('category loading explains unavailable source and missing website login without stale fallback', () => {
  for (const code of ['categories_login_required', 'categories_unavailable']) {
    const h = setup(() => ({
      failure: true,
      xhr: { status: 503, responseText: JSON.stringify({ error: code }) }
    }));
    open(h);
    assert.equal(h.pageCards().length, 0);
    assert.ok(
      h.nodes.some((n) =>
        n.value.includes(
          code === 'categories_login_required' ? 'веб-сессию' : 'Не удалось'
        )
      )
    );
    h.respond = () => ({ categories: [group()] });
    h.pageAction('Повторить');
    assert.equal(h.pageCards().length, 1);
  }
  for (const reply of [
    {},
    { categories: [] },
    { categories: [{ id: 4, title: 'wrong shape', items: [] }] }
  ]) {
    const h = setup(() => reply as MockReply);
    open(h);
    assert.equal(h.pageCards().length, 0);
    assert.ok(
      h.nodes.some((n) => n.value === 'Список категорий kino.watch недоступен.')
    );
  }
  const h = harness({ native: true });
  open(h);
  assert.ok(
    h.nodes.some((n) => n.value.includes('Не удалось загрузить категории'))
  );
});
test('late category replies after logout cannot populate the previous account screen', () => {
  const h = setup(() => ({ defer: true }));
  open(h);
  h.action('logout');
  h.callbacks[0].success({ categories: [group()] });
  assert.equal(h.pageCards().length, 0);
});

test('missing website view count displays zero', () => {
  const category = group();
  category.items[0].views = '';
  category.items[0].watchers = '';
  category.items[0].count = '';
  const h = setup(() => ({ categories: [category] }));
  open(h);
  assert.ok(h.nodes.some((n) => n.value === '◉ 0'));
});
