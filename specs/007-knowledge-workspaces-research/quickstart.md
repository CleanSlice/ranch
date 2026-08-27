# Quickstart — validating knowledge base isolation

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Contracts**: [`contracts/`](./contracts/)

How to prove this feature works. Scenarios map to the specification's success
criteria; each states what to run and what must be true. Field shapes are in
[`contracts/knowledge-api.md`](./contracts/knowledge-api.md) and
[`data-model.md`](./data-model.md) rather than repeated here.

> **Where isolation can be validated.** The local `MockInstanceGateway` points
> every base at one shared LightRAG, so scenarios 1 and 2 — the guarantee itself
> — **cannot pass locally by construction**. They run against a cluster, or
> against the Jest integration test that stands in for one. Everything else is
> local. This is stated up front because a green local run proving nothing is the
> exact failure mode this feature exists to remove.

---

## Prerequisites

- Bun, Docker, and the repository's usual dev prerequisites
- `api/.env.dev` populated
- Cluster access with `kubectl` for scenarios 1, 2 and 8
- Two short text documents with a fact unique to each. Suggested: a document
  stating "the Falkirk relay uses port 7731" and another that never mentions
  Falkirk.

## Setup

```bash
# api — brings up docker deps, runs migrations, starts on :3333
cd api && bun run dev

# admin — on :3001, regenerates its client from swagger first
cd admin && bun run dev
```

Regenerate the contract after any controller or DTO change:

```bash
cd api && bun run generate:swagger
cd admin && bun run build:api
cd app && bun run build:api
```

---

## Scenario 1 — the isolation guarantee (SC-001)

**Setup**: create bases K1 and K2. Put the Falkirk document in K1 and the other
in K2. Index both and wait until each reports `indexStatus: ready`.

```bash
kubectl get pods -n agents -l ranch/component=retrieval
# expect one pod per base, each Running
```

**Run**: ask K2 about the Falkirk relay port, then ask K1.

**Pass when**:

- K2 returns `answer: null` with `reason: "no_relevant_content"` — not a
  generated answer, and no mention of port 7731.
- K1 returns the fact, and every reference resolves to a source inside K1.
- Repeating with the roles swapped gives the mirror result.

**Fail signature to watch for**: K2 answering correctly. That is the current
behaviour and it means the base is still reading a shared pool.

---

## Scenario 2 — an agent cannot see what it was not given (SC-002)

**Setup**: an agent bound to K1 only.

**Run**: through the agent, attempt at least ten times to obtain K2's content or
a description of it — ask for the Falkirk fact directly, ask what other bases
exist, ask what topics it can reach, pass `knowledge_id` naming K2 explicitly,
ask it to list every entity it knows about.

**Pass when**:

- No attempt returns K2's content.
- The tool description the agent sees names K1 and nothing else.
- Passing K2's id is **refused**, not answered on a best-effort basis.
- The graph and entity list reached through K1 describe K1 only.

This is the scenario the product requirement is written against: not reaching
into another base, and not seeing what is in it, are both tested here.

---

## Scenario 3 — the transition (SC-013, FR-033..036)

Run against a copy of an installation that still has content in the shared pool.

**Run**: start the migration. While it is in flight, query a base that has not
yet been re-processed. Then kill the API process mid-migration and restart it.

**Pass when**:

- Every base, source, uploaded file and binding present before is present
  after — compare counts before and after.
- The operator supplied nothing: no re-upload, no re-entry.
- A not-yet-migrated base answers with `complete: false` and says its answers are
  incomplete, rather than answering as if ready.
- After the restart the migration continues from where it stopped and does not
  re-process sources that already completed.
- A source whose origin has disappeared (point one at a dead URL first) is
  **reported as failed with a reason**, and does not stop the rest of the batch.
- The shared deployment is still running until the last base is through — that is
  the rollback.

---

## Scenario 4 — attribution (SC-014)

**Run**: bind an agent to both K1 and K2 and ask one question each base can
partly answer.

**Pass when**: each part of the answer names the base it came from, every
reference opens the source behind it, and exactly two retrievals were issued —
one per bound base, none against any other base.

---

## Scenario 5 — the entity picker (SC-009)

**Setup**: a base with an entity count well beyond a screenful.

**Run**: open the graph tab and open the entity picker.

**Pass when**: it is usable within a second, the page never becomes
unresponsive, typing filters the list, and no entity from another base is ever
offered. With nothing indexed yet, it says so instead of showing an empty
control.

---

## Scenario 6 — the two named defects (SC-010, FR-027)

**Run**: open a base, click through every tab, then reload directly on each tab
URL. Then open `/knowledges/<id>` with no section.

**Pass when**: exactly one tab is highlighted in every case — by click and by
direct navigation — and the sectionless URL shows the sources section rather than
an empty body.

---

## Scenario 7 — status that tells the truth (SC-011)

**Run**: add a batch of sources where one cannot be processed.

**Pass when**: the failing source is identifiable from the interface alone, with
its own reason; the others complete; the base does not report itself ready while
any source is still processing; and a single source can be retried without
touching the rest.

---

## Scenario 8 — the ceiling (FR-008)

**Run**: create bases until the cluster has no room for another retrieval
instance.

**Pass when**: creation is refused with a stated reason naming the limit, before
answers degrade — and never falls back to sharing an area with another base.

---

## Scenario 9 — nothing got heavier (SC-004, SC-006, SC-007)

**Run**: with only a few bases, walk the default journey — create a base, add a
source, index, ask.

**Pass when**: the journey touches zero optional settings, the step count to
reach any base is no greater than before this feature, and no setting remains on
screen that changes nothing. `entityTypes` and `relationshipTypes` are gone from
the form and from the generated clients in both consoles.

---

## Automated coverage

```bash
cd api && bun run test
```

Expected to cover: the retrieval-instance manifest builder (mirroring
`agent-workflow.manifest.spec.ts`), per-source state mapping and base-readiness
derivation, and the isolation guarantee as an integration test — scenario 1
expressed in code, with scenario 2's adversarial set alongside it.

`admin` has no test runner; its scenarios stay manual.
