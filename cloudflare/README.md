# Развёртывание Worker через терминал (альтернатива Cloudflare Builds)

Основная инструкция без терминала находится в `НАЧНИТЕ-ЗДЕСЬ.md` в корне архива.

Нужен Node.js 22+ и доступ к тому Cloudflare-аккаунту, где создан ai-chat-agent.

```bash
cd cloudflare
npm install
npx wrangler login
npm test
npx wrangler deploy
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put AGENT_PASSWORD
```

Команды secret put запрашивают значения интерактивно. Не добавляйте значения в командную строку, историю терминала, исходники или GitHub. Вместо этих двух команд можно добавить секреты в Cloudflare Dashboard → Worker → Settings → Variables and Secrets, тип Secret.

Для генерации отдельного пароля:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Пароль создаётся на вашей машине; сохраните его в своём менеджере паролей и используйте как AGENT_PASSWORD. Это не GitHub-токен.

## Привязка памяти

`wrangler.jsonc` содержит:
- binding `AGENT_STATE` на класс `AgentState`;
- SQLite Durable Object migration `v1` / `new_sqlite_classes`;
- обычные несекретные переменные ALLOWED_ORIGIN, GITHUB_OWNER, SOURCE_REPO.

Не удаляйте/не переименовывайте класс или binding без понимания миграций: потеря памяти означает потерю реестра управляемых приложений. Весь владелец обслуживается одним Durable Object для последовательного исполнения запросов; это личный, не высоконагруженный многопользовательский сервис.

Обращение к URL Worker обычной вкладкой может вернуть 403: запрос не имеет нужных Origin и Authorization. Проверяйте кнопкой подключения в приложении.

## Диагностика

- 503 / AGENT_STATE — не применены binding/migration. Разверните **весь проект**, не один worker.mjs.
- 503 / GITHUB_TOKEN — секрет отсутствует.
- 401 — неправильный AGENT_PASSWORD.
- 403 / источник — ALLOWED_ORIGIN должен быть точным origin чата без пути; для этого сайта https://kuksa7.github.io.
- GitHub MCP 401/403 — токен истёк, не поддерживается или не хватает разрешений.
- GitHub HTTP 403 при Pages — проверьте Pages/Administration permissions и политики аккаунта.
- Модель HTTP 400 — проверьте поддержку tools, parallel_tool_calls и max_tokens выбранной моделью. Не отключайте защитные проверки ради обхода ошибки.
- Модель не использует инструменты — попробуйте модель с надёжной поддержкой function calling. Если MCP-журнал не подтверждает действие, оно не считается выполненным, даже если модель так написала.
- Текущий код чата слишком большой для модели — начните с чтения одного файла и небольшой задачи; возврат полной изменённой версии index.html может превышать лимиты модели.
- Ошибка после подтверждения — проверьте GitHub до повторного запуска. Операция могла частично выполниться. Автоматического отката/повторного создания нет.

В конфигурации разрешены только HTTPS API-адреса провайдеров из исходного чата. Дополнительный адрес можно явно разрешить серверной несекретной переменной `LLM_ALLOWED_BASES`, JSON-массив строк. Произвольные адреса из ответа модели не принимаются.

## MCP и API

MCP-клиент использует официальный `https://api.githubcopilot.com/mcp/`, проходит initialize/initialized, проверяет tools/list, вызывает только get_me, get_file_contents, create_repository, push_files, create_branch, create_pull_request. Ответы JSON и SSE разбираются отдельно, JSON-RPC ошибки не маскируются под успех.

REST-дополнение ограничено GitHub metadata, чтением heads, /user и включением Pages. Модель не получает произвольный HTTP-инструмент, токен GitHub или инструмент удаления/слияния PR. Проверяйте код до добавления новых инструментов.

API чата:
- GET /api/status — проверка MCP и владельца.
- POST /api/chat — conversationId, message, provider {baseUrl, key, model}.
- POST /api/state — состояние подготовленного действия.
- POST /api/decision — conversationId, planId, approve: true|false.

Все маршруты требуют Origin и Bearer AGENT_PASSWORD. Модельный ключ живёт только в памяти запроса, не сохраняется в Durable Object. Содержимое сообщений/файлов сохраняется до 7 суток бездействия с ежедневной очисткой. Ошибки не логируют полный запрос; не добавляйте такое логирование самостоятельно.

Тесты `npm test` используют Node.js-моки fetch и SQLite storage, **не эмулятор Cloudflare и не реальные GitHub-запросы**. Нужна реальная проверка после деплоя.
