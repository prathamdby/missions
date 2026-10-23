# Missions

Missions coordinate agents working toward a goal in a local project.

## Language

**Mission**: A goal and the work undertaken to achieve it. _Avoid_: Job, run

**Project**: A local Git repository available for missions. _Avoid_: Workspace

**Workspace**: The checkout or worktree in which a mission works. _Avoid_: Project

**Agent**: A droid acting as an orchestrator or worker within a mission.

**Orchestrator**: The agent responsible for planning and coordinating a mission. _Avoid_: Worker

**Worker**: An agent responsible for an assignment. _Avoid_: Orchestrator

**Assignment**: A piece of mission work given to a worker. _Avoid_: Mission

**Plan**: The proposed work for a mission, subject to approval or revision.

**Queue**: Messages awaiting delivery to an agent.

**Permission**: Authorization for an agent action that requires approval.

**Autonomy**: The level of actions agents may take without asking.

**Publish**: Sharing mission changes through a commit, push, or pull request.

**Cleanup**: Removal of a mission's worktree and local branch when eligible.
