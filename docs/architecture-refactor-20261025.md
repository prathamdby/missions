# Architecture refactor execution record

Date: 2026-10-25. Approved scope: replacement P0–P8 only. Source: `eafc235b9b3fe9cf4bf79d352ebc0cd05595dcf2`. Checkout: `/home/prathamd/.t3/worktrees/missions/refactor-architecture-preserving-20261025`.

## Frozen contract

This is a structural refactor, not a behavior improvement. Preserve UI, keys, mount-owned state, API/errors/IDs, revisions, event order, persistence, permissions, retry/admission rules, scheduling and resource ownership. Keep the existing delivery implementation if an extraction only exposes its dependencies through a callback bag. No new queue, session owner, validation or retention.

## Checklist

- [x] P0: Characterize the old build and preserve equivalence oracles.
- [x] P1: Move unchanged runtime declarations.
- [x] P2: Narrow publishing access.
- [x] P3: Reject delivery extraction under the approved benefit rule.
- [x] P4: Reject lifecycle extraction under the approved benefit rule.
- [x] P5: Subtract unreachable permission completion machinery.
- [ ] P6: Hide mount-scoped command/sink assembly.
- [ ] P7: Extract pure conversation projection at existing memo boundaries.
- [ ] P8: Final equivalence, structural restrictions, rollback and tool report.

## Baseline provenance

- Node `v24.22.0`; pnpm `12.14.0`; Droid CLI `0.249.0`.
- Pinned SDK `@factory/droid-sdk@0.10.0`; Playwright `1.64.1`; Vitest `5.0.5`; Ultracite `8.0.2`.
- T3 confirmed `acpRegistry_factory_droid`, `gpt-6.1-sol`, `reasoning_effort=high` in the bound thread.
- Preserved artifacts: `/tmp/missions-architecture-20261025-eafc235/`. This is outside Playwright's cleanup directory. It contains the base source archive, full logs and additional baseline evidence.
- Tests use isolated temporary SQLite homes and Git fixtures. No live daemon database or external publishing effect is part of the equivalence runs.
- New browser comparisons use fixed clock inputs and static transcript fixtures, loaded fonts and no masks. Both desktop/phone widths and dark/light browser preferences are exercised. The current application declares a dark color scheme and has no light-theme switch; light preference must not invent one.
- Live SDK/model and paid first-token runs are not authorized by this offline refactor's checks and have not been run.

## Action / reason / proof / deletion ledger

### P0, characterized before production edits

- Action: start fresh `pnpm gate` and `pnpm test:e2e` against unchanged product source; preserve the fixed source archive and logs.
- Reason: previous passing tests are not before/after equivalence proof.
- Proof: original browser suite passed 57/57. The first gate overlapped the browser build and failed a 10-second replay teardown and syntax-highlighting deadline. The exact unchanged gate passed in isolation, 98 files / 1,085 tests. After adding characterization, `pnpm gate` passed 101 files / 1,089 tests, zero lint errors/warnings and all eight doctor checks. Logs: `base-gate.log`, `base-gate-isolated.log`, `base-e2e.log`, `p0-gate.log`.
- Proof: all five new browser cases pass on the base, including a second comparison-only run (`base-visual-verify.log`). Draft text, failed-upload attachments and manual work disclosure reset across conversation switches. Failed sends restore only their original composer; detached failures do not restore a newly mounted composer. Retrying preserves the original payload/ID. This intentionally preserves existing reset behavior, not additional retention.
- Proof: eight exact pixel baselines and four exact geometry baselines cover 1440px/412px and dark/light browser preferences, with keyboard focus assertions. The same collapsed image is checked again after remount. All expected pixels originate from the old build; geometry fixtures received only a final newline to satisfy JSON formatting before verification.
- Proof: deterministic HTTP failures, journal intent/results, original-operation replay, unknown persisted fields, revisions, event order/count and SQLite reopen documents are frozen in `architecture-equivalence.test.ts`. The exported throwaway database is `base.db`.
- Proof: executable module hashes cover the type-only changes, including native construction, options, prompts, role tools and store/journal implementations. They are stronger than tracing selected native calls for these type-only moves.
- Proof: the complete projection corpus freezes ties, failed role tools, missing agents/history, previews, both roles and participant messages. Seven old 2,000-message projection samples ranged from 1.08ms to 9.13ms. This is observed variation, not a new pass budget. The existing replay benchmark also ran.
- Proof: independent existing suites retain question/Plan decisions, duplicate clicks/admission, retry identity, sidebar/view controls, removal, native process, Git, recovery and concurrency assertions. No existing assertion, timeout, tolerance or test configuration changed.
- Deletion: none. Do not replace expected outputs with candidate output.

### P1, runtime declarations

- Base: `4d0fdeb`. Action: move the unchanged runtime declarations into `apps/daemon/src/runtime/contracts.ts`; move type imports atomically.
- Reason: FakeRuntime and ScriptedRuntime no longer depend on MissionService for their contract. Native, fake and scripted adapters and orchestration share the same declarations. Options intentionally remain SDK-shaped.
- Proof: the import restriction rejected the old adapters and accepts the new imports, with forbidden/allowed fixtures (including the legitimate pure messages dependency). An initial import-rewrite error was caught by the executable hash/native tests and corrected before completion, without changing any expected result.
- Proof: all 12 old executable-module hashes match exactly. Focused runtime, process, role-tool, scripted-runtime and durable parity checks pass, 89 tests. `pnpm gate`: 102 files / 1,091 tests. Affected browser cases: 8/8. Logs: `p1-focused-fixed.log`, `p1-gate.log`, `p1-e2e.log`.
- Deletion: old declaration definitions and reverse type imports; no compatibility re-export. No construction, native operation, prompt or scheduling code changed.
- Revert: this type/import-only commit; no external effect to undo.

### P2, publishing access

- Base: `92250d7`. Action: GitService accepts `PublishMissionAccess`, containing exactly get, patch, notify, withWorkspaceMutation and withWorkspaceRecovery.
- Reason: publishing no longer imports the broad MissionService type or has access to unrelated orchestration capabilities.
- Proof: compile-time equality with the five existing signatures, allowed/denied import fixtures and an old-structure failure. The exact executable hashes remain unchanged, including GitService and daemon composition.
- Proof: 102 focused Git/hook/signing/index/ref/recovery/workspace/deletion and parity tests pass; gate passes 103 files / 1,093 tests; 15 affected browser cases pass. Logs: `p2-focused.log`, `p2-gate.log`, `p2-e2e.log`.
- Deletion: GitService's broad type dependency. The original MissionService instance, synchronous patch callbacks, constructor order, observer setter, WorkspaceOperationGate and WriteLeaseRegistry allocation are untouched.
- Revert: interface/import-only commit; no external action to undo.

### P3, rejected after dependency assessment

- Assessed at `eafc235`; unchanged executable implementation verified after P1/P2. Evidence anchors below refer to base `apps/daemon/src/missions/mission-service.ts`.
- Action: retain scheduleDelivery → deliver → deliverPass → drainOutbox → submitAccepted (3304–3473) in MissionService, with NativeQueueTracker separate.
- Reason: only the deliveries Map is exclusive to this cluster. Its other dependencies are shared lifecycle admission/currentness/execution/task drain, store/publication, worker assignment and notice validity, attachment loading, timing, reporting and mutable LiveAgent.awaitingText.
- Caller map: lease change, launch, Plan decision, idle callback, assignment startup, agent/daemon/user acceptance, queue removal/retry/replacement and resume (807, 1166, 2302, 2443, 2683, 2866, 2922, 3909, 4000, 4092, 4201, 4679). The call sites already request only scheduling.
- Proof: saveQueueItem (729–735), reviseAccepted (3940–3951), eventStillValid (3275–3299) and submitOptions (3515–3528) have other callers. Queue evidence arrives through onAgentEvent/syncQueue, not through submit success. Delivery mutates awaitingText (3424), consumed by streaming (1757–1764).
- Rejection: moving the whole cluster would expose a broad callback interface with those same policies. Moving only the Map/loop exposes run-pass, closing and task-ownership callbacks while hiding no meaningful caller policy. Neither meets the selected benefit test. No forwarding module, scheduler, timeout adapter or ledger was added.
- Boundaries retained: synchronous scheduling/map admission, sequential passes, pre-await submitting persistence, the existing 30-second deadline and native evidence precedence. Exact old executable hash plus independent native, process and mission suites remain the proof for this unchanged code.
- Deletion/revert: none. The proposed extraction is rejected, not implemented. No new differential crash/interleaving harness is claimed for this rejected move.

### P4, rejected after ownership assessment

- Assessed at `eafc235`; anchors refer to the same base file as P3.
- Action: retain ensureRuntime/startRuntime/finishStart/startFailed (1205–1399), current-owner/execute (1508–1518, 1692–1733) and closeRuntime/disposeRuntime (1556–1690) in their existing owner.
- Reason: LiveAgent is also feature state, not an isolated runtime token. Its toolCalls serve tool events; awaitingText serves delivery/streaming; planGuidance serves mode/Plan synchronization; episode/counter/completedTurns serve Worker status/failure/stall logic. Retirement is reset by stop-failure recovery (4743–4747).
- Caller map: startup serves launch, system messages, assignment startup, delivery and resume. Retirement serves Worker failure, failed assignment start, Worker retirement, stopping, stop confirmation and shutdown. execute/currentness additionally serve composer discovery, plans, questions, permission callbacks, role tools, artifacts, queue mutations and model updates.
- Proof: the live Map also represents occupancy in composer/broker context, workspace quiescence, Worker capacity (2597–2624), handoff, model updates, deletion admission and shutdown. Retiring owners remain capacity occupants; an opaque ready-only registry would not preserve that responsibility.
- Rejection: a registry-only module would expose the owner objects, iteration, phase, epoch, occupancy and retirement resetting. A full extraction requires callbacks for all these features and relocates workspace exclusion, synchronous fences, immediate-turn yields and service-wide joining. Neither hides more knowledge than its interface exposes.
- Boundaries retained: runtime readiness is awaited outside the canonical workspace gate; closeRuntime remains synchronous before its returned promise; execute invokes the effect synchronously; leases/occupancy release only after confirmed shutdown. No LiveAgent split, duplicate owner or transition queue.
- Deletion/revert: none. The proposed extraction is rejected, not implemented. Existing deferred-start/Pause/shutdown/model/Worker/question/Plan assertions and executable equivalence remain intact.

### P5, unreachable permission completion

- Base: `105f2b7`. Action: remove Pending, the never-populated private Map, completion resolver/persistence, grant writes and their private clock helper.
- Reason: repository-wide reference inspection and the complete file show no insertion into the ECMAScript-private Map, including construction/recovery. No caller can supply a live Pending entry.
- Proof: before subtraction, new HTTP characterization passes every decision for historical/missing/wrong-Mission requests before and after restart. Restart already marks the stored request stale; the original assumption that it stayed pending failed against the old build and was corrected there. The observed HTTP errors, no added writes/events/grants and synchronous exact StaleDecisionError are retained.
- Proof: classification, mandatoryDenial, ask, acquireLease and the live abort loop are byte-identical to this slice's base. The 30-second timer, random cancellation keys, attribution, revalidation and lease ownership are unchanged. Store/options/public callable signatures and historical endpoint remain.
- Compatibility entrypoints now reference shared stateless function values, rather than retaining a phantom instance Map merely to satisfy class-methods-use-this. There is no per-instance function closure, added owner, new promise, lint exemption or forwarding module.
- Proof: 203 focused tests pass. Gate: 104 files / 1,095 tests; complete desktop/mobile browser suite: 62/62. Logs: `p5-before.log`, `p5-focused.log`, `p5-gate.log`, `p5-e2e.log`. The initial new fixture omitted its required version field; typecheck caught it and it was supplied before the passing gate.
- Deletion: unreachable completion only; broker policy, exported classifications, live cancellation, database schema and route/service validation remain.
- Revert: this subtraction commit after stopping the app/daemon pair. It changes no persisted representation and undoes no external action.

### Deferred observations and blockers

- T3 read-only research found no authoritative crapper/dryer/mutator integration: repository, lockfile, `.agents`, configuration/docs searches and 37 unique PATH directories had no matching executable or supported invocation. No installation was attempted. CRAP <10, duplication >=0.8 and mutation compliance remain unmeasured, not passed. This blocks full metric completion, not safe bounded structural work.
- No pre-existing product defect is authorized for repair here.
