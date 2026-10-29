export function createCatalog(Lampa, client, pages, ui) {
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
  function catalogRoute(route, changes) {
    var result = {
      view: 'catalog',
      section: route.kp_section || 'new',
      page: route.kp_page || 1,
      query: route.kp_query || '',
      genre: route.kp_genre || '',
      genreTitle: route.kp_genre_title || '',
      quality: route.kp_quality || '',
      qualityTitle: route.kp_quality_title || '',
      folder: route.kp_folder || ''
    };
    Object.keys(changes).forEach(function (key) {
      result[key] = changes[key];
    });
    return result;
  }
  function catalogSearch(route) {
    if (!Lampa.Input || !Lampa.Input.edit) {
      notify('В этой сборке Lampa недоступна клавиатура поиска.');
      return;
    }
    var owner = pages.current();
    Lampa.Input.edit(
      {
        title: 'Поиск в KinoPub',
        value: route.kp_query || '',
        free: true,
        nosave: true,
        nomic: true
      },
      function (value) {
        if (pages.current() !== owner) {
          return;
        }
        pages.resume();
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
        pages.show(
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
  function catalogFilters(route) {
    var owner = pages.current();
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
          pages.show(
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
    function choose(path, key, label) {
      client.api(path, {}, function (error, json) {
        if (pages.current() !== owner) {
          return;
        }
        if (error) {
          notify(errorMessage(error));
          return;
        }
        var values = Array.isArray(json) ? json : json.items || [];
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
      function select(id, title) {
        if (pages.current() !== owner) {
          return;
        }
        var changes = { page: 1 };
        changes[key] = id;
        changes[label] = title;
        pages.show(catalogRoute(route, changes));
      }
    }
  }
  function bookmarkMenu(item) {
    var owner = pages.current();
    client.api('/bookmarks', {}, function (error, json) {
      if (pages.current() !== owner) {
        return;
      }
      if (error) {
        notify(errorMessage(error));
        return;
      }
      var folders = json.items || [];
      client.api(
        '/bookmarks/get-item-folders',
        { item: item.id },
        function (error, memberships) {
          if (pages.current() !== owner) {
            return;
          }
          if (error) {
            notify(errorMessage(error));
            return;
          }
          var present = (memberships.folders || []).map(function (folder) {
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
                if (pages.current() !== owner) {
                  return;
                }
                client.api(
                  '/bookmarks/create',
                  { title: 'Избранное' },
                  function (error, result) {
                    if (!error && result.folder && result.folder.id) {
                      bookmarkRevision++;
                    }
                    if (pages.current() !== owner) {
                      return;
                    }
                    if (error || !result.folder || !result.folder.id) {
                      notify(
                        'Не удалось создать папку KinoPub. Повтори позже.'
                      );
                      return;
                    }
                    change(result.folder.id, false);
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
    function change(folder, remove) {
      if (pages.current() !== owner) {
        return;
      }
      client.api(
        remove ? '/bookmarks/remove-item' : '/bookmarks/add',
        { item: item.id, folder: folder },
        function (error) {
          if (!error) {
            bookmarkRevision++;
          }
          if (pages.current() !== owner) {
            return;
          }
          if (error) {
            notify(errorMessage(error));
            return;
          }
          notify(
            remove ? 'Удалено из папки KinoPub.' : 'Добавлено в папку KinoPub.'
          );
          pages.refresh();
        },
        false,
        true
      );
    }
  }
  function catalogRows(route, done) {
    var loadedRevision = bookmarkRevision;
    var loadedGeneration = client.generation();
    var names = {
      new: 'Новинки',
      movies: 'Фильмы',
      series: 'Сериалы',
      search: 'Поиск',
      folders: 'Избранное',
      folder: 'Избранное'
    };
    var section = Object.prototype.hasOwnProperty.call(names, route.kp_section)
      ? route.kp_section
      : 'new';
    var page = Math.min(
      10000,
      Math.max(1, Math.floor(Number(route.kp_page) || 1))
    );
    var actions = ['new', 'movies', 'series', 'search', 'folders'].map(
      function (name) {
        return {
          title: (section === name ? '✓ ' : '') + names[name],
          run: function () {
            if (name === 'search') {
              catalogSearch(route);
            } else {
              pages.show(
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
    var params = { page: page, perpage: 20 };
    var path = '/items';
    if (section === 'search') {
      path += '/search';
      params.q = String(route.kp_query || '').slice(0, 100);
    } else if (bookmarks) {
      path =
        section === 'folders'
          ? '/bookmarks'
          : '/bookmarks/' + encodeURIComponent(route.kp_folder);
      params = {};
    } else {
      params.sort = section === 'new' ? 'created-' : 'updated-';
      if (section === 'movies') {
        params.type = 'movie';
      }
      if (section === 'series') {
        params.type = 'serial';
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
    }
    client.api(path, params, function (error, json) {
      if (error) {
        done(errorMessage(error));
        return;
      }
      var items = json.items || [];
      var total = Math.min(
        10000,
        Math.max(
          1,
          Math.floor(Number(json.pagination && json.pagination.total) || 1)
        )
      );
      if (bookmarks) {
        total = Math.max(1, Math.ceil(items.length / 20));
        items = items.slice((page - 1) * 20, page * 20);
      }
      function pagination(number, title) {
        actions.push({
          title: title,
          run: function () {
            pages.show(catalogRoute(route, { section: section, page: number }));
          }
        });
      }
      if (page > 1) {
        pagination(page - 1, '← Предыдущая страница');
      }
      if (page < total) {
        pagination(page + 1, 'Следующая страница →');
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
            : section === 'folder' && json.folder
              ? json.folder.title
              : names[section]),
        details: [
          'Страница ' + page + ' из ' + total,
          !bookmarks && section !== 'search' && route.kp_genre_title,
          !bookmarks && section !== 'search' && route.kp_quality_title
        ]
          .filter(Boolean)
          .join(' · '),
        hint:
          section === 'folders'
            ? 'Выбери папку закладок своего аккаунта KinoPub.'
            : 'Долгое нажатие на карточку — закладки KinoPub. Озвучку выбирай в плеере.',
        empty: bookmarks
          ? 'Пока пусто. Добавляй материалы долгим нажатием на карточку в каталоге.'
          : 'Ничего не найдено. Измени поиск или фильтры.',
        layout: section === 'folders' ? 'folders' : 'posters',
        actions: actions,
        rows: items.map(function (item) {
          if (section === 'folders') {
            return {
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
          var types = {
            movie: 'Фильм',
            serial: 'Сериал',
            documovie: 'Документальный фильм',
            docuserial: 'Документальный сериал',
            concert: 'Концерт',
            tvshow: 'ТВ-шоу',
            '3D': '3D'
          };
          return {
            title: item.title,
            subtitle: [
              item.year,
              types[item.type],
              Number(item.quality) > 100 ? item.quality + 'p' : ''
            ]
              .filter(Boolean)
              .join(' · '),
            poster: String(
              image.medium || image.big || image.small || ''
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
