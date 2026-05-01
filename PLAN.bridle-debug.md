# PLAN: Bridle prompt-debug panel (admin-only)

## Goal

Дать админу видимость в то, что улетает в LLM при чате через bridle:
- полный system prompt,
- история сообщений (то что реально ушло в `llm.complete`/`llm.stream`),
- сырой ответ ассистента (text + tool-calls + stop reason),
- токены (input/output/total) и `credentialId`,
- модель, провайдер, latency.

UI: иконка `Info` рядом с каждым ассистентским сообщением → выезжающая панель (Sheet) с табами **Prompt / Response / Usage**.

Включается только под флагом — без флага runtime ничего лишнего не шлёт, hub ничего не релеит.

## Безопасность

Двойная защита:
1. **Runtime emit gate** — debug-payload эмитится из runtime только если `BRIDLE_DEBUG=true` (или агент в dev-режиме).
2. **Hub admin gate** — даже если runtime прислал `debug` event, hub релеит его только клиентам с `isAdmin === true` (роль `Owner`/`Admin` в JWT).

Если оба условия нарушатся, system-prompt всё равно не утечёт обычному пользователю.

## Архитектура (3 слоя)

```
┌─────────────┐  message     ┌─────────────┐  message    ┌─────────────┐
│   Admin     │─────────────▶│   API hub   │────────────▶│   Runtime   │
│   bridle    │              │  (bridle)   │             │  (loop +    │
│             │◀─────────────│             │◀────────────│   llm)      │
└─────────────┘  stream/     └─────────────┘  stream/    └─────────────┘
                 stream_end                   stream_end
                                              ▼
                                         ┌────────┐
                                         │ debug  │ ◀── NEW event
                                         └────────┘
```

Новый WS-event `debug` едет тем же путём, что и `stream_end`, и привязан к тому же `messageId`.

## Изменения по слоям

| Слой | Slice | Что меняем |
|------|-------|------------|
| **Runtime** | `runtime/loop` | После каждого LLM-ответа в `LoopService.callLlm` собрать debug-snapshot и эмитить его в bridle channel при выполнении 2 условий (флаг + channel === bridle). Снэпшот включает `systemPrompt`, `history`, `response.text`, `response.toolCalls`, `response.stopReason`, `response.usage`, `model`, `provider`, `latencyMs`. |
| **Runtime** | `runtime/setup/channel/bridle` | Добавить метод `sendDebug(to, payload)` — простой `socket.emit('debug', { clientId: to, ... })`. |
| **API hub** | `bridle` | (1) В `bridleAgentWs.handler` принимать `@SubscribeMessage('debug')`. (2) В hub gateway добавить роутинг — но только клиентам с `isAdmin`. (3) В `bridleChatWs.handler` сохранять `isAdmin` в `client.data` (уже есть). (4) Расширить wire-типы в `bridle.types.ts`. |
| **Admin UI** | `bridle` | (1) В store `bridle.ts` — новый state `debugByMessageId`, обработчик WS-events `debug`. (2) В `Message.vue` — кнопка `Info` (только если debug есть). (3) Новый компонент `DebugPanel.vue` (Sheet с tabs, copy-to-clipboard, форматирование JSON). |

Никаких новых слайсов. Никаких изменений в БД. Никаких миграций.

## Что НЕ делаем (out of scope для этой итерации)

- Не сохраняем debug-payloads в БД или S3 — это live-only, по WS, исчезает после обновления страницы. Persistence можно добавить отдельным PR-ом.
- Не показываем debug для **пользовательских** сообщений отдельно — debug привязан к ответу ассистента (там и история целиком, и user-msg как последний event).
- Не показываем debug для streaming-чанков по отдельности — только финальный snapshot после `stream_end`.
- Не делаем UI для включения флага в админке — флаг включается переменной окружения на runtime подах.

## Конфиг

Одна новая переменная в runtime:
```
BRIDLE_DEBUG=true     # эмитить debug события в bridle hub
```

По умолчанию (если не задана и `NODE_ENV !== 'development'`) — **выключено**.

## Acceptance criteria

1. Админ открывает bridle в admin → пишет сообщение → получает ответ.
2. У ответа появляется кликабельная иконка `Info`.
3. Клик открывает Sheet справа с тремя табами:
   - **Prompt**: system prompt + JSON-массив history
   - **Response**: текст ответа + tool calls + stop reason
   - **Usage**: input/output/total tokens, model, provider, credentialId, latency
4. Каждый блок имеет кнопку **Copy**.
5. С `BRIDLE_DEBUG=false` (или unset в проде) иконка не появляется ни у одного сообщения.
6. Не-админ пользователь, подключённый к тому же боту, не видит debug-данных в WS-трафике (проверяется в DevTools).

## Tech stack (FIXED)

NestJS + Socket.IO + Bun (runtime) + Nuxt + Pinia + shadcn-vue (Sheet, Tabs, Tooltip, Button — все уже есть).

---

## Phase 2 — Detailed plan

### Wire types (общие)

```ts
// shared shape (mirror in runtime + api + admin)
export interface IBridleDebugEvent {
  type: 'debug'
  clientId: string
  messageId: string             // mirrors stream_end messageId
  ts: number
  model: string
  provider: string              // 'claude', 'openrouter', etc.
  systemPrompt: string
  history: unknown[]            // raw runtime Event[]
  response: {
    text: string
    toolCalls?: Array<{ name: string; params: unknown }>
    stopReason?: string
  }
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    credentialId?: string
  }
  latencyMs: number
}
```

### Runtime changes

**`runtime/src/slices/setup/channel/domain/channel.gateway.ts`**
- Опциональный новый метод на интерфейсе:
  ```ts
  sendDebug?(to: string, payload: Omit<IBridleDebugEvent, 'type' | 'clientId' | 'ts'>): Promise<void>
  ```

**`runtime/src/slices/setup/channel/data/repositories/bridle/bridle.repository.ts`**
- Реализовать `sendDebug(to, payload)` → `socket.emit('debug', { clientId: to, ts: Date.now(), ...payload })`.
- Если сокет не подключён — silent skip (debug — best-effort).

**`runtime/src/slices/runtime/loop/domain/loop.types.ts`**
- Расширить `ILoopContext` опциональным `sendDebug?: (payload: ...) => Promise<void>` (заполняется из channel).

**`runtime/src/slices/runtime/loop/domain/loop.service.ts`**
- В `callLlm`: обернуть вызов `Date.now()` для latency.
- После получения `response`, если `ctx.sendDebug` есть и `BRIDLE_DEBUG === 'true'` (env-чек прямо тут — runtime короткоживущий, не нужен Config service):
  ```ts
  const enabled = process.env.BRIDLE_DEBUG === 'true' || process.env.NODE_ENV === 'development'
  if (enabled && ctx.sendDebug && ctx.channel === 'bridle') {
    void ctx.sendDebug({
      messageId: ...,  // need: see below
      model, provider, systemPrompt, history,
      response: { text, toolCalls, stopReason },
      usage, latencyMs,
    })
  }
  ```
- **Проблема messageId:** `stream_end`-id генерится внутри `bridle.repository.streamSend` (не возвращается наружу). Решение: пробросить `messageId` через `streamSend` callback или генерить в loop и передавать вниз. **Простейший путь:** генерить `messageId` в loop'е (uuid), передавать в channel.send/streamSend как опциональный аргумент. Если не передан — channel генерит свой (текущее поведение). Это дополнительный мини-рефактор `IChannelGateway.send`.

  **Альтернативa — точечный hack:** не привязывать debug к `messageId` — debug приходит **после** `stream_end`, на admin'е сопоставляем по «последнему ассистентскому сообщению». Менее красиво, но 0 рефакторинга channel API.

  Берём **альтернативу** для скорости: `messageId` в `IBridleDebugEvent` опционален, admin прикрепляет debug к последнему ассистентскому сообщению по таймстемпу. Если позже захочется точное соответствие — добавим messageId-проброс отдельным PR-ом.

**`runtime/src/slices/setup/llm/data/repositories/*.ts`** — нужен provider name. Добавить `readonly provider: string` в каждый repository (`'claude'`, `'openrouter'`, etc.) и пробросить через `LlmService` → возвращать в `ModelResponse`-обёртке. **Минимально:** в LLM-types добавить опциональное `provider?: string` в `ModelResponse`.

  **Упростим ещё:** не трогаем 7 LLM repos. В loop читаем `process.env.LLM_PROVIDER` или из `agentConfig`. В worst case — `'unknown'`. Cosmetic field.

**`runtime/src/slices/runtime/runtime/domain/runtime.service.ts`** — место где собирается `ILoopContext`. Привязать `sendDebug` к active channel: если channel === bridle — берём `bridleRepo.sendDebug.bind(bridleRepo)`, иначе undefined.

### API hub changes

**`ranch/api/src/slices/bridle/domain/bridle.types.ts`**
- Добавить тип `IBridleDebugEvent` (зеркало runtime).
- Расширить `IBridleOutgoingEvent['type']`: добавить `'debug'`.

**`ranch/api/src/slices/bridle/handlers/bridleAgentWs.handler.ts`**
- Новый `@SubscribeMessage('debug') handleDebug(...)` — вызывает новый `hub.handleDebugEvent(botId, data)`.

**`ranch/api/src/slices/bridle/data/bridle.gateway.ts`**
- Хранить `isAdmin` в `IBridleClientData` (расширить тип). В `registerClient` принять `isAdmin: boolean`.
- Новый метод `handleDebugEvent(botId, data)` — итерирует клиентов с `botId === target && isAdmin === true` и пересылает `data`.

**`ranch/api/src/slices/bridle/handlers/bridleChatWs.handler.ts`**
- В `handleConnection` передавать `isAdmin` в `hub.registerClient`.

**`ranch/api/src/slices/bridle/domain/bridle.gateway.ts`** (interface)
- Добавить `abstract handleDebugEvent(botId: string, data: IBridleDebugEvent): void`.
- Расширить сигнатуру `registerClient` параметром `isAdmin`.

### Admin changes

**`ranch/admin/slices/bridle/stores/bridle.ts`**
- Новый интерфейс `IBridleDebugData` (зеркало wire-типа без `type`/`clientId`).
- Новый state: `debugByMessageId: Record<string, IBridleDebugData>` + `lastDebug: IBridleDebugData | null`.
- В `socket.on('debug', ...)` — сохраняем по `messageId`, если нет — кладём в `lastDebug` и привязываем к самому свежему ассистентскому сообщению через геттер.
- Новый getter: `getDebugForMessage(id: string): IBridleDebugData | null` — сначала смотрит точное совпадение по messageId, fallback на последнее ассистентское.

**`ranch/admin/slices/bridle/components/bridle/Message.vue`**
- Добавить prop `debug?: IBridleDebugData | null`.
- Если `message.role === 'assistant' && debug` — рисовать кнопку `Info` (Lucide) рядом с сообщением, по клику emit `'inspect'`.

**`ranch/admin/slices/bridle/components/bridle/DebugPanel.vue`** (новый)
- Sheet справа (side="right", w-[600px]).
- Header: badge с `model` + `provider`, время, latency.
- Tabs: **Prompt** | **Response** | **Usage**.
- Каждый таб с `<pre>` блоком + кнопка Copy (clipboard API).
- Tokens в Usage табе — табличка input/output/total + cost (из `usage` slice уже есть `costUsd` логика на api, но здесь обходимся чистыми числами; cost опционально считаем на лету через захардкоженные тарифы — позже свяжем с api-эндпойнтом).
  - **Решение:** cost не считаем в этой итерации, показываем только токены. PR-cleanup на cost позже.

**`ranch/admin/slices/bridle/components/bridle/Provider.vue`**
- State `inspectedMessageId: ref<string | null>(null)`.
- На `Message` вешаем `@inspect="inspectedMessageId = msg.id"`.
- Внизу `<DebugPanel :open="!!inspectedMessageId" :debug="..." @update:open="inspectedMessageId = null" />`.

**`ranch/admin/slices/bridle/components/bridle/index.ts`** — экспорт `DebugPanel.vue`.

### Реализационный порядок (зависимости)

1. Wire types (api + runtime + admin) — параллельно, идентичны.
2. API hub (gateway + handler + types) — может быть готов и протестирован раньше runtime.
3. Runtime emit (channel.gateway + bridle.repository + loop.service + runtime.service) — требует api hub принимающим event.
4. Admin store — требует чтобы из api приходил event.
5. Admin UI (DebugPanel + Message + Provider) — зависит от store.
6. typecheck/build на api и admin.

### Тестирование

Ручное (UI feature, нет автотестов в проекте):
- Поднять API + runtime с `BRIDLE_DEBUG=true`.
- Открыть admin → bridle → отправить сообщение → проверить:
  - WS-frame `debug` пришёл (DevTools).
  - Иконка Info появилась.
  - Sheet открывается, табы заполнены.
- Без `BRIDLE_DEBUG` — иконка не должна появиться.
- Залогиниться не-админом → frame `debug` не должен прийти на этот сокет.

---

> **Phase 2 done. Implementation начинается.**
