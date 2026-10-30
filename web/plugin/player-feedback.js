// Keep Lampa's player and recovery logic intact; translate only known nonfatal
// HLS messages for Kinolamp playback. Never render arbitrary upstream text.
export function installPlayerFeedback(Lampa) {
  if (
    !Lampa.Player.listener ||
    !Lampa.PlayerVideo ||
    !Lampa.PlayerVideo.listener ||
    !Lampa.PlayerInfo ||
    typeof Lampa.PlayerInfo.set !== 'function'
  ) {
    return;
  }
  var owned = false;
  var messages = {
    bufferFullError:
      'Буфер плеера переполнен. Если видео зависло, перезапусти воспроизведение или смени плеер в настройках Lampa.',
    bufferStalledError: 'Буферизация: плеер ожидает продолжения видео.',
    fragLoadError:
      'Не удалось загрузить фрагмент видео. Плеер повторяет попытку.',
    fragLoadTimeOut:
      'Фрагмент видео загружается слишком долго. Плеер повторяет попытку.'
  };
  Lampa.Player.listener.follow('start', function (work) {
    owned = !!(work && work._kinolampDiagnostic);
  });
  Lampa.Player.listener.follow('destroy', function () {
    owned = false;
  });
  Lampa.PlayerVideo.listener.follow('error', function (event) {
    if (
      !owned ||
      !event ||
      event.fatal !== false ||
      typeof event.error !== 'string'
    ) {
      return;
    }
    var match = event.error.match(/^details \[([a-zA-Z]+)\] fatal \[false\]$/);
    if (match && Object.prototype.hasOwnProperty.call(messages, match[1])) {
      Lampa.PlayerInfo.set('error', messages[match[1]]);
    }
  });
}
