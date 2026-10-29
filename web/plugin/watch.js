import icon from '../static/icon.svg';
export function installWatch(Lampa, $, search, ui) {
  var notify = ui.notify;
  var menu = ui.menu;
  Lampa.Listener.follow('full', function (event) {
    if (
      !event ||
      event.type !== 'complite' ||
      !event.data ||
      !event.data.movie
    ) {
      return;
    }
    var holder =
      event.object && event.object.activity && event.object.activity.render();
    if (!holder || holder.find('.kp-self-button').length) {
      return;
    }
    var target = holder.find('.buttons--container').first();
    if (!target.length) {
      notify(
        'Не удалось подключить KinoPub к кнопке «Смотреть». Обнови Lampa.'
      );
      return;
    }
    var button = $('<div class="full-start__button kp-self-button"></div>');
    button.append($(icon)).append($('<span></span>').text('KinoPub'));
    button.on('hover:enter', function () {
      search(event.data.movie);
    });
    target.append(button);
    // Extend Lampa's button grouping after its own source handlers are installed.
    var start = event.link && event.link.items && event.link.items[0];
    if (start && start.use) {
      start.use({
        onGroupButtons: function () {
          var html = this.html;
          html
            .find('.button--play')
            .unbind('hover:enter hover:long')
            .on('hover:enter', function () {
              search(event.data.movie);
            })
            .on('hover:long', function () {
              var sources = [];
              html
                .find('.buttons--container > .full-start__button')
                .not('.hide')
                .each(function () {
                  var source = $(this);
                  sources.push({
                    title: source.text(),
                    run: function () {
                      source.trigger('hover:enter');
                    }
                  });
                });
              menu('Источники', sources);
            });
        }
      });
    }
  });
}
