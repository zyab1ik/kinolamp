import { VERSION } from './config.js';
import { createClient } from './client.js';
import { createProgress } from './progress.js';
import { createDiagnostics } from './diagnostics.js';
import { createTransport } from './transport.js';
import { createUi } from './ui.js';
import { createAuthorization } from './authorization.js';
import { createPlayerDiagnostics } from './player-diagnostics.js';
import { createNativePages } from './pages.js';
import { createPlayback } from './playback.js';
import { createCatalog } from './catalog.js';
import { installSettings } from './settings.js';
import { installWatch } from './watch.js';
import { installPlayerFeedback } from './player-feedback.js';
import { installAudioLabels } from './audio-labels.js';
import catalogIcon from './kinopub.svg';
function nameExtension(Lampa, root) {
  var script = root.document && root.document.currentScript;
  if (
    !script ||
    !script.src ||
    !Lampa.Plugins ||
    !Lampa.Plugins.get ||
    !Lampa.Plugins.save
  ) {
    return;
  }
  var scriptURL = script.src.split(/[?#]/)[0];
  var changed = false;
  Lampa.Plugins.get().forEach(function (entry) {
    if (entry.url && entry.url.split(/[?#]/)[0] === scriptURL && !entry.name) {
      entry.name = 'Kinolamp';
      entry.author = 'zyab1ik';
      entry.descr = 'KinoPub для Lampa · собственная инфраструктура';
      changed = true;
    }
  });
  if (changed) {
    Lampa.Plugins.save();
  }
}

export function install(Lampa, $, root) {
  if (!$ || !Lampa.SettingsApi || !Lampa.Select || !Lampa.Reguest) {
    return;
  }
  nameExtension(Lampa, root);
  installPlayerFeedback(Lampa);
  installAudioLabels(Lampa);
  var ui = createUi(Lampa);
  var diagnostics = createDiagnostics(Lampa.Storage, Date.now);
  var transport = createTransport(Lampa, diagnostics);
  var client = createClient(Lampa.Storage, transport);
  var authorization = createAuthorization(Lampa, $, client, ui);
  var playerDiagnostics = createPlayerDiagnostics(
    Lampa,
    $,
    root,
    client,
    transport,
    diagnostics,
    ui
  );
  // Page callbacks run after registration, when both controllers have been created.
  var playback;
  var catalog;
  var pages = createNativePages(
    Lampa,
    $,
    root.Navigator,
    function (route, done) {
      if (route.kp_view === 'catalog') {
        catalog.load(route, done);
      } else {
        playback.load(route, done);
      }
    },
    function (row) {
      playback.activate(row);
    }
  );
  playback = createPlayback(Lampa, {
    client: client,
    transport: transport,
    pages: pages,
    progress: createProgress(Lampa.Storage),
    diagnostics: diagnostics,
    recordSource: playerDiagnostics.source,
    authorization: authorization,
    ui: ui
  });
  catalog = createCatalog(Lampa, client, pages, ui);
  installSettings(
    Lampa,
    client,
    authorization,
    playback,
    catalog,
    playerDiagnostics,
    ui
  );
  installWatch(Lampa, $, playback.search, ui);
  if (pages && Lampa.Menu && Lampa.Menu.addButton) {
    var catalogMenuAdded = false;
    function addCatalogMenu() {
      if (catalogMenuAdded) {
        return;
      }
      catalogMenuAdded = true;
      Lampa.Menu.addButton(catalogIcon, 'KinoPub', catalog.open).attr(
        'data-action',
        'kinolamp'
      );
    }
    if (root.appready) {
      addCatalogMenu();
    } else {
      Lampa.Listener.follow('app', function (event) {
        if (event && event.type === 'ready') {
          addCatalogMenu();
        }
      });
    }
  }
  if (Lampa.Manifest) {
    Lampa.Manifest.plugins = {
      type: 'video',
      name: 'Kinolamp',
      version: VERSION,
      description: 'Личный источник KinoPub без телеметрии'
    };
  }
}
export { nameExtension };
