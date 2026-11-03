# Feature Specification: Pinned runtime images for the Brotli RCE

**Feature Branch**: `fix/CLEAN-204-brotli-runtime-pins`

**Spec Directory**: `specs/025-brotli-runtime-pins`

**Created**: 2026-11-02

**Status**: Draft

**Ticket**: [CLEAN-204](https://dreamvention.atlassian.net/browse/CLEAN-204)

**Input**: User description: "посмотри плиз уязвимости и как мы можем поправить" — a per-service table of the Bun and Node versions found in the cluster pods, a five-point remediation proposal (pin `runtime` off the Bun 1.3 line, rebuild `api` and the consoles, a Traefik middleware as a stop-gap, restart the pods), a walk-through of how `build-images.yaml`, `release-platform.yaml`, `publish-runtime.yml` and `ops-restart-agents.yaml` get an image into production, an offer to edit the four Dockerfiles while the team keeps the tags and the agent restart, and "после ranch по планам перенести в mazda-ai-ranch, но там инфра mazda-ai-gitops, нужно тоже изучить все".

---

## Context

CVE-2026-111497, published as *Node2Shell*, is an out-of-bounds write in the Brotli decoder that Node and Bun both bundle. Google, as the Brotli maintainer and the numbering authority, scores it **9.2 Critical** on CVSS 4.0; the Node.js project rates it High. CISA added it to the Known Exploited Vulnerabilities catalog on **2026-10-27**.

The fixed releases are **Node 22.23.4 / 24.22.1 / 26.12.1** and **Bun 1.4.4**. Bun has no 1.3.x backport, and Node 20, 23 and 25 are end of life and will never get one — a pin to any of those lines cannot be patched, only moved.

Anything that decompresses Brotli data it did not author is in reach, in both directions: a request body an attacker sends us, and a response an attacker's server sends back to a call we made.

Every runtime image this platform ships still resolves its base through a floating tag, so the version that ends up in production is whichever one the tag pointed at on the day CI happened to build. Two installations consume these images through pipelines that share almost nothing: the upstream cluster rolls `:latest` on a version tag, and Mazda pins immutable timestamp tags in a GitOps repository. The work is therefore one small set of edits and two different rollout orders.

### Surfaces, as measured

| # | Surface | Pinned at | Today | Needs | How an attacker reaches it |
|---|---|---|---|---|---|
| 1 | `ranch-api` | `api/Dockerfile:29` | `oven/bun:1-slim` | `oven/bun:1.4.4-slim` | Internet-facing and unauthenticated. `api/src/main.ts:37` mounts `json({ limit: '2mb' })`, body-parser's `inflate` defaults to true, and body-parser 2.2.2 answers `Content-Encoding: br` with `zlib.createBrotliDecompress()` (`lib/read.js:222`). Any client at all. |
| 2 | `runtime` (the agents) | `runtime/Dockerfile:1` | `oven/bun:1.3-alpine` | `oven/bun:1.4.4-alpine` | Single-stage, so this is what every agent pod runs. `fetch()` requests Brotli by default, and agents call MCP servers, LLM providers, Telegram/Slack and URLs a user hands them. A hostile server answers with a crafted body. |
| 3 | `ranch-admin` | `admin/Dockerfile:32` | `node:22-slim` | `node:22.23.4-slim` | Nitro does not inflate incoming request bodies, so the live path is the server-side `fetch` to our own API — a trusted source. Lower risk, vulnerable version. |
| 4 | `ranch-app` | `app/Dockerfile:35` | `node:22-alpine` | `node:22.23.4-alpine` | As above. |
| 5 | `browser-pool` | `k8s/browser-pool-image/Dockerfile:15` | `ghcr.io/browserless/chromium:latest`, carrying Node **24.15.0** (pinned by path at line 29) | a base with Node ≥ 24.22.1 | Not in the original report. The auth-proxy is a Node HTTP service gating `/live` and `/websockify`. The Node version lives inside a third-party base we do not build. |
| 6 | `bridle` SDK publish | `.github/workflows/publish-sdk.yml:33` | `node-version: '20'` | a supported line | CI only. bridle ships no image, so there is no production exposure — but an EOL line will never be patched. |

All target tags were confirmed to exist in their registries before being written down here.

The builder stages in `api`, `admin` and `app` are already `oven/bun:1.4.4` — that was CLEAN-174, now merged to `main`. Only the final stages still float, and only the final stage becomes a running process.

### Three corrections to the rollout model in the report

The report's account of the pipelines is accurate except on three points, each of which changes what the team has to do:

1. **`runtime` does not need a `v*` tag.** `publish-runtime.yml` tags `:latest` on pushes to `main` as well — `type=raw,value=latest,enable={{is_default_branch}}` — and its own comment states that "main and tag pushes both update `latest`". Merging the pin is enough to publish it.
2. **Agent pods do not need re-creating.** `ops-restart-agents.yaml` sends SIGTERM to `bun` and lets the kubelet restart the container in place; `imagePullPolicy: Always` re-resolves the tag on every container start. Its own guard still bites, though: pods created before 2026-07-31 (`f7eefe4`) lack `restartPolicy: Always`, a clean exit would park them in `Succeeded` forever, and the workflow skips them with a warning. Those agents have to be redeployed from the admin instead.
3. **On Mazda there is no `--pull` to add.** CodeBuild builds with `--platform`, `-f`, `-t` and `--build-arg` and nothing else (`buildspec.yml.tftpl:260`). "Rebuild with `--pull`" is not an option on that path, which makes the explicit pin the only lever there rather than merely the safer one.

### Mazda is a different pipeline end to end

Studied in `connectsolutions/mazda-ai-gitops`, since the `k8s/` and `terraform/` trees inside `ranch` describe the self-hosted deployment and have drifted from Mazda:

- Images live in **ECR** (`mazda-ai-dev` / `mazda-ai-prod`, and `mazda-ai-agents-dev` / `-prod`) on **immutable timestamp tags** such as `api-20261023-160054`, with `pullPolicy: IfNotPresent`. For api, admin, app and browser-pool there is no `:latest` to restart into — the tag in the values file *is* the deployed version.
- **AWS CodeBuild** builds five images, then rewrites `tag:` in `helm/*/values.<env>.yaml` and pushes that to the GitOps repository; **ArgoCD** rolls it out. dev builds the fork's `dev` branch, prod its `main`.
- The agent image is built from **`CleanSlice/runtime@main`**, not from the fork. The upstream `runtime` pin is therefore also the Mazda agent fix, and no fork-side change can substitute for it.
- The agent image has no values file. The buildspec says so outright: images without one "are referenced from the Ranch database and by their `latest` tag". `push_latest = true`, and because ECR repositories are immutable, `move_latest` **deletes** the existing `latest` tag before re-tagging — a build that dies between those two steps leaves the agents with no `latest` at all.
- Ingress is **AWS ALB** (`alb.ingress.kubernetes.io/*`), not Traefik. The proposed middleware has nothing to attach to there; an edge filter on Mazda would have to be AWS WAF. The upstream cluster does use Traefik (`k8s/platform/*/ingress.yaml`), so the stop-gap exists on one installation and not the other.
- Agents in the fork have been **StatefulSets** since PR #49, merged 2026-10-26, with `imagePullPolicy: Always`. Deleting a pod there is safe, because the controller recreates it — the opposite of the bare pods upstream, where a delete is permanent.
- The fork's `api`, `admin`, `app` and `browser-pool` Dockerfiles are currently identical to upstream (dev is at catch-up 25), so the pins travel by the normal catch-up and need no fork-local edit.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The public API stops accepting attacker-controlled Brotli (Priority: P1)

An operator needs the one surface that any stranger on the internet can reach to stop handing attacker-supplied bytes to a vulnerable decoder. Nothing else on the list can be triggered without first persuading some other system to cooperate; this one needs a single HTTP request.

**Why this priority**: It is the only unauthenticated path, it is reachable by anyone, and the CVE is in the KEV catalog. If only one thing ships, it is this.

**Independent Test**: Build the API image, confirm the running container reports Bun ≥ 1.4.4, and send the service a Brotli-encoded request body; the process answers and stays up.

**Acceptance Scenarios**:

1. **Given** the API image is rebuilt from the pinned base, **When** the running container is asked for its Bun version, **Then** it reports 1.4.4 or newer.
2. **Given** the pinned API is serving traffic, **When** a request arrives with `Content-Encoding: br`, **Then** the service responds and the process does not restart or lose a replica.
3. **Given** the pinned Dockerfile, **When** the image is built on a machine whose Docker cache holds an older base, **Then** the build still produces the pinned version, because the tag names it exactly.

---

### User Story 2 - Agents stop trusting Brotli from the servers they call (Priority: P2)

An operator needs the agent fleet off the Bun 1.3 line. Agents spend their day calling things nobody here controls, and `fetch()` asks for Brotli without being told to. The 1.3 line will never be fixed, so this is a move rather than a bump.

**Why this priority**: Equal in severity to P1 and far larger in blast radius — every agent pod — but it needs a hostile or compromised endpoint in the path, where P1 needs only a stranger with `curl`.

**Independent Test**: Build the runtime image from the pinned base, start one agent, confirm it reports Bun ≥ 1.4.4 and completes a normal task that calls out over HTTP.

**Acceptance Scenarios**:

1. **Given** the runtime image is rebuilt from `oven/bun:1.4.4-alpine`, **When** an agent container starts, **Then** it reports Bun 1.4.4 or newer.
2. **Given** the base image moved a minor version, **When** the image builds, **Then** the frozen dependency install still succeeds — the failure mode CLEAN-174 was opened for.
3. **Given** the fleet is restarted in place, **When** each pod's resolved image digest is read back, **Then** every pod reports the digest of the newly published image.
4. **Given** a pod predating `restartPolicy: Always`, **When** the fleet-wide restart runs, **Then** that pod is reported as skipped rather than killed, and named for redeployment from the admin.

---

### User Story 3 - The consoles stop shipping a vulnerable Node (Priority: P3)

An operator needs `ranch-admin` and `ranch-app` on a Node that carries the fix, so that no part of the platform is left on a version an auditor or a scanner will flag.

**Why this priority**: Real but the least reachable — Nitro does not inflate request bodies, and the server-side `fetch` these images make goes to our own API. It is a vulnerable version rather than a live hole, and it is cheap to close in the same pass.

**Independent Test**: Build both console images and confirm each reports Node ≥ 22.23.4.

**Acceptance Scenarios**:

1. **Given** both console Dockerfiles are pinned, **When** either image is built and started, **Then** it reports Node 22.23.4 or newer.
2. **Given** the pinned bases, **When** either console image is built, **Then** the Nuxt build and the server start behave as before.

---

### User Story 4 - The same fix reaches Mazda through Mazda's own pipeline (Priority: P4)

An operator responsible for the Mazda installation needs the pins to arrive there without hand-editing the fork, and needs to know what to run, because nothing about the upstream rollout applies: no `:latest`, no `rollout restart`, no Traefik, and a build system that cannot be told to re-pull.

**Why this priority**: It is the second of the two installations and it carries real customer traffic, but it is strictly downstream — it cannot start until the upstream pins exist.

**Independent Test**: After a catch-up merge, confirm the fork's four Dockerfiles match upstream, then confirm a CodeBuild run produced new ECR tags and a GitOps commit that ArgoCD synced.

**Acceptance Scenarios**:

1. **Given** the pins are on upstream `main`, **When** the normal catch-up lands on the fork's `dev`, **Then** the fork's `api`, `admin`, `app` and `browser-pool` Dockerfiles are byte-identical to upstream and no fork-local edit was needed.
2. **Given** a CodeBuild run on the fork's `dev`, **When** it finishes, **Then** `helm/ranch-{api,admin,app,browser-pool}/values.dev.yaml` carry new `tag:` values and the GitOps commit is synced by ArgoCD.
3. **Given** the agent image was rebuilt from `CleanSlice/runtime@main`, **When** its ECR `latest` tag is re-pointed, **Then** the agents pick up the new digest on their next container start, and the window in which `latest` does not exist is noted in the runbook.
4. **Given** prod builds from the fork's `main`, **When** the dev rollout is verified, **Then** the same sequence is repeated for prod rather than assumed to have happened.

---

### User Story 5 - The two surfaces outside our control are decided, not forgotten (Priority: P5)

An operator needs an explicit answer on `browser-pool` and on bridle's CI, so neither sits in a scanner report as an unowned finding.

**Why this priority**: Neither is on the critical path — bridle has no production image at all, and browser-pool's Node is chosen by a third party — but leaving them undocumented is how a finding survives three audits.

**Independent Test**: For each, the repository states the decision and the owner; the finding can be closed by pointing at it.

**Acceptance Scenarios**:

1. **Given** `browser-pool` is built from a third-party base, **When** its Node version is read from the rebuilt image, **Then** the result is recorded, and if it is still below 24.22.1 an owner and a next step are named.
2. **Given** bridle publishes its SDK on Node 20, **When** the workflow is reviewed, **Then** the line is either moved to a supported one or recorded as accepted CI-only risk with the reason.

---

### Edge Cases

- **The frozen install breaks on the new base.** The exact trap CLEAN-174 was filed for: a floating Bun tag rolled 1.4.3 to 1.4.4 and three workflows died on `lockfile had changes, but lockfile is frozen`. The evidence says `runtime` is safe — its own CI ran `bun install --frozen-lockfile` under an unpinned `setup-bun` (so 1.4.4) and passed on 2026-11-02 — but the image build adds `--production`, which CI does not exercise.
- **A pod predating `restartPolicy: Always`** is skipped by the restart workflow and keeps running the old image indefinitely while reporting healthy.
- **Mazda's `latest` tag disappears mid-build.** `move_latest` deletes before it pushes, because ECR repositories are immutable. An agent pod that restarts inside that window finds no image.
- **A catch-up triggers an unplanned Mazda build.** The dev pipeline watches pushes to the fork's `dev`, so the catch-up that carries the pins may start a build and a deploy before anyone asks for one.
- **`browser-pool`'s base is a floating third-party `:latest`.** Rebuilding to collect a Node fix also collects whatever else browserless changed. The repository works around a related instability already: CodeBuild rewrites the hardcoded Node path to a glob in a throwaway context, because that path moves on every base bump.
- **The upstream `:latest` race.** `build-images.yaml` documents it: a parallel main-branch build would overwrite the tag-run's `:latest` with a `0.0.0-<sha>` image, which is why `:latest` and the deploy are reserved for `v*` tags.
- **Interim mitigation rejects legitimate traffic.** Refusing `Content-Encoding` at the edge, or disabling body-parser inflation, also refuses gzip and deflate request bodies with 415. Nothing in the consoles is known to send one, but the SDKs and any customer integration would have to be checked first.
- **CI is not production, and is still unpinned.** `runtime`'s workflows use `oven-sh/setup-bun@v2` with no version, and the commit pinning `bun-version: 1.4.4` across ranch's own workflows is still local-only — the ranch PAT has no `workflow` scope, so it has never been pushed.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every image that becomes a running process MUST name an exact base version at or above the fix for its line — Bun ≥ 1.4.4, Node ≥ 22.23.4 on the 22 line, Node ≥ 24.22.1 on the 24 line.
- **FR-002**: No image under our control may resolve its base through a floating tag, so that a rebuild cannot silently produce a pre-fix runtime and a rebuild on a warm cache cannot differ from one on a cold cache.
- **FR-003**: The agent runtime MUST leave the Bun 1.3 line entirely, since no fixed 1.3 release exists or will exist.
- **FR-004**: Each pinned image MUST still build end to end, with its frozen dependency install intact, before the change is proposed for merge.
- **FR-005**: The change MUST be accompanied by a written rollout order per installation, stating for each what makes a built image become a running process, and what the team has to trigger.
- **FR-006**: The rollout order MUST name the pods that cannot be restarted in place and the alternative for them, rather than assuming a fleet-wide restart covers everything.
- **FR-007**: The pins MUST reach the Mazda fork through its normal catch-up route with no fork-local divergence in the four Dockerfiles.
- **FR-008**: The Mazda rollout MUST end with a recorded image tag in the GitOps values for api, admin, app and browser-pool, and a re-pointed `latest` for the agent image, for dev and prod separately.
- **FR-009**: The two surfaces whose runtime version is chosen by someone else — browser-pool's base and bridle's CI — MUST each end with a recorded decision and a named owner.
- **FR-010**: Any interim mitigation adopted ahead of the rebuilds MUST be stated as temporary, with the condition for removing it, and MUST be verified not to reject request bodies that real clients send.
- **FR-011**: Rebuilding, tagging, deploying and restarting agents remain with the team; this work delivers the pinned files, the verification evidence and the rollout order, and MUST NOT trigger a production rollout on its own.
- **FR-012**: The interim mitigation ahead of the rebuilds is [NEEDS CLARIFICATION: adopt the one-line application-level change that closes the API surface on both installations immediately, or wait for the rebuilt images and ship no stop-gap? The Traefik middleware from the report only covers the upstream cluster, since Mazda runs ALB.]
- **FR-013**: `browser-pool` is [NEEDS CLARIFICATION: in scope for this ticket, or split into its own? Its Node version sits inside a third-party base, so closing it may mean waiting on browserless rather than editing a Dockerfile.]

### Key Entities

- **Runtime image**: a built artifact that becomes a running process. Six exist across the two installations; each carries exactly one language runtime whose version is decided by one `FROM` line at build time.
- **Rollout path**: the chain from a merged commit to a restarted process. There are two, and they share no step: upstream (version bump → `v*` tag → `:latest` → `rollout restart`) and Mazda (CodeBuild → immutable ECR tag → GitOps values commit → ArgoCD sync).
- **Agent workload**: the thing that runs the runtime image. A bare Pod upstream, where a delete is permanent; a StatefulSet on Mazda since PR #49, where a delete is recoverable. The image reference lives in the Ranch database, not in a manifest.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero processes across both installations report a pre-fix runtime version when queried directly — not the image tag, the version the process itself reports.
- **SC-002**: The public API answers a Brotli-encoded request body normally, with no process restart and no replica loss, for every such request in a one-hour observation window after the rollout.
- **SC-003**: Every `FROM` line in the images we build names an exact version; a search for floating base tags across them returns nothing.
- **SC-004**: All agents report the digest of the newly published image after the restart, and any pod that could not be restarted in place is listed by name with its follow-up.
- **SC-005**: Both Mazda environments show a GitOps values commit whose tag matches the image CodeBuild pushed, synced by ArgoCD, for dev and for prod separately.
- **SC-006**: Both installations are fully patched within two working days of the pins landing on `main`, and the remaining exposure at any moment during that window is a single named surface rather than an unknown.
- **SC-007**: Every surface in the measured table ends in one of three states — patched, decided with an owner, or accepted with a written reason. None is left unaccounted for.

---

## Assumptions

- Rebuilding, releasing, deploying and restarting agents are executed by the team, not from this session. This is the user's own split and the reason FR-011 exists.
- The agent count of 23 and the in-pod versions in the report (Bun 1.4.3 in `ranch-api`, Bun 1.3.14 in the agents, Node 22.23.3 in the consoles) come from the user's inspection of the cluster. They are consistent with the floating tags in the Dockerfiles and are taken as given; nothing here re-reads a live cluster.
- `runtime`'s dependency lockfile is compatible with Bun 1.4.4. Evidence: its own CI installed frozen under an unpinned `setup-bun` and passed on 2026-11-02. The image build additionally passes `--production`, so the build is still run locally before the change is proposed.
- `browser-pool`'s base carried Node 24.15.0 at the time its Dockerfile last recorded that path. What today's `ghcr.io/browserless/chromium:latest` carries could not be read from the registry here and is unverified.
- The bridle finding comes from a local checkout dated 2026-06-01; fetching that remote hangs on an SSH passphrase in this environment, so it has not been confirmed against the current default branch.
- No production client sends a compressed request body to the API. This has not been verified and gates FR-010; if it is wrong, an interim mitigation would break those clients.
- The prod rollout for Mazda follows the same sequence as dev and is not assumed to be automatic, since prod builds from the fork's `main` while dev builds from `dev`.
- CI runner versions are out of scope here. Pinning ranch's own workflows is CLEAN-174's unpushed commit, blocked on a PAT without `workflow` scope; `runtime`'s unpinned `setup-bun` is noted but not changed by this work.
