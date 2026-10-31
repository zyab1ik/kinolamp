import PAGE_STYLES from './pages.css';
import { httpsURL } from './text.js';
export function createNativePages(Lampa, $, navigation, load, activate) {
  if (!Lampa.Component || !Lampa.Activity || !Lampa.Scroll || !navigation) {
    return null;
  }
  var active = null;
  $('body').append($('<style></style>').text(PAGE_STYLES));
  Lampa.Component.add('kinolamp', function (object) {
    var self = this;
    var isAlive = true;
    var isSuspended = false;
    var requestId = 0;
    var focusedElement = false;
    var captions = [];
    var isStale = null;
    var more = null;
    var loadingMore = false;
    var moreFailed = false;
    var moreRequest = 0;
    var seen = Object.create(null);
    var view = $('<div class="kp-page"></div>');
    var head = $('<div class="kp-page__head"></div>');
    var title = $('<div class="kp-page__title"></div>').text('KinoPub');
    var status = $('<div class="kp-page__status" role="status"></div>').text(
      'Загрузка…'
    );
    var grid = $('<div class="kp-page__grid"></div>');
    var toolbar = $('<div class="kp-page__toolbar"></div>');
    var pagination = $(
      '<div class="kp-page__toolbar kp-page__pagination"></div>'
    );
    var details = $('<div class="kp-page__details"></div>');
    var description = $('<div class="kp-page__description"></div>');
    var scroll = new Lampa.Scroll({ mask: true, over: true });
    head.append(title);
    scroll.append(toolbar);
    scroll.append(details);
    scroll.append(description);
    scroll.append(grid);
    scroll.append(pagination);
    view.append(head).append(status).append(scroll.render());
    function buttons(actions, target) {
      actions.forEach(function (action) {
        var button = $(
          '<div class="simple-button selector kp-page__action"></div>'
        ).text(action.title);
        button.on('hover:focus', function () {
          focusedElement = button[0];
          scroll.update(button, true);
        });
        button.on('hover:enter', function () {
          if (isAlive && !isSuspended) {
            action.run();
          }
        });
        (target || toolbar).append(button);
        if (!focusedElement) {
          focusedElement = button[0];
        }
      });
    }
    function updateCaptions() {
      captions.forEach(function (label) {
        label.node.text(
          typeof label.row.subtitle === 'function'
            ? label.row.subtitle()
            : label.row.subtitle
        );
      });
    }
    function appendRows(rows) {
      var count = captions.length;
      rows.forEach(function (row) {
        if (row.key && seen[row.key]) {
          return;
        }
        if (row.key) {
          seen[row.key] = true;
        }
        var position = captions.length;
        var card = $('<div class="kp-page__card selector"></div>');
        var poster = $('<div class="kp-page__poster"></div>');
        poster.append(
          $('<span class="kp-page__placeholder"></span>').text(
            row.symbol || '▶'
          )
        );
        if (httpsURL(row.poster)) {
          poster.append(
            $('<img loading="lazy" alt="">')
              .attr('src', row.poster)
              .on('error', function () {
                $(this).remove();
              })
          );
        }
        card
          .append(poster)
          .append(
            $('<div class="kp-page__name card__title"></div>').text(row.title)
          );
        var meta = $('<div class="kp-page__meta"></div>');
        card.append(meta);
        if (row.original) {
          card.append(
            $('<div class="kp-page__original"></div>').text(row.original)
          );
        }
        var badges = $('<div class="kp-page__badges"></div>');
        (row.badges || []).forEach(function (label) {
          badges.append($('<span class="kp-page__badge"></span>').text(label));
        });
        poster.append(badges);
        if (row.rating) {
          poster.append(
            $('<span class="kp-page__rating"></span>').text(row.rating)
          );
        }
        captions.push({ node: meta, row: row });
        if (!focusedElement) {
          focusedElement = card[0];
        }
        card.on('hover:focus', function () {
          focusedElement = card[0];
          scroll.update(card, true);
          if (position >= captions.length - 5) {
            loadMore();
          }
        });
        card.on('hover:enter', function () {
          if (isAlive && !isSuspended) {
            activate(row);
          }
        });
        if (row.menu) {
          card.on('hover:long', function () {
            if (isAlive && !isSuspended) {
              row.menu();
            }
          });
        }
        grid.append(card);
      });
      updateCaptions();
      return captions.length - count;
    }
    function loadMore() {
      if (!isAlive || isSuspended || loadingMore || moreFailed || !more) {
        return;
      }
      var expected = ++moreRequest;
      loadingMore = true;
      pagination
        .empty()
        .append(
          $('<div class="kp-page__loading" role="status"></div>').text(
            'Загрузка…'
          )
        );
      more(function (error, data) {
        if (!isAlive || isSuspended || expected !== moreRequest) {
          return;
        }
        loadingMore = false;
        pagination.empty();
        if (isStale && isStale()) {
          more = null;
          return;
        }
        if (error) {
          moreFailed = true;
          var beforeRetry = focusedElement;
          pagination.append(
            $('<div class="kp-page__loading" role="status"></div>').text(
              'Не удалось загрузить следующие карточки.'
            )
          );
          buttons(
            [
              {
                title: 'Повторить',
                run: function () {
                  moreFailed = false;
                  focusedElement = beforeRetry;
                  loadMore();
                }
              }
            ],
            pagination
          );
        } else {
          var added = appendRows(data.rows);
          more = added ? data.more || null : null;
        }
        Lampa.Controller.collectionSet(view);
        Lampa.Controller.collectionFocus(focusedElement, view);
      });
    }
    scroll.onEnd = loadMore;
    this.create = function () {
      var expected = ++requestId;
      moreRequest++;
      more = null;
      loadingMore = false;
      moreFailed = false;
      seen = Object.create(null);
      status.text('Загрузка…');
      self.activity.loader(true);
      load(object, function (error, data) {
        if (!isAlive || expected !== requestId) {
          return;
        }
        self.activity.loader(false);
        grid.empty();
        toolbar.empty();
        pagination.empty();
        focusedElement = false;
        captions = [];
        isStale = null;
        if (error) {
          title.text('KinoPub');
          details.text('');
          description.text('');
          status.text(error);
          buttons([{ title: 'Повторить', run: self.create }]);
        } else {
          isStale = data.isStale || null;
          title.text(data.title);
          details.text(data.details || '');
          description.text(data.description || '');
          grid.attr('data-layout', data.layout || 'posters');
          buttons(data.actions || []);
          status.text(
            data.rows.length
              ? data.hint || 'Выбери подходящий результат.'
              : data.empty ||
                  'Ничего не найдено. Вернись назад и выбери другой материал.'
          );
          appendRows(data.rows);
          more = data.rows.length ? data.more || null : null;
        }
        if (!isSuspended) {
          self.activity.toggle();
        }
      });
    };
    this.start = function () {
      if (!isAlive) {
        return;
      }
      isSuspended = false;
      active = self;
      if (isStale && isStale()) {
        self.create();
        return;
      }
      updateCaptions();
      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(view);
          Lampa.Controller.collectionFocus(focusedElement, view);
        },
        up: function () {
          if (navigation.canmove('up')) {
            navigation.move('up');
          } else {
            Lampa.Controller.toggle('head');
          }
        },
        down: function () {
          navigation.move('down');
        },
        right: function () {
          navigation.move('right');
        },
        left: function () {
          if (navigation.canmove('left')) {
            navigation.move('left');
          } else {
            Lampa.Controller.toggle('menu');
          }
        },
        back: function () {
          Lampa.Activity.backward();
        }
      });
      Lampa.Controller.toggle('content');
    };
    this.render = function () {
      return view;
    };
    this.pause = function () {
      isSuspended = true;
      moreRequest++;
      if (loadingMore) {
        loadingMore = false;
        pagination.empty();
      }
      if (active === self) {
        active = null;
      }
    };
    this.stop = function () {};
    this.destroy = function () {
      isAlive = false;
      if (active === self) {
        active = null;
      }
      scroll.destroy();
      view.remove();
    };
  });
  return {
    show: function (route) {
      // Activity history must contain only route data, never DOM nodes, callbacks or API tokens.
      Lampa.Activity.push({
        component: 'kinolamp',
        title: 'KinoPub',
        kp_view: route.view,
        kp_query: route.query,
        kp_id: route.id,
        kp_season: route.season,
        kp_section: route.section,
        kp_page: route.page,
        kp_genre: route.genre,
        kp_genre_title: route.genreTitle,
        kp_quality: route.quality,
        kp_quality_title: route.qualityTitle,
        kp_sort: route.sort,
        kp_folder: route.folder
      });
    },
    current: function () {
      return active;
    },
    refresh: function () {
      if (active) {
        active.create();
      }
    },
    resume: function () {
      if (active) {
        active.start();
      }
    }
  };
}
