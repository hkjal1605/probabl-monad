/** Runs a command with TEST_DATABASE_URL set to a fresh, owned localhost PostgreSQL cluster,
 * removed afterwards. Existing databases are never touched. */
import { localDatabase } from "../../packages/database/src/local.ts";

const command = process.argv.slice(2);
if (!command.length) throw new Error("Usage: bun scripts/evm/with-database.ts <command...>");
const database = await localDatabase();
try {
  const child = Bun.spawn(command, {
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, TEST_DATABASE_URL: database.connectionString },
  });
  process.exitCode = await child.exited;
} finally {
  await database.close();
}
