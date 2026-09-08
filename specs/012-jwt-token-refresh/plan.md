# Implementation Plan: Session stays alive while you work, and ends honestly when it cannot

**Branch**: `feat/CLEAN-72-jwt-token-refresh` | **Date**: 2026-09-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-jwt-token-refresh/spec.md` | **Jira**: [CLEAN-72](https://dreamvention.atlassian.net/browse/CLEAN-72)

## Summary

Replace "one 7-day JWT minted at login and never renewed" with the two-credential model proven in skyhunter: an opaque server-side **Session** (hashed secret, sliding 7-day inactivity window, 30-day absolute maximum, revocable) delivered as an httpOnly `ranch_session` cookie scoped to `/auth`, plus the existing console JWT shortened to **15 minutes** and renewed from the session by `POST /auth/refresh` even after it has expired. `POST /auth/logout` revokes the session. Every 401 carries a machine-readable code; the bridle `/message` routes stop turning a bad bearer into an anonymous visitor. Both consoles keep the token in memory only, attach it per request, refresh proactively (timer, tab visibility, one in-flight promise), retry once on `TOKEN_EXPIRED`/`TOKEN_INVALID`, and show one in-place "session ended" dialog with the login form when renewal fails. The admin socket reconnects with the current token and reacts to `bridle_error`. Decisions in [research.md](./research.md) §3.2 and R0–R14.

## Technical Context

**Language/Version**: TypeScript — NestJS 10 API on Bun (Jest tests, `@nestjs/jwt` 11 / `jsonwebtoken` 9 transitive, Express 5); Nuxt 4 / Vue 3 SPAs (`ssr: false`) for `app` and `admin`

**Primary Dependencies**: NestJS + Prisma (`prisma-import` per-slice schemas), class-validator/Swagger DTOs, socket.io hub; **new**: `cookie-parser` + `@types/cookie-parser` in `api`. Consoles: Nuxt layers per slice, Pinia, `@hey-api/client-axios` ^0.6 SDK (`build:api`), `@nuxtjs/i18n` (app), `socket.io-client` ^4.8 (admin)

**Storage**: PostgreSQL via Prisma — new table `Session` (additive migration `20260908120000_user_session`); nothing persisted in the browser for auth any more (the `access_token` cookie is removed)

**Testing**: API — Jest, colocated `*.spec.ts`, hand-rolled stubs (`cd api && bun run test -- session auth jwtAuth bridleChatAuth bridle.controller bridleClientWs`); consoles have no runner — verification = `bun run build:api && bun run typecheck` per console, `bun run i18n:check` (app), and [quickstart.md](./quickstart.md)

**Target Platform**: Linux API in k8s behind `api.ranch.cleanslice.org`; consoles are browser SPAs on sibling subdomains (same site) — dev: `localhost:3333` / `:3000` / `:3001`

**Project Type**: Web application — monorepo slices `api` + `app` + `admin`

**Performance Goals**: renewal is one indexed lookup + one update per 15 min per active tab; zero DB work on ordinary guarded requests (guard stays stateless); boot = one request (`/auth/refresh` returns the user)

**Constraints**: session secret never in a body or a log; cookie `HttpOnly; SameSite=Lax; Path=/auth; Secure` (flag-driven — `NODE_ENV` is `dev` in the cluster); `withCredentials` only on the consoles' own axios instance; share page keeps `Authorization: null` and 403-not-401; other token families (agent service 365d, embed 15m, extension 30d, browserless 15m) untouched — only the two console issuers inherit the new default; `admin/` English-only, `app/` copy via `en.json` + `i18n:sync`; no session rotation on refresh (multi-tab)

**Scale/Scope**: tens of users, a handful of sessions each; table bounded by per-user pruning on login

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is an unfilled template — no project-specific gates. Applied baseline: CleanSlice layering (controllers → domain services → abstract gateways; DTO/Prisma types never leak into domain), one new slice per concern, no speculative abstractions (no rotation, no per-request session lookup, no cron, no "sign out everywhere" until asked), tests for every new server path. **PASS** pre-Phase-0 and post-Phase-1.

## Project Structure

### Documentation (this feature)

```text
specs/012-jwt-token-refresh/
├── plan.md              # This file
├── research.md          # §1–4 audit + option analysis; §5 Phase 0 decisions R0–R14
├── data-model.md        # Phase 1 — Session, access-token claims, cookie, rejection codes, console state
├── quickstart.md        # Phase 1 — validation guide
├── contracts/
│   └── session-api.md   # Phase 1 — REST, 401 codes, bridle routes, WS codes, env, console contract
├── checklists/requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
api/
├── package.json                                   # + cookie-parser, @types/cookie-parser
├── .env.example                                   # JWT_EXPIRES_IN=15m, SESSION_IDLE_DAYS, SESSION_ABSOLUTE_DAYS, SESSION_COOKIE_SECURE=false
├── prisma/migrations/20260908120000_user_session/migration.sql   # additive
└── src/
    ├── main.ts                                    # app.use(cookieParser())
    ├── app.module.ts                              # + SessionModule
    └── slices/
        ├── user/session/                          # NEW slice (apiKey pattern)
        │   ├── session.prisma                     # model Session (data-model.md)
        │   ├── session.module.ts                  # { provide: ISessionGateway, useClass: SessionGateway }
        │   ├── domain/{session.types.ts, session.gateway.ts, session.service.ts, session.service.spec.ts, index.ts}
        │   │                                      # mint rs_ secret, hash, create/refresh/revoke/prune, live rules, cookie options
        │   └── data/{session.gateway.ts, session.mapper.ts, session.gateway.spec.ts}
        ├── user/auth/
        │   ├── auth.module.ts                     # default expiresIn '15m'; imports SessionModule
        │   ├── auth.controller.ts                 # + POST refresh, POST logout; Set-Cookie on login/register/refresh/logout
        │   ├── auth.controller.spec.ts            # NEW — cookie set/cleared, refresh 401 codes
        │   ├── domain/auth.types.ts               # + sid claim, AuthErrorCodes, unauthorized(code)
        │   ├── domain/auth.service.ts             # issueSession(), refresh(), logout(); expiresIn in result
        │   ├── domain/auth.service.spec.ts        # NEW
        │   ├── dtos/{auth.dto.ts (+expiresIn), logoutResult.dto.ts, index.ts}
        │   ├── guards/jwtAuth.guard.ts            # codes TOKEN_MISSING / TOKEN_EXPIRED / TOKEN_INVALID + log
        │   └── guards/jwtAuth.guard.spec.ts       # NEW
        ├── setup/init/
        │   ├── init.module.ts                     # drop own JwtModule; import AuthModule
        │   ├── init.controller.ts                 # Set-Cookie on /setup/init
        │   └── domain/init.service.ts             # calls AuthService.issueSession()
        └── bridle/
            ├── bridle.controller.ts               # resolveRequester: bad bearer without share headers → 401 code
            ├── bridle.controller.spec.ts          # updated
            ├── guards/bridleChatAuth.guard.ts     # codes
            ├── guards/bridleChatAuth.guard.spec.ts# updated (assert on code)
            ├── handlers/bridleClientWs.handler.ts # TOKEN_EXPIRED vs INVALID_TOKEN on non-public agents
            └── handlers/bridleClientWs.handler.spec.ts  # updated
k8s/deploy/30-api.yaml                             # JWT_EXPIRES_IN "15m", SESSION_* vars

app/slices/
├── setup/api/plugins/api.ts                       # withCredentials; request interceptor (token from store, skip X-Share-Token); response interceptor: code-aware refresh + retry once, endSession
├── setup/api/utils/handleApiAuthentication.ts     # removed (or reduced to a no-op shim)
├── user/auth/
│   ├── stores/auth.ts                             # memory token, expiresAt, sessionEnded; init → refresh; refresh (dedup) / ensureFresh / endSession / logout; timer + visibility
│   ├── plugins/auth.ts                            # registers visibilitychange
│   ├── data/auth.gateway.ts + domain/*            # refresh(), logout(); IAuthSession gains expiresIn
│   ├── data/authError.mapper.ts                   # read `code` from the 401 body
│   ├── components/auth/sessionEnded/Provider.vue  # NEW — in-place overlay with AuthCommonForm
│   └── i18n/locales/en.json (+ru via i18n:sync)   # account.session_ended_title / _body
├── common/layouts/default.vue                     # + <AuthSessionEndedProvider />
├── bridle/stores/bridle.ts                        # sendMessage catch: 401 handled upstream; keep the draft on session-ended
└── setup/api/data/repositories/api/*              # regenerated

admin/slices/
├── setup/api/plugins/apiBaseUrl.ts                # withCredentials; token from store (no document.cookie); code-aware refresh + retry once
├── user/auth/
│   ├── stores/auth.ts                             # same store shape as app; hydrate → refresh
│   ├── plugins/auth.ts                            # visibilitychange
│   ├── data/auth.gateway.ts                       # refresh(), logout()
│   ├── utils/authedFetch.ts                       # NEW — fetch/XHR helper with once-retry
│   └── components/authSessionEnded/Provider.vue   # NEW — reka-ui AlertDialog + login form
├── common/layouts/default.vue                     # + provider
├── bridle/stores/bridle.ts                        # connect(): auth as function; bridle_error listener; token params → auth store / authedFetch
├── bridle/components/bridle/Provider.vue          # drop `token` prop; ensureFresh before connect/reset
├── agent/agent/components/agent/chat/Tab.vue      # drop :token
├── rancher/components/rancher/Provider.vue        # drop :token
└── setup/api/data/repositories/api/*              # regenerated
```

**Structure Decision**: one new API slice (`user/session`) plus surgical changes in `user/auth`, `setup/init` and `bridle`; in each console the change is confined to `setup/api` (transport), `user/auth` (store, gateway, dialog) and `bridle` (admin socket / app error handling), with one-line mounts in the default layouts and prop removals at two admin call sites.

## Implementation phases (for `/speckit-tasks`)

1. **API session slice**: prisma model + migration, types, gateway + mapper, `SessionService` (mint/hash/create/refresh/revoke/prune, live rules, cookie options from env) with specs. `cookie-parser` in `main.ts`, env vars in `.env.example` and k8s.
2. **API auth**: `AuthErrorCodes` + `unauthorized()`; `JwtAuthGuard` codes + log; `AuthService.issueSession/refresh/logout`; `AuthDto.expiresIn`, `LogoutResultDto`; controller routes + `Set-Cookie`; `init` slice delegates to `AuthService`; default `JWT_EXPIRES_IN` `15m`; specs.
3. **API bridle**: `resolveRequester` / `requireChannelAccess` rule, `BridleChatAuthGuard` codes, WS `TOKEN_EXPIRED`; update the three specs; Swagger descriptions.
4. **Client regen**: `cd api && bun run build && bun run generate:swagger` → `app`/`admin` `build:api`.
5. **App transport + store**: `withCredentials`, request interceptor, code-aware response interceptor with retry, store rewrite (memory token, refresh/ensureFresh/endSession/logout, timer, visibility), gateway/service/types, `authError.mapper` reads `code`, remove `handleApiAuthentication` usage (share gateway unaffected).
6. **App session-ended dialog**: `sessionEnded/Provider.vue`, layout mount, i18n keys + `i18n:sync`; bridle store keeps the draft and shows no raw string for auth failures.
7. **Admin transport + store**: mirror of 5 (no i18n), `authedFetch`.
8. **Admin socket + dialog**: `connect()` auth function, `bridle_error` handling, `ensureFresh` before connect/reset, drop `token` prop at three sites, transcript/upload/restart via `authedFetch`; `authSessionEnded/Provider.vue` + layout mount.
9. **Verification**: quickstart §1–§5, typecheck both consoles, `i18n:check`; Jira checkpoint comments after 3, 6 and 8; PR.

## Complexity Tracking

No constitution violations. Deliberate deferrals (not violations), each recorded in research.md with the trigger that would bring it back: session-secret rotation with reuse detection (needed only if the cookie ever becomes page-readable), per-request session lookup in the guard (needed only for instant revocation), "sign out everywhere" / session list UI, embed-SDK refresh path and the WS public-agent downgrade (R5), a scheduled cleanup job (R7).
