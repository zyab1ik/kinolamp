import type {
  Id,
  Action,
  Video,
  Season,
  Item,
  Movie,
  ApiResponse,
  Context,
  Stream,
  PlaybackState,
  PlayOptions,
  Work,
  Route,
  Row,
  PageReply,
  Lampa,
  PlaybackDependencies
} from './contracts.js';

import { createSeasonPosters } from './season-posters.js';
import { createEpisodePlaylist } from './episode-playlist.js';
import { createProgressTracker } from './progress-tracker.js';
import { httpsURL } from './text.js';
import {
  matchItem,
  streams,
  voiceIdentity,
  audioTitle,
  mediaKey
} from './media.js';
/** Owns playback, local progress and the lazy next-episode queue for one installation. */
export function createPlayback(
  Lampa: Lampa,
  dependencies: PlaybackDependencies
) {
  var client = dependencies.client;
  var transport = dependencies.transport;
  var pages = dependencies.pages;
  var progress = dependencies.progress;
  var diagnostics = dependencies.diagnostics;
  var recordSource = dependencies.recordSource;
  var authorization = dependencies.authorization;
  var ui = dependencies.ui;
  var notify = ui.notify;
  var restore = ui.restore;
  var menu = ui.menu;
  var errorMessage = ui.errorMessage;
  var authorized = authorization.authorized;
  var playlist = createEpisodePlaylist(Lampa, client, openVideo, notify);
  var tracker = createProgressTracker(Lampa, progress);
  var loadSeasonPosters = createSeasonPosters(Lampa);

  // Resolve a unique card match before asking the viewer to choose a result!.
  function search(movie: Movie) {
    var query =
      movie.title ||
      movie.name ||
      movie.original_title ||
      movie.original_name ||
      '';
    if (!query) {
      notify('Открой карточку фильма или сериала.');
      return;
    }
    authorized(function () {
      if (
        movie.release_date ||
        movie.first_air_date ||
        movie.year ||
        movie.imdb_id
      ) {
        client.api('/items/search', { q: query }, function (error, json) {
          if (error) {
            notify(errorMessage(error));
            return;
          }
          var match = matchItem(movie, json!.items);
          if (match) {
            openMatchedItem(match.id);
          } else {
            showResults();
          }
        });
        return;
      }
      showResults();
    });
    function showResults() {
      if (pages) {
        pages.show({ view: 'search', query: query });
        return;
      }
      client.api('/items/search', { q: query }, function (error, json) {
        if (error) {
          notify(errorMessage(error));
          return;
        }
        var items = json!.items || [];
        if (!items.length) {
          notify('В KinoPub ничего не найдено.');
          return;
        }
        function results() {
          menu(
            'Результаты KinoPub',
            items.map(function (item) {
              return {
                title: item.title,
                subtitle: [item.year, item.type].filter(Boolean).join(' · '),
                run: function () {
                  openItem(item.id, results);
                }
              };
            })
          );
        }
        results();
      });
    }
  }
  function openMatchedItem(id: Id) {
    client.api(
      '/items/' + encodeURIComponent(id),
      { nolinks: 0 },
      function (error, json) {
        if (error || !json!.item) {
          notify(errorMessage(error));
          return;
        }
        var item = json!.item;
        if (item.seasons && item.seasons.length) {
          if (pages) {
            pages.show({ view: 'item', id: id });
          } else {
            openItem(id, function () {
              restore('full');
            });
          }
        } else if (item.videos && item.videos.length === 1) {
          openVideo(
            item,
            item.videos[0],
            null,
            { kind: 'part', season: 0, number: 1 },
            { automatic: true }
          );
        } else if (pages) {
          pages.show({ view: 'item', id: id });
        } else {
          openItem(id, function () {
            restore('full');
          });
        }
      }
    );
  }
  function openItem(id: Id, back: Action) {
    client.api(
      '/items/' + encodeURIComponent(id),
      { nolinks: 0 },
      function (error, json) {
        if (error) {
          notify(errorMessage(error));
          return;
        }
        var item = json!.item!;
        if (!item) {
          notify('Нет данных о видео.');
          return;
        }
        function seasons() {
          menu(
            item.title,
            item.seasons!.map(function (season, index) {
              return {
                title: 'Сезон ' + (season.number || index + 1),
                run: function () {
                  episodes(season);
                }
              };
            }),
            back
          );
        }
        function episodes(season: Season) {
          menu(
            'Серии',
            (season.episodes || []).map(function (episode, index) {
              var context: Context = {
                kind: 'episode',
                season:
                  season.number === undefined
                    ? item.seasons!.indexOf(season) + 1
                    : season.number,
                number: episode.number || index + 1
              };
              return {
                title:
                  (episode.number || index + 1) +
                  '. ' +
                  (episode.title || 'Серия'),
                subtitle: progress.label(mediaKey(item, episode, context)),
                run: function () {
                  openVideo(
                    item,
                    episode,
                    function () {
                      episodes(season);
                    },
                    context
                  );
                }
              };
            }),
            seasons
          );
        }
        if (item.seasons && item.seasons.length) {
          seasons();
        } else {
          var videos = item.videos || [];
          if (videos.length === 1) {
            openVideo(item, videos[0], back, {
              kind: 'part',
              season: 0,
              number: 1
            });
          } else if (videos.length) {
            menu(
              item.title,
              videos.map(function (video, index) {
                var context: Context = {
                  kind: 'part',
                  season: 0,
                  number: index + 1
                };
                return {
                  title: video.title || 'Видео ' + (index + 1),
                  subtitle: progress.label(mediaKey(item, video, context)),
                  run: function () {
                    openVideo(
                      item,
                      video,
                      function () {
                        openItem(id, back);
                      },
                      context
                    );
                  }
                };
              }),
              back
            );
          } else {
            notify('У этого материала нет доступного видео.');
          }
        }
      }
    );
  }
  // Named options keep a normal start distinct from a lazy episode transition.
  function openVideo(
    item: Item,
    video: Video,
    back: Action | null,
    context: Context,
    options?: PlayOptions
  ) {
    options = options || {};
    var automatic = options.automatic;
    if (pages) {
      back = pages.resume;
    }
    var transition = options.transition;
    var playback: PlaybackState = {
      key: mediaKey(item, video, context),
      time: 0,
      context: context,
      voice: '',
      accept: transition && transition.accept
    };
    function unavailable(message: string) {
      if (transition && !transition.valid()) {
        return;
      }
      notify(message);
      if (transition) {
        transition.fail();
      }
    }
    function choose(data: ApiResponse) {
      if (transition && !transition.valid()) {
        return;
      }
      var proxy =
        client.get('proxy_enabled') === true ||
        client.get('proxy_enabled') === 'true';
      var maxHeight = transition
        ? transition.height
        : Number(client.get('quality')) || 1080;
      var audios =
        Array.isArray(video.audios) && video.audios.length
          ? video.audios
          : data.audios || [];
      var availableStreams = streams(
        data.files,
        proxy,
        maxHeight,
        audios.length > 1
      );
      if (!availableStreams.length) {
        unavailable(
          proxy
            ? 'Нет HTTPS HLS4-ссылок. Отключи HLS-прокси или проверь данные KinoPub.'
            : 'Нет HTTPS-ссылок на видео.'
        );
        return;
      }
      if (transition && availableStreams[0].height > maxHeight) {
        unavailable('В следующей серии нет качества в выбранном ограничении.');
        return;
      }
      function selectStream(stream: Stream) {
        playback.mode = proxy ? 'proxy' : 'direct';
        playback.format = stream.format;
        diagnostics.record('source', {
          mode: proxy ? 'proxy' : 'direct',
          format: stream.format,
          height: stream.height
        });
        recordSource(stream.url);
        playback.height = stream.height || maxHeight;
        playback.audios = audios;
        if (transition) {
          var matching = transition.voice
            ? audios.filter(function (audio) {
                return voiceIdentity(audio) === transition!.voice;
              })
            : [];
          if (transition.voice && !matching.length) {
            notify(
              'Предыдущая озвучка недоступна в этой серии. Выбрана первая доступная.'
            );
          }
          var selected = matching[0] || audios[0];
          playback.selectedAudio = selected;
          playback.voice = selected ? voiceIdentity(selected) : '';
          if (proxy) {
            prepareProxy(
              item,
              video,
              data,
              stream,
              selected
                ? Number(selected.index) || audios.indexOf(selected) + 1
                : 0,
              Math.min(playback.height, maxHeight),
              playback,
              unavailable
            );
            return;
          }
        }
        if (!proxy) {
          play(item, video, data, stream.url, playback, availableStreams);
          return;
        }
        var tracks = audios.map(function (audio, index) {
          return {
            title: audioTitle(audio, index),
            run: function () {
              playback.voice = voiceIdentity(audio);
              playback.selectedAudio = audio;
              prepareProxy(
                item,
                video,
                data,
                stream,
                Number(audio.index) || index + 1,
                Math.min(stream.height || maxHeight, maxHeight),
                playback,
                unavailable
              );
            }
          };
        });
        if (tracks.length) {
          menu('Озвучка', tracks, function () {
            choose(data);
          });
        } else {
          prepareProxy(
            item,
            video,
            data,
            stream,
            0,
            Math.min(stream.height || maxHeight, maxHeight),
            playback,
            unavailable
          );
        }
      }
      if (automatic) {
        selectStream(availableStreams[0]);
      } else {
        menu(
          'Качество',
          availableStreams.map(function (stream) {
            return {
              title:
                (stream.height ? stream.height + 'p' : 'Авто') +
                ' · ' +
                stream.format.toUpperCase(),
              run: function () {
                selectStream(stream);
              }
            };
          }),
          back
        );
      }
    }
    function load() {
      playback.preparedAt = Date.now();
      if (video.files && video.files.length) {
        choose(video);
        return;
      }
      var mediaId = video.id || video.media_id;
      if (!mediaId) {
        unavailable('KinoPub не вернул media ID или ссылки.');
        return;
      }
      client.api(
        '/items/media-links',
        { mid: mediaId },
        function (error, json) {
          if (error) {
            unavailable(errorMessage(error));
          } else {
            choose(json!);
          }
        }
      );
    }
    var previous = progress.get(playback.key);
    if (transition) {
      playback.time = previous && !previous.watched ? previous.time : 0;
      load();
      return;
    }
    if (!previous) {
      load();
      return;
    }
    var entries = [];
    if (!previous.watched) {
      entries.push({
        title: progress.label(playback.key),
        run: function () {
          if (tracker.supported) {
            playback.time = previous!.time;
          } else {
            notify(
              'Этот плеер не поддерживает продолжение Kinolamp. Видео начнётся сначала.'
            );
          }
          load();
        }
      });
    }
    entries.push({
      title: 'Начать сначала',
      run: function () {
        progress.clear(playback.key);
        load();
      }
    });
    entries.push({
      title: 'Сбросить прогресс',
      run: function () {
        progress.clear(playback.key);
        notify('Прогресс этого видео сброшен.');
        back!();
      }
    });
    if (automatic) {
      entries[0].run();
      return;
    }
    menu(
      previous.watched ? 'Уже просмотрено' : 'Продолжить просмотр',
      entries,
      back
    );
  }
  // Only accept short-lived tickets from the explicitly configured proxy.
  function prepareProxy(
    item: Item,
    video: Video,
    data: ApiResponse,
    stream: Stream,
    voice: number,
    height: number,
    playback: PlaybackState,
    unavailable: (message: string) => void
  ) {
    var base = String(client.get('proxy_url')).replace(/\/+$/, '');
    var token = client.get('proxy_token');
    if (
      !httpsURL(base) ||
      !/^https:\/\/[^/]+$/.test(base) ||
      !token ||
      token.length < 32
    ) {
      unavailable(
        'Для HLS-прокси укажи HTTPS-адрес своего VPS и ключ минимум 32 символа.'
      );
      return;
    }
    transport(
      'POST',
      base + '/api/manifests',
      JSON.stringify({ master: stream.url, voice: voice, maxHeight: height }),
      { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      function (error, json) {
        // A proxy response may only return a ticket at the configured origin.
        var prefix = base + '/hls/';
        if (
          error ||
          !json ||
          typeof json.url !== 'string' ||
          json.url.indexOf(prefix) !== 0 ||
          !/^[a-f0-9]{64}\.m3u8$/.test(json.url.slice(prefix.length))
        ) {
          unavailable(
            'HLS-прокси недоступен. Проверь ключ, ALLOWED_ORIGINS и CDN_HOSTS на VPS.'
          );
          return;
        }
        play(item, video, data, json.url, playback);
      }
    );
  }
  function play(
    item: Item,
    video: Video,
    data: ApiResponse,
    url: string,
    playback: PlaybackState,
    qualities?: Stream[]
  ) {
    var subtitles = (data.subtitles || video.subtitles || [])
      .filter(function (s) {
        return httpsURL(s.url);
      })
      .map(function (s) {
        return {
          label: String(s.lang || 'Subtitles'),
          language: String(s.lang || ''),
          url: s.url!
        };
      });
    var work: Work = {
      title:
        String(item.title || '') + (video.title ? ' · ' + video.title : ''),
      url: url
    };
    work._kinolampAudios =
      playback.mode === 'proxy'
        ? playback.selectedAudio
          ? [playback.selectedAudio]
          : []
        : playback.audios;
    work._kinolampDiagnostic = {
      requested: Date.now(),
      mode: playback.mode,
      format: playback.format
    };
    diagnostics.record('prepare', { ms: Date.now() - playback.preparedAt! });
    if (qualities && qualities.length > 1) {
      work.quality = {};
      qualities.forEach(function (stream) {
        work.quality![stream.height ? stream.height + 'p' : 'Авто'] =
          stream.url;
      });
    }
    tracker.attach(work, playback);
    if (subtitles.length) {
      work.subtitles = subtitles;
    }
    if (playback.accept) {
      playback.accept(work, playback);
      return;
    }
    var entries = playlist(item, video, work, playback);
    try {
      Lampa.Player.play(work);
      Lampa.Player.playlist(entries);
    } catch (_) {
      notify('Не удалось запустить плеер Lampa.');
    }
  }

  // Native pages contain display data; signed playback links stay out of routes.
  function pageRows(route: Route, done: PageReply) {
    function imageURL(value: unknown) {
      return typeof value === 'string' ? value.replace(/^http:/, 'https:') : '';
    }
    function poster(item: Pick<Item, 'posters'>) {
      return imageURL(
        item.posters &&
          (item.posters.medium || item.posters.big || item.posters.small)
      );
    }
    function minutes(seconds: number | undefined) {
      return seconds! > 0 ? Math.ceil(seconds! / 60) + ' мин' : '';
    }
    function details(item: Item) {
      return [
        item.year,
        (item.genres || [])
          .map(function (genre) {
            return genre.title;
          })
          .join(', '),
        (item.countries || [])
          .map(function (country) {
            return country.title;
          })
          .join(', ')
      ]
        .filter(Boolean)
        .join(' · ');
    }
    if (route.kp_view === 'search') {
      client.api(
        '/items/search',
        { q: route.kp_query },
        function (error, json) {
          if (error) {
            done(errorMessage(error));
            return;
          }
          done(null, {
            title: 'Результаты: «' + route.kp_query + '»',
            rows: (json!.items || []).map(function (item) {
              return {
                title: item.title,
                subtitle: [item.year, item.type].filter(Boolean).join(' · '),
                poster: poster(item),
                next: { view: 'item', id: item.id }
              };
            })
          });
        }
      );
      return;
    }
    client.api(
      '/items/' + encodeURIComponent(String(route.kp_id)),
      { nolinks: 0 },
      function (error, json) {
        if (error || !json!.item) {
          done(errorMessage(error));
          return;
        }
        var item = json!.item;
        var image = poster(item);
        if (route.kp_view === 'item' && item.seasons && item.seasons.length) {
          loadSeasonPosters(item, function (covers) {
            done(null, {
              title: item.title,
              description: item.plot,
              details: details(item),
              layout: 'seasons',
              hint: 'Сезоны · ' + item.seasons!.length,
              rows: item.seasons!.map(function (season, index) {
                var number =
                  season.number === undefined ? index + 1 : season.number;
                var cover = covers.filter(function (candidate) {
                  return Number(candidate.number) === Number(number);
                })[0];
                var own = poster(season);
                var tmdb = cover && imageURL(cover.poster);
                var frames = (season.episodes || [])
                  .map(function (episode) {
                    return imageURL(episode.thumbnail);
                  })
                  .filter(httpsURL);
                return {
                  title: 'Сезон ' + number,
                  subtitle: [
                    season.title,
                    'Серий: ' + (season.episodes || []).length
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  poster: httpsURL(own)
                    ? own
                    : httpsURL(tmdb)
                      ? tmdb
                      : frames[0] || image,
                  next: { view: 'season', id: item.id, season: index }
                };
              })
            });
          });
          return;
        }
        var season = (item.seasons || [])[route.kp_season!];
        var episodes = route.kp_view === 'season';
        var videos = episodes
          ? (season && season.episodes) || []
          : item.videos || [];
        done(null, {
          title: item.title,
          description: item.plot,
          details: details(item),
          layout: 'episodes',
          hint: episodes
            ? 'Сезон ' +
              (season && season.number !== undefined
                ? season.number
                : Number(route.kp_season) + 1) +
              ' · Серий: ' +
              videos.length
            : 'Выбери часть фильма.',
          rows: videos.map(function (video, index) {
            var context: Context = {
              kind: episodes ? 'episode' : 'part',
              season: episodes
                ? season.number === undefined
                  ? Number(route.kp_season) + 1
                  : season.number
                : 0,
              number: video.number || index + 1
            };
            return {
              title: episodes
                ? 'Серия ' +
                  context.number +
                  (video.title ? ' · ' + video.title : '')
                : video.title || 'Видео ' + context.number,
              subtitle: function () {
                return [
                  minutes(video.duration),
                  progress.label(mediaKey(item, video, context))
                ]
                  .filter(Boolean)
                  .join(' · ');
              },
              poster: imageURL(video.thumbnail) || image,
              item: item,
              video: video,
              context: context
            };
          })
        });
      }
    );
  }
  function activatePageRow(row: Row) {
    if (row.next && row.next.view === 'item') {
      openMatchedItem(row.next.id!);
    } else if (row.next) {
      pages!.show(row.next);
    } else {
      openVideo(row.item!, row.video!, pages!.resume, row.context!, {
        automatic: true
      });
    }
  }

  function resetProgress() {
    tracker.clear();
    progress.clear();
    notify('Прогресс Kinolamp сброшен.');
  }
  return {
    search: search,
    load: pageRows,
    activate: activatePageRow,
    resetProgress: resetProgress
  };
}
