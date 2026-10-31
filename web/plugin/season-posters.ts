import type { Item, Lampa } from './contracts.js';
interface SeasonPoster {
  number?: number;
  poster: string;
}
// Resolve artwork by identity, never by an ambiguous translated title.
// Reuse Lampa's TMDB client/proxy/cache; KinoPub tokens never enter these calls.
export function createSeasonPosters(Lampa: Lampa) {
  return function load(item: Item, done: (seasons: SeasonPoster[]) => void) {
    var imdb = String(item.imdb || '').replace(/^tt/, '');
    var source = Lampa.Api && Lampa.Api.sources && Lampa.Api.sources.tmdb;
    if (
      !/^[0-9]{1,10}$/.test(imdb) ||
      Number(imdb) === 0 ||
      !source ||
      typeof source.get !== 'function' ||
      !Lampa.TMDB ||
      typeof Lampa.TMDB.image !== 'function'
    ) {
      done([]);
      return;
    }
    while (imdb.length < 7) {
      imdb = '0' + imdb;
    }
    var settled = false;
    // Artwork is optional. A slow metadata service must not block season choice.
    var timer = setTimeout(finish, 2500);
    function finish(seasons?: SeasonPoster[]) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      done(seasons || []);
    }
    function failed() {
      finish([]);
    }
    try {
      source.get(
        'find/tt' + imdb + '?external_source=imdb_id',
        {},
        function (found) {
          if (settled) {
            return;
          }
          var matches = found && found.tv_results;
          if (
            !Array.isArray(matches) ||
            matches.length !== 1 ||
            !matches[0] ||
            !/^[1-9][0-9]*$/.test(String(matches[0].id))
          ) {
            failed();
            return;
          }
          source.get(
            'tv/' + matches[0].id,
            {},
            function (show) {
              var seasons = show && show.seasons;
              finish(
                Array.isArray(seasons)
                  ? seasons.map(function (season) {
                      return {
                        number: season.season_number,
                        // Only image paths are passed to Lampa's image/proxy helper.
                        poster:
                          typeof season.poster_path === 'string' &&
                          /^\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(
                            season.poster_path
                          )
                            ? Lampa.TMDB.image('t/p/w500' + season.poster_path)
                            : ''
                      };
                    })
                  : []
              );
            },
            failed,
            { life: 60 * 24 * 7 }
          );
        },
        failed,
        { life: 60 * 24 * 7 }
      );
    } catch (_) {
      // Older/custom Lampa builds may expose an incompatible metadata adapter.
      failed();
    }
  };
}
