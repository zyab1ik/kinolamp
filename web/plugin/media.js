import { httpsURL } from './text.js';
function qualityOf(file) {
  return (
    parseInt(String(file.quality || file.h || '').replace(/[^0-9]/g, ''), 10) ||
    0
  );
}
function streams(files, proxy, maxHeight, multipleAudios) {
  var result = [];
  // HLS2 may expose only the default voice. Keep every quality on HLS4 when
  // KinoPub advertises multiple voices, so Lampa can discover native tracks.
  var useHLS4 =
    proxy ||
    (multipleAudios &&
      (files || []).some(function (file) {
        var urls = file.urls || file.url || {};
        return httpsURL(urls.hls4);
      }));
  (files || []).forEach(function (file) {
    var urls = file.urls || file.url || {};
    var formats = useHLS4 ? ['hls4'] : ['hls2', 'hls', 'hls4', 'http'];
    for (var i = 0; i < formats.length; i++) {
      var url = urls[formats[i]];
      if (httpsURL(url)) {
        result.push({ url: url, height: qualityOf(file), format: formats[i] });
        break;
      }
    }
  });
  result.sort(function (a, b) {
    return b.height - a.height;
  });
  var limited = result.filter(function (s) {
    return !s.height || s.height <= maxHeight;
  });
  return limited.length ? limited : result.slice(-1);
}
function audioTitle(audio, index) {
  return (
    [
      audio.lang,
      audio.type && (audio.type.short_title || audio.type.title),
      audio.author && audio.author.title,
      audio.codec
    ]
      .filter(Boolean)
      .join(' · ') || 'Дорожка ' + (index + 1)
  );
}
function voiceIdentity(audio) {
  return JSON.stringify([
    audio.lang || '',
    (audio.type && (audio.type.id || audio.type.title)) || '',
    (audio.author && (audio.author.id || audio.author.title)) || '',
    audio.codec || ''
  ]).toLowerCase();
}
function episodeQueue(item) {
  var result = [];
  (item.seasons || []).forEach(function (season, seasonIndex) {
    (season.episodes || []).forEach(function (video, episodeIndex) {
      result.push({
        video: video,
        context: {
          kind: 'episode',
          season: season.number === undefined ? seasonIndex + 1 : season.number,
          number: video.number || episodeIndex + 1
        }
      });
    });
  });
  return result.sort(function (a, b) {
    return (
      a.context.season - b.context.season || a.context.number - b.context.number
    );
  });
}

function matchItem(movie, items) {
  function title(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]+/g, ' ')
      .trim();
  }
  var names = [
    movie.title,
    movie.name,
    movie.original_title,
    movie.original_name
  ]
    .map(title)
    .filter(Boolean);
  var year = String(
    movie.release_date || movie.first_air_date || movie.year || ''
  ).slice(0, 4);
  var series = !!movie.first_air_date || movie.media_type === 'tv';
  var exact = (items || []).filter(function (item) {
    if (movie.imdb_id && item.imdb === movie.imdb_id) {
      return true;
    }
    if (!year || String(item.year) !== year) {
      return false;
    }
    if (series ? item.type !== 'serial' : item.type !== 'movie') {
      return false;
    }
    return String(item.title || '')
      .split('/')
      .some(function (part) {
        return names.indexOf(title(part)) !== -1;
      });
  });
  return exact.length === 1 ? exact[0] : null;
}

function mediaKey(item, video, context) {
  if (item.id === undefined || item.id === null) {
    return '';
  }
  return (
    'media:' +
    JSON.stringify([
      String(item.id),
      context.kind,
      context.season,
      String(video.id || video.media_id || context.number)
    ])
  );
}

export {
  streams,
  audioTitle,
  voiceIdentity,
  episodeQueue,
  matchItem,
  mediaKey
};
