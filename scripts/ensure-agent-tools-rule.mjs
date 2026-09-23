#!/usr/bin/env node
/**
 * Puts the agent-tools rule pointer back into the graft-owned guidance files
 * (CLEAN-109). `graft init` rewrites `.claude/skills/graft/SKILL.md` and
 * `.cursor/rules/graft.mdc` wholesale, so a rule written into them by hand is
 * lost on the next init; this script re-inserts a short fenced block that
 * points at the canonical doc. Idempotent: run it as often as you like.
 *
 *   node scripts/ensure-agent-tools-rule.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const START = '<!-- ranch:agent-tools:start -->';
const END = '<!-- ranch:agent-tools:end -->';
const BLOCK = [
  START,
  '## Project rule: agent tools',
  '',
  'A module is not done until the Ranch agent has tools for what the console',
  'can do. Before adding or changing an admin-console capability, read',
  '`docs/agent-tools.md`: tools live in the slice as `<name>.tool.ts` with',
  '`topic` / `title` / `template`, audience gating, `confirm` on anything',
  'destructive, no secrets in results, and a spec. The API refuses to boot a',
  'tool without that metadata.',
  END,
  '',
].join('\n');

const targets = ['.claude/skills/graft/SKILL.md', '.cursor/rules/graft.mdc'];

let changed = 0;
for (const rel of targets) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    console.log(`skip  ${rel} (not present)`);
    continue;
  }
  const current = readFileSync(path, 'utf8');
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const block = BLOCK.replace(/\n/g, eol);
  const start = current.indexOf(START);
  const end = current.indexOf(END);
  let next;
  if (start !== -1 && end !== -1 && end > start) {
    const existing = current.slice(start, end + END.length);
    const fresh = block.trimEnd();
    if (existing === fresh) {
      console.log(`ok    ${rel}`);
      continue;
    }
    next = current.slice(0, start) + fresh + current.slice(end + END.length);
  } else {
    const trimmed = current.replace(/\s+$/, '');
    next = `${trimmed}${eol}${eol}${block}`;
  }
  writeFileSync(path, next);
  changed += 1;
  console.log(`wrote ${rel}`);
}

console.log(changed ? `${changed} file(s) updated` : 'nothing to do');
