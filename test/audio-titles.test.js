'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { audioTitle } = require('../web/static/kp');

test('WALL-E voice names expand abbreviations and keep codec distinctions', () => {
  const voices = [
    ['rus', 'DUB', 'BD CEE', 'aac', 'Дубляж · BD CEE (Русский)'],
    ['rus', 'MVO', 'С.Р.И.', 'aac', 'Многоголосый · С.Р.И. (Русский)'],
    ['rus', 'AVO', 'Ю. Сербин', 'aac', 'Авторский · Ю. Сербин (Русский)'],
    ['ukr', 'DUB', 'iTunes', 'aac', 'Дубляж · iTunes (Украинский)'],
    ['eng', 'Orig', '', 'aac', 'Оригинал (Английский)'],
    ['eng', 'Orig', '', 'aac', 'Оригинал (Английский)'],
    ['rus', 'DUB', '', 'ac3', 'Дубляж · AC3 (Русский)']
  ];
  voices.forEach(([lang, type, author, codec, expected], index) => {
    assert.equal(audioTitle({ lang, type: { short_title: type }, author: { title: author }, codec }, index), expected);
  });
});

test('voice names prefer full API descriptions and preserve unknown metadata', () => {
  assert.equal(audioTitle({ type: { title: 'Профессиональный многоголосый', short_title: 'MVO' }, lang: 'RU', codec: 'AAC' }, 0), 'Профессиональный многоголосый (Русский)');
  assert.equal(audioTitle({ type: { short_title: 'DVO' }, lang: 'uk' }, 0), 'Двухголосый (Украинский)');
  assert.equal(audioTitle({ type: { short_title: 'VO' }, lang: 'en' }, 0), 'Одноголосый (Английский)');
  assert.equal(audioTitle({ lang: 'pol', type: { title: 'Commentary' }, codec: 'dts' }, 0), 'Commentary · DTS (POL)');
  assert.equal(audioTitle({ lang: 'ja', type: {} }, 1), 'Дорожка 2 (Японский)');
  assert.equal(audioTitle({}, 2), 'Дорожка 3');
});
