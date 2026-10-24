"use client";

import type { AgentModelSettings } from "@missions/protocol/missions";
import type {
  DefaultWorkspaceMode,
  ModelOption,
  Settings,
  UpdateSettingsRequest,
} from "@missions/protocol/settings";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMemo, useSyncExternalStore } from "react";

import { SidebarIcon } from "@/components/mission/icons";
import { ModelControls } from "@/components/missions/model-controls";
import { ConnectionBanner } from "@/components/shell/connection-banner";
import { useShell } from "@/components/shell/shell-context";
import { Button, UnavailableButton } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/selection";
import { Skeleton } from "@/components/ui/skeleton";
import { Hint, HintTarget } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/api/api-error";
import { api } from "@/lib/api/endpoints";
import {
  useConnectionStatus,
  useGithubAuth,
  useGrants,
  useModels,
  useSettings,
} from "@/lib/api/queries";
import { queryKeys } from "@/lib/api/query-keys";
import { catalogUnavailable } from "@/lib/mission/model-settings";
import { toast } from "@/lib/toast-store";
import { cn } from "@/lib/utils";

import { LocationDraft } from "./location-draft";
import { createSettingsCoordinator } from "./settings-cache";
import type { SettingsCoordinator } from "./settings-coordinator";

const WORKSPACE_MODES: Record<
  DefaultWorkspaceMode,
  { description: string; label: string }
> = {
  current_checkout: {
    description:
      "New missions edit the project folder directly, on the branch you have checked out. You confirm first if it has uncommitted changes.",
    label: "Current checkout",
  },
  new_worktree: {
    description:
      "New missions get an isolated copy on a new branch, so your checkout stays untouched. Folders without Git always use the current checkout.",
    label: "New worktree",
  },
};

const isWorkspaceMode = (value: string): value is DefaultWorkspaceMode =>
  Object.hasOwn(WORKSPACE_MODES, value);

const coordinators = new WeakMap<QueryClient, SettingsCoordinator>();

const useUpdateSettings = () => {
  const queryClient = useQueryClient();
  let coordinator = coordinators.get(queryClient);
  if (!coordinator) {
    coordinator = createSettingsCoordinator(queryClient, {
      onError: (error) =>
        toast({
          description: errorMessage(error),
          title: "Could not save the setting",
          tone: "danger",
        }),
      persist: api.updateSettings,
    });
    coordinators.set(queryClient, coordinator);
  }
  const isPending = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot
  );
  return { isPending, save: coordinator.save };
};

const Group = ({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) => (
  <section aria-label={title} className="flex flex-col gap-lg">
    <div className="flex flex-col gap-xs">
      <h2 className="text-base leading-sm font-semibold tracking-tight text-text">
        {title}
      </h2>
      <p className="text-xs leading-sm font-book tracking-tight text-text-tertiary">
        {description}
      </p>
    </div>
    <div className="flex flex-col divide-y divide-border-subtle overflow-hidden rounded-md bg-surface-raised shadow-sm">
      {children}
    </div>
  </section>
);

const Row = ({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description: ReactNode;
  label: string;
}) => (
  <div className="flex min-h-15 items-center gap-2xl px-xl py-lg max-md:flex-col max-md:items-stretch max-md:gap-lg">
    <div className="flex min-w-0 flex-1 flex-col gap-2xs">
      <span className="text-sm leading-sm font-medium tracking-tight text-text">
        {label}
      </span>
      <span className="text-xs leading-sm font-book tracking-tight text-text-tertiary">
        {description}
      </span>
    </div>
    <div className="flex items-center gap-md max-md:flex-wrap">{children}</div>
  </div>
);

const ModelRow = ({
  description,
  disabled,
  label,
  models,
  onChange,
  agentRole,
  unavailable,
  value,
}: {
  description: string;
  disabled: boolean;
  label: string;
  models: readonly ModelOption[];
  onChange: (value: AgentModelSettings) => void;
  agentRole: "orchestrator" | "worker";
  unavailable: boolean;
  value: AgentModelSettings;
}) => (
  <Row description={description} label={label}>
    <ModelControls
      label={label}
      models={models}
      onChange={onChange}
      pending={disabled}
      settings={value}
      showLabel={false}
      testId={`settings-${agentRole}`}
      unavailable={unavailable}
    />
  </Row>
);
const ValueBox = ({ children }: { children: ReactNode }) => (
  <span className="flex h-7.5 max-w-80 items-center rounded-sm bg-surface px-control ring-1 ring-border ring-inset">
    <span className="truncate font-mono text-xs leading-sm font-book text-text-secondary">
      {children}
    </span>
  </span>
);

const LocationRow = ({
  disabled,
  onSave,
  value,
}: {
  disabled: boolean;
  onSave: (value: string) => Promise<boolean>;
  value: string;
}) => {
  const location = useMemo(() => new LocationDraft(), []);
  const { value: draft, pending } = useSyncExternalStore(
    location.subscribe,
    location.getSnapshot,
    location.getSnapshot
  );
  return (
    <Row
      description="Where the daemon creates worktrees on this machine."
      label="Location"
    >
      {draft === null ? (
        <>
          <ValueBox>{value}</ValueBox>
          <Button
            data-testid="settings-worktree-change"
            disabled={disabled}
            onClick={() => location.edit(value)}
            variant="secondary"
          >
            Change
          </Button>
        </>
      ) : (
        <form
          className="flex items-center gap-md"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!disabled) {
              await location.save(value, onSave);
            }
          }}
        >
          <input
            aria-label="Worktree location"
            className="h-7.5 w-64 rounded-sm bg-surface px-control font-mono text-xs leading-sm font-book text-text ring-1 ring-border-strong outline-none ring-inset focus-visible:shadow-focus"
            data-testid="settings-worktree-input"
            onChange={(event) => location.edit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                location.cancel();
              }
            }}
            value={draft}
          />
          <Button
            data-testid="settings-save"
            disabled={disabled || pending || !draft.trim()}
            type="submit"
            variant="primary"
          >
            Save
          </Button>
          <Button onClick={() => location.cancel()} variant="ghost">
            Cancel
          </Button>
        </form>
      )}
    </Row>
  );
};

const StatusLine = ({
  detail,
  label,
  tone,
}: {
  detail?: string | null;
  label: string;
  tone: "danger" | "success" | "warning";
}) => (
  <span className="flex min-w-0 items-center gap-md">
    <span
      aria-hidden="true"
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        tone === "success" && "bg-success",
        tone === "warning" && "bg-warning",
        tone === "danger" && "bg-danger"
      )}
    />
    <span className="truncate text-xs leading-sm font-medium tracking-tight text-text-secondary">
      {label}
    </span>
    {detail ? (
      <span className="shrink-0 font-mono text-2xs leading-xs font-book text-text-tertiary">
        {detail}
      </span>
    ) : null}
  </span>
);

const Connections = () => {
  const queryClient = useQueryClient();
  const connection = useConnectionStatus();
  const github = useGithubAuth();
  if (!connection.data) {
    return null;
  }
  const { daemon, droid } = connection.data;
  const gh = github.data ?? connection.data.github;
  const ghLabel =
    gh.state === "signed_in"
      ? `Signed in as ${gh.user ?? "you"}`
      : (gh.message ??
        (gh.state === "gh_missing" ? "gh is not installed" : "Signed out"));
  const recheck = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.githubAuth });
    queryClient.invalidateQueries({ queryKey: queryKeys.connection });
  };
  return (
    <Group
      description="The web app only talks to the daemon. The daemon uses this machine’s credentials."
      title="Connections"
    >
      <Row
        description="Runs missions, git, and gh on this machine."
        label="Daemon"
      >
        <StatusLine
          detail={`${daemon.url} · v${daemon.version}`}
          label="Connected"
          tone="success"
        />
        <UnavailableButton reason="Restart from terminal">
          Restart
        </UnavailableButton>
      </Row>
      <Row
        description="Uses the gh CLI login. Needed to clone, push, and open PRs."
        label="GitHub"
      >
        <StatusLine
          detail={github.data?.host ?? null}
          label={ghLabel}
          tone={gh.state === "signed_in" ? "success" : "warning"}
        />
        <Button
          data-testid="settings-github-recheck"
          onClick={recheck}
          variant="secondary"
        >
          Re-check
        </Button>
      </Row>
      <Row
        description="Used by the Droid SDK to run models."
        label="Factory API key"
      >
        <StatusLine
          detail="FACTORY_API_KEY"
          label={
            droid.state === "ready"
              ? `Droid ready${droid.version ? ` · ${droid.version}` : ""}`
              : (droid.message ?? "Droid is not available")
          }
          tone={droid.state === "ready" ? "success" : "danger"}
        />
        <UnavailableButton reason="Set key, then restart">
          Replace
        </UnavailableButton>
      </Row>
    </Group>
  );
};

/** Always-allow grants from permission prompts, with revoke. Not in Z6J. */
const Grants = () => {
  const queryClient = useQueryClient();
  const grants = useGrants();
  const revoke = useMutation({
    mutationFn: (grantId: string) => api.revokeGrant(grantId),
    onError: (error) =>
      toast({
        description: errorMessage(error),
        title: "Could not revoke",
        tone: "danger",
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.grants }),
  });
  if (!grants.data || grants.data.length === 0) {
    return null;
  }
  return (
    <Group
      description="Commands you chose to always allow. Revoke one to be asked again."
      title="Always allowed"
    >
      {grants.data.map((grant) => (
        <Row
          description={
            <span className="font-mono text-2xs leading-xs">
              {grant.workspacePath}
            </span>
          }
          key={grant.id}
          label={grant.normalizedRequest || grant.action}
        >
          <Button
            data-testid="settings-grant-revoke"
            disabled={revoke.isPending && revoke.variables === grant.id}
            onClick={() => revoke.mutate(grant.id)}
            variant="secondary"
          >
            Revoke
          </Button>
        </Row>
      ))}
    </Group>
  );
};

const SettingsGroups = ({ data }: { data: Settings }) => {
  const models = useModels();
  const update = useUpdateSettings();
  const save = (patch: UpdateSettingsRequest) => update.save(patch);
  const options = models.data?.models ?? [];
  const busy = update.isPending;
  return (
    <>
      <Group
        description="New missions start with these. Change them for one mission in its right panel."
        title="Models"
      >
        <ModelRow
          description="Plans the mission, splits it into todos, and talks to you."
          disabled={busy}
          label="Orchestrator"
          models={options}
          unavailable={catalogUnavailable(models)}
          onChange={(orchestrator) => save({ orchestrator })}
          agentRole="orchestrator"
          value={data.orchestrator}
        />
        <ModelRow
          description="Do the todos, each in the mission’s worktree."
          disabled={busy}
          label="Workers"
          models={options}
          unavailable={catalogUnavailable(models)}
          onChange={(worker) => save({ worker })}
          agentRole="worker"
          value={data.worker}
        />
      </Group>
      <Group
        description="Where new missions run. You can still pick another workspace when you start one."
        title="Worktrees"
      >
        <Row
          description={WORKSPACE_MODES[data.defaultWorkspaceMode].description}
          label="Default workspace"
        >
          <Select
            disabled={busy}
            onValueChange={(mode) => {
              if (isWorkspaceMode(mode)) {
                save({ defaultWorkspaceMode: mode });
              }
            }}
            value={data.defaultWorkspaceMode}
          >
            <SelectTrigger
              appearance="settings"
              aria-label="Default workspace"
              data-testid="settings-default-workspace"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["new_worktree", "current_checkout"] as const).map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {WORKSPACE_MODES[mode].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <LocationRow
          disabled={busy}
          onSave={(worktreeRoot) => save({ worktreeRoot })}
          value={data.worktreeRoot}
        />
        <Row
          description="New mission branches start with this."
          label="Branch prefix"
        >
          <Hint label="Not available yet">
            <HintTarget>
              <ValueBox>missions/</ValueBox>
            </HintTarget>
          </Hint>
        </Row>
        <Row
          description="Copy untracked .env files from the project into each new worktree."
          label="Copy .env files"
        >
          <Hint label="Not available yet">
            <HintTarget>
              <Switch
                appearance="settings"
                aria-label="Copy .env files"
                checked={false}
                disabled
              />
            </HintTarget>
          </Hint>
        </Row>
        <Row
          description="Removes the worktree and local branch after the PR merges."
          label="Delete worktree when merged"
        >
          <Switch
            appearance="settings"
            aria-label="Delete worktree when merged"
            checked={data.cleanupAfterMerge}
            data-testid="settings-cleanup-after-merge"
            disabled={busy}
            onCheckedChange={(cleanupAfterMerge) => save({ cleanupAfterMerge })}
          />
        </Row>
      </Group>
      <Connections />
      <Grants />
    </>
  );
};

const SettingsBody = () => {
  const settings = useSettings();
  if (settings.isPending) {
    return (
      <div className="flex flex-col gap-lg">
        <Skeleton className="w-1/3" />
        <Skeleton className="h-30" />
        <Skeleton className="w-1/3" />
        <Skeleton className="h-15" />
      </div>
    );
  }
  if (settings.isError) {
    return (
      <output className="text-xs leading-sm text-text-tertiary">
        Settings load once the Missions daemon is reachable.
      </output>
    );
  }
  return <SettingsGroups data={settings.data} />;
};

/** Paper Z6J. */
export const SettingsView = () => {
  const { setNavOpen } = useShell();
  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      <header className="flex h-13 shrink-0 items-center gap-control pr-xl pl-gutter max-md:pl-lg">
        <button
          aria-label="Open navigation"
          className="-ml-xs flex size-7 cursor-pointer items-center justify-center rounded-sm text-text-secondary hover:bg-surface-overlay md:hidden"
          onClick={() => setNavOpen(true)}
          type="button"
        >
          <SidebarIcon />
        </button>
        <h1 className="text-base leading-md font-semibold tracking-tight text-text">
          Settings
        </h1>
      </header>
      <ConnectionBanner />
      <ScrollArea asChild axis="y">
        <div className="relative min-h-0 flex-1 px-3xl pt-2xl pb-4xl max-md:px-lg">
          <div className="mx-auto flex w-full max-w-settings flex-col gap-group">
            <SettingsBody />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};
