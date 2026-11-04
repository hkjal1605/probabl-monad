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
      ...([
        "market-maker",
        "vault-keeper",
        "feed-mirror",
        "market-automation",
        "world-keeper",
        "world-marker",
      ].includes(name)
        ? [`--env-file=${resolve(root, `.env.${name}`)}`]
        : name === "world-fit"
          ? [`--env-file=${resolve(root, ".env.world-keeper")}`]
          : []),
      resolve(root, entry),
      ...extra,
    ],
  };
}

// One API process runs the chain index (live replica, finalized persistence, reconciliation)
// and the /v1 API (and with WORLD_BOOKS_ADDRESS the world index and /v2). The market maker, the
// Δ-vault keeper, the market automation, the testnet mock-feed mirror, and the world vault's
// keeper and marker each use their own wallet and run only when their .env.<name> file exists;
// the world fit runs nightly with the keeper's environment.
module.exports = {
  apps: [
    service("polymarket", "services/polymarket-ingestor/src/main.ts", "384M"),
    service("api", "apps/server/src/main.ts", "1024M"),
    ...(existsSync(resolve(root, ".env.market-maker"))
      ? [service("market-maker", "services/market-maker/src/main.ts", "512M", ["--execute"])]
      : []),
    ...(existsSync(resolve(root, ".env.vault-keeper"))
      ? [service("vault-keeper", "services/vault-keeper/src/main.ts", "512M", ["--execute"])]
      : []),
    ...(existsSync(resolve(root, ".env.market-automation"))
      ? [
          service("market-automation", "services/market-automation/src/main.ts", "256M", [
            "--execute",
          ]),
        ]
      : []),
    ...(existsSync(resolve(root, ".env.feed-mirror"))
      ? [service("feed-mirror", "scripts/evm/feed-mirror.ts", "256M")]
      : []),
    ...(existsSync(resolve(root, ".env.world-keeper"))
      ? [
          service("world-keeper", "services/world-keeper/src/main.ts", "512M", [
            "quote",
            "--execute",
          ]),
          {
            ...service("world-fit", "services/world-keeper/src/main.ts", "512M", ["fit"]),
            autorestart: false,
            cron_restart: "30 3 * * *",
          },
        ]
      : []),
    ...(existsSync(resolve(root, ".env.world-marker"))
      ? [
          service("world-marker", "services/world-keeper/src/main.ts", "384M", [
            "mark",
            "--execute",
          ]),
        ]
      : []),
  ],
};
