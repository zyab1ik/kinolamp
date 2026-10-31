import type { Progress, PlaybackState, Work, Lampa } from './contracts.js';
interface ProgressSession {
  work: Work;
  key: string;
  seek: number;
  time: number;
  duration: number;
  ready: boolean;
  savedAt: number;
  waitForSeek?: number;
  ended?: boolean;
}
/** Bridges player lifecycle events to local progress without overwriting a pending seek. */
export function createProgressTracker(Lampa: Lampa, progress: Progress) {
  var session: ProgressSession | null = null;
  var canSaveProgress = !!(
    Lampa.Player.listener &&
    Lampa.PlayerVideo &&
    Lampa.PlayerVideo.listener &&
    Lampa.PlayerVideo.to
  );
  function saveSession(ended: boolean) {
    if (session && session.ready) {
      session.ended = session.ended || ended;
      progress.save(session.key, session.time, session.duration, session.ended);
    }
  }
  if (canSaveProgress) {
    Lampa.Player.listener.follow('create', function () {
      saveSession(false);
      session = null;
    });
    Lampa.Player.listener.follow('start', function (work) {
      saveSession(false);
      session =
        work && work._kinolampProgress
          ? {
              work: work,
              key: work._kinolampProgress.key,
              seek: work._kinolampProgress.time,
              time: 0,
              duration: 0,
              ready: false,
              savedAt: 0
            }
          : null;
    });
    Lampa.PlayerVideo.listener.follow('timeupdate', function (event) {
      if (
        !session ||
        !event ||
        typeof event.current !== 'number' ||
        !isFinite(event.current) ||
        event.current < 0 ||
        typeof event.duration !== 'number' ||
        !isFinite(event.duration) ||
        event.duration <= 0
      ) {
        return;
      }
      if (session.seek > 0) {
        var seek = Math.min(session.seek, Math.max(0, event.duration - 1));
        session.waitForSeek = seek;
        session.seek = 0;
        Lampa.PlayerVideo.to(seek);
        return;
      }
      if (session.waitForSeek && event.current < session.waitForSeek - 2) {
        return;
      }
      session.waitForSeek = 0;
      session.time = event.current;
      session.duration = event.duration;
      session.ready = true;
      if (Date.now() - session.savedAt >= 5000) {
        saveSession(false);
        session.savedAt = Date.now();
      }
    });
    Lampa.PlayerVideo.listener.follow('pause', function () {
      saveSession(false);
    });
    Lampa.PlayerVideo.listener.follow('ended', function () {
      saveSession(true);
    });
    Lampa.Player.listener.follow('destroy', function () {
      saveSession(false);
      session = null;
    });
  }

  function attach(work: Work, playback: PlaybackState) {
    if (canSaveProgress && playback.key) {
      work._kinolampProgress = { key: playback.key, time: playback.time };
      work.timeline = {
        time: playback.time,
        duration: 0,
        percent: 0,
        handler: function (_percent, time, duration) {
          if (
            session &&
            session.work.timeline === work.timeline &&
            session.seek === 0 &&
            session.ready
          ) {
            progress.save(playback.key, time, duration, session.ended);
          }
        }
      };
    }
  }
  function clear() {
    session = null;
  }
  return { supported: canSaveProgress, attach: attach, clear: clear };
}
