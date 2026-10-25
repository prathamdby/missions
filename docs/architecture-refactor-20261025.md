# Architecture refactor execution record

Date: 2026-10-25. Approved scope: replacement P0–P8 only. Source: `eafc235b9b3fe9cf4bf79d352ebc0cd05595dcf2`. Checkout: `/home/prathamd/.t3/worktrees/missions/refactor-architecture-preserving-20261025`.

## Frozen contract

This is a structural refactor, not a behavior improvement. Preserve UI, keys, mount-owned state, API/errors/IDs, revisions, event order, persistence, permissions, retry/admission rules, scheduling and resource ownership. Keep the existing delivery implementation if an extraction only exposes its dependencies through a callback bag. No new queue, session owner, validation or retention.

## Checklist

- [x] P0: Characterize the old build and preserve equivalence oracles.
- [ ] P1: Move unchanged runtime declarations.
- [ ] P2: Narrow publishing access.
- [ ] P3: Delivery extraction or evidence-backed rejection.
- [ ] P4: Lifecycle extraction or evidence-backed rejection.
- [ ] P5: Subtract unreachable permission completion machinery.
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

### Deferred observations and blockers

- T3 read-only research found no authoritative crapper/dryer/mutator integration: repository, lockfile, `.agents`, configuration/docs searches and 37 unique PATH directories had no matching executable or supported invocation. No installation was attempted. CRAP <10, duplication >=0.8 and mutation compliance remain unmeasured, not passed. This blocks full metric completion, not safe bounded structural work.
- No pre-existing product defect is authorized for repair here.
