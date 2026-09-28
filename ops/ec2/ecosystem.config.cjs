const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

const root = resolve(__dirname, "../..");
const common = {
  cwd: root,
  script: "/usr/local/bin/bun",
  interpreter: "none",
  exec_mode: "fork",
  instances: 1,
  autorestart: true,
  watch: false,
  min_uptime: "30s",
  max_restarts: 20,
  exp_backoff_restart_delay: 1000,
  kill_timeout: 90000,
  merge_logs: true,
  env: {
    NODE_ENV: "production",
    TZ: "UTC",
    NO_COLOR: "1",
    DO_NOT_TRACK: "1",
  },
};

function service(name, entry, memory, extra = []) {
  return {
    ...common,
    name: `probabl-${name}`,
    max_memory_restart: memory,
    args: [
      `--env-file=${resolve(root, ".env")}`,
      ...(name === "market-maker" ? [`--env-file=${resolve(root, ".env.market-maker")}`] : []),
      resolve(root, entry),
      ...extra,
    ],
  };
}

// One API process runs the chain index (live replica, finalized persistence, reconciliation)
// and the /v1 API. The market maker uses its own dedicated wallet and runs only when
// .env.market-maker exists.
module.exports = {
  apps: [
    service("polymarket", "services/polymarket-ingestor/src/main.ts", "384M"),
    service("api", "apps/server/src/main.ts", "1024M"),
    ...(existsSync(resolve(root, ".env.market-maker"))
      ? [service("market-maker", "services/market-maker/src/main.ts", "512M", ["--execute"])]
      : []),
  ],
};
