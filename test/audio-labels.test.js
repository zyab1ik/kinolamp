'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness, video } = require('./support/lampa');
const audios = [
  { index: 2, lang: 'eng', type: { title: 'Оригинал' }, codec: 'aac' },
  { index: 1, lang: 'rus', type: { short_title: 'Дубляж' }, author: { title: 'Студия <тест>' }, codec: 'ac3' }
];
function setup(options = {}) {
  const shown = [];
  const h = harness({ playerPanel: { setTranslate(data) { shown.push(data); } }, ...options });
  h.click(); h.select(); h.select();
  return { h, shown, work: h.plays[0] };
}
function films(audios) { return req => req.url.includes('/search') ? { items: [{ id: 7 }] } : { item: { id: 7, title: 'Film', videos: [video({ audios })] } }; }

test('KinoPub voices label only real native tracks and preserve Tizen-style enabled setters', () => {
  const { h, shown, work } = setup({ respond: films(audios) });
  assert.equal(work.voiceovers, undefined, 'do not fabricate selectable tracks from API metadata');
  const switched = [];
  const tracks = [{ language: 'ru', extra: { channels: 6 } }, { lang: 'en' }];
  tracks.forEach((track, i) => Object.defineProperty(track, 'enabled', { set(value) { switched.push([i, value]); } }));
  const setter = Object.getOwnPropertyDescriptor(tracks[1], 'enabled').set;
  h.videoEvents.emit('tracks', { tracks });
  assert.equal(shown.at(-1).tracks[0].name, 'Дубляж · Студия &lt;тест&gt; · AC3 (Русский)');
  assert.equal(shown.at(-1).tracks[1].name, 'Оригинал (Английский)');
  assert.equal(shown.at(-1).tracks[0].extra, tracks[0].extra);
  assert.equal(Object.getOwnPropertyDescriptor(tracks[1], 'enabled').set, setter);
  tracks[1].enabled = true; assert.deepEqual(switched, [[1, true]]);
  assert.equal(tracks[0].name, undefined, 'native objects must remain unmodified');
  work.translate.subs = [{ language: 'rus' }];
  h.videoEvents.emit('webos_tracks', { tracks: [{ language: 'en-US' }, { language: 'ru_RU' }] });
  assert.match(shown.at(-1).tracks[0].name, /Оригинал/);
  assert.match(shown.at(-1).tracks[1].name, /Дубляж/);
  assert.deepEqual(shown.at(-1).subs, [{ language: 'rus' }]);
  h.videoEvents.emit('tracks', { tracks: [{ language: 'ru' }, { lang: 'en' }, {}] });
  assert.match(shown.at(-1).tracks[0].name, /Дубляж/);
  assert.match(shown.at(-1).tracks[1].name, /Оригинал/);
  assert.equal(shown.at(-1).tracks[2], null);
});

test('missing or ambiguous native tracks are not relabeled as unavailable KinoPub voices', () => {
  const { h, shown } = setup({ respond: films(audios) });
  h.videoEvents.emit('tracks', { tracks: [{}] }); assert.deepEqual(shown.at(-1).tracks, [null]);
  h.videoEvents.emit('tracks', { tracks: [{ language: 'fr' }] }); assert.deepEqual(shown.at(-1).tracks, [null]);
  h.videoEvents.emit('tracks', { tracks: [{ language: 'ru' }] }); assert.match(shown.at(-1).tracks[0].name, /Дубляж/);
  h.videoEvents.emit('tracks', { tracks: [{ language: 'ru' }, { language: 'ru' }, { language: 'ru' }] }); assert.deepEqual(shown.at(-1).tracks, [null, null, null]);
  const mixed = setup({ respond: films([{ lang: 'rus' }, { lang: 'rus' }]) });
  mixed.h.videoEvents.emit('tracks', { tracks: [{ language: 'rus' }] }); assert.deepEqual(mixed.shown.at(-1).tracks, [null]);
  mixed.h.videoEvents.emit('tracks', { tracks: [{ language: 'und' }, {}] }); assert.equal(mixed.shown.at(-1).tracks.length, 2);
  const missingLanguage = setup({ respond: films([{}]) });
  missingLanguage.h.videoEvents.emit('tracks', { tracks: [{ language: 'ja' }] }); assert.equal(missingLanguage.shown.at(-1).tracks[0].name, 'Дорожка 1');
});

test('label events are scoped to the current player lifecycle and tolerate older Lampa APIs', () => {
  const { h, shown } = setup();
  for (const event of [undefined, {}, { tracks: {} }, { tracks: [] }]) h.videoEvents.emit('tracks', event);
  assert.equal(shown.length, 0);
  h.playerEvents.emit('destroy'); h.videoEvents.emit('tracks', { tracks: [{}] }); assert.equal(shown.length, 0);
  for (const work of [undefined, {}, { _kinolampAudios: {} }]) { h.playerEvents.emit('start', work); h.videoEvents.emit('tracks', { tracks: [{}] }); }
  assert.equal(shown.length, 0);
  for (const options of [{ playerPanel: {} }, { playerPanel: { setTranslate: true } }, { noPlayerListener: true }, { noPlayerVideo: true }, { noVideoListener: true }]) harness({ playerPanel: { setTranslate() { assert.fail(); } }, ...options });
});

test('proxy labels the selected voice only, and media-links metadata fills an empty episode audio list', () => {
  const storage = { kp_self_proxy_enabled: true, kp_self_proxy_url: 'https://plugin.example', kp_self_proxy_token: 'x'.repeat(64) };
  const h = harness({ storage, playerPanel: { setTranslate(data) { h.labels = data; } } });
  const normal = h.respond;
  h.respond = req => req.url.includes('/v1/items/7') ? { item: { id: 7, videos: [video({ audios })] } } : normal(req);
  h.click(); h.select(); h.select(); h.select(0);
  assert.equal(h.work._kinolampAudios.length, 1);
  h.videoEvents.emit('tracks', { tracks: [{ language: 'eng' }] }); assert.match(h.labels.tracks[0].name, /Оригинал/);
  const empty = setup({ respond: films([]) }); empty.h.videoEvents.emit('tracks', { tracks: [{}] }); assert.deepEqual(empty.shown.at(-1).tracks, [null]);
  const links = setup({ respond(req) {
    if (req.url.includes('/search')) return { items: [{ id: 7 }] };
    if (req.url.includes('/media-links')) return video({ audios });
    return { item: { id: 7, videos: [video({ files: [], audios: [] })] } };
  } });
  links.h.videoEvents.emit('tracks', { tracks: [{ language: 'ru' }, { language: 'en' }] });
  assert.match(links.shown.at(-1).tracks[0].name, /Дубляж/);
});

test('next-episode playback receives that episode audio metadata rather than stale voice labels', () => {
  const item = { id: 7, title: 'Series', seasons: [{ number: 1, episodes: [
    video({ id: 77, number: 1, audios: [{ lang: 'rus', author: { title: 'Студия первого эпизода' } }] }),
    video({ id: 78, number: 2, audios: [{ lang: 'rus', author: { title: 'Студия второго эпизода' } }] })
  ] }] };
  let labels;
  const h = harness({ native: true, playerPanel: { setTranslate(data) { labels = data; } }, respond() { return { item }; } });
  h.Lampa.Activity.push({ component: 'kinolamp', kp_view: 'season', kp_id: 7, kp_season: 0 });
  h.openCard(0); h.videoEvents.emit('tracks', { tracks: [{ language: 'ru' }] });
  assert.match(labels.tracks[0].name, /первого эпизода/);
  h.next(); h.videoEvents.emit('tracks', { tracks: [{ language: 'ru' }] });
  assert.equal(h.plays.length, 2);
  assert.match(labels.tracks[0].name, /второго эпизода/);
});
