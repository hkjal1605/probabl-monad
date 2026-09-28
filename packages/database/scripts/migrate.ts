/** Creates or verifies the protocol and Polymarket schemas (idempotent). */
import { createDatabase } from "../src/index.ts";
import {
  createPolymarketDatabase,
  initializePolymarketStorage,
} from "../src/polymarket/queries.ts";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = createDatabase({ connectionString: url, max: 1, applicationName: "probabl-migrate" });
await db.initialize();
await db.close();
const polymarket = createPolymarketDatabase(url);
await initializePolymarketStorage(polymarket, { createSchema: true });
await polymarket.end();
console.info("Database schema is current");
