import { API } from './config.js';
export function createTransport(Lampa, diagnostics) {
  function transport(method, url, body, headers, done) {
    var complete = done;
    var finish = diagnostics.begin(
      url.indexOf(API + '/v1/') === 0
        ? 'api'
        : url.indexOf('/api/manifests') !== -1
          ? 'proxy'
          : ''
    );
    done = function (error, json) {
      finish({
        status: error ? Number(error.status) || 0 : 200,
        result: error ? 'error' : 'ok'
      });
      complete(error, json);
    };
    var request = new Lampa.Reguest();
    request.timeout(15000);
    request.silent(
      url,
      function (json) {
        if (typeof json === 'string') {
          try {
            json = JSON.parse(json);
          } catch (_) {
            done({ code: 'bad_response' });
            return;
          }
        }
        if (!json || typeof json !== 'object') {
          done({ code: 'bad_response' });
          return;
        }
        if (json.error) {
          done({ code: String(json.error) });
          return;
        }
        done(null, json);
      },
      function (xhr) {
        var code = 'network_error';
        try {
          code = JSON.parse(xhr.responseText).error || code;
        } catch (_) {
          // Keep the generic error when upstream did not return JSON.
        }
        done({ status: xhr && xhr.status, code: code });
      },
      method === 'POST' ? body : false,
      { headers: headers }
    );
  }

  return transport;
}
