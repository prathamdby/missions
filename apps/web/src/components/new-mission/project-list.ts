import type { MissionSummary } from "@missions/protocol/missions";
import type { Project } from "@missions/protocol/projects";

import { isMissionActive } from "@/lib/format";

const WEEK_MS = 7 * 86_400_000;

const ownMissions = (project: Project, missions: readonly MissionSummary[]) =>
  missions.filter((mission) => mission.projectId === project.id);

const lastActivity = (project: Project, own: readonly MissionSummary[]) => {
  let latest = project.createdAt;
  for (const mission of own) {
    if (mission.updatedAt > latest) {
      latest = mission.updatedAt;
    }
  }
  return latest;
};

/** "2 running", "4 missions", or how long ago a quiet project was last used. */
export const projectMeta = (
  project: Project,
  missions: readonly MissionSummary[],
  now: number
) => {
  const own = ownMissions(project, missions);
  const running = own.filter((mission) =>
    isMissionActive(mission.status)
  ).length;
  if (running > 0) {
    return `${running} running`;
  }
  const idle = now - Date.parse(lastActivity(project, own));
  if (idle >= WEEK_MS) {
    return `${Math.floor(idle / WEEK_MS)}w ago`;
  }
  if (own.length === 0) {
    return "No missions";
  }
  return own.length === 1 ? "1 mission" : `${own.length} missions`;
};

/** Projects matching `query`, most recently used first. */
export const recentProjects = (
  projects: readonly Project[],
  missions: readonly MissionSummary[],
  query: string
) => {
  const needle = query.trim().toLowerCase();
  return projects
    .filter(
      (project) =>
        !needle ||
        project.name.toLowerCase().includes(needle) ||
        project.path.toLowerCase().includes(needle)
    )
    .map((project) => ({
      at: lastActivity(project, ownMissions(project, missions)),
      project,
    }))
    .toSorted((a, b) => b.at.localeCompare(a.at))
    .map((entry) => entry.project);
};
