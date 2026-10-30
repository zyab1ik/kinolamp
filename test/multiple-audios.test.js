'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../web/static/kp');
const { harness, video } = require('./support/lampa');

const audios = [
  { index: 1, lang: 'rus', author: { title: 'LE-Production' } },
  { index: 2, lang: 'eng', type: { title: 'Оригинал' } }
];

test('multiple voices use HLS4 at every quality without mixing single-audio streams', () => {
  const files = [...video().files,
    { quality: '480p', url: { hls2: 'https://cdn.example/480' } },
    { quality: '360p', urls: { hls4: 'http://cdn.example/360' } },
    {}
  ];
  const streams = plugin.streams(files, false, 1080, true);
  assert.deepEqual(streams.map(s => [s.height, s.format]), [[1080, 'hls4'], [720, 'hls4']]);
  assert.deepEqual(plugin.streams(files, false, 720, true).map(s => s.height), [720]);
  assert.equal(plugin.streams(files, false, 480, true)[0].height, 720);
  for (const missing of [null, []]) assert.deepEqual(plugin.streams(missing, false, 1080, true), []);
  assert.deepEqual(plugin.streams([{}], false, 1080, true), []);
  const legacy = [{ url: { hls4: 'http://cdn.example/unsafe', hls2: 'https://cdn.example/legacy' } }];
  assert.equal(plugin.streams(legacy, false, 1080, true)[0].format, 'hls2');
  assert.deepEqual(plugin.streams(legacy, true, 1080, true), []);
});

test('Watch passes multi-audio streams to the native player and preserves real audio handles', () => {
  let translated;
  const h = harness({ native: true, playerPanel: { setTranslate(value) { translated = value; } }, respond(req) {
    return req.url.includes('/search')
      ? { items: [{ id: 7, title: 'Film', year: 2026, type: 'movie' }] }
      : { item: { id: 7, title: 'Film', videos: [video({ audios })] } };
  } });
  h.click({ title: 'Film', year: 2026 });
  assert.equal(h.plays.length, 1);
  assert.equal(h.work.url, 'https://edge.cdn.example/hls4/master');
  assert.deepEqual(h.work.quality, { '1080p': h.work.url, '720p': 'https://edge.cdn.example/hls4/720' });
  assert.equal(h.work.voiceovers, undefined);
  const tracks = [{ language: 'rus' }, { language: 'eng' }];
  let selected;
  Object.defineProperty(tracks[1], 'enabled', { set(value) { selected = value; } });
  h.videoEvents.emit('tracks', { tracks });
  assert.match(translated.tracks[0].name, /LE-Production/);
  assert.match(translated.tracks[1].name, /Оригинал/);
  tracks[1].enabled = true;
  assert.equal(selected, true);
  assert.equal(h.requests.some(req => req.url.endsWith('/api/manifests')), false);
});

test('episode transitions and media-links keep multi-audio HLS4 within the quality limit', () => {
  const item = { id: 7, title: 'Series', seasons: [{ number: 11, episodes: [
    video({ id: 77, number: 6, audios }),
    video({ id: 78, number: 7, files: [], audios: [] })
  ] }] };
  const h = harness({ native: true, storage: { kp_self_quality: 720 }, respond(req) {
    return req.url.includes('/media-links') ? video({ audios }) : { item };
  } });
  h.Lampa.Activity.push({ component: 'kinolamp', kp_view: 'season', kp_id: 7, kp_season: 0 });
  h.openCard(0);
  assert.equal(h.work.season, 11);
  assert.equal(h.work.episode, 6);
  assert.equal(h.work.url, 'https://edge.cdn.example/hls4/720');
  h.next();
  assert.equal(h.work.episode, 7);
  assert.equal(h.work.url, 'https://edge.cdn.example/hls4/720');
  assert.equal(h.work._kinolampAudios.length, 2);
  assert.equal(h.requests.filter(req => req.url.includes('/media-links')).length, 1);
});
