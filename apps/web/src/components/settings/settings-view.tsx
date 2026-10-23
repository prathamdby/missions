"use client";

import type { Autonomy } from "@missions/protocol/common";
import type { AgentModelSettings } from "@missions/protocol/missions";
import type {
  ModelOption,
  Settings,
  UpdateSettingsRequest,
} from "@missions/protocol/settings";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMemo, useSyncExternalStore } from "react";

import {
  ChevronDownIcon,
  ShieldIcon,
  SidebarIcon,
} from "@/components/mission/icons";
import { ConnectionBanner } from "@/components/shell/connection-banner";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/selection";
import { Skeleton } from "@/components/ui/skeleton";
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
import { AUTONOMY, AUTONOMY_LEVELS } from "@/lib/autonomy";
import { effortLabel } from "@/lib/mission/pr";
import { toast } from "@/lib/toast-store";
import { cn } from "@/lib/utils";

import { LocationDraft } from "./location-draft";
import {
  DEFAULT_EFFORT,
  selectModel,
  selectEffort,
  selectableModels,
} from "./model-rules";
import { createSettingsCoordinator } from "./settings-cache";
import type { SettingsCoordinator } from "./settings-coordinator";

/** Paper Z6J describes each level in full under "Default level". */
const LEVEL_DETAIL: Record<Autonomy, string> = {
  high: "High · everything in Medium, plus pushes, migrations, and deploys.",
  low: "Low · edits and safe commands like ls, cat, git status.",
  medium:
    "Medium · edits, low-risk commands, and reversible changes like npm install, git commit, build.",
  off: "Off · reads only. Droids ask before every edit or command.",
};

const NOT_YET = "The daemon does not support changing this yet.";

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

/**
 * Paper's select: a styled face with a native select laid over it, so the
 * look matches the mockup and the control keeps native keyboard behavior.
 */
const SelectBox = ({
  children,
  className,
  disabled,
  label,
  onChange,
  options,
  testId,
  value,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  options: readonly { label: string; value: string }[];
  testId?: string;
  value: string;
}) => (
  <span
    className={cn(
      "relative flex h-7.5 shrink-0 items-center gap-sm rounded-sm bg-surface-overlay pr-md pl-control shadow-button transition-colors duration-fast focus-within:shadow-focus hover:bg-surface-active has-disabled:opacity-disabled",
      className
    )}
  >
    {children}
    <ChevronDownIcon className="size-3 text-text-tertiary" />
    <select
      aria-label={label}
      className="absolute inset-0 cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed"
      data-testid={testId}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </span>
);

const ModelRow = ({
  description,
  disabled,
  label,
  models,
  onChange,
  agentRole,
  value,
}: {
  description: string;
  disabled: boolean;
  label: string;
  models: readonly ModelOption[];
  onChange: (value: AgentModelSettings) => void;
  agentRole: "orchestrator" | "worker";
  value: AgentModelSettings;
}) => {
  const current = models.find((model) => model.id === value.modelId);
  const modelOptions = selectableModels(models, value);
  const efforts = current?.supportedReasoningEfforts ?? [];
  return (
    <Row description={description} label={label}>
      <SelectBox
        className="w-32"
        disabled={disabled}
        label={`${label} model`}
        onChange={(modelId) => onChange(selectModel(models, modelId))}
        options={modelOptions.map((model) => ({
          label: model.displayName,
          value: model.id,
        }))}
        testId={`settings-${agentRole}-model`}
        value={value.modelId}
      >
        <span className="min-w-0 flex-1 truncate font-mono text-xs leading-sm font-book text-text">
          {current?.displayName ?? value.modelId}
        </span>
      </SelectBox>
      <SelectBox
        className="w-35"
        disabled={disabled || efforts.length === 0}
        label={`${label} thinking`}
        onChange={(effort) => onChange(selectEffort(current, value, effort))}
        options={[
          { label: "Default", value: DEFAULT_EFFORT },
          ...(value.reasoningEffort && !efforts.includes(value.reasoningEffort)
            ? [
                {
                  label: effortLabel(value.reasoningEffort),
                  value: value.reasoningEffort,
                },
              ]
            : []),
          ...efforts.map((effort) => ({
            label: effortLabel(effort),
            value: effort,
          })),
        ]}
        testId={`settings-${agentRole}-effort`}
        value={value.reasoningEffort ?? DEFAULT_EFFORT}
      >
        <span className="text-xs leading-sm font-book tracking-tight text-text-tertiary">
          Thinking
        </span>
        <span className="min-w-0 flex-1 truncate text-xs leading-sm font-medium tracking-tight text-text">
          {effortLabel(value.reasoningEffort)}
        </span>
      </SelectBox>
    </Row>
  );
};

const Segmented = ({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: Autonomy) => void;
  value: Autonomy;
}) => (
  <fieldset className="flex items-center gap-2xs rounded-sm bg-surface p-2xs ring-1 ring-border ring-inset">
    <legend className="sr-only">Default autonomy</legend>
    {AUTONOMY_LEVELS.map((level) => {
      const active = level === value;
      return (
        <label
          className={cn(
            "flex h-6.5 cursor-pointer items-center gap-sm rounded-xs px-control text-xs leading-sm font-medium tracking-tight transition-colors duration-fast has-focus-visible:shadow-focus has-disabled:cursor-not-allowed",
            active
              ? "bg-surface-active text-text shadow-button"
              : "text-text-tertiary hover:text-text-secondary"
          )}
          key={level}
        >
          <input
            checked={active}
            className="sr-only"
            data-testid={`settings-autonomy-${level}`}
            disabled={disabled}
            name="default-autonomy"
            onChange={() => onChange(level)}
            type="radio"
            value={level}
          />
          {active ? <ShieldIcon className="size-3" /> : null}
          {AUTONOMY[level].label}
        </label>
      );
    })}
  </fieldset>
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

const DisabledAction = ({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) => (
  <Button aria-disabled="true" title={title} variant="secondary">
    {children}
  </Button>
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
        <DisabledAction title="Restart the daemon from the terminal where it runs.">
          Restart
        </DisabledAction>
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
        <DisabledAction title="Set FACTORY_API_KEY in the daemon's environment, then restart it.">
          Replace
        </DisabledAction>
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
          onChange={(orchestrator) => save({ orchestrator })}
          agentRole="orchestrator"
          value={data.orchestrator}
        />
        <ModelRow
          description="Do the todos, each in the mission’s worktree."
          disabled={busy}
          label="Workers"
          models={options}
          onChange={(worker) => save({ worker })}
          agentRole="worker"
          value={data.worker}
        />
      </Group>
      <Group
        description="What droids can run without asking. ⇧Tab changes it for one mission."
        title="Autonomy"
      >
        <Row
          description={LEVEL_DETAIL[data.defaultAutonomy]}
          label="Default level"
        >
          <Segmented
            disabled={busy}
            onChange={(defaultAutonomy) => save({ defaultAutonomy })}
            value={data.defaultAutonomy}
          />
        </Row>
      </Group>
      <Group
        description="Each mission works in its own git worktree, so your checkout stays untouched."
        title="Worktrees"
      >
        <LocationRow
          disabled={busy}
          onSave={(worktreeRoot) => save({ worktreeRoot })}
          value={data.worktreeRoot}
        />
        <Row
          description="New mission branches start with this."
          label="Branch prefix"
        >
          <span aria-disabled="true" title={NOT_YET}>
            <ValueBox>missions/</ValueBox>
          </span>
        </Row>
        <Row
          description="Copy untracked .env files from the project into each new worktree."
          label="Copy .env files"
        >
          <Switch
            appearance="settings"
            aria-label="Copy .env files"
            checked={false}
            disabled
            title={NOT_YET}
          />
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
      <div className="min-h-0 flex-1 overflow-y-auto px-3xl pt-2xl pb-4xl max-md:px-lg">
        <div className="mx-auto flex w-full max-w-settings flex-col gap-group">
          <SettingsBody />
        </div>
      </div>
    </div>
  );
};
