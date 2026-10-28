'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../web/static/kp');
const { video, harness } = require('./support/lampa');

function show() {
  return { id: 7, title: 'Show', seasons: [
    { number: 1, episodes: [video({ id: 101, number: 1 }), video({ id: 102, number: 2 })] },
    { number: 2, episodes: [video({ id: 201, number: 1 })] }
  ] };
}
function serial(options = {}) {
  const h = harness(options); const base = h.respond;
  h.respond = req => req.url.includes('/v1/items/7') ? { item: show() } : base(req);
  return h;
}
function start(h, quality = 0) { h.click(); h.select(); h.select(); h.select(); h.select(quality); }

test('episode queue sorts seasons and episodes without mutating source data', () => {
  assert.deepEqual(plugin.episodeQueue({}), []);
  assert.equal(plugin.episodeQueue({ seasons: [{ episodes: [{}] }] })[0].context.season, 1);
  const item = { seasons: [{ number: 2, episodes: [{ number: 2 }, { number: 1 }] }, { number: 0, episodes: [{}] }, {}] };
  assert.deepEqual(plugin.episodeQueue(item).map(e => [e.context.season, e.context.number]), [[0, 1], [2, 1], [2, 2]]);
  assert.equal(item.seasons[0].number, 2);
  assert.equal(plugin.voiceIdentity({ lang: 'RUS' }), plugin.voiceIdentity({ lang: 'rus' }));
  assert.notEqual(plugin.voiceIdentity({ lang: 'rus', codec: 'aac' }), plugin.voiceIdentity({ lang: 'rus', codec: 'ac3' }));
  assert.equal(plugin.voiceIdentity({ type: { id: 1 }, author: { id: 2 } }), '["",1,2,""]');
});

test('native next/manual playlist obtains fresh links and carries quality across seasons', () => {
  const h = serial(); start(h, 1);
  assert.equal(h.playlist.length, 3); assert.equal(h.work.episode, 1); assert.equal(h.work.season, 1);
  assert.equal(typeof h.playlist[1].url, 'function');
  h.next(); assert.equal(h.work.episode, 2); assert.equal(h.work.season, 1);
  assert.match(h.work.url, /720/); assert.equal(typeof h.playlist[0].url, 'function');
  h.videoEvents.emit('timeupdate', { current: 123, duration: 1000 });
  h.work.timeline.handler(15, 150, 1000);
  assert.equal(plugin.createProgress(h.storage).get(h.work._kinolampProgress.key).time, 150);
  h.next(); assert.equal(h.work.season, 2); assert.equal(h.work.episode, 1);
  const calls = h.requests.length; h.next(); assert.equal(h.requests.length, calls);
  assert.equal(h.requests.filter(r => r.url.includes('/v1/items/7')).length, 3);
  // Revisiting an already played episode re-arms its resolver rather than reusing a ticket.
  h.playlist[0].url(() => {}); assert.equal(h.requests.filter(r => r.url.includes('/v1/items/7')).length, 4);
});

test('automatic continuation obeys the explicit shared Lampa setting', () => {
  const h = serial(); start(h);
  h.ended(); assert.equal(h.plays.length, 1);
  const param = h.settings.find(s => s.param.name === 'playlist_next'); assert.equal(param.param.default, false);
  assert.match(param.field.description, /Общая настройка/);
  h.storage.set('playlist_next', true); h.ended(); assert.equal(h.plays.length, 2);
  h.videoEvents.emit('error', { fatal: true }); assert.equal(h.plays.length, 2);
  h.Lampa.Player.close(); assert.equal(h.plays.length, 2);
});

test('next proxy ticket is created at selection time and voice follows identity across reordered indices', () => {
  const storage = { kp_self_proxy_enabled: true, kp_self_proxy_url: 'https://plugin.example', kp_self_proxy_token: 'x'.repeat(64) };
  const h = serial({ storage }); const normal = h.respond; let loads = 0;
  h.respond = req => {
    if (req.url.includes('/v1/items/7')) {
      const item = show(); loads++;
      const chosen = { lang: 'eng', index: loads === 1 ? 4 : 7, author: { id: 2 }, codec: 'ac3' };
      item.seasons[0].episodes.forEach(e => { e.audios = loads === 1 ? [e.audios[0], chosen] : [chosen, e.audios[0]]; });
      return { item };
    }
    return normal(req);
  };
  start(h, 1); h.select(1);
  assert.equal(h.requests.filter(r => r.url.endsWith('/api/manifests')).length, 1);
  h.next();
  const posts = h.requests.filter(r => r.url.endsWith('/api/manifests')).map(r => JSON.parse(r.body));
  assert.deepEqual(posts.map(p => [p.voice, p.maxHeight]), [[4, 720], [7, 720]]);
  assert.equal(h.plays.length, 2);
});

test('missing voice falls back visibly, including no-audio and metadata without indices', () => {
  const storage = { kp_self_proxy_enabled: true, kp_self_proxy_url: 'https://plugin.example', kp_self_proxy_token: 'x'.repeat(64) };
  for (const audios of [[], [{ lang: 'other' }]]) {
    const h = serial({ storage }); start(h); h.select(); const normal = h.respond;
    h.respond = req => {
      if (req.url.includes('/v1/items/7')) { const item = show(); item.seasons[0].episodes[1].audios = audios; return { item }; }
      return normal(req);
    };
    h.next(); assert.match(h.notices.at(-1), /озвучка недоступна/); assert.equal(h.plays.length, 2);
  }
  const h = serial({ storage }); const normal = h.respond;
  h.respond = req => {
    if (req.url.includes('/v1/items/7')) { const item = show(); item.seasons[0].episodes[0].audios = []; return { item }; }
    return normal(req);
  };
  start(h); h.next(); assert.equal(h.plays.length, 2);
});

test('failed or missing next item stops the native loader; no retry loop or quality escalation', () => {
  for (const mode of ['api', 'missing', 'files', 'media', 'media-failure', 'quality']) {
    const h = serial(); start(h, 1); const normal = h.respond;
    h.respond = req => {
      if (req.url.includes('/v1/items/7')) {
        if (mode === 'api') return { error: 'unavailable' };
        if (mode === 'missing') return {};
        const item = show(); const next = item.seasons[0].episodes[1];
        if (mode === 'files') next.files = [{}];
        if (mode === 'media' || mode === 'media-failure') delete next.files;
        if (mode === 'quality') next.files = [video().files[0]];
        return { item };
      }
      if (req.url.includes('/media-links') && mode === 'media-failure') return { error: 'unavailable' };
      return normal(req);
    };
    h.next();
    if (mode === 'media') assert.equal(h.plays.length, 2);
    else { assert.equal(h.plays.length, 1); assert.equal(h.closed, true); assert.ok(h.notices.length); }
  }
});

test('closing or replacing playback cancels pending item/media/ticket callbacks', () => {
  for (const phase of ['item', 'media', 'proxy', 'proxy-error']) {
    const proxy = phase.startsWith('proxy');
    const h = serial({ storage: proxy ? { kp_self_proxy_enabled: true, kp_self_proxy_url: 'https://plugin.example', kp_self_proxy_token: 'x'.repeat(64) } : {} });
    start(h); if (proxy) h.select(); const normal = h.respond;
    h.respond = req => {
      if (phase === 'item' && req.url.includes('/v1/items/7')) return { defer: true };
      if (phase === 'media' && req.url.includes('/v1/items/7')) { const item = show(); delete item.seasons[0].episodes[1].files; return { item }; }
      if (phase === 'media' && req.url.includes('/media-links') || proxy && req.url.endsWith('/api/manifests')) return { defer: true };
      return normal(req);
    };
    const calls = h.requests.length; h.next(); h.next(); assert.ok(h.requests.length <= calls + 2);
    h.Lampa.Player.close(); const pending = h.callbacks.pop();
    pending.success(phase === 'item' ? { item: show() } : phase === 'media' ? video() : phase === 'proxy-error' ? {} : { url: 'https://plugin.example/hls/' + 'a'.repeat(64) + '.m3u8' });
    assert.equal(h.plays.length, 1); assert.deepEqual(h.notices, []);
  }
});

test('a replaced queue ignores old resolvers and unsupported players keep single-item playback', () => {
  const h = serial(); start(h); const old = h.playlist[1].url; start(h); const count = h.requests.length;
  old(() => assert.fail('stale resolver called')); assert.equal(h.requests.length, count);
  const limited = serial({ noClose: true }); start(limited); assert.equal(limited.playlist.length, 1);
  const emptyTitle = serial(); const normal = emptyTitle.respond;
  emptyTitle.respond = req => {
    if (req.url.includes('/v1/items/7')) { const item = show(); delete item.seasons[0].episodes[1].title; return { item }; }
    return normal(req);
  };
  start(emptyTitle); assert.equal(emptyTitle.playlist[1].title, 's1e2 · ');
});

test('automatic resume uses local progress without an interactive dialog', () => {
  for (const watched of [false, true]) {
    const h = serial(); const entry = show().seasons[0].episodes[1];
    plugin.createProgress(h.storage).save(plugin.mediaKey(show(), entry, { kind: 'episode', season: 1, number: 2 }), watched ? 1000 : 123, 1000);
    start(h); const count = h.menus.length; h.next(); assert.equal(h.menus.length, count);
    assert.equal(h.work.timeline.time, watched ? 0 : 123);
  }
});
