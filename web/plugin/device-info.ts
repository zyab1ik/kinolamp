import type { Lampa, Root } from './contracts.js';
import { VERSION } from './config.js';

// Read only descriptive fields. Never send the complete user agent or device IDs.
export function deviceInfo(Lampa: Lampa, root: Root, customName: string) {
  var platform =
    Lampa.Platform && typeof Lampa.Platform.get === 'function'
      ? Lampa.Platform.get()
      : '';
  var agent = root.navigator ? root.navigator.userAgent : '';
  var system = /(Tizen|Android|webOS|Web0S)[ /]([\d.]+)/i.exec(agent);
  var labels: Record<string, string> = {
    tizen: 'Samsung TV',
    webos: 'LG TV',
    philips: 'Philips TV',
    android: 'Android',
    androidtv: 'Android TV',
    browser: 'Браузер'
  };
  var label = labels[platform];
  var hardware = typeof label === 'string' ? label : platform || 'Lampa';
  var operatingSystem = '';
  if (system) {
    var name = system[1].toLowerCase();
    operatingSystem =
      (name === 'web0s' || name === 'webos'
        ? 'webOS'
        : name === 'tizen'
          ? 'Tizen'
          : 'Android') +
      ' ' +
      system[2];
    if (!platform || platform === 'browser') {
      hardware = operatingSystem.split(' ')[0];
    }
  }
  // Android's standard UA exposes the model immediately before "Build/".
  // Other devices keep their platform name rather than guessing a model.
  var model = /Android[^)]*;\s*([^;()]+?)\s+Build\//i.exec(agent);
  if (model) {
    hardware += ' · ' + model[1].trim().slice(0, 80);
  }
  // eslint-disable-next-line no-control-regex -- Device names must not contain control characters.
  var controls = /[\x00-\x1f\x7f]/g;
  var title = customName.replace(controls, '').trim().slice(0, 80);
  return {
    title: title || hardware + ' · Kinolamp',
    hardware: hardware,
    software:
      'Kinolamp ' + VERSION + (operatingSystem ? ' · ' + operatingSystem : '')
  };
}
