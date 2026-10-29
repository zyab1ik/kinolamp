import { API, PREFIX, CLIENT_ID, CLIENT_SECRET } from './config.js';
import { encodeForm } from './text.js';
// Transport is injected to test OAuth without credentials or real network calls.
export function createClient(storage, transport) {
  var refreshing = false;
  var waiting = [];
  // Logout invalidates pending requests and token refreshes.
  var generation = 0;
  function get(key) {
    return storage.get(PREFIX + key, '') || '';
  }
  function set(key, value) {
    storage.set(PREFIX + key, value);
  }
  function save(json, expected) {
    if (
      expected !== generation ||
      !json ||
      typeof json.access_token !== 'string' ||
      !json.access_token
    ) {
      return false;
    }
    set('access', json.access_token);
    if (typeof json.refresh_token === 'string' && json.refresh_token) {
      set('refresh', json.refresh_token);
    }
    return true;
  }
  function logout() {
    generation++;
    set('access', '');
    set('refresh', '');
  }
  function oauth(path, grant, done) {
    grant.client_id = CLIENT_ID;
    grant.client_secret = CLIENT_SECRET;
    transport(
      'POST',
      API + path,
      encodeForm(grant),
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      done
    );
  }
  function refresh(done) {
    if (!get('refresh')) {
      done({ code: 'login_required' });
      return;
    }
    waiting.push(done);
    if (refreshing) {
      return;
    }
    refreshing = true;
    var expected = generation;
    oauth(
      '/oauth2/token',
      { grant_type: 'refresh_token', refresh_token: get('refresh') },
      function (error, json) {
        if (!error && !save(json, expected)) {
          error = { code: 'session_changed' };
        }
        if (
          error &&
          expected === generation &&
          (error.status === 400 || error.status === 401)
        ) {
          logout();
        }
        refreshing = false;
        var callbacks = waiting;
        waiting = [];
        callbacks.forEach(function (callback) {
          callback(error);
        });
      }
    );
  }
  function api(path, params, done, retried, post) {
    if (!get('access')) {
      done({ code: 'login_required' });
      return;
    }
    var expected = generation;
    var query = encodeForm(params || {});
    var headers = { Authorization: 'Bearer ' + get('access') };
    if (post) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    transport(
      post ? 'POST' : 'GET',
      API + '/v1' + path + (!post && query ? '?' + query : ''),
      post ? query : null,
      headers,
      function (error, json) {
        if (generation !== expected) {
          done({ code: 'session_changed' });
          return;
        }
        if (error && error.status === 401 && !retried) {
          refresh(function (refreshError) {
            if (refreshError) {
              done(refreshError);
            } else {
              api(path, params, done, true, post);
            }
          });
        } else {
          done(error, json);
        }
      }
    );
  }
  return {
    get: get,
    set: set,
    api: api,
    oauth: oauth,
    logout: logout,
    hasToken: function () {
      return !!get('access');
    },
    generation: function () {
      return generation;
    },
    saveTokens: save,
    notifyDevice: function (info, done) {
      api('/device/notify', info, done, false, true);
    }
  };
}
