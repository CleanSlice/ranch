/**
 * `CREATOR_OR_OPERATOR_TOOLS` against the tool files (CLEAN-257). The list
 * is what the console tells an Owner beside an ability ("only on agents
 * they created"), and the refusal itself is a call inside each tool, so the
 * two are compared here: every `*.tool.ts` is read as text, cut at each
 * `@Tool({`, and a tool is "refusing" when its part calls `operatorOnly(`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CREATOR_OR_OPERATOR_TOOLS } from './tooling';

const SLICES = join(__dirname, '..');

/**
 * Tools that call `operatorOnly` for one argument and do the rest for a
 * person who was given the tool: not whole refusals, so not in the list.
 */
const REFUSES_A_PART = ['update_agent'];

function toolFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') out.push(...toolFiles(full));
    } else if (entry.endsWith('.tool.ts')) {
      out.push(full);
    }
  }
  return out;
}

function toolsCallingOperatorOnly(): string[] {
  const names: string[] = [];
  for (const file of toolFiles(SLICES)) {
    const parts = readFileSync(file, 'utf8').split('@Tool({').slice(1);
    for (const part of parts) {
      const name = /name:\s*'([a-z0-9_]+)'/.exec(part)?.[1];
      if (name && part.includes('operatorOnly(')) names.push(name);
    }
  }
  return names.sort();
}

describe('CREATOR_OR_OPERATOR_TOOLS', () => {
  it('names exactly the tools that refuse whole with operatorOnly', () => {
    expect(toolsCallingOperatorOnly()).toEqual(
      [...CREATOR_OR_OPERATOR_TOOLS, ...REFUSES_A_PART].sort(),
    );
  });
});
