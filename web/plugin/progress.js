import { PREFIX } from './config.js';
export function createProgress(storage) {
  var key = PREFIX + 'progress';
  function records() {
    var data = storage.get(key, {});
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  }
  function write(data) {
    try {
      storage.set(key, data);
    } catch (_) {
      /* A full local store must not stop playback. */
    }
  }
  function get(id) {
    var entry = records()[id];
    return entry &&
      typeof entry.time === 'number' &&
      isFinite(entry.time) &&
      entry.time > 0 &&
      typeof entry.duration === 'number' &&
      isFinite(entry.duration) &&
      entry.duration > 0
      ? entry
      : null;
  }
  function save(id, time, duration, ended) {
    if (
      !id ||
      typeof time !== 'number' ||
      !isFinite(time) ||
      time < 0 ||
      typeof duration !== 'number' ||
      !isFinite(duration) ||
      duration <= 0
    ) {
      return;
    }
    var data = records();
    time = Math.min(time, duration);
    data[id] = {
      time: time,
      duration: duration,
      watched: !!ended || time / duration >= 0.95,
      updated: Date.now()
    };
    var ids = Object.keys(data).sort(function (a, b) {
      return data[b].updated - data[a].updated;
    });
    ids
      .filter(function (old) {
        return old !== id;
      })
      .slice(499)
      .forEach(function (old) {
        delete data[old];
      });
    write(data);
  }
  function clear(id) {
    var data = records();
    if (id) {
      delete data[id];
    } else {
      data = {};
    }
    write(data);
  }
  function label(id) {
    var entry = get(id);
    return entry
      ? entry.watched
        ? 'Просмотрено'
        : 'Продолжить с ' +
          Math.floor(entry.time / 60) +
          ':' +
          ('0' + Math.floor(entry.time % 60)).slice(-2)
      : '';
  }
  return { get: get, save: save, clear: clear, label: label };
}
