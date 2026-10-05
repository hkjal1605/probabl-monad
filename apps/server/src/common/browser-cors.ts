import { cors } from "hono/cors";

/** Browser access uses the same exact origin allowlist as wallet authentication, with
 * credentials: the trading app's session is an HttpOnly cookie. */
export const browserCors = (origins: readonly string[]) =>
  cors({
    origin: (origin) => (origins.includes(origin) ? origin : undefined),
    credentials: true,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "Idempotency-Key",
      "X-Probabl-Client",
      "X-Probabl-Wallet",
    ],
    exposeHeaders: ["Retry-After", "X-Request-Id"],
    maxAge: 3600,
  });
