# Daemon HTTP API (v2)

All paths come from `routes` in `src/routes.ts`. Bodies and responses use the schemas named below. Errors always use `ApiErrorSchema` with the status from `errorStatus`.

## Boundary

- The daemon listens on `127.0.0.1:4317`, the web app on `127.0.0.1:4318`.
- Every `/v2/*` route except `/v2/health` requires `Authorization: Bearer <token>`. The token lives in `<MISSIONS_HOME>/daemon-token`; only the Next.js server reads it.
- The daemon rejects requests whose `Host` is not a loopback name for its port and any request that carries an `Origin` header (browsers never call it directly).
- The browser calls `PROXY_PREFIX + path` (`/api/daemon/v2/...`). The proxy validates `Host` against the web port, requires a same-origin `Origin` on mutations, drops `x-forwarded-*`, cookies and auth headers, then attaches the token.

## Live state

1. `GET missionSnapshot(id)` returns `MissionSnapshot` with `cursor`.
2. `GET events()?after=<cursor>[&missionId=<id>]` streams SSE. Frames named `event` carry a `DaemonEvent` JSON body and `id: <seq>`; reconnects may send `Last-Event-ID` instead of `after`. A `resync` frame (`ResyncRequiredSchema`) means the cursor is older than retained history: refetch the snapshot. Each stream keeps its most recent 20,000 events. Without `missionId`, only global events (`missionId: null`) are sent. A per-mission subscription to a missing mission returns `404`.
3. Clients drop events with `seq <= applied` and refetch the snapshot on a gap. Sequences are gap-free per stream (one mission, or global). `transcript.delta` frames are coalesced previews: each delta's `messageId` equals the `id` of the `transcript.item` that will replace it, so append deltas to a preview keyed by that ID and drop the preview when the item arrives (the item is authoritative).
4. Replay ends at the stream's captured high-water, then delivers buffered live events in sequence. A slow reader exceeding the 5,000-event live buffer is disconnected (a blocked connection cannot reliably receive a final frame). Reconnect from the last applied cursor; expired history receives `resync`. Heartbeats never queue behind pending writes.

## Routes

| Method | Route | Body | Response |
| --- | --- | --- | --- |
| GET | `connection()` |  | `ConnectionStatus` |
| GET/PATCH | `settings()` | `UpdateSettingsRequest` | `Settings` |
| GET | `models()` |  | `ModelList` |
| GET | `grants()` |  | `GrantList` |
| DELETE | `grant(id)` |  | `204` |
| GET | `projects()` |  | `ProjectList` |
| POST | `projects()` | `AddLocalProjectRequest` | `AddLocalProjectResponse` |
| DELETE | `project(id)` |  | `204` (forgets it; never deletes files) |
| POST | `clone()` | `CloneProjectRequest` | `CloneJob` (202) |
| GET | `cloneJob(id)` |  | `CloneJob` |
| GET | `projectBranches(id)` |  | `BranchList` |
| GET | `projectWorktrees(id)` |  | `WorktreeList` |
| GET | `projectCheckout(id)` |  | `CheckoutStatus` |
| GET | `fsBrowse()?path=` |  | `FsBrowseResponse` (defaults to home) |
| GET | `githubAuth()` |  | `GithubAuthStatus` |
| GET | `githubRepos()?q=` |  | `GithubRepoList` (401 `unauthorized` when signed out) |
| GET | `missions()?projectId=` |  | `MissionList` |
| POST | `missions()` | `CreateMissionRequest` | `MissionSnapshot` (201) |
| GET/PATCH | `mission(id)` | `UpdateMissionRequest` | `Mission` |
| DELETE | `mission(id)` | `MissionControlRequest` | `CommandAccepted` (paused, interrupted, completed, failed or archived missions only; forgets the mission, never deletes files) |
| GET | `missionSnapshot(id)` |  | `MissionSnapshot` |
| GET | `missionTranscript(id)?before=<seq>&limit=` |  | `Page<TranscriptItem>` (cursor = seq) |
| POST | `missionMessages(id)` | `SubmitMessageRequest` | `QueueItem` |
| PATCH | `queueItem(id, item)` | `ChangeQueueModeRequest` | `QueueItem` |
| DELETE | `queueItem(id, item)` | `RemoveQueueItemRequest` | `QueueItem` |
| POST | `queueItemEdit(id, item)` | `EditQueueItemRequest` | `EditQueueItemResponse` |
| POST | `queueItemRetry(id, item)` | `RetryQueueItemRequest` | `QueueItem` (a new item with `retryOf`; failed or unknown items only) |
| POST | `permission(id, req)` | `DecidePermissionRequest` | `PermissionRequest` |
| POST | `question(id, q)` | `AnswerQuestionRequest` | `Question` |
| POST | `plan(id)` | `DecidePlanRequest` | `PlanRevision` |
| POST | `missionPause(id)` / `missionResume(id)` | `MissionControlRequest` | `Mission` |
| POST | `missionArchive(id)` | `MissionControlRequest` | `Mission` (completed, paused, interrupted or failed missions only; stops idle agents, keeps the worktree) |
| GET | `changes(id)` |  | `Changes` |
| GET | `files(id)?dir=` |  | `FileTree` |
| GET | `file(id)?path=` |  | `FileContent` |
| GET | `artifact(id, a)` |  | artifact bytes with its media type |
| POST | `commit(id)` | `CommitRequest` | `Mission` |
| POST | `push(id)` | `PushRequest` | `Mission` |
| GET/POST | `pullRequest(id)` | `CreatePullRequest` | `Mission` (GET refreshes PR/check/merge state) |
| GET | `pullRequests()` (`/v2/pull-requests`) |  | `PullRequestList` (stored PRs, newest mission update first) |
| POST | `cleanup(id)` | `CleanupRequest` | `Mission` |

Mutations are idempotent per `operationId`: repeating the same action for the same mission returns the recorded result instead of acting twice, even when transient preconditions have since changed. Reusing an ID for another action or mission returns `409`. Unknown outcomes are reconciled against their original recorded intent, never a retry's changed payload. Stale `expectedRevision`, `epoch`, `planRevision`, `expectedHead` or `expectedChangesHash` values on new operations return `409` (`stale_revision` or `conflict`).

- `PullRequestList.pullRequests` contains only missions with a stored PR, projected to `missionId`, `missionTitle`, `projectId`, `updatedAt` (the mission's last update) and `pr`. Listing does not load snapshots or refresh GitHub.
- `Changes.hash` fingerprints the reviewed diff; send it back as `expectedChangesHash` so a commit never includes changes the user has not seen. Each `FileDiff.committed` is `true` when the file is already in a mission commit rather than the working tree.
- `ModelList` comes from the installed Droid CLI (cached for 10 minutes). `PATCH settings()` rejects model IDs that are not in it.
- `Settings.defaultWorkspaceMode` is `new_worktree` or `current_checkout`: where the new-mission form starts for Git projects (folders that are not Git repositories always use `current_checkout`). Saved settings from older daemons have no value and read as `new_worktree`. `PATCH settings()` accepts it as an optional field and keeps every other saved preference.
- `PATCH mission(id)` accepts optional `orchestrator` and `worker` model/reasoning settings alongside `expectedRevision` and `title`. These affect only this mission, never Settings defaults. A ready Orchestrator uses native session settings for subsequent turns without interrupting or replaying work; existing Workers keep their settings and only newly started Workers use the preference. During startup the mission records the desired choice promptly and reconciles it before sending the goal. Catalog validation and native acknowledgement must succeed before a ready session's choice is saved. A stale revision is rejected even if it becomes stale during validation or native acknowledgement; an applied native change is restored where possible, otherwise the confirmed current choice is published with an error so clients must refresh.
- `DELETE mission(id)` removes the mission from the app: its agents, queue, transcript, plans, todos, questions, permissions, assignments, artifact records, operation history, process records and event stream are purged in one transaction. The worktree, branch, artifact files and shared files stay on disk, and project grants are kept. Only stopped missions qualify; active, `pausing` and `stop_failed` missions, missions with an unresolved operation (`intent` or `unknown`) and missions with a mutation still in flight return `409` (`conflict`). A stale `expectedRevision` returns `409` (`stale_revision`). Retrying the same `operationId` after success returns `status: "duplicate"`, including after a daemon restart; a new `operationId` for a deleted mission returns `404`. The global stream receives `mission.removed { missionId }` exactly once; an open per-mission stream ends after delivering its buffered events, and a new per-mission subscription returns `404`.
- File routes resolve paths inside the mission workspace only; `..`, absolute paths, symlinks leaving the workspace and `.git` return `403` (`forbidden`). Artifacts are served by ID with `nosniff` and a sandboxed CSP.

## Messages and delivery

The queue is a durable outbox. Every logical message (user prompt, agent message, assignment, handoff) is a `QueueItem` with a stable `id`, recipient `agentId`, `origin` (`user`, `agent`, `daemon`), `purpose` (`message`, `assignment`, `handoff`, `control`), placement `mode` (`steer`, `queue`), a server-bound `sender` for agent messages, and a per-mission `sequence`.

- `POST missionMessages(id)` returns as soon as the message is durably `accepted`; it does not wait for the agent to start. Delivery to one recipient follows `sequence`. Before native I/O the item moves to `submitting`; native admission and consumption move it to `queued` and `sent`.
- `accepted` items have definitely not been sent. They can be edited, removed or switched between steer and queue locally, even while the agent is still starting. After a restart they stay `accepted` and are delivered only after Resume.
- `unknown` means the message may or may not have reached the runner. It is never replayed automatically. `queueItemRetry` sends it again as a new message after the user chooses to; for `unknown` originals this can deliver it twice.
- Reusing an `operationId` with a different recipient, text, placement returns `409`. Text is never used to merge two intentional messages.
- Each recipient holds at most 20 outstanding user messages and 20 outstanding agent messages; beyond that the request fails with an explicit capacity error.
- Agent messages (`send_message`, assignments and handoffs) are persisted with exactly one `agent_message` `TranscriptItem` carrying `sender`, `recipient`, `purpose` and the queue item ID as `requestId`. The SDK receives the structured sender; the recipient's native echo is not projected again.
- `steer` maps to native `end_of_turn` (the next tool-completion boundary), `queue` to native `end_of_loop`. Steers admitted before the same boundary are consumed together before the next model continuation.
- `Agent.waitingReason` explains a waiting agent: `startup`, `model`, `permission`, `answer`, `write_lease` or `retry`.

## Work mode and Plan mode

`Mission.executionMode` is `work` by default. Only the main agent can enter Plan mode, through `missions.enter_plan`, when the user asks in plain language to plan, scope or review an approach before changes, or the agent judges that a broad, risky or ambiguous request needs planning. Mission creation and message requests reject `executionMode` with `400` (`bad_request`).

- To leave planning early, ask in chat to skip or stop planning. The main agent immediately presents a minimal plan with `ExitSpecMode`; one approval returns the mission to Work mode.
- In Plan mode every agent is read-only (writes, Git administration and publishing are denied) and the main agent runs in native Spec mode with the planning guidance added once as model-only context.
- The main agent presents a plan with native `ExitSpecMode`. The resulting `PlanRevision` is `actionable` only while that native request is live and bound to the same session and epoch. `POST plan(id)` with `approve: true` proceeds once and returns the mission to `work`; `approve: false` cancels the request and sends the feedback back. A non-actionable revision returns `409` (`stale_revision`); after Resume the agent is asked to present it again.

## Agent Git actions

The main agent may commit, push and open pull requests without asking; Workers cannot. The fixed High policy automatically approves commands, local Git and publishing, but edits outside the workspace and unknown tools still ask. Pause, read-only assignments and Plan mode remain mandatory gates. High-impact Git commands (reset, clean, rebase, checkout/switch, branch or tag deletion, force pushes and similar) and publishing wait until no other agent holds write access. After an agent runs a Git or `gh` command the daemon re-reads the branch, commits since the mission's start revision, upstream and any pull request into `Mission.publish`. These reads are best effort and never retried as side effects.

## Timing

`MISSIONS_TIMING=1` writes content-free JSON timing records (`[timing] {...}`) to the daemon's stderr: message acceptance, delivery submission and admission, runtime startup stages, and the first thinking and assistant text per request. Records carry IDs, stage names and durations only.

## Upgrade and rollback

Database migrations run when the daemon opens `<MISSIONS_HOME>/missions.db`.

1. Stop the old app and daemon pair before upgrading. Missions that were running come back `interrupted` and wait for Resume.
2. Before applying a pending migration, the daemon writes a consistent copy next to the database: `missions.db.pre-migration-<applied>.bak` (mode `0600`, created once per starting schema).
3. Older daemons refuse a database written by a newer schema, so an old binary cannot write upgraded records.
4. Old JSON documents are normalized when read. Sessions started under older app instructions are kept read-only; on Resume the agent continues in a new session that receives a bounded continuation summary instead of a replay.

To roll back, stop the new daemon, move `missions.db` (and its `-wal`/`-shm` files) aside, copy the matching `.bak` file to `missions.db`, then start the previous app and daemon pair. Downgrading a database in place over upgraded records is not supported; anything done after the upgrade is lost by the restore.
