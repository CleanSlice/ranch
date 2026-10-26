import { readdirSync, readFileSync, statSync } from 'fs';
import * as path from 'path';

/**
 * Every route is behind JwtAuthGuard now that it is registered as an APP_GUARD
 * (app.module.ts, CLEAN-175), so `@Public()` is the only way back out. That
 * makes the set of `@Public()` routes the entire authentication surface of the
 * API, and this test pins it.
 *
 * Before the global guard existed, `JwtAuthGuard` was attached by hand per
 * controller and 18 of 43 controllers never attached it. Nothing failed, no
 * test noticed, and `/knowledges`, `/agents`, `/settings` and `/llms` answered
 * anonymous callers over the public ingress for months. A count that only ever
 * moves when someone edits this file is what keeps that from happening twice.
 *
 * Adding an exemption is a deliberate act: update the number here and say in
 * the PR why the caller cannot hold a token. The same file exists in the Mazda
 * fork; keep the two lists in step so a catch-up merge carries no surprise.
 */
const EXPECTED_PUBLIC_ROUTES: Record<string, number> = {
  // The login-free landing page lists agents flagged public, and the status
  // stream is an EventSource, which cannot send an Authorization header. The
  // list, the detail and the status snapshot used to be public too; nothing
  // anonymous read them, and they return the full configuration (CLEAN-177).
  'slices/agent/agent/agent.controller.ts': 2,
  // Credential exchange (login, register) and the API-key-guarded embed mint,
  // plus refresh and logout: both authenticate by the httpOnly session cookie
  // and run precisely when the access token is gone (CLEAN-72).
  'slices/user/auth/auth.controller.ts': 5,
  // Bootstrap: creating the first owner cannot require a token that only
  // exists after the first owner.
  'slices/setup/init/init.controller.ts': 2,
  // kubelet sends no Authorization header on liveness and readiness.
  'slices/setup/health/health.controller.ts': 1,
  // The login, register and landing pages ask whether registration is open
  // before anyone is signed in; the route serves that one key and nothing
  // else from the group.
  'slices/setting/setting.controller.ts': 1,
  // Narrow-scope extension token verified by hand, plus the extension zip.
  'slices/integration/integration.extension.controller.ts': 2,
  'slices/browser/browser.extension.controller.ts': 1,
  // Machine surface: the agent runtime and the cleanup CronJob authenticate
  // with the shared bridle key and hold no user identity.
  'slices/integration/integration.internal.controller.ts': 1,
  'slices/browser/browser.internal.controller.ts': 1,
  'slices/usage/usage.controller.ts': 1,
  // Event ingest, called by whatever watches the agents with an API key
  // carrying events:write. @Public() drops only the JWT requirement:
  // ApiKeyGuard and ScopesGuard still run (CLEAN-164).
  'slices/agent/event/agentEvent.ingest.controller.ts': 1,
  // The embedded widget, served to anonymous visitors on customer sites. The
  // controller resolves its own identities; transcripts are gated per channel.
  'slices/bridle/bridle.controller.ts': 1,
  // Share-link visitors hold a link, not an account: the token in the body is
  // the credential and an unknown or revoked one is a 404 (CLEAN-66).
  'slices/agent/shareLink/share.controller.ts': 1,
  // An open link to one agent file, meant to be pasted into a fresh tab that
  // carries no session. The signed token IS the credential (CLEAN-112).
  'slices/agent/file/file.controller.ts': 1,
  // OAuth: `callback` is where the provider sends the browser with no header
  // it could have (CLEAN-75); `start` and `status` are called with the bridle
  // key, never a user JWT. Only the callback is exempt in the fork today.
  'slices/mcpServer/oauth/mcpOauth.controller.ts': 3,
  // A2A: the `ap_` peer credential travels in `Authorization: Bearer`, which
  // the global guard would reject as a bad JWT before the peer guards run.
  // Not in the fork yet; carry it over at the next catch-up.
  'slices/agent/peer/a2a.controller.ts': 2,
};

const SRC_ROOT = path.resolve(__dirname, '../../../..');
// Matches the decorator on its own line, so the phrase "@Public()" inside a
// comment explaining an exemption does not count as one.
const PUBLIC_DECORATOR = /^[ \t]*@Public\(\)[ \t]*$/gm;

function controllerFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      controllerFiles(full, found);
    } else if (entry.endsWith('.controller.ts')) {
      found.push(full);
    }
  }
  return found;
}

function countPublicRoutes(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of controllerFiles(SRC_ROOT)) {
    const matches = readFileSync(file, 'utf8').match(PUBLIC_DECORATOR);
    if (!matches?.length) continue;
    counts[path.relative(SRC_ROOT, file).split(path.sep).join('/')] =
      matches.length;
  }
  return counts;
}

describe('public route surface', () => {
  it('matches the reviewed allowlist exactly', () => {
    // Both directions matter: an added exemption is a hole, and a removed one
    // is a caller that has just started getting 401s in production.
    expect(countPublicRoutes()).toEqual(EXPECTED_PUBLIC_ROUTES);
  });

  it('finds controllers to scan at all, so a bad path cannot pass vacuously', () => {
    expect(controllerFiles(SRC_ROOT).length).toBeGreaterThan(30);
  });
});
