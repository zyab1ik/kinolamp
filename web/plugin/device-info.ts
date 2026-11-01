import type { Lampa, Root } from './contracts.js';
import { VERSION } from './config.js';

function cleanDescription(value: string) {
  // eslint-disable-next-line no-control-regex -- Device descriptions must not contain control characters.
  var controls = /[\x00-\x1f\x7f]/g;
  return value.replace(controls, '').trim().slice(0, 80);
}

// These are UA signatures, not a device allowlist. Unknown platforms are retained.
function systemInfo(agent: string) {
  var signatures: { name: string; pattern: RegExp }[] = [
    { name: 'iOS', pattern: /(?:CPU(?: iPhone)? OS|iPhone OS) ([\d_]+)/i },
    { name: 'Android', pattern: /Android[ /]([\d.]+)/i },
    { name: 'Tizen', pattern: /Tizen[ /]([\d.]+)/i },
    { name: 'webOS', pattern: /(?:webOS|Web0S)[ /]([\d.]+)/i },
    { name: 'Windows NT', pattern: /Windows NT ([\d.]+)/i },
    { name: 'macOS', pattern: /Mac OS X[ /]([\d_.]+)/i },
    { name: 'Chrome OS', pattern: /CrOS [^; )]+ ([\d.]+)/i }
  ];
  for (var index = 0; index < signatures.length; index++) {
    var signature = signatures[index];
    var match = signature.pattern.exec(agent);
    if (match) {
      return { name: signature.name, version: match[1].replace(/_/g, '.') };
    }
  }
  return { name: /Linux/i.test(agent) ? 'Linux' : '', version: '' };
}

// Use available descriptions only; never send the complete UA or device IDs.
export function deviceInfo(Lampa: Lampa, root: Root, customName: string) {
  var platform =
    Lampa.Platform && typeof Lampa.Platform.get === 'function'
      ? Lampa.Platform.get()
      : '';
  var navigator = root.navigator;
  var agent = navigator ? navigator.userAgent : '';
  var system = systemInfo(agent);
  var hints = navigator && navigator.userAgentData;
  // Browser-provided platform descriptions also cover systems unknown to us.
  var availablePlatform = hints ? cleanDescription(hints.platform) : '';
  if (!availablePlatform && navigator) {
    availablePlatform = cleanDescription(navigator.platform || '');
  }
  var operatingSystem = system.name || availablePlatform;
  var androidModel = /Android[^)]*;\s*([^;()]+?)\s+Build\//i.exec(agent);
  var appleDevice = /\b(iPhone|iPad|iPod)\b/.exec(agent);
  var model = androidModel
    ? cleanDescription(androidModel[1])
    : appleDevice
      ? appleDevice[1]
      : '';
  var description = model || operatingSystem || cleanDescription(platform);
  return {
    title:
      cleanDescription(customName) ||
      (description ? description + ' · Kinolamp' : 'Устройство с Lampa'),
    hardware: description || 'Устройство с Lampa',
    software:
      'Kinolamp ' +
      VERSION +
      (operatingSystem ? ' · ' + operatingSystem : '') +
      (system.version ? ' ' + system.version : '')
  };
}
