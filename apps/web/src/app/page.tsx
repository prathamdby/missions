import { connection } from "next/server";

import { getDaemonHealth } from "@/lib/daemon-health";

const STATUS = {
  connected: {
    dot: "size-2 rounded-full bg-success",
    label: "Daemon connected",
  },
  incompatible: {
    dot: "size-2 rounded-full bg-warning",
    label: "Daemon speaks a different protocol version",
  },
  unreachable: {
    dot: "size-2 rounded-full bg-danger",
    label: "Daemon is not running",
  },
} as const;

const Home = async () => {
  await connection();
  const daemon = await getDaemonHealth();
  const { dot, label } = STATUS[daemon.status];

  return (
    <main className="flex min-h-dvh items-center justify-center p-2xl">
      <div className="flex flex-col gap-md rounded-lg bg-surface-raised p-xl shadow-sm">
        <h1 className="type-title text-text">Missions</h1>
        <output className="flex items-center gap-sm type-caption text-text-secondary">
          <span aria-hidden="true" className={dot} />
          {label}
        </output>
        {daemon.status === "connected" ? (
          <p className="type-mono text-text-tertiary">
            protocol v{daemon.health.protocolVersion} · {daemon.health.version}
          </p>
        ) : null}
      </div>
    </main>
  );
};

export default Home;
