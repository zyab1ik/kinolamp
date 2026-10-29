import { VERSION } from './config.js';
export function createAuthorization(Lampa, $, client, ui) {
  var notify = ui.notify;
  var restore = ui.restore;
  var errorMessage = ui.errorMessage;
  var pendingLogin = null;
  function updateDevice() {
    if (!client.hasToken()) {
      return;
    }
    var platform =
      Lampa.Platform && typeof Lampa.Platform.get === 'function'
        ? Lampa.Platform.get()
        : '';
    client.notifyDevice(
      {
        title: 'Kinolamp / Lampa',
        hardware: String(platform || 'Lampa'),
        software: 'Kinolamp ' + VERSION
      },
      function () {}
    );
  }
  updateDevice();
  function stopLogin() {
    if (!pendingLogin) {
      return;
    }
    clearTimeout(pendingLogin.timer);
    pendingLogin.cancelled = true;
    pendingLogin = null;
  }
  function login(done) {
    if (pendingLogin) {
      return;
    }
    var state = {
      cancelled: false,
      timer: null,
      generation: client.generation()
    };
    pendingLogin = state;
    client.oauth(
      '/oauth2/device',
      { grant_type: 'device_code' },
      function (error, json) {
        if (state.cancelled) {
          return;
        }
        if (error || !json.code || !json.user_code) {
          stopLogin();
          notify(errorMessage(error));
          return;
        }
        var pollInterval = Math.max(Number(json.interval) || 5, 5) * 1000;
        var expiresAt =
          Date.now() + Math.min(Number(json.expires_in) || 600, 3600) * 1000;
        var previous = (Lampa.Controller.enabled() || {}).name;
        var content = $('<div></div>');
        var verification =
          /^https:\/\/(?:kino\.pub|kino\.watch)\/device\/?$/.test(
            json.verification_uri
          )
            ? json.verification_uri
            : 'https://kino.pub/device';
        content.append(
          $('<p></p>').text(
            '1. Открой на телефоне или в другой вкладке: ' + verification
          )
        );
        content.append($('<h1></h1>').text(String(json.user_code)));
        content.append(
          $('<p></p>').text(
            '2. Войди в аккаунт KinoPub, введи этот код в поле «Код устройства» и нажми «Добавить».'
          )
        );
        content.append(
          $('<p></p>').text(
            '3. Оставь это окно открытым — вход завершится автоматически.'
          )
        );
        content.append(
          $('<a target="_blank" rel="noopener noreferrer"></a>')
            .attr('href', verification)
            .text('Открыть страницу активации')
        );
        content.append(
          $('<p></p>').text(
            'Назад — отменить. Пароль остаётся на сайте KinoPub.'
          )
        );
        function close() {
          stopLogin();
          Lampa.Modal.close();
          restore(previous);
        }
        Lampa.Modal.open({
          title: 'Kinolamp',
          html: content,
          size: 'small',
          onBack: close
        });
        function poll() {
          if (state.cancelled) {
            return;
          }
          if (Date.now() >= expiresAt) {
            close();
            notify('Код истёк. Запусти вход ещё раз.');
            return;
          }
          client.oauth(
            '/oauth2/device',
            { grant_type: 'device_token', code: json.code },
            function (error, token) {
              if (state.cancelled) {
                return;
              }
              if (!error && client.saveTokens(token, state.generation)) {
                updateDevice();
                close();
                notify('KinoPub: вход выполнен.');
                if (done) {
                  done();
                }
                return;
              }
              if (
                error &&
                (error.code === 'authorization_pending' ||
                  error.code === 'slow_down')
              ) {
                if (error.code === 'slow_down') {
                  pollInterval += 5000;
                }
                state.timer = setTimeout(poll, pollInterval);
                return;
              }
              close();
              notify(errorMessage(error));
            }
          );
        }
        state.timer = setTimeout(poll, pollInterval);
      }
    );
  }
  function authorized(run) {
    if (client.hasToken()) {
      run();
    } else {
      login(run);
    }
  }

  function logout() {
    if (pendingLogin) {
      stopLogin();
      Lampa.Modal.close();
    }
    client.logout();
    Lampa.Settings.update();
    notify('Локальная сессия удалена. Отзыв устройства доступен на kino.pub.');
  }
  return { login: login, logout: logout, authorized: authorized };
}
