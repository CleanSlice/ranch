# UI Contract: Widget thinking display (SDK `<bridle-chat>`)

**Feature**: [spec](../spec.md) | **Wire contract**: [thinking-event.md](./thinking-event.md) | **Reference**: Rovo screenshot in CLEAN-10 / spec header | **Date**: 2026-08-14

All markup/styles live inside the widget's shadow root (`BridleChat.ce.vue`), BEM family `.bridle__thinking*`, themed exclusively via existing `--bridle-*` custom properties (both color modes, `cleanslice` and `default` themes, `themeVars`/`customCss` overrides keep working).

## Structure (replaces the `.bridle__typing` dots block; matches the Rovo reference pattern)

```text
.bridle__thinking                         # block container, in message flow where dots were
├── .bridle__thinking-header              # row: status text + block chevron (FR-003, FR-006)
│   ├── .bridle__thinking-status          # «{title}» is thinking…  ← shimmer while status='thinking'
│   └── .bridle__thinking-toggle          # chevron button, rotates when collapsed
├── .bridle__thinking-steps               # vertical timeline, thin left rule (hidden when collapsed)
│   └── .bridle__thinking-step            # one per step, arrival order
│       ├── .bridle__thinking-step-head   # icon/bullet + label + per-step chevron (only if detail)
│       │       modifier: --active        # in-progress step, visually distinct (FR-007)
│       └── .bridle__thinking-step-detail # reasoning prose, rendered via existing renderMarkdown
└── (status='done')                       # header becomes summary row: "Thought for a moment" / step count,
                                          # shimmer off, block auto-collapsed, re-expandable (FR-006)
```

Behavioral rules:

- Appears on `typing` event; shimmer runs only while `status='thinking'`.
- The block stays visible above the growing answer while text streams below it; it freezes and auto-collapses on the terminal `thinking done: true` event (backstops: ~75 s inactivity watchdog, socket `close`). Mid-turn `stream_end`s of interim bubbles never freeze it.
- Steps arrive collapsed; per-step expand only where `detail` exists; expanding/collapsing never moves the composer or steals scroll (spec US2-AS1); auto-follow only when the visitor is already at the bottom (existing widget scroll behavior).
- No steps published ⇒ header line only — never an empty timeline (US2-AS5).
- Zero-duration turns (answer faster than the first paint) must not flash artifacts: the block renders only if `typing`/`thinking` precedes the first text.

## Shimmer (research D5)

- Gradient sweep clipped to text: `linear-gradient(90deg, <muted>, <bright>, <muted>)` over `background-size: 200%`, animated `background-position`, `-webkit-background-clip: text; background-clip: text; color: transparent`. Duration ~1.6 s, linear, infinite. Colors derived from existing text/muted `--bridle-*` tokens — must pass in both color modes.
- `@media (prefers-reduced-motion: reduce)`: animation removed; status renders as static muted text (FR-011). Applies to any other decorative motion in the block.

## Accessibility (FR-011)

- Block container: `role="status"` + `aria-label` mirroring the status text while thinking (replaces the dots' current `aria-label="Agent is typing"`).
- Block and per-step chevrons are real `<button>`s with `aria-expanded`; step detail regions reference their header (`aria-controls`/`id` pairing).
- Shimmer is purely decorative — text remains real DOM text, readable by screen readers.

## Public API surface changes (SDK)

| Surface | Change |
|---------|--------|
| `capabilities` (connect auth) | + `'thinking'` |
| `BridleClient.on(...)` | new overload: `on('thinking', (e: IBridleThinkingEvent) => void)` |
| `types.ts` | + `IBridleThinkingStep`, `IBridleThinkingEvent`, `IThinkingBlock` (blocks are standalone in-flow items interleaved with messages; `IBridleMessage` unchanged) |
| Init options | **unchanged** (status text uses existing `title`; D10) |
| CSS | new `.bridle__thinking*` family; `.bridle__typing` dots removed with the shimmer replacing their role |

## Ranch admin parity (P3, research D9)

Same behavioral rules re-implemented in `admin/slices/bridle/` (Pinia store handles `thinking`; Tailwind/shadcn styling adapted to admin idiom — e.g. `animate-*` utilities + local keyframes). Admin store connects with the `'thinking'` capability. No shadow DOM there; class names free-form.
