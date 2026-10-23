# Daemon HTTP API (v1)

All paths come from `routes` in `src/routes.ts`. Bodies and responses use the schemas named below. Errors always use `ApiErrorSchema` with the status from `errorStatus`.

## Boundary

- The daemon listens on `127.0.0.1:4317`, the web app on `127.0.0.1:4318`.
- Every `/v1/*` route except `/v1/health` requires `Authorization: Bearer <token>`. The token lives in `<MISSIONS_HOME>/daemon-token`; only the Next.js server reads it.
- The daemon rejects requests whose `Host` is not a loopback name for its port and any request that carries an `Origin` header (browsers never call it directly).
- The browser calls `PROXY_PREFIX + path` (`/api/daemon/v1/...`). The proxy validates `Host` against the web port, requires a same-origin `Origin` on mutations, drops `x-forwarded-*`, cookies and auth headers, then attaches the token.

## Live state

1. `GET missionSnapshot(id)` returns `MissionSnapshot` with `cursor`.
2. `GET events()?after=<cursor>[&missionId=<id>]` streams SSE. Frames named `event` carry a `DaemonEvent` JSON body and `id: <seq>`; reconnects may send `Last-Event-ID` instead of `after`. A `resync` frame (`ResyncRequiredSchema`) means the cursor is older than retained history: refetch the snapshot. Each stream keeps its most recent 20,000 events. Without `missionId`, only global events (`missionId: null`) are sent.
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
| GET | `missionSnapshot(id)` |  | `MissionSnapshot` |
| GET | `missionTranscript(id)?before=<seq>&limit=` |  | `Page<TranscriptItem>` (cursor = seq) |
| POST | `missionMessages(id)` | `SubmitMessageRequest` | `QueueItem` |
| PATCH | `queueItem(id, item)` | `ChangeQueueModeRequest` | `QueueItem` |
| DELETE | `queueItem(id, item)` | `RemoveQueueItemRequest` | `QueueItem` |
| POST | `queueItemEdit(id, item)` | `EditQueueItemRequest` | `EditQueueItemResponse` |
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
| GET | `pullRequests()` (`/v1/pull-requests`) |  | `PullRequestList` (stored PRs, newest mission update first) |
| POST | `cleanup(id)` | `CleanupRequest` | `Mission` |

Mutations are idempotent per `operationId`: repeating the same action for the same mission returns the recorded result instead of acting twice, even when transient preconditions have since changed. Reusing an ID for another action or mission returns `409`. Unknown outcomes are reconciled against their original recorded intent, never a retry's changed payload. Stale `expectedRevision`, `epoch`, `planRevision`, `expectedHead` or `expectedChangesHash` values on new operations return `409` (`stale_revision` or `conflict`).

- `PullRequestList.pullRequests` contains only missions with a stored PR, projected to `missionId`, `missionTitle`, `projectId`, `updatedAt` (the mission's last update) and `pr`. Listing does not load snapshots or refresh GitHub.
- `Changes.hash` fingerprints the reviewed diff; send it back as `expectedChangesHash` so a commit never includes changes the user has not seen. Each `FileDiff.committed` is `true` when the file is already in a mission commit rather than the working tree.
- `ModelList` comes from the installed Droid CLI (cached for 10 minutes). `PATCH settings()` rejects model IDs that are not in it.
- `PATCH mission(id)` accepts optional `orchestrator` and `worker` model/reasoning settings alongside `expectedRevision`, `title`, and `autonomy`. These affect only this mission, never Settings defaults. A ready Orchestrator uses native session settings for subsequent turns without interrupting or replaying work; existing Workers keep their settings and only newly started Workers use the preference. During startup the mission records the desired choice promptly and reconciles it before sending the goal. Catalog validation and native acknowledgement must succeed before a ready session's choice is saved. A stale revision is rejected even if it becomes stale during validation or native acknowledgement; an applied native change is restored where possible, otherwise the confirmed current choice is published with an error so clients must refresh.
- File routes resolve paths inside the mission workspace only; `..`, absolute paths, symlinks leaving the workspace and `.git` return `403` (`forbidden`). Artifacts are served by ID with `nosniff` and a sandboxed CSP.
