# Input brief (verbatim, 2026-10-28)

The task description the user gave for CLEAN-184. Kept as written so the plan
phase can take its design decisions from the source instead of from a
paraphrase. `spec.md` states the behaviour; this file holds the proposed
design, which `/speckit-plan` verifies against the deployed LightRAG before
adopting it.

---

# Задача: `query_knowledge` должен отдавать агенту найденные фрагменты, а не ответ чужой LLM

## Обязательный процесс (не пропускать)

1. Прочитай `ranch/CLAUDE.md`, `.cursor/rules/project.mdc`, `.env.project` (ключи не печатать).
2. Заведи Jira-задачу в проекте `CLEAN` (метка `[API]`), назначь на пользователя из `JIRA_EMAIL`, переведи в In Progress. Без `CLEAN-<n>` не коммитить.
3. Ветка `fix/CLEAN-<n>-knowledge-context-retrieval` от `origin/main`.
4. Перед кодом — CleanSlice MCP: `get-started`, `list-categories`, минимум 2 `search` (gateway/repository в слайсе; тесты/спеки в слайсе), `read-doc` при необходимости.
5. Прочитай `ranch/docs/agent-tools.md` — ты меняешь агентский инструмент, чек-лист в конце дока обязателен.
6. Коммит с `CLEAN-<n>`, PR в `main`, ссылку на PR — в Jira.

## Симптом (реальный кейс из прода)

Агент с базой знаний Mazda (26MY Mazda3 Spec Deck) на вопрос
«For the Mazda3 hatchback what trim levels come with adaptive headlights?»
ответил, что точной разбивки по комплектациям у него нет, и посоветовал свериться со спек-шитом.
Правильный ответ есть в документе: AFS стандартно стоит на **2.5 S Premium** и **2.5 Turbo Premium Plus**,
на 2.5 S, Select Sport, Preferred и Carbon Edition его нет.

Агент сделал три параллельных вызова `query_knowledge` с перефразированным вопросом.
Два ответа содержали правильную таблицу. Третий вернул:
«I do not have sufficient information in the provided knowledge base to generate a comprehensive list of 2026 Mazda3 Hatchback trim levels…».
Агент принял этот частичный отказ за свидетельство источника и ушёл в осторожный ответ.

## Корневая причина (проверено по коду)

Цепочка: runtime (агент) → MCP `query_knowledge` → `KnowledgeService.query` → `KnowledgeGateway.searchKnowledge` → `LightragHttpClient.query` → LightRAG `POST /query`.

- `ranch/api/src/slices/reins/lightrag/data/lightragHttp.client.ts:235-258` отправляет в LightRAG
  `{ query, mode: 'hybrid', top_k: 10, include_references: true }`, без `only_need_context`.
  LightRAG сам находит чанки, отдаёт их **своей** LLM, и она пишет ответ.
- `extractQueryResult` (тот же файл, ~строка 532) забирает только `body.response`, то есть сгенерированный текст, и ссылки на файлы.
  **Самих фрагментов документа агент не видит.**
- `knowledge.service.ts:56` `isNoRelevantContentAnswer` ловит только `[no-context]` и `Sorry, I'm not able to provide an answer`.
  Частичные отказы («I do not have sufficient information…», «does not provide a complete…») проходят как нормальный ответ из базы.
- Итог: каждый вызов — независимая выборка плюс независимая генерация. Ответы бывают противоречивыми,
  а отказ чужой LLM агент читает как «в документах этого нет».

## Цель

Агент получает **сырые найденные фрагменты** (чанки текста, плюс сущности и связи графа, если они полезны) с указанием источника
и сам составляет ответ. Генерации ответа внутри LightRAG на пути агента больше нет.

Консольный путь (`POST /knowledge/:id/query` в `knowledge.controller.ts:206-214`, вызывается из `admin/slices/reins/stores/knowledge.ts:142`)
**не трогать**: там пользователь хочет готовый ответ, он остаётся как есть.

## Дизайн

### 1. LightRAG-клиент: новый метод получения контекста

В `lightrag/domain/lightrag.client.ts` (абстракция) и `lightrag/data/lightragHttp.client.ts` добавь метод, например `retrieveContext(input: IQueryInput): Promise<IContextResult>`.

**Сначала проверь, что умеет развёрнутый LightRAG** (образ `ghcr.io/hkuds/lightrag:latest`, под `platform/lightrag` и инстансы отдельных баз):
открой его `/openapi.json` или `/docs` и посмотри, есть ли `POST /query/data`.

- **Если `/query/data` есть (предпочтительно):** он возвращает структурированные данные без LLM-генерации:
  `data.chunks[]` (content, file_path, reference_id), `data.entities[]`, `data.relationships[]`, `data.references[]`.
  Сверь точную схему ответа с `/openapi.json` того же инстанса и не гадай по памяти.
- **Если нет:** `POST /query` с `only_need_context: true`. Тогда `response` — это текстовый контекст (сущности, связи, чанки)
  без генерации. Он менее структурирован, но тоже годится.
- Опиши в коде комментарием, какой путь выбран и почему; если поддерживаешь оба, сделай явный fallback по 404.

Параметры: `mode` по умолчанию `mix` (если инстанс его поддерживает, иначе `hybrid`), `top_k` / `chunk_top_k` подбери так,
чтобы результат влезал в бюджет (см. ниже). Таймаут — тот же `bounded(...)`, `QUERY_TIMEOUT_MS = 50_000` можно уменьшить,
раз генерации больше нет; аргументируй в PR.

### 2. Сервис и шлюз

- `KnowledgeGateway` получает метод `retrieveKnowledgeContext(knowledgeId, query, …)`; `KnowledgeService` — метод `retrieveContext(knowledgeId, query)`.
- Сохрани все текущие гарантии `KnowledgeService.query`: `requireReadable`, ранний выход для пустой изолированной базы
  (`complete && !hasIndexed` → `reason: 'no_relevant_content'`), флаг `complete`, резолв ссылок через `resolveReference`
  (каждый фрагмент должен быть привязан к `sourceId`/`sourceName`).
- Пустой результат (0 чанков) → `reason: 'no_relevant_content'`, как сейчас.

### 3. Инструмент `query_knowledge`

В `knowledge.tool.ts` замени `this.knowledgeService.query(id, query)` на `retrieveContext`. Формат результата для модели:

```json
{
  "knowledge_id": "...",
  "knowledge_name": "Mazda",
  "complete": true,
  "passages": [
    { "source": "26MY Mazda3 Spec Deck.pdf", "source_id": "...", "text": "…точный текст чанка…" }
  ],
  "facts": [ "AFS — Adaptive Front-lighting System: …" ]
}
```

- `passages` — дословный текст чанков, без пересказа. Дубликаты (одинаковый текст из разных режимов поиска) убрать.
- `facts` — опционально, коротко из сущностей и связей графа; не раздувать.
- Сохрани fan-out по базам, логику shared-pool (`migrated` / `sharedPool`) и обработку ошибок/таймаутов — они уже правильные.

**Бюджет размера.** Runtime режет каждый tool_result в истории до `tools.maxOutputChars = 16_000` символов
(`runtime/src/slices/runtime/init/domain/init.types.ts:208`, применение в `runtime/src/slices/runtime/runtime/domain/runtime.service.ts:240-244`).
Обрезка посреди JSON испортит результат. Поэтому собирай ответ так, чтобы он гарантированно влезал примерно в **12 000 символов**
на один вызов: сортируй фрагменты по релевантности, добавляй целиком, пока влезает, остальные отбрасывай и пиши
`"truncated": true, "omitted_passages": N`. Если базы несколько, бюджет делится между ними.

### 4. Описание инструмента (`BASE_DESCRIPTION`)

Обнови текст под новое поведение. Сейчас там «Returns matched content with citations» — сделай это правдой и добавь:
- результат — дословные фрагменты документов; отвечай по ним и цитируй источник;
- отсутствие фрагментов по одному запросу не опровергает факт, найденный другим запросом;
- если фрагменты прямо отвечают на вопрос, отвечай уверенно и без оговорок «не могу гарантировать».

Сохрани существующие требования: вызывать до ответа, батчить независимые вопросы. Комментарий над константой про батчинг
обнови: генерации больше нет, цифры 198 s / 35 s устарели — замерь заново или убери.

### 5. Страховка для консольного пути (маленькая, отдельным коммитом)

Расширь `isNoRelevantContentAnswer` или добавь `isPartialRefusal`, чтобы ловить частичные отказы LightRAG
(«I do not have sufficient information», «does not contain enough information», «not able to provide a complete»),
и помечай такие ответы в консоли. Агентский путь от этого уже не зависит, но консоль сейчас показывает те же отказы как ответ.

## Тесты (обязательны)

Спеки лежат рядом со слайсом (`*.spec.ts`), смотри существующие `knowledge.tool.spec.ts`, `knowledge.isolation.spec.ts`,
`lightragHttp.client.spec.ts` и делай так же.

1. `lightragHttp.client.spec.ts`: `retrieveContext` шлёт правильный эндпоинт и тело (без генерации); парсит чанки и ссылки;
   fallback на `only_need_context` при 404 (если реализован); таймаут даёт `LightragTimeoutError`.
2. `knowledge.tool.spec.ts`:
   - результат содержит `passages` с дословным текстом и привязкой к источнику;
   - результат не превышает бюджет; при переполнении есть `truncated: true` и это валидный JSON;
   - пустая база → `no_relevant_content`, LightRAG не вызывается;
   - ошибки/таймауты одной базы не роняют остальные (как сейчас);
   - **регрессия Mazda**: мок LightRAG возвращает чанк с таблицей AFS → в выходе инструмента есть «2.5 S Premium» и «2.5 Turbo Premium Plus».
3. `knowledge.isolation.spec.ts`: изоляция баз сохраняется на новом пути (агент не получает чанки чужой базы).
4. Консольный `POST /knowledge/:id/query` по-прежнему возвращает сгенерированный `answer` — тест, что его не задело.

`bun test` (или принятая в репо команда) — зелёный; приложи вывод в PR.

## Ручная проверка (Definition of Done)

1. Задеплоить на стейдж или локально поднять с реальным LightRAG-инстансом базы Mazda.
2. Спросить агента: «For the Mazda3 hatchback what trim levels come with adaptive headlights?»
   Ожидание: прямой ответ «2.5 S Premium и 2.5 Turbo Premium Plus», без оговорок, со ссылкой на 26MY Mazda3 Spec Deck.
3. Повторить 5 раз. Ответ должен быть стабильным (раньше зависел от того, какой из параллельных запросов «отказал»).
4. Ещё 3–4 вопроса по спек-деку, где ответ — таблица или список (цены, двигатели, комплектации): проверить, что в результате инструмента
   есть нужные фрагменты и он не превышает бюджет.
5. Сравнить время ответа агента до и после (ожидаем быстрее: LightRAG больше не генерирует).
6. В PR: какой эндпоинт LightRAG использован, пример реального результата инструмента (обрезанный), замеры времени.

## Чего не делать

- Не менять консольный эндпоинт и UI admin/app (кроме пункта 5).
- Не поднимать `maxOutputChars` в runtime ради этой задачи — уложиться в бюджет на стороне API.
- Не пересказывать чанки LLM-ом на стороне API: весь смысл в том, чтобы агент видел первоисточник.
- Не трогать дубль клиента в `reins/nestjs/` (отдельный репо), только отметить в PR, что там та же проблема.

## Отдельно: проверить гипотезу про UI (не блокирует задачу, можно отдельным тикетом)

В первом ответе агент написал «I cannot provide the specific trim-level table shown above», но пользователь никакой таблицы не видел.
Похоже, агент выписал таблицу в промежуточном текстовом сообщении между вызовами инструментов, а чат спрятал его
в свёрнутый блок «Thought for a moment», показав только финальный текст. Найди сессию этого агента, посмотри события
(текст ассистента между `tool_call`) и проверь, как `app`/`admin` (слайс `chat`, оба консоли — twin) рендерят промежуточный текст.
Если гипотеза подтвердится — заведи отдельный `CLEAN`-тикет с найденным.

---

## Corrections found while verifying the brief against the code (2026-10-28)

- Runtime cap: `tools.maxOutputChars = 16_000` is set at
  `runtime/src/slices/runtime/init/domain/init.types.ts:325` (declared at
  `:145`) and applied in
  `runtime/src/slices/runtime/runtime/domain/runtime.service.ts:284-288` for
  the rebuilt history and through `capPayload` in `loop.service.ts` for the
  live tool result. The line numbers in the brief are stale; the figure is right.
- The runtime's cap is structure-aware for plain objects and arrays, but an
  MCP result reaches it as `[{ type: "text", text: "<json>" }]`, one string,
  so the string is sliced and the JSON does break. The budget on the API side
  is therefore necessary, as the brief says.
- The console endpoint (`knowledge.controller.ts:206-214`,
  `operationId: queryKnowledge`) is confirmed. The admin store call site was
  not re-checked line by line.
- The CleanSlice MCP named in step 4 (`get-started`, `list-categories`,
  `search`, `read-doc`) is not connected in the session that wrote this spec.
  The plan phase runs it, or states that it was unavailable.
