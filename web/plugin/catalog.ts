import type {
  Id,
  Params,
  Client,
  Ui,
  Pages,
  Item,
  Route,
  PageRoute,
  PageReply,
  Lampa
} from './contracts.js';

export function createCatalog(
  Lampa: Lampa,
  client: Client,
  pages: Pages | null,
  ui: Ui
) {
  var notify = ui.notify;
  var menu = ui.menu;
  var errorMessage = ui.errorMessage;
  // Cached folder pages reload after a bookmark mutation or account change.
  var bookmarkRevision = 0;
  function openCatalog() {
    if (!pages) {
      notify('Для каталога обнови Lampa: нужны нативные страницы приложения.');
      return;
    }
    if (!client.hasToken()) {
      Lampa.Controller.toggle('settings');
      Lampa.Settings.create('kp_self');
      notify('Сначала войди в KinoPub, затем открой каталог.');
      return;
    }
    pages.show({ view: 'catalog', section: 'new', page: 1 });
  }
  function catalogRoute(route: Route, changes: Partial<PageRoute>) {
    var result: PageRoute = {
      view: 'catalog',
      section: route.kp_section || 'new',
      page: route.kp_page || 1,
      query: route.kp_query || '',
      genre: route.kp_genre || '',
      genreTitle: route.kp_genre_title || '',
      quality: route.kp_quality || '',
      qualityTitle: route.kp_quality_title || '',
      sort: route.kp_sort || '',
      folder: route.kp_folder || ''
    };
    Object.keys(changes).forEach(function (key) {
      result[key] = changes[key];
    });
    return result;
  }
  function catalogSearch(route: Route) {
    if (!Lampa.Input || !Lampa.Input.edit) {
      notify('В этой сборке Lampa недоступна клавиатура поиска.');
      return;
    }
    var owner = pages!.current();
    Lampa.Input.edit(
      {
        title: 'Поиск в KinoPub',
        value: route.kp_query || '',
        free: true,
        nosave: true,
        nomic: true
      },
      function (value) {
        if (pages!.current() !== owner) {
          return;
        }
        pages!.resume();
        var query = String(value || '')
          .trim()
          .slice(0, 100);
        if (!query) {
          return;
        }
        if (query.length < 3) {
          notify('Введи минимум три символа.');
          return;
        }
        pages!.show(
          catalogRoute(route, {
            section: 'search',
            query: query,
            page: 1,
            folder: '',
            genre: '',
            genreTitle: '',
            quality: '',
            qualityTitle: ''
          })
        );
      }
    );
  }
  function catalogFilters(route: Route) {
    var owner = pages!.current();
    menu('Фильтры KinoPub', [
      {
        title: 'Жанр: ' + (route.kp_genre_title || 'Все'),
        run: function () {
          choose('/genres', 'genre', 'genreTitle');
        }
      },
      {
        title: 'Качество: ' + (route.kp_quality_title || 'Любое'),
        run: function () {
          choose('/references/video-quality', 'quality', 'qualityTitle');
        }
      },
      {
        title: 'Сбросить фильтры',
        run: function () {
          pages!.show(
            catalogRoute(route, {
              page: 1,
              genre: '',
              genreTitle: '',
              quality: '',
              qualityTitle: ''
            })
          );
        }
      }
    ]);
    function choose(path: string, key: string, label: string) {
      client.api(path, {}, function (error, json) {
        if (pages!.current() !== owner) {
          return;
        }
        if (error) {
          notify(errorMessage(error));
          return;
        }
        var values: Item[] = Array.isArray(json)
          ? (json as Item[])
          : json!.items || [];
        menu(
          key === 'genre' ? 'Жанр' : 'Качество',
          [
            {
              title: 'Все',
              run: function () {
                select('', '');
              }
            }
          ].concat(
            values.map(function (value) {
              return {
                title: value.title,
                run: function () {
                  select(value.id, value.title);
                }
              };
            })
          )
        );
      });
      function select(id: Id, title: string) {
        if (pages!.current() !== owner) {
          return;
        }
        var changes: Partial<PageRoute> = { page: 1 };
        changes[key] = id;
        changes[label] = title;
        pages!.show(catalogRoute(route, changes));
      }
    }
  }
  function bookmarkMenu(item: Item) {
    var owner = pages!.current();
    client.api('/bookmarks', {}, function (error, json) {
      if (pages!.current() !== owner) {
        return;
      }
      if (error) {
        notify(errorMessage(error));
        return;
      }
      var folders = json!.items || [];
      client.api(
        '/bookmarks/get-item-folders',
        { item: item.id },
        function (error, memberships) {
          if (pages!.current() !== owner) {
            return;
          }
          if (error) {
            notify(errorMessage(error));
            return;
          }
          var present = (memberships!.folders || []).map(function (folder) {
            return String(folder.id);
          });
          var choices = folders.map(function (folder) {
            var contains = present.indexOf(String(folder.id)) !== -1;
            return {
              title:
                (contains ? '✓ Удалить из «' : 'Добавить в «') +
                folder.title +
                '»',
              run: function () {
                change(folder.id, contains);
              }
            };
          });
          if (!choices.length) {
            choices.push({
              title: 'Создать папку «Избранное» и добавить',
              run: function () {
                if (pages!.current() !== owner) {
                  return;
                }
                client.api(
                  '/bookmarks/create',
                  { title: 'Избранное' },
                  function (error, result) {
                    if (!error && result!.folder && result!.folder.id) {
                      bookmarkRevision++;
                    }
                    if (pages!.current() !== owner) {
                      return;
                    }
                    if (error || !result!.folder || !result!.folder.id) {
                      notify(
                        'Не удалось создать папку KinoPub. Повтори позже.'
                      );
                      return;
                    }
                    change(result!.folder.id, false);
                  },
                  false,
                  true
                );
              }
            });
          }
          menu('Закладки KinoPub · ' + item.title, choices);
        }
      );
    });
    function change(folder: Id, remove: boolean) {
      if (pages!.current() !== owner) {
        return;
      }
      client.api(
        remove ? '/bookmarks/remove-item' : '/bookmarks/add',
        { item: item.id, folder: folder },
        function (error) {
          if (!error) {
            bookmarkRevision++;
          }
          if (pages!.current() !== owner) {
            return;
          }
          if (error) {
            notify(errorMessage(error));
            return;
          }
          notify(
            remove ? 'Удалено из папки KinoPub.' : 'Добавлено в папку KinoPub.'
          );
          pages!.refresh();
        },
        false,
        true
      );
    }
  }
  function catalogRows(route: Route, done: PageReply) {
    var loadedRevision = bookmarkRevision;
    var loadedGeneration = client.generation();
    var names: Record<string, string> = {
      new: 'Новинки',
      movies: 'Фильмы',
      series: 'Сериалы',
      documentaries: 'Документальные фильмы',
      docuseries: 'Документальные сериалы',
      concerts: 'Концерты',
      shows: 'ТВ-шоу',
      stereo: '3D-фильмы',
      search: 'Поиск',
      folders: 'Избранное',
      folder: 'Избранное'
    };
    var section = Object.prototype.hasOwnProperty.call(names, route.kp_section!)
      ? route.kp_section!
      : 'new';
    var page = Math.min(
      10000,
      Math.max(1, Math.floor(Number(route.kp_page) || 1))
    );
    var sorts: Record<string, string> = {
      'created-': 'По дате добавления',
      'updated-': 'По обновлению',
      'rating-': 'По рейтингу',
      'views-': 'По просмотрам'
    };
    var sort = Object.prototype.hasOwnProperty.call(sorts, route.kp_sort!)
      ? route.kp_sort!
      : section === 'new'
        ? 'created-'
        : 'updated-';
    var actions = ['new', 'movies', 'series', 'search', 'folders'].map(
      function (name) {
        return {
          title: (section === name ? '✓ ' : '') + names[name],
          run: function () {
            if (name === 'search') {
              catalogSearch(route);
            } else {
              pages!.show(
                catalogRoute(route, {
                  section: name,
                  page: 1,
                  query: '',
                  folder: '',
                  genre: '',
                  genreTitle: '',
                  quality: '',
                  qualityTitle: ''
                })
              );
            }
          }
        };
      }
    );
    var bookmarks = section === 'folder' || section === 'folders';
    actions.splice(3, 0, {
      title: 'Разделы',
      run: function () {
        menu(
          'Библиотека KinoPub',
          [
            'new',
            'movies',
            'series',
            'documentaries',
            'docuseries',
            'concerts',
            'shows',
            'stereo'
          ].map(function (name) {
            return {
              title: (section === name ? '✓ ' : '') + names[name],
              run: function () {
                pages!.show(
                  catalogRoute(route, {
                    section: name,
                    page: 1,
                    query: '',
                    folder: '',
                    genre: '',
                    genreTitle: '',
                    quality: '',
                    qualityTitle: '',
                    sort: ''
                  })
                );
              }
            };
          })
        );
      }
    });
    var params: Params = { page: page, perpage: 20 };
    var path = '/items';
    if (section === 'search') {
      path += '/search';
      params.q = String(route.kp_query || '').slice(0, 100);
    } else if (bookmarks) {
      path =
        section === 'folders'
          ? '/bookmarks'
          : '/bookmarks/' + encodeURIComponent(String(route.kp_folder));
      params = {};
    } else {
      params.sort = sort;
      var sectionTypes: Record<string, string> = {
        movies: 'movie',
        series: 'serial',
        documentaries: 'documovie',
        docuseries: 'docuserial',
        concerts: 'concert',
        shows: 'tvshow',
        stereo: '3D'
      };
      if (sectionTypes[section]) {
        params.type = sectionTypes[section];
      }
      if (route.kp_genre) {
        params.genre = route.kp_genre;
      }
      if (route.kp_quality) {
        params['quality[]'] = route.kp_quality;
      }
      actions.push({
        title: 'Фильтры',
        run: function () {
          catalogFilters(route);
        }
      });
      actions.push({
        title: sorts[sort],
        run: function () {
          menu(
            'Сортировка KinoPub',
            Object.keys(sorts).map(function (value) {
              return {
                title: (value === sort ? '✓ ' : '') + sorts[value],
                run: function () {
                  pages!.show(catalogRoute(route, { sort: value, page: 1 }));
                }
              };
            })
          );
        }
      });
    }
    client.api(path, params, function (error, json) {
      if (error) {
        done(errorMessage(error));
        return;
      }
      var items = json!.items || [];
      var total = Math.min(
        10000,
        Math.max(
          1,
          Math.floor(Number(json!.pagination && json!.pagination.total) || 1)
        )
      );
      if (bookmarks) {
        total = Math.max(1, Math.ceil(items.length / 20));
        items = items.slice((page - 1) * 20, page * 20);
      }
      done(null, {
        isStale: function () {
          return (
            loadedGeneration !== client.generation() ||
            (bookmarks && loadedRevision !== bookmarkRevision)
          );
        },
        title:
          'KinoPub · ' +
          (section === 'search'
            ? '«' + params.q + '»'
            : section === 'folder' && json!.folder
              ? json!.folder.title
              : names[section]),
        details: [
          !bookmarks && section !== 'search' && route.kp_genre_title,
          !bookmarks && section !== 'search' && route.kp_quality_title
        ]
          .filter(Boolean)
          .join(' · '),
        hint:
          section === 'folders'
            ? 'Выбери папку закладок своего аккаунта KinoPub.'
            : 'Удерживай OK на карточке, чтобы добавить в закладки.',
        empty: bookmarks
          ? 'Пока пусто. Добавляй материалы долгим нажатием на карточку в каталоге.'
          : 'Ничего не найдено. Измени поиск или фильтры.',
        layout: section === 'folders' ? 'folders' : 'catalog',
        actions: actions,
        more:
          page < total && items.length
            ? function (callback) {
                var next: Route = {};
                Object.keys(route).forEach(function (key) {
                  next[key] = route[key];
                });
                next.kp_page = page + 1;
                next.kp_section = section;
                catalogRows(next, callback);
              }
            : null,
        rows: items.map(function (item) {
          if (section === 'folders') {
            return {
              key: 'folder:' + item.id,
              title: item.title,
              subtitle: 'Материалов: ' + (Number(item.count) || 0),
              symbol: '★',
              next: {
                view: 'catalog',
                section: 'folder',
                folder: item.id,
                page: 1
              }
            };
          }
          var image = item.posters || {};
          var types: Record<string, string> = {
            movie: 'Фильм',
            serial: 'Сериал',
            documovie: 'Документальный фильм',
            docuserial: 'Документальный сериал',
            concert: 'Концерт',
            tvshow: 'ТВ-шоу',
            '3D': '3D'
          };
          var titles = String(item.title || '').split(' / ');
          var quality = Number(item.quality);
          var badges: string[] = [];
          if (quality > 100) {
            badges.push(quality === 2160 ? 'UHD 4K' : quality + 'p');
          }
          if (Number(item.ac3) > 0) {
            badges.push('AC3');
          }
          var rating = Number(item.imdb_rating);
          return {
            key:
              item.id === undefined || item.id === null
                ? ''
                : 'item:' + item.id,
            title: titles[0],
            original: titles.slice(1).join(' / '),
            badges: badges,
            rating:
              rating > 0 && rating <= 10 ? 'IMDb ' + rating.toFixed(1) : '',
            subtitle: [
              item.year,
              (item.genres || [])
                .map(function (genre) {
                  return genre.title;
                })
                .filter(Boolean)
                .join(', ') || types[String(item.type)]
            ]
              .filter(Boolean)
              .join(' · '),
            poster: String(
              image.big || image.medium || image.small || ''
            ).replace(/^http:/, 'https:'),
            next: { view: 'item', id: item.id },
            menu: function () {
              bookmarkMenu(item);
            }
          };
        })
      });
    });
  }

  return { open: openCatalog, load: catalogRows };
}
