import { escapeText } from './text.js';
import { episodeQueue, mediaKey } from './media.js';

/** Fresh links are resolved only when Lampa selects the next episode. */
export function createEpisodePlaylist(Lampa, client, openVideo, notify) {
  // In-flight episode responses belong to one player lifecycle only.
  var navigation = 0;
  var queueOwner = null;
  if (Lampa.Player.listener) {
    Lampa.Player.listener.follow('create', function () {
      navigation++;
    });
    Lampa.Player.listener.follow('destroy', function () {
      navigation++;
    });
    Lampa.Player.listener.follow('start', function (work) {
      if (queueOwner && work && work._kinolampQueueId === queueOwner.id) {
        queueOwner.entries.forEach(function (entry) {
          if (entry !== work) {
            entry.url = entry._kinolampLoad;
          }
        });
      }
    });
  }

  return function playlist(item, video, work, playback) {
    var entries = [work];
    if (
      playback.context.kind === 'episode' &&
      Lampa.Player.listener &&
      Lampa.Player.close &&
      playback.key
    ) {
      var owner = {
        id: navigation + 1,
        height: playback.height,
        voice: playback.voice,
        current: work,
        video: video,
        loading: false
      };
      queueOwner = owner;
      entries = episodeQueue(item).map(function (entry) {
        var id = mediaKey(item, entry.video, entry.context);
        var target =
          id === playback.key
            ? work
            : {
                title: escapeText(
                  's' +
                    entry.context.season +
                    'e' +
                    entry.context.number +
                    ' · ' +
                    (entry.video.title || '')
                )
              };
        target.season = entry.context.season;
        target.episode = entry.context.number;
        target._kinolampQueueId = owner.id;
        target._kinolampLoad = function (ready) {
          if (owner.loading || queueOwner !== owner) {
            return;
          }
          owner.loading = true;
          var expected = navigation;
          function current() {
            return expected === navigation && queueOwner === owner;
          }
          function failed() {
            owner.loading = false;
            if (current()) {
              Lampa.Player.close();
            }
          }
          client.api(
            '/items/' + encodeURIComponent(item.id),
            { nolinks: 0 },
            function (error, json) {
              if (!current()) {
                owner.loading = false;
                return;
              }
              var next =
                !error &&
                json.item &&
                episodeQueue(json.item).filter(function (candidate) {
                  return (
                    mediaKey(json.item, candidate.video, candidate.context) ===
                    id
                  );
                })[0];
              if (!next) {
                notify(
                  'Следующая серия недоступна. Воспроизведение остановлено.'
                );
                failed();
                return;
              }
              openVideo(json.item, next.video, null, next.context, {
                automatic: true,
                transition: {
                  height: owner.height,
                  voice: owner.voice,
                  fail: failed,
                  valid: current,
                  accept: function (prepared, options) {
                    owner.loading = false;
                    if (!current()) {
                      return;
                    }
                    Object.keys(prepared).forEach(function (key) {
                      target[key] = prepared[key];
                    });
                    owner.current = target;
                    owner.video = next.video;
                    owner.height = options.height;
                    owner.voice = options.voice;
                    ready();
                  }
                }
              });
            }
          );
        };
        if (target !== work) {
          target.url = target._kinolampLoad;
        }
        return target;
      });
      owner.entries = entries;
    }

    return entries;
  };
}
