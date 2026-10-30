# Структура Kinolamp

Структура основана на применимых каталогах
[golang-standards/project-layout](https://github.com/golang-standards/project-layout).
Это общественный шаблон организации Go-проектов, а не официальный стандарт Go.

```text
cmd/kinolamp/                точка входа и тест кода завершения
internal/app/               закрытая реализация приложения
  config.go                 проверка переменных окружения
  runtime.go                настройка HTTP-сервера и graceful shutdown
  server.go                 маршруты, авторизация, CORS, ticket и лимиты
  egress.go                 allowlist, проверка DNS/IP и HTTPS-клиент
  hls.go                    выбор качества/аудио и сокращение HLS master
  app_test.go               проверки серверных сценариев и безопасности
web/
  assets.go                 go:embed для статических файлов
  plugin/                   исходные модули плагина и CSS
  static/kp.js              собранный ES5-плагин Lampa
  static/index.html         страница установки
configs/                    шаблоны конфигурации, без секретов
build/package/Dockerfile    сборка и упаковка контейнера
deployments/                Compose и пример Caddy
test/plugin.test.js         проверки JavaScript и контракта Lampa
docs/                       документация приложения
.github/workflows/          CI в обязательном для GitHub расположении
```

`cmd/kinolamp` вызывает `internal/app`. Основная логика не находится в `main`;
пакет `internal` закрыт для импорта внешними проектами. `web/assets.go` встраивает только явно перечисленные публичные файлы из
`web/static`; модули `web/plugin` в бинарник не попадают. Конфигурация читается из
окружения; локальный `.env` не встраивается и не коммитится.

Папки `pkg`, `api`, `vendor` и остальные части шаблона не создаются без
потребности: у приложения нет публичной Go-библиотеки или внешних runtime-зависимостей.
Инструменты разработки JavaScript закреплены в `package-lock.json`.

Все команды запускаются из корня через Make. Compose получает фиксированное
имя проекта `kinolamp`, конфигурацию `deployments/compose.yaml` и корневой `.env`.
Его build context указывает на корень репозитория. Контейнер и локальная сборка
используют одну точку входа `./cmd/kinolamp` и одни встроенные web-ресурсы.

Название бинарника, Docker-образа и приложения — `kinolamp`. URL `/kp.js` и
префикс локальных настроек `kp_self_` сохранены для совместимости: перенос
исходников не должен сбрасывать существующие сессии KinoPub на устройстве.

`make coverage` проверяет все собственные Go-пакеты с race detector и весь
`web/static/kp.js`: пороги 100% statements для Go и 100% lines/branches/functions
для JavaScript. Собственных исполняемых файлов или пакетов, исключённых из покрытия, нет.
При обнаружении Go-пакетов исключается только `node_modules`: скачанные
npm dev-зависимости иногда содержат свои Go-примеры.


## Native Watch source and menu lifecycle

KinoPub is registered as a source in Lampa's hidden `.buttons--container`. The standard Watch button groups these sources; the plugin does not replace its handlers or add a separate toolbar action. Builds without the native source container show an update message.

Lampa hides Select before calling onSelect, and Select.close itself invokes onBack. Kinolamp must not call close in either callback: doing so in onBack recursively re-enters close. Tests model this native close contract rather than a no-op close stub.

## Device description

An authenticated client posts title, coarse Lampa platform and plugin version to `/v1/device/notify` after login and on startup. This updates the current device, preserving the existing account slot and token. No hardware ID, serial number, MAC address or full user agent is collected. Existing HTTP authentication refresh/race handling also applies to this POST; failures do not block playback. No account device is removed.

## Full-page KinoPub browser

Current Lampa builds register a `kinolamp` Activity/Component. Search results, seasons and video/episode lists use full pages with focusable poster grids, native Scroll and Navigator keyboard/remote navigation. Quality/audio and resume choices remain short native dialogs. Older builds without Activity/Component/Scroll retain the compatible Select path.

Activity history contains only serializable query/item/season routes. DOM nodes, callbacks, API responses, stream URLs and OAuth tokens are not put into the history state. Routes reload their data after a browser restart. Late responses to destroyed pages are ignored. Image URLs are validated as HTTPS; HTTP poster/thumbnail URLs are upgraded and failed images retain a placeholder. Progress labels refresh when returning from playback.

### Native playback UX

On full-card completion the plugin adds a handler through Lampa's Start component API. It runs after the normal button grouping, replacing only the native Watch button's activation and long-press actions; Lampa retains its focus handler. Watch resolves a unique title/year/type match or an IMDb ID. A single-video film starts immediately with the saved position and highest stream within the quality limit. Multiple or missing matches retain the native results page. Series open seasons and episodes. Long press uses Lampa.Select for the available source actions. Builds without the Start extension API retain the source-list integration.

Direct playback passes available qualities to Lampa.Player's `quality` map. No second Back button is rendered inside Kinolamp pages. Settings use SettingsApi and a nested native Settings component; proxy credentials are hidden and removed from focus navigation until proxy mode is enabled. They are preserved in local storage when hidden. Progress reset stays behind confirmation in Advanced.

## Season artwork

Season cards prefer a season-specific KinoPub poster. Otherwise Kinolamp uses
Lampa's existing TMDB API/proxy/cache to resolve the item's IMDb ID and load
TV details. Posters are matched by season number, including specials (season 0),
not by array position or a title search. Only public metadata IDs are sent to
TMDB; KinoPub authorization is never passed to that client.

The optional lookup has a 2.5-second deadline and ignores late callbacks. An
unavailable API, ambiguous result, missing poster or unsupported Lampa build
falls back to an HTTPS frame from the same season, then the series image.
Portrait season covers and landscape episode thumbnails retain separate layouts.
