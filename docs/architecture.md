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
  static/kp.js              плагин Lampa
  static/index.html         страница установки
configs/                    шаблоны конфигурации, без секретов
build/package/Dockerfile    сборка и упаковка контейнера
deployments/                Compose и пример Caddy
test/plugin.test.js         проверки JavaScript и контракта Lampa
docs/                       документация приложения
.github/workflows/          CI в обязательном для GitHub расположении
```

`cmd/kinolamp` вызывает `internal/app`. Основная логика не находится в `main`;
пакет `internal` закрыт для импорта внешними проектами. `web` содержит только
разрешённые публичные файлы, встроенные в бинарник. Конфигурация читается из
окружения; локальный `.env` не встраивается и не коммитится.

Папки `pkg`, `api`, `vendor` и остальные части шаблона не создаются без
потребности: у приложения нет публичной Go-библиотеки или внешних зависимостей.

Все команды запускаются из корня через Make. Compose получает фиксированное
имя проекта `kinolamp`, конфигурацию `deployments/compose.yaml` и корневой `.env`.
Его build context указывает на корень репозитория. Контейнер и локальная сборка
используют одну точку входа `./cmd/kinolamp` и одни встроенные web-ресурсы.

Название бинарника, Docker-образа и приложения — `kinolamp`. URL `/kp.js` и
префикс локальных настроек `kp_self_` сохранены для совместимости: перенос
исходников не должен сбрасывать существующие сессии KinoPub на устройстве.

`make coverage` проверяет весь модуль через `go test -race ./...` и весь
`web/static/kp.js`: пороги 100% statements для Go и 100% lines/branches/functions
для JavaScript. Исполняемых файлов или пакетов, исключённых из покрытия, нет.
