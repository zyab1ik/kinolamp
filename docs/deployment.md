# Автодеплой Kinolamp

Workflow `CI and Deployment` (`.github/workflows/ci.yml`) запускает параллельно проверки Go/JS, 100% покрытие и проверку Docker. Только main после успешных проверок передаёт проверенный образ на `debian@eu3.filefor.net:2223`. Сайт: https://kp.eu3.filefor.net/.

Workflow запускается один раз для PR в main и один раз после push/слияния в main; дублирующий push-run для ветки PR отключён. Названия workflow, jobs, шагов и итоговый отчёт — на английском. Устаревшие PR-запуски отменяются; текущая выкладка main не прерывается.

В pull request и других ветках выкладка пропускается. До завершения установки `DEPLOY_ENABLED` не задан — деплой выключен. Итоговая таблица CI отличает проверку кода от выкладки. Для повторного запуска есть Run workflow из main; перед отправкой проверяется, что SHA ещё соответствует последнему main.

## Однократная настройка

1. Установить `scripts/deploy-receiver.sh` на VPS как `/usr/local/libexec/kinolamp-deploy`, владелец root, права 0755. Установить `deployments/compose.production.yaml` как `/etc/kinolamp/compose.yaml`, root:root 0644. Обновления этих двух инфраструктурных файлов устанавливаются отдельно; поступающий образ их не меняет.
2. Сохранить существующий `/home/debian/kinolamp/.env` (права 0600). OAuth и другие секреты приложения остаются на устройстве/VPS; файл не отправляется в GitHub. Адрес и порт сервиса сохраняются.
3. Создать отдельный Ed25519 SSH-ключ для Actions. Не использовать личный ключ. В `/home/debian/.ssh/authorized_keys` добавить только его публичную часть с ограничением:

   ```text
   restrict,command="/usr/local/libexec/kinolamp-deploy" ssh-ed25519 PUBLIC_KEY kinolamp-actions-production
   ```

   Такой ключ выполняет только `deploy <40-символьный SHA>`, без shell, PTY и пробросов. Пользователь debian имеет доступ к Docker; доверяй тем, кто может изменять workflow и код репозитория.
4. Сохранить приватную часть в repository secret `DEPLOY_SSH_KEY`. В `DEPLOY_KNOWN_HOSTS` записать проверенный ключ сервера в формате `[eu3.filefor.net]:2223 ssh-ed25519 ...`. Получать его через уже доверенное SSH-соединение, не доверять результату непроверенного `ssh-keyscan` автоматически. Локальную временную приватную копию удалить после установки и проверки; ключ остаётся в GitHub Secrets.
5. Проверить ограничение команды и успешную выкладку текущего образа через этот ключ. Убедиться, что образ помечен `org.opencontainers.image.revision=<SHA>` и имеет тег `kinolamp:<SHA>`.
6. Последним шагом установить repository variable `DEPLOY_ENABLED=true`. После слияния workflow в main запустить его из main и проверить итоговый SHA на сервере.

Используются repository secrets: отдельное environment не требуется. GitHub предоставляет запись секретов workflow, поэтому права записи в репозиторий означают доверие к деплою. Условие main в YAML не является отдельным барьером против человека, который вправе менять сам workflow.

## Что проверяется при выкладке

- Строгая проверка SSH host key и отдельный ключ без интерактивного доступа.
- SHA формата ровно 40 hex, целостность gzip, лимит архива 128 MiB и совпадение SHA с label Docker-образа.
- Один деплой одновременно: concurrency в Actions и flock на VPS.
- Пересоздание только сервиса Kinolamp с существующим `.env`; read-only, non-root, без capabilities.
- Health контейнера и локального HTTP, затем публичные HTTPS health и kp.js из Actions.
- При ошибке запуска/локального health — восстановление предыдущего image ID и повторная проверка. Если откат тоже не прошёл, job завершается ошибкой для ручного разбора. Ошибка внешней HTTPS-проверки после здорового локального запуска останавливает job; она может быть вызвана внешним шлюзом и сама по себе не переключает образ.

Пересоздание контейнера может дать краткий перерыв. Приватный ключ не передаётся на VPS; на нём остаётся публичный ключ. Проверенный архив хранится в Actions один день и удаляется с VPS после обработки. Docker-образы остаются для отката; их удаление выполняется отдельно и не затрагивает работающий контейнер.

## Управление и диагностика

```sh
make check
make check-ci
make test-deploy
make coverage
make docker-build
```

`make up` — ручная сборка из локального checkout. После настройки автодеплоя production обновляется workflow, поэтому ручной `make up` из старого checkout может вернуть старую версию.

На VPS последняя успешная ревизия находится в `/home/debian/.local/state/kinolamp-deploy/revision`. Логи контейнера доступны через `docker logs --tail 50 kinolamp-kinolamp-1`, состояние — через `docker inspect`. Секреты `.env` в логи не выводить.

Тест `make test-deploy` проверяет успешное обновление, слишком большой/повреждённый архив, неверный SHA label, ошибку запуска, откат по health, ошибку самого отката и отказ произвольным SSH-командам. Go/JS coverage проверяется отдельно и остаётся 100%.

## GitHub Actions practices

- Read-only `GITHUB_TOKEN` by default, with `actions: read` only for downloading the deployment artifact.
- Actions pinned to full commit SHAs; checkout does not persist Git credentials.
- Secrets are passed through environment variables only in the deployment step; no `pull_request_target` or execution of PR code with deployment credentials.
- Explicit timeouts, branch filters, PR concurrency and serialized deployments.
- The tested image is transferred between jobs using an immutable artifact, retained for one day.
- `make check-ci` validates workflow syntax and job dependencies with a pinned actionlint version.

References: [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use), [workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow), [concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
