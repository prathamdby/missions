# Missions

Missions coordinate agents working toward a goal in a local project.

## Language

**Mission**: A goal and the work undertaken to achieve it. _Avoid_: Job, run

**Project**: A local Git repository available for missions. _Avoid_: Workspace

**Workspace**: The checkout or worktree in which a mission works. _Avoid_: Project

**Agent**: A droid acting as an orchestrator or worker within a mission.

**Orchestrator**: The main agent of a mission: it talks with the user, does work directly, and coordinates Workers when that helps. The UI and prompts call it the main agent. _Avoid_: Worker

**Worker**: An agent responsible for an assignment. _Avoid_: Orchestrator

**Assignment**: A piece of mission work given to a worker. _Avoid_: Mission

**Handoff**: A Worker's final report on its assignment, delivered to the Orchestrator as an agent message.

**Agent message**: A message from one agent to another in the same mission, such as a Worker's question or the Orchestrator's reply. Its sender is set by the daemon, and it is task context, never user authorization.

**Work mode**: The default execution mode, in which agents act directly under the fixed High permission policy.

**Plan mode**: An optional, read-only execution mode for every agent, in which the Orchestrator plans and asks the user to approve the plan.

**Plan**: The proposed work presented in Plan mode, subject to approval or revision.

**Queue**: Durable messages awaiting delivery to an agent, in acceptance order.

**Accepted**: A queued message saved by the daemon but not yet sent to its agent; it can still be edited or removed.

**Steer**: Delivery at the agent's next tool boundary. _Avoid_: Interrupt

**Permission**: Authorization for an agent action that requires approval.

**Publish**: Sharing mission changes through a commit, push, or pull request.

**Cleanup**: Removal of a mission's worktree and local branch when eligible.
