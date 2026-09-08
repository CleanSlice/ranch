# Contract: Agent-facing document block

The text `BridleAttachmentService.expand()` appends to the user's message for one attachment, and the grammar `TranscriptReaderService` uses to remove it again at read time. Both directions must agree; this file is the single source.

## 1. Composition of the message text

```
<typed text, trimmed>            ← may be empty
\n\n
<block 1>
\n\n
<block 2>
…
```

Blocks appear in the order of `attachmentIds`. When there are no blocks the text is the typed text unchanged (no trailing newlines).

## 2. Block grammar

Every block starts at the beginning of a line with the literal `[Attached file: `.

### 2.1 Fenced block (text kinds, PDF, DOCX, spreadsheets)

```
[Attached file: <name> — id: <uuid>]<optional hint>
```
<body>
```
```

- `<name>` is the original filename (may contain any character except a newline).
- `<uuid>` is the attachment id (36-char UUID).
- `<optional hint>` is present only for spreadsheets: `` — this is a preview; call query_attachment with this id for exact sums, counts and lookups. ``
- `<body>` never contains a line consisting solely of three backticks. If extracted text contains such a line, the fence is widened to four backticks (CommonMark rule) and the closing fence matches.
- A truncation notice, when present, is the **last line inside the fence**: `[… <n> characters truncated — attached file was longer than the <limit>-character limit …]` (existing wording) for PDF/DOCX/text; spreadsheets never use this notice, they report omissions per sheet (see §3).

### 2.2 Notice line (unreadable binaries and extraction failures)

```
[Attached file: <name> — id: <uuid> (<mime>, <n> bytes). Its contents are not readable in this chat — it is delivered as a named reference only.]
```

Single line, no fence.

### 2.3 Legacy forms (must still be recognised on read)

Transcripts written before CLEAN-67 contain the same two shapes without ` — id: <uuid>`:

```
[Attached file: <name>]
```
…
```
```
and
```
[Attached file: <name> (<mime>, <n> bytes). Its contents are not readable …]
```

## 3. Spreadsheet body format

```
Workbook: 3 sheets — 1 "Накл. на склад(1)" (visible, 48 rows × 40 cols used, 6 merged regions); 2 "Накл. на склад(2)" (visible, 9 × 12, 2 merged); 3 "Розрахунки" (hidden, 120 × 8, 0 merged)

== Sheet 1: Накл. на склад(1) == visible · 48 rows × 40 cols used · rows 1–48 included · 0 rows omitted
R1: A1[A1:AN1]=ТОВ "Асканія-Флора"
R2: A2[A2:AN2]=Постачальник:
R4: B=Товар | C=Кількість | D=Ціна | F=Сума
R5: B=Троянда Red Naomi | C=120 | D=45.5 | F=[=]5460
R6: B=Троянда Avalanche | C=80 | D=52 | F=[=]4160
(rows 7–9 empty)
R10: B=Сума без ПДВ | F=[=]162231.5
R11: B=ПДВ (20%) | F=[=]32446.3
R12: B=ВСЬОГО ДО СПЛАТИ | F=[=]194677.8

== Sheet 2: Накл. на склад(2) == visible · 9 rows × 12 cols used · rows 1–9 included · 0 rows omitted
…

== Sheet 3: Розрахунки == hidden · 120 rows × 8 cols used · rows omitted (hidden sheet; pass include_hidden to query_attachment to read it)
```

Rules:

| Rule | Detail |
|---|---|
| Workbook line | Always first. Lists every sheet (hidden included) with index, name, state, used size, merged count. |
| Sheet header | `== Sheet <index>: <name> ==` then ` · `-separated: state, used size, `rows a–b included`, `<n> rows omitted`. |
| Row line | `R<n>: ` followed by cells joined with ` \| `. Only non-empty cells. Column letter only (`B=`) unless the cell is a merge master, then full address + span (`A1[A1:AN1]=`). |
| Merged region | Emitted once at its master cell with `[<range>]`. Other cells in the range never appear. |
| Formula cell | Value prefixed with `[=]`. |
| Error cell | Value is the Excel error text, e.g. `#REF!`. |
| Empty rows | One empty row: visible via the jump in `R<n>`. Two or more consecutive: `(rows a–b empty)` on its own line. |
| Cell text | Pipes inside a value are escaped as `\|`; newlines inside a value become `⏎`. |
| Hidden sheet | Header line only, with the hint to use `include_hidden`. |
| Budget | `SPREADSHEET_PREVIEW_ROWS_PER_SHEET` non-empty rows per sheet and `SPREADSHEET_INLINE_BUDGET_CHARS` for the whole body, whichever hits first, always at a row boundary. The header of every sheet reports exact `included`/`omitted` counts. A sheet that got no rows says `rows omitted (preview budget exhausted; use query_attachment)`. |

## 4. DOCX body format

Paragraphs separated by one blank line. Tables: one line per row, cells joined with ` | `. List items prefixed with `- `. Headings as plain lines (no `#`, so the fence body cannot be mistaken for markdown structure).

## 5. Read-time split (TranscriptReaderService)

Given a `user` event's `data.text`:

1. Find the first line that starts with `[Attached file: `. If none: `text = data.text`, no `agentText`.
2. From that line to the end, parse a sequence of blocks: each is either a notice line (§2.2/§2.3 second form) or a header line followed by a fence body up to and including a closing fence of the same width. Blocks are separated by exactly one empty line.
3. If the sequence parses to the end of the string: `text = everything before the first block`, right-trimmed; `agentText = data.text`.
4. If the sequence does not parse (user text happened to contain the marker, or a truncated JSONL line): leave `text = data.text`, no `agentText`. Never drop content on a parse failure.

The function is pure and exported (`splitAttachmentBlocks(text): { text, agentText? }`) so the chat export formatter and tests use the same implementation.
