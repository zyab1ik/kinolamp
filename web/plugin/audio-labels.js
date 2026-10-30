import { audioTitle } from './media.js';
import { escapeText } from './text.js';

function language(value) {
  var code = String(value || '')
    .toLowerCase()
    .replace(/[^a-z].*$/, '');
  var aliases = {
    ru: 'rus',
    en: 'eng',
    uk: 'ukr',
    ja: 'jpn',
    de: 'deu',
    ger: 'deu',
    fr: 'fra',
    fre: 'fra',
    es: 'spa',
    it: 'ita',
    ko: 'kor',
    zh: 'zho',
    chi: 'zho'
  };
  return code === 'und' ? '' : aliases[code] || code;
}

// Translate names only. The original native track objects and their enabled
// setters remain owned by Lampa, including Tizen AVPlay and WebOS audio handles.
export function installAudioLabels(Lampa) {
  if (
    !Lampa.Player.listener ||
    !Lampa.PlayerVideo ||
    !Lampa.PlayerVideo.listener ||
    !Lampa.PlayerPanel ||
    typeof Lampa.PlayerPanel.setTranslate !== 'function'
  ) {
    return;
  }
  var current = null;
  Lampa.Player.listener.follow('start', function (work) {
    current = work && Array.isArray(work._kinolampAudios) ? work : null;
  });
  Lampa.Player.listener.follow('destroy', function () {
    current = null;
  });
  function update(event) {
    if (
      !current ||
      !event ||
      !Array.isArray(event.tracks) ||
      !event.tracks.length
    ) {
      return;
    }
    var tracks = event.tracks;
    var audios = current._kinolampAudios.slice();
    if (
      audios.every(function (audio) {
        return Number(audio.index) > 0;
      })
    ) {
      audios.sort(function (a, b) {
        return Number(a.index) - Number(b.index);
      });
    }
    var labels = tracks.map(function (track, position) {
      var lang = language(track.language || track.lang);
      var audio = audios.length === tracks.length ? audios[position] : null;
      if (
        audio &&
        lang &&
        language(audio.lang) &&
        language(audio.lang) !== lang
      ) {
        audio = null;
      }
      if (!audio && lang) {
        var matches = audios.filter(function (candidate) {
          return language(candidate.lang) === lang;
        });
        var nativeMatches = tracks.filter(function (candidate) {
          return language(candidate.language || candidate.lang) === lang;
        });
        if (matches.length === 1 && nativeMatches.length === 1) {
          audio = matches[0];
        }
      }
      // A mismatch is not proof that every API voice exists in this stream.
      // Null keeps Lampa's own label instead of inventing a selectable track.
      return audio
        ? { name: escapeText(audioTitle(audio, position)), extra: track.extra }
        : null;
    });
    var translate = current.translate || {};
    translate.tracks = labels;
    current.translate = translate;
    Lampa.PlayerPanel.setTranslate(translate);
  }
  Lampa.PlayerVideo.listener.follow('tracks', update);
  Lampa.PlayerVideo.listener.follow('webos_tracks', update);
}
