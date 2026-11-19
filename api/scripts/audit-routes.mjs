// Read-only audit: the least role every HTTP route of the API asks for.
//
// Usage (from the repository root or from api/):
//   node api/scripts/audit-routes.mjs api/src/slices [levels to print]
//
// `levels` is a comma-separated list of PUBLIC, machine, ANY-JWT, User+,
// Admin+, Owner, Agent; `all` prints every route; the default prints what a
// reviewer wants to look at first: ANY-JWT, User+ and Agent. The TOTAL line is
// always printed.
//
// How a route is read:
//   - `machine`  the route is @Public() and carries a guard that authenticates
//                a caller that is not a person (the shared bridle key, an API
//                key, an A2A peer credential).
//   - `PUBLIC`   @Public() with no such guard: anonymous, or the handler
//                verifies its own token (chat, share links, extension tokens).
//   - a role     the least role in @Roles(...) on the handler, else the class.
//   - `ANY-JWT`  no role is enforced: any valid token passes. Only possible
//                while RolesGuard is not a global guard.
//
// Whether RolesGuard is global is read from app.module.ts next to the slices
// directory. When it is, @Roles works without @UseGuards and a route with no
// @Roles asks for Admin (roles.guard.ts); those rows carry the note `default`.
// A route marked `+Agent` names the Agent role, so an agent runtime's own
// token is admitted there.
//
// This is a text scan, so the pinned sets in
// src/slices/user/auth/guards/*Routes.spec.ts read the decorators' metadata
// instead; the two must agree.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const root = process.argv[2];
if (!root) {
  console.error('usage: node audit-routes.mjs <api/src/slices> [levels|all]');
  process.exit(2);
}

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.controller.ts')) files.push(p);
  }
})(root);

const appModule = join(dirname(root), 'app.module.ts');
const globalRoles =
  existsSync(appModule) &&
  /provide:\s*APP_GUARD,\s*useClass:\s*RolesGuard/.test(
    readFileSync(appModule, 'utf8'),
  );

const HTTP =
  /^\s*@(Get|Post|Put|Patch|Delete|Sse)\(\s*(?:'([^']*)'|"([^"]*)")?/;
const MACHINE = /\b(BridleApiKeyGuard|ApiKeyGuard|A2aPeerGuard|A2aCardGuard)\b/;
// A comment between two decorators used to end the decorator block, so the
// decorators under it (@Public, @UseGuards) were lost and the route was read
// as ANY-JWT. Comment lines are blanked before scanning; the line numbers stay.
const isComment = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);

const rows = [];

for (const file of files.sort()) {
  const lines = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => (isComment(l) ? '' : l));
  const classIdx = lines.findIndex((l) => /^export class /.test(l));
  if (classIdx < 0) continue;
  // Decorators directly above the class: back to the last import or closing
  // brace, across the blanked comment lines.
  let top = classIdx;
  while (top > 0 && !/^(import |\}|.*\bfrom '.*';$)/.test(lines[top - 1])) {
    top -= 1;
  }
  const head = lines.slice(top, classIdx).join('\n');
  const prefix =
    (head.match(/@Controller\(\s*['"]([^'"]*)['"]/) || [])[1] ?? '';
  const classGuards = (head.match(/@UseGuards\(([^)]*)\)/) || [])[1] ?? '';
  const classRoles = (head.match(/@Roles\(([^)]*)\)/) || [])[1];
  const classPublic = /@Public\(\)/.test(head);

  let block = [];
  let depth = 0;
  for (let i = classIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const startsDecorator = /^\s*@/.test(line);
    if (startsDecorator || (block.length && (depth > 0 || line === ''))) {
      block.push(line);
      for (const ch of line) {
        if (ch === '(' || ch === '{' || ch === '[') depth += 1;
        else if (ch === ')' || ch === '}' || ch === ']') depth -= 1;
      }
      continue;
    }
    if (block.length) {
      const text = block.join('\n');
      const http = block.map((b) => b.match(HTTP)).find(Boolean);
      if (http) {
        const roles = (text.match(/@Roles\(([^)]*)\)/s) || [])[1];
        const guards = (text.match(/@UseGuards\(([^)]*)\)/s) || [])[1] ?? '';
        const isPublic = classPublic || /@Public\(\)/.test(text);
        const allGuards = `${classGuards} ${guards}`;
        const rolesEnforced = globalRoles || /\bRolesGuard\b/.test(allGuards);
        const stated = (roles ?? classRoles ?? '')
          .replace(/UserRoleTypes\./g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const notes = [];
        let min;
        if (isPublic && MACHINE.test(allGuards)) min = 'machine';
        else if (isPublic) min = 'PUBLIC';
        else if (MACHINE.test(allGuards)) {
          // A machine guard behind the global JWT guard: the caller needs a
          // person's token as well. Not a machine route.
          min = 'ANY-JWT';
          notes.push('machine guard without @Public()');
        } else if (!rolesEnforced) {
          min = 'ANY-JWT';
          notes.push(stated ? '@Roles without RolesGuard' : 'no RolesGuard');
        } else if (!stated) {
          if (globalRoles) {
            min = 'Admin+';
            notes.push('default');
          } else {
            min = 'ANY-JWT';
            notes.push('no @Roles');
          }
        } else if (/\bUser\b/.test(stated)) min = 'User+';
        else if (/\bAdmin\b/.test(stated)) min = 'Admin+';
        else if (/\bOwner\b/.test(stated)) min = 'Owner';
        else if (/\bAgent\b/.test(stated)) min = 'Agent';
        else min = stated;
        const agent =
          !isPublic && rolesEnforced && /\bAgent\b/.test(stated)
            ? true
            : min === 'ANY-JWT';
        if (/\bAgent\b/.test(stated) && min !== 'Agent') notes.push('+Agent');
        rows.push({
          file: relative(root, file).replace(/\\/g, '/'),
          line: i + 1,
          route: `${http[1] === 'Sse' ? 'GET' : http[1].toUpperCase()} /${[
            prefix,
            http[2] ?? http[3] ?? '',
          ]
            .filter(Boolean)
            .join('/')}`,
          min,
          agent,
          note: notes.join(', '),
        });
      }
      block = [];
      depth = 0;
    }
  }
}

const arg = process.argv[3] ?? 'ANY-JWT,User+,Agent';
const want = new Set(arg.split(','));
const shown = (r) =>
  arg === 'all' || want.has(r.min) || (want.has('Agent') && r.agent);
let last = '';
for (const r of rows.filter(shown)) {
  if (r.file !== last) console.log(`\n${r.file}`);
  last = r.file;
  console.log(`  ${r.min.padEnd(8)} ${r.route}  :${r.line} ${r.note}`.trimEnd());
}
const tally = {};
for (const r of rows) tally[r.min] = (tally[r.min] ?? 0) + 1;
console.log(
  `\nTOTAL ${rows.length} ${JSON.stringify(tally)} controllers ${files.length}`,
);
console.log(
  `RolesGuard global: ${globalRoles ? 'yes' : 'no'}; routes an agent token passes: ${rows.filter((r) => r.agent).length}; routes on the Admin default: ${rows.filter((r) => r.note.includes('default')).length}`,
);
