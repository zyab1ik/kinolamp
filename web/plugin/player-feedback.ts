import type { Lampa } from './contracts.js';

// Own only the status text for Kinolamp. Lampa keeps playback and HLS recovery.
export function installPlayerFeedback(Lampa: Lampa) {
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
  var session = 0;
  var waiting = false;
  var longWait = false;
  var position: number | null = null;
  var warningTimer: number | undefined;
  var writeTimer: number | undefined;
  var recoverable = [
    'bufferFullError',
    'bufferStalledError',
    'fragLoadError',
    'fragLoadTimeOut'
  ];

  function cancel() {
    clearTimeout(warningTimer);
    clearTimeout(writeTimer);
    waiting = false;
    longWait = false;
  }
  function write(message: string) {
    clearTimeout(writeTimer);
    var expected = session;
    // PlayerInfo may subscribe after us and write raw HLS text synchronously.
    // Defer our text until all native handlers have finished without editing
    // the event that diagnostics and the recovery engine still need.
    writeTimer = setTimeout(function () {
      if (owned && session === expected) {
        Lampa.PlayerInfo.set('error', message);
      }
    }, 0);
  }
  function showWaiting() {
    if (!owned) {
      return;
    }
    if (!waiting) {
      waiting = true;
      var expected = session;
      warningTimer = setTimeout(function () {
        if (owned && waiting && session === expected) {
          longWait = true;
          write('Видео не загружается. Попробуйте повторить воспроизведение.');
        }
      }, 15000);
    }
    write(
      longWait
        ? 'Видео не загружается. Попробуйте повторить воспроизведение.'
        : 'Загрузка видео…'
    );
  }
  function resumed() {
    if (owned && waiting) {
      cancel();
      write('');
    }
  }
  Lampa.Player.listener.follow('start', function (work) {
    cancel();
    session++;
    position = null;
    owned = !!(work && work._kinolampDiagnostic);
  });
  Lampa.Player.listener.follow('destroy', function () {
    cancel();
    session++;
    position = null;
    owned = false;
  });
  Lampa.PlayerVideo.listener.follow('waiting', showWaiting);
  Lampa.PlayerVideo.listener.follow('stalled', showWaiting);
  Lampa.PlayerVideo.listener.follow('playing', resumed);
  Lampa.PlayerVideo.listener.follow('pause', resumed);
  Lampa.PlayerVideo.listener.follow('ended', resumed);
  Lampa.PlayerVideo.listener.follow('timeupdate', function (event) {
    if (
      !owned ||
      !event ||
      typeof event.current !== 'number' ||
      !isFinite(event.current) ||
      event.current < 0
    ) {
      return;
    }
    // Some native TV players report progress but omit a resumed/playing event.
    // A repeated timestamp is not evidence that playback has recovered.
    if (position !== null && event.current > position) {
      resumed();
    }
    position = event.current;
  });
  Lampa.PlayerVideo.listener.follow('error', function (event) {
    if (!owned || !event) {
      return;
    }
    if (event.fatal === true) {
      // A delayed buffering message must not overwrite a native fatal error.
      cancel();
      return;
    }
    if (event.fatal !== false || typeof event.error !== 'string') {
      return;
    }
    var match = event.error.match(/^details \[([a-zA-Z]+)\] fatal \[false\]$/);
    if (match && recoverable.indexOf(match[1]) !== -1) {
      showWaiting();
    }
  });
}
