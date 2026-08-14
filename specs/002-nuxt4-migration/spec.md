# Feature Specification: Upgrade operator consoles off Nuxt 3 EOL

**Feature Branch**: `feat/CLEAN-32-nuxt4-migration`

**Created**: 2026-08-14

**Status**: Draft

**Jira**: [CLEAN-32](https://dreamvention.atlassian.net/browse/CLEAN-32)

**Input**: User description: "Ranch: миграция Nuxt 3.16 → Nuxt 4 в app/ и admin/ (Nuxt 3 — EOL). Оба фронта сидят на nuxt ^3.16 — ветка Nuxt 3 уже end-of-life, багфиксы и секьюрити-патчи не прилетают. Перейти на Nuxt 4 в обоих приложениях. Сначала обкатать через compatibilityVersion: 4 на Nuxt 3, затем поднять сам пакет. Учесть новую структуру каталогов (app/), изменения defaults (shared/, data fetching). Зависимые модули тянуть вместе: @nuxtjs/i18n ^9 → ^10, @pinia/nuxt ^0.9, shadcn-nuxt ^2.4, @nuxt/image ^1. Критерий готовности: обе сборки собираются и работают, slices не разъехались, tsc-проверка проходит."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Both consoles stay usable after leaving an unsupported platform (Priority: P1)

An operator opens the user console (`app`) and the admin console (`admin`) after the frontend platform is upgraded. Sign-in, navigation, agent management, chat, settings, and other existing screens still work the same way they did before. Nothing that currently works is dropped as a side effect of leaving the end-of-life platform.

**Why this priority**: The migration exists so the product can keep receiving security and bug fixes. If either console is broken, the upgrade cannot ship — operators would be worse off than on the unsupported release.

**Independent Test**: Walk the primary operator journeys on both consoles (sign-in, home/dashboard, agent list and detail, chat, settings) after the upgrade and confirm they complete without new errors or missing screens.

**Acceptance Scenarios**:

1. **Given** a working user console before the upgrade, **When** the operator uses it after the upgrade, **Then** existing screens load and the same core actions succeed.
2. **Given** a working admin console before the upgrade, **When** the operator uses it after the upgrade, **Then** existing screens load and the same core actions succeed.
3. **Given** either console after the upgrade, **When** the operator refreshes a deep link they used before, **Then** the same screen opens (routes are not silently renamed or dropped).

---

### User Story 2 - Builds and type-checking stay green (Priority: P1)

A maintainer builds both consoles and runs the project's type check. Both consoles produce a successful production build. Type-checking completes without new errors introduced by the platform upgrade.

**Why this priority**: CLEAN-32's explicit ready criterion. A console that "kind of runs" locally but fails CI or type-checking is not shippable.

**Independent Test**: Run the production build for `app` and for `admin`, and run the type check used by the project; all three must pass.

**Acceptance Scenarios**:

1. **Given** a clean checkout of the upgraded branch, **When** a maintainer builds the user console, **Then** the build completes successfully.
2. **Given** a clean checkout of the upgraded branch, **When** a maintainer builds the admin console, **Then** the build completes successfully.
3. **Given** a clean checkout of the upgraded branch, **When** a maintainer runs type-checking, **Then** it passes.

---

### User Story 3 - Feature slices stay intact (Priority: P1)

A maintainer inspects both consoles after the upgrade. Features are still organized as independent slices (self-contained product areas that the consoles compose together). No slice has to be inlined into a single app blob, renamed away, or rewritten from scratch just to satisfy the new platform. Screens that lived in a slice still belong to that slice.

**Why this priority**: Ranch's frontends are slice-composed. If slices "come apart" (`slices не разъехались`), the upgrade destroys the architecture the rest of the product depends on — CLEAN-32 calls this out as a ready criterion.

**Independent Test**: Confirm each existing slice still loads as a composed unit in both consoles, and that a representative screen from several slices still renders from that slice rather than from a newly flattened tree.

**Acceptance Scenarios**:

1. **Given** the set of slices that exist today in the user console, **When** the upgraded console starts, **Then** those slices still compose the product (none are silently dropped).
2. **Given** the set of slices that exist today in the admin console, **When** the upgraded console starts, **Then** those slices still compose the product (none are silently dropped).
3. **Given** a screen that today lives in a specific slice, **When** a maintainer opens it after the upgrade, **Then** it still originates from that slice.

---

### User Story 4 - Localization, images, shared state, and UI kit keep working (Priority: P2)

An operator using either console after the upgrade still sees translated UI, images, persisted client state, and the existing visual components. The supporting modules that provide these capabilities are brought onto versions that work with the new platform rather than left on the old one.

**Why this priority**: These are the known coupled dependencies of the upgrade. If they are skipped, the consoles can build while language switching, images, or UI components silently break.

**Independent Test**: Switch language, load a page that shows images, perform an action that depends on client state, and confirm core UI controls still render on both consoles.

**Acceptance Scenarios**:

1. **Given** an operator with a non-default language, **When** they open either console after the upgrade, **Then** UI strings still appear in that language and language switching still works.
2. **Given** a screen that displays images, **When** the operator opens it after the upgrade, **Then** those images still render.
3. **Given** an operator who had client-side state (for example a selected view or session-backed UI), **When** they continue using the console after the upgrade, **Then** that state still behaves as before.
4. **Given** existing UI kit components (buttons, forms, dialogs, tables), **When** the operator visits screens that use them, **Then** they still render and remain interactive.

---

### User Story 5 - Upgrade is proven in compatibility mode before the platform itself is bumped (Priority: P2)

A maintainer first turns on "behave like the next major platform" while still on the current major, and verifies builds, slices, and operator journeys. Only after that check is green do they bump the platform package itself to the new major and re-verify the same journeys.

**Why this priority**: CLEAN-32 requires this two-step path so breakage is found before the irreversible package bump. It is how the upgrade stays reversible during the risky middle of the work.

**Independent Test**: Demonstrate a recorded compatibility-mode checkpoint where both consoles still build and run, then a second checkpoint after the actual major bump with the same checks still green.

**Acceptance Scenarios**:

1. **Given** both consoles still on the current major, **When** next-major compatibility is enabled, **Then** both consoles still build and the primary operator journeys still work.
2. **Given** that compatibility checkpoint is green, **When** the platform package is then raised to the new major, **Then** both consoles still build, type-check, and the same journeys still work.
3. **Given** a failure found in compatibility mode, **When** it is not yet fixed, **Then** the platform package is not bumped.

---

### Edge Cases

- What happens when a slice relies on a default that changed between majors (shared code location, data-fetching defaults, directory layout)? The slice must keep working; defaults are adapted, not ignored.
- What happens when a coupled module has no Nuxt 4-compatible release yet? The upgrade cannot be declared done; the gap is recorded and the module is upgraded or replaced before ready.
- What happens when only one of the two consoles upgrades cleanly? The feature is not done — both must ship together.
- What happens to local development (`ranch dev` / existing env-based API URL)? Developers can still start both consoles and reach the API the same way they do today.
- What happens to production Docker/k8s image builds for the two consoles? They still produce runnable images.
- What happens to deep links, i18n route prefixes, and existing public URLs? They remain valid.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Both the user console and the admin console MUST run on Nuxt 4 (no longer on the Nuxt 3 line, which is end-of-life).
- **FR-002**: The upgrade MUST be executed in two stages: (1) enable next-major compatibility while still on Nuxt 3 and prove both consoles still work, then (2) bump the Nuxt package to 4 and prove them again.
- **FR-003**: Both consoles MUST produce a successful production build after the upgrade.
- **FR-004**: Project type-checking MUST pass after the upgrade.
- **FR-005**: Existing slices in both consoles MUST continue to compose the product; slices MUST NOT be flattened, dropped, or rewritten from scratch as a prerequisite of the upgrade.
- **FR-006**: The upgrade MUST account for Nuxt 4 directory conventions (including the `app/` application directory) and for changed platform defaults around shared code and data fetching, without breaking existing screens.
- **FR-007**: Localization MUST be upgraded from `@nuxtjs/i18n` v9 to v10 (or the then-current Nuxt 4-compatible line) and language switching MUST keep working in both consoles.
- **FR-008**: Image handling (`@nuxt/image`), client state (`@pinia/nuxt` / Pinia), and the UI kit (`shadcn-nuxt`) MUST be verified against Nuxt 4 and upgraded if the current versions are incompatible.
- **FR-009**: Existing operator-facing routes, including localized prefixes, MUST remain valid.
- **FR-010**: Local development MUST still start both consoles and talk to the API via the same environment configuration used today.
- **FR-011**: Container/image builds for both consoles MUST still succeed.
- **FR-012**: The API / backend is out of scope; this feature MUST NOT require API contract changes to complete.

### Key Entities

- **User console (`app`)**: The operator-facing product UI. Today it is a slice-composed, client-rendered console on Nuxt 3.16.
- **Admin console (`admin`)**: The administration UI. Same platform and composition model as the user console.
- **Slice**: An independently owned product area that a console composes in. The upgrade succeeds only if slices still compose rather than collapse.
- **Frontend platform**: The Nuxt major that hosts both consoles. Moving it from 3 (EOL) to 4 is the point of this feature.
- **Coupled module**: A console plugin/module that must move with the platform (localization, images, client state, UI kit).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the upgrade, 100% of existing slices in `app` and in `admin` still load as composed units (zero slices dropped).
- **SC-002**: Production builds of both consoles succeed on a clean checkout (2 of 2 builds green).
- **SC-003**: Project type-checking completes with zero errors introduced by the upgrade.
- **SC-004**: A maintainer can complete the primary operator journeys on both consoles (sign-in, main navigation, a representative agent workflow, settings) without encountering a new blocking error.
- **SC-005**: Language switching still works on both consoles for every language shipped today.
- **SC-006**: The shipped platform major for both consoles is 4; neither console remains on Nuxt 3.
- **SC-007**: Compatibility-mode verification is recorded as a passing checkpoint before the Nuxt package itself is bumped.

## Assumptions

- Scope is `app/` and `admin/` only. The API, CLI, extension, and infrastructure are unchanged except where a console build recipe must follow the new platform.
- Both consoles stay client-rendered (no SSR) unless Nuxt 4 makes that combination impossible — in which case the deviation is called out during planning, not silently changed here.
- Slice composition remains the architecture; the upgrade adapts it to Nuxt 4, it does not replace it.
- Directory-layout changes required by Nuxt 4 (including `app/` and `shared/`) are in scope to the extent needed for the upgrade to work. Cosmetic reshuffles that are not required by the new major are out of scope.
- Coupled modules named in CLEAN-32 (`@nuxtjs/i18n` 9 → 10, `@pinia/nuxt` ^0.9, `shadcn-nuxt` ^2.4, `@nuxt/image` ^1) are the known upgrade set; any additional module that blocks Nuxt 4 is upgraded the same way rather than expanding into a redesign.
- Both consoles ship in the same change. One-console-first rollout is out of scope unless compatibility mode proves they cannot move together.
- Visual redesign, new operator features, and performance work are out of scope except where a default change forces a behavior fix.
- "tsc-проверка" in CLEAN-32 means the type-check the repo already uses for these packages (or the Nuxt-recommended type check if the current one is invalid on Nuxt 4).
