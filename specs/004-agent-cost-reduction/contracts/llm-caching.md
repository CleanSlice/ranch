# Contract: Cached LLM Requests (Claude repository)

**Provider**: `ClaudeRepository.stream()` / `ClaudeRepository.complete()` (`runtime/src/slices/setup/llm/data/repositories/claude/claude.repository.ts`)
**Consumers**: `LoopService.callLlm()` (all agent LLM traffic — heartbeat, cron, and user turns share this path)

## Request shape

Every Anthropic request sends the system prompt as a cache-marked content block:

```jsonc
{
  "model": "<agent model>",
  "max_tokens": "<unchanged>",
  "system": [
    {
      "type": "text",
      "text": "<systemPrompt — unchanged bytes>",
      "cache_control": { "type": "ephemeral", "ttl": "1h" }
    }
  ],
  "messages": ["<unchanged>"],
  "tools": ["<unchanged — render before system, covered by the same breakpoint>"]
}
```

Client construction adds the beta flag `extended-cache-ttl-2025-04-11` to `anthropic-beta` default headers on **both** client kinds (OAuth clients append to the existing `oauth-2025-04-20,claude-code-20250219`; the API-key client gains the header).

## Behavioral guarantees

| Guarantee | Detail |
|---|---|
| Correctness-neutral | Cache state never changes response content. Miss/expiry/below-minimum-prefix (< 4096 tokens on Haiku 4.5) silently process at full price — no errors, no retries added. Covers spec FR-008. |
| Warm steady-state | TTL refreshes on every hit; at the default 30-min heartbeat cadence a 1h entry stays warm: one 2× write then ~0.1× reads on the tools+system prefix. Covers FR-007 / SC-004. |
| Fallback paths | Model fallback and multi-token client switching keep the same request shape; a model switch cold-starts its own cache (provider semantics), which only costs one extra write. |
| Other providers | `google`, `openai-compat`, `claudecli` repositories are byte-for-byte unchanged. |

## Observability & cost accounting

- The per-call repository log line reports the raw split: `in=<uncached> out=<n> cache_write=<n> cache_read=<n>`. Verification recipe for SC-004 lives in [quickstart.md](../quickstart.md).
- `ModelUsage.inputTokens` (what flows into usage.json → ranch) is **billing-equivalent**: `round(input + 0.1 × cache_read + 2 × cache_write)`, so flat-rate cost math downstream yields exact dollars (see research.md D5, amended). Without cache activity it equals raw `input_tokens` — pre-caching behavior is unchanged.

## Non-goals (recorded)

- No second breakpoint on message history (deferred; see research.md D4).
- No ranch-side schema changes; literal cache-token fields + blended pricing (and cache-hit-rate UI) remain follow-up work per research.md D5.
