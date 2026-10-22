# Daemon HTTP API (v1)

All paths come from `routes` in `src/routes.ts`. Bodies and responses use the schemas named below. Errors always use `ApiErrorSchema` with the status from `errorStatus`.

## Boundary

- The daemon listens on `127.0.0.1:4317`, the web app on `127.0.0.1:4318`.
- Every `/v1/*` route except `/v1/health` requires `Authorization: Bearer <token>`. The token lives in `<MISSIONS_HOME>/daemon-token`; only the Next.js server reads it.
- The daemon rejects requests whose `Host` is not a loopback name for its port and any request that carries an `Origin` header (browsers never call it directly).
- The browser calls `PROXY_PREFIX + path` (`/api/daemon/v1/...`). The proxy validates `Host` against the web port, requires a same-origin `Origin` on mutations, drops `x-forwarded-*`, cookies and auth headers, then attaches the token.

## Live state

1. `GET missionSnapshot(id)` returns `MissionSnapshot` with `cursor`.
2. `GET events()?after=<cursor>[&missionId=<id>]` streams SSE. Frames named `event` carry a `DaemonEvent` JSON body and `id: <seq>`; reconnects may send `Last-Event-ID` instead of `after`. A `resync` frame (`ResyncRequiredSchema`) means the cursor is older than retained history: refetch the snapshot. Without `missionId`, only global events (`missionId: null`) are sent.
3. Clients drop events with `seq <= applied` and refetch the snapshot on a gap. `transcript.delta` frames are coalesced previews; the matching `transcript.item` is authoritative.

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
| GET | `changes(id)` |  | `Changes` |
| GET | `files(id)?dir=` |  | `FileTree` |
| GET | `file(id)?path=` |  | `FileContent` |
| GET | `artifact(id, a)` |  | artifact bytes with its media type |
| POST | `commit(id)` | `CommitRequest` | `Mission` |
| POST | `push(id)` | `PushRequest` | `Mission` |
| GET/POST | `pullRequest(id)` | `CreatePullRequest` | `Mission` (GET refreshes PR/check/merge state) |
| POST | `cleanup(id)` | `CleanupRequest` | `Mission` |

Mutations are idempotent per `operationId`: repeating one returns the recorded result instead of acting twice. Stale `expectedRevision`, `epoch`, `planRevision`, `expectedHead` or `expectedChangesHash` values return `409` (`stale_revision` or `conflict`).
