import { PREFIX, VERSION } from './config.js';
// Diagnostics is an allowlist, not a scrubber: arbitrary URLs, messages, titles
// and request/response objects can never enter the report, even as nested fields.
export function createDiagnostics(storage, now) {
  var entries = [];
  var generation = 0;
  var started = now();
  var events = [
    'api',
    'proxy',
    'source',
    'prepare',
    'start',
    'playing',
    'waiting',
    'stalled',
    'sample',
    'pause',
    'ended',
    'error',
    'stop',
    'probe_api',
    'probe_proxy',
    'probe_cdn'
  ];
  var details = [
    'fragLoadError',
    'fragLoadTimeOut',
    'manifestLoadError',
    'manifestLoadTimeOut',
    'manifestParsingError',
    'levelLoadError',
    'levelLoadTimeOut',
    'bufferStalledError',
    'bufferFullError',
    'bufferAppendError',
    'other'
  ];
  function enabled() {
    var value = storage.get(PREFIX + 'diagnostics_enabled', false);
    return value === true || value === 'true';
  }
  function record(event, data) {
    if (!enabled() || events.indexOf(event) === -1) {
      return;
    }
    data = data || {};
    var entry = { event: event, at: Math.max(0, now() - started) };
    [
      'ms',
      'status',
      'current',
      'buffer',
      'readyState',
      'width',
      'height'
    ].forEach(function (key) {
      var value = data[key];
      if (
        typeof value === 'number' &&
        isFinite(value) &&
        value >= 0 &&
        value <= 86400000
      ) {
        entry[key] = Math.round(value * 100) / 100;
      }
    });
    if (['direct', 'proxy'].indexOf(data.mode) !== -1) {
      entry.mode = data.mode;
    }
    if (['hls2', 'hls4', 'hls', 'http'].indexOf(data.format) !== -1) {
      entry.format = data.format;
    }
    if (['mse', 'direct_src'].indexOf(data.path) !== -1) {
      entry.path = data.path;
    }
    if (typeof data.nativeHls === 'boolean') {
      entry.nativeHls = data.nativeHls;
    }
    if (
      [
        'ok',
        'error',
        'timeout',
        'network_or_cors',
        'not_configured',
        'unsupported',
        'cancelled'
      ].indexOf(data.result) !== -1
    ) {
      entry.result = data.result;
    }
    if (details.indexOf(data.detail) !== -1) {
      entry.detail = data.detail;
    }
    if (typeof data.fatal === 'boolean') {
      entry.fatal = data.fatal;
    }
    entries.push(entry);
    if (entries.length > 120) {
      entries.shift();
    }
    return true;
  }
  function begin(event) {
    var time = now();
    var current = generation;
    var collecting = enabled();
    return function (data) {
      if (!collecting || current !== generation) {
        return;
      }
      return record(event, {
        ms: Math.max(0, now() - time),
        status: data.status,
        result: data.result
      });
    };
  }
  return {
    enabled: enabled,
    record: record,
    begin: begin,
    clear: function () {
      entries = [];
      generation++;
      started = now();
    },
    report: function () {
      return JSON.parse(
        JSON.stringify({
          schema: 1,
          version: VERSION,
          enabled: enabled(),
          scope: 'local-session-last-120-events',
          events: entries
        })
      );
    }
  };
}
