import { readFileSync } from 'fs';
import * as path from 'path';

/**
 * The Rancher template that every Ranch admin agent is deployed from
 * (CLEAN-232, T105 and T036). Three things about its text are worth a test,
 * because each of them was true once and nothing noticed:
 *
 *  1. It teaches no way around the tools. The template used to tell the
 *     agent that raw HTTP against the Ranch API with its own bearer "always
 *     works" and to "pivot to http" when a tool was missing. That bearer
 *     carries Owner, so the advice was a recipe for doing Owner things for
 *     whoever was asking.
 *  2. Guidance that points at the management console sits inside
 *     `admin-only` blocks, which the runtime strips for anybody who is not
 *     an administrator of the agent. HEARTBEAT.md and the skill are not
 *     stripped by the runtime, so they do not mention it at all.
 *  3. SOUL.md fits the prompt limit its own agent.config.json sets
 *     (CLEAN-230): past it the runtime cuts the file mid-sentence.
 */

const TEMPLATE = path.resolve(__dirname, '../../../../rancher/.agent');
const read = (file: string) => readFileSync(path.join(TEMPLATE, file), 'utf8');

const FILES = ['SOUL.md', 'HEARTBEAT.md', 'skills/ranch/SKILL.md'] as const;

/** The runtime's own pattern (`stripAdminBlocks` in agent.service.ts). */
const ADMIN_BLOCK = /<!--\s*admin-only\s*-->[\s\S]*?<!--\s*\/admin-only\s*-->/g;
const forEveryone = (text: string) => text.replace(ADMIN_BLOCK, '');

describe('the Rancher template teaches no way around its tools', () => {
  it.each(FILES)(
    '%s names no bearer, no API address and no HTTP recipe',
    (file) => {
      const text = read(file);
      for (const banned of [
        'RANCH_API_TOKEN',
        'RANCH_API_URL',
        'Authorization',
        'Bearer',
        '/api-json',
        'http({',
        'http GET',
        'http POST',
        'http PUT',
        'http PATCH',
        'http DELETE',
        'pivot to',
        'always works',
        'always available',
        'echo $',
      ]) {
        expect([file, banned, text.includes(banned)]).toEqual([
          file,
          banned,
          false,
        ]);
      }
    },
  );

  it.each(FILES)(
    '%s gives no REST route of the API as something to call',
    (file) => {
      // `GET /agents`, `POST /knowledges/{id}/query` and the like.
      const routes = read(file).match(
        /\b(GET|POST|PUT|PATCH|DELETE)\b[^\n|]{0,12}`?\/[a-z]/g,
      );
      expect([file, routes]).toEqual([file, null]);
    },
  );

  it('SOUL.md says it in so many words, where every caller reads it', () => {
    const soul = forEveryone(read('SOUL.md'));
    expect(soul).toContain(
      'You work through your tools, and only through them.',
    );
    expect(soul).toContain('There is no other route.');
    expect(soul).toContain('Never show a credential.');
  });

  it('the skill says the same, and sends nobody to another route', () => {
    const skill = read('skills/ranch/SKILL.md');
    expect(skill).toContain('your tools, and only through them');
    expect(skill).not.toMatch(/fall ?back/i);
  });
});

describe('the management console is mentioned to administrators only', () => {
  const CONSOLE =
    /management console|admin UI|admin console|Files tab|Agents → New/i;

  it('SOUL.md: only inside admin-only blocks', () => {
    const soul = read('SOUL.md');
    // It does mention it …
    expect(soul).toMatch(CONSOLE);
    // … and never where a User would read it.
    expect(forEveryone(soul)).not.toMatch(CONSOLE);
  });

  it('every admin-only block opens and closes', () => {
    for (const file of FILES) {
      const text = read(file);
      const opened = text.match(/<!--\s*admin-only\s*-->/g)?.length ?? 0;
      const closed = text.match(/<!--\s*\/admin-only\s*-->/g)?.length ?? 0;
      expect([file, opened]).toEqual([file, closed]);
      // Nothing of a block survives the runtime's strip.
      expect(forEveryone(text)).not.toMatch(/admin-only/);
    }
  });

  it('HEARTBEAT.md and the skill, which the runtime does not strip, do not mention it', () => {
    expect(read('HEARTBEAT.md')).not.toMatch(CONSOLE);
    expect(read('skills/ranch/SKILL.md')).not.toMatch(CONSOLE);
  });
});

describe('SOUL.md fits its prompt limit (CLEAN-230)', () => {
  it('is no longer than memory.limits.soul of the template’s own config', () => {
    const config = JSON.parse(read('agent.config.json')) as {
      memory?: { limits?: { soul?: number } };
    };
    const limit = config.memory?.limits?.soul;
    expect(typeof limit).toBe('number');
    // The runtime counts characters of the file as it is on disk.
    expect(read('SOUL.md').length).toBeLessThanOrEqual(limit as number);
  });
});

describe('the template’s prose', () => {
  it.each(FILES)('%s has no em dash', (file) => {
    expect(read(file)).not.toMatch(/—/);
  });
});
