<div align="center">

# Missions

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <a href="#documentation"><img src="https://img.shields.io/badge/docs-local-blue" alt="Documentation"></a>
  <a href="#installation"><img src="https://img.shields.io/badge/node-24%20LTS-blue" alt="Node 24 LTS"></a>
</p>

</div>

You give Missions a goal on a project that lives on your machine. A main agent talks with you, does the work, and can hand pieces of it to workers.

The daemon and the web app bind to loopback. The browser never calls the daemon, and it never imports daemon code or the Droid SDK. Shared contracts live in `@missions/protocol`.

## Contents

- [What you get](#what-you-get)
- [Installation](#installation)
- [Verification](#verification)
- [How a mission runs](#how-a-mission-runs)
- [Data on disk](#data-on-disk)
- [Local development](#local-development)
- [Documentation](#documentation)

## What you get

This repository is a pnpm workspace. The first commit is the loopback shell. Later commits add persistence, agents, the mission UI, and publishing.

| Package | Role |
| --- | --- |
| `@missions/daemon` | HTTP API on `127.0.0.1:4317`. Health in the first commit. SQLite, missions, and Droid sessions after that. |
| `@missions/web` | Next.js app on `127.0.0.1:4318`. Shows daemon health, then the mission UI. |
| `@missions/protocol` | Zod contracts both sides import. The browser never reaches past this package. |
| `design/` | Token source in `design/tokens.json`. The web stylesheet is generated from it. |

`GLOSSARY.md` is the product vocabulary. A **project** is a local Git repository. A **workspace** is the checkout or worktree a mission uses. The **orchestrator** is the main agent. A **worker** takes one assignment and reports back with a handoff.

## Installation

You need Node 24 (`.nvmrc`, `engines.node` `>=24.2.0`) and pnpm 12.14.0 (`packageManager` in `package.json`). Corepack can install that pnpm version. There is no Docker stack and no hosted service.

```bash
git clone https://github.com/prathamdby/missions.git
cd missions
pnpm install
```

Agent work needs the [Factory Droid](https://factory.ai) CLI. The daemon looks for it at `~/.local/bin/droid`, or at `MISSIONS_DROID_PATH` if you set that.

### 1. Start the daemon

```bash
pnpm dev:daemon
```

That runs `tsx watch src/main.ts` in `@missions/daemon`. The process listens on `127.0.0.1:4317`. Set `MISSIONS_DAEMON_PORT` to move it. A value that is not an integer from 1 to 65535 throws `Invalid MISSIONS_DAEMON_PORT`.

On a current checkout the daemon writes its SQLite database, token, repos, worktrees, artifacts, and attachments under `MISSIONS_HOME`. That directory defaults to `~/.missions`. The token file is `daemon-token`, mode `0600`. Only the Next.js server reads it.

### 2. Start the web app

```bash
pnpm dev:web
```

That runs Next.js on `127.0.0.1:4318`. Open `http://127.0.0.1:4318`.

The first commit's home page is a server component. It asks the daemon for `GET /v1/health` and shows one of three states.

| Status | What you see |
| --- | --- |
| `connected` | Daemon connected, plus the protocol version and package version. |
| `incompatible` | The JSON body failed `HealthResponseSchema`. |
| `unreachable` | The fetch failed, timed out after 2 seconds, or returned a non-OK status. |

A current checkout keeps that loopback split and adds the mission UI. The browser calls `/api/daemon/v2/...`. The Next.js server checks `Host`, requires a same-origin `Origin` on mutations, drops forwarded, cookie, and auth headers, then attaches the bearer token.

### 3. Optional environment

| Variable | Default | Effect |
| --- | --- | --- |
| `MISSIONS_DAEMON_PORT` | `4317` | Daemon listen port. The web health check uses the same variable. |
| `MISSIONS_HOME` | `~/.missions` | Database, token, repos, worktrees, artifacts, attachments. |
| `MISSIONS_DROID_PATH` | `~/.local/bin/droid` | Droid CLI the daemon spawns. |
| `MISSIONS_TIMING` | unset | Set to `1` to log content-free timing records on the daemon's stderr. |

Leave these unset for a normal local run. Do not point either port at a public interface. Both servers bind `127.0.0.1` only.

## Verification

With the daemon running:

```bash
curl -sS http://127.0.0.1:4317/v1/health
```

On the first commit that path is the only route. The body is `status: "ok"`, `service: "missions-daemon"`, `protocolVersion: 1`, an ISO `startedAt`, a nonnegative `uptimeMs`, and the package `version`. Unknown routes return `{ "error": { "code": "not_found", "message": "Route not found" } }` with status 404. Handler failures return `internal` and the message `Internal error`. The handler does not echo the thrown text.

A current checkout serves the mission API under `/v2`. `GET /v2/health` stays open. Every other `/v2` route requires `Authorization: Bearer <token>`. The daemon also rejects a `Host` that is not a loopback name for its port, and it rejects any request that carries an `Origin` header.

The web app should show **Daemon connected** when both processes are up and the health JSON matches the schema.

## How a mission runs

These behaviors land after the first commit. Names and routes below match `GLOSSARY.md` and `packages/protocol/API.md`.

You add a local project, pick a branch and a workspace, and create a mission with a goal. The default workspace for a Git project is a new worktree. Folders that are not Git repositories stay on the current checkout. `Settings.defaultWorkspaceMode` is `new_worktree` or `current_checkout`.

Work mode is the default. Agents act under approval-free YOLO after the capability gates. Plan mode is read-only. Only the main agent enters it, by calling `missions.enter_plan` when you ask to plan or when it decides the request needs a plan. Approval of that plan returns the mission to Work mode. Creating a mission or posting a message cannot set `executionMode`.

The queue is a durable outbox. `POST /v2/missions/:id/messages` returns when the message is `accepted`, not when the agent starts. `accepted` items can be edited, removed, or moved between steer and queue. `unknown` means delivery is uncertain, including after the 30-second acknowledgement deadline. Those items are never replayed on their own. A retry sends a new message, and an `unknown` original can arrive twice.

Workers get assignments. A handoff is the worker's final report, delivered to the main agent as an agent message. The daemon also sends agent events when a worker fails, stalls without a handoff, resumes after a stall, starts waiting on you, or stops waiting. Those notices are task context. They are not your authorization.

Publishing is a reviewed commit, a push, or a pull request. `Changes.hash` fingerprints the diff you reviewed. Send it back as `expectedChangesHash` so a commit cannot include changes you have not seen. Cleanup removes a mission's worktree and local branch when that mission is eligible.

`DELETE /v2/missions/:id` forgets a stopped mission. It can remove a worktree Missions created. It does not remove a current checkout or an existing worktree you already had.

## Data on disk

| Path under `MISSIONS_HOME` | What it holds |
| --- | --- |
| `missions.db` | Missions, events, and operations. The daemon migrates this file when it opens it. |
| `daemon-token` | Bearer token for `/v2` routes other than health. Mode `0600`. |
| `repos/` | Cloned repositories. |
| `worktrees/` | Mission worktrees. |
| `artifacts/` and `attachments/` | Mission files and composer uploads. |

Before a pending migration, the daemon writes `missions.db.pre-migration-<applied>.bak` once for that starting schema, mode `0600`. An older daemon refuses a database written by a newer schema. To roll back, stop the new daemon, move `missions.db` and its `-wal` and `-shm` files aside, copy the matching `.bak` to `missions.db`, and start the previous pair. Work done after the upgrade is not in that backup.

File routes stay inside the mission workspace. `..`, absolute paths, symlinks that leave the workspace, and `.git` return `403`.

Review text and tool calls leave the machine when the daemon runs the Droid CLI and that CLI calls a model. This repo does not add a second telemetry sink.

## Local development

Use two terminals after `pnpm install`.

```bash
pnpm dev:daemon
pnpm dev:web
```

Checks:

```bash
pnpm gate
```

`pnpm gate` runs `pnpm design:check`, `pnpm check`, `pnpm check:doctor`, `pnpm typecheck`, and `pnpm test`.

| Script | What it does |
| --- | --- |
| `pnpm check` | Ultracite (Oxlint + Oxfmt). |
| `pnpm fix` | Applies Ultracite fixes. |
| `pnpm design:tokens` | Regenerates `apps/web/src/styles/tokens.css` from `design/tokens.json`. |
| `pnpm design:check` | Fails if generated tokens or authored CSS drift from the contract. |
| `pnpm typecheck` | Root `tsc`, then each workspace package. |
| `pnpm test` | Vitest. |
| `pnpm test:live` | Live Vitest config. Requires `MISSIONS_LIVE=1`. Present after the scripted-agent work. |
| `pnpm test:e2e` | Playwright. Present after the browser-test work. |

Design values come only from `design/tokens.json`. Do not edit `apps/web/src/styles/tokens.css` by hand. Spacing in feature code uses the named scale (`p-md`, `gap-sm`), not numeric steps. The rules are in `design/README.md`.

The first commit's `pnpm test` covers the health route, the health schema, and the design contract. It does not start Droid.

## Documentation

| Document | What it covers |
| --- | --- |
| [Glossary](GLOSSARY.md) | Mission, project, workspace, agent, queue, publish, cleanup. Added after the first commit. |
| [Daemon HTTP API](packages/protocol/API.md) | `/v2` routes, delivery, plan mode, Git actions, upgrades. |
| [Design system](design/README.md) | Tokens, spacing, lint, and documented exceptions. Present in the first commit. |
| [First-token notes](apps/daemon/src/perf/README.md) | Startup timing runs against an installed CLI. |
