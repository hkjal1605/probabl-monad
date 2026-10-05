import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

/** Fixed-window request counts per key, in memory: abuse protection for one API process, never
 * accounting. Keys beyond `capacity` evict the oldest window. */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly capacity = 50_000,
  ) {}

  /** Counts a request for `key`; false once the window's limit is reached. */
  take(key: string, now = Date.now()) {
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.delete(key);
      if (this.windows.size >= this.capacity) {
        const oldest = this.windows.keys().next().value;
        if (oldest !== undefined) this.windows.delete(oldest);
      }
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    if (window.count >= this.limit) return false;
    window.count++;
    return true;
  }

  /** Throws 429 (with Retry-After) when `key` is over its limit. */
  enforce(c: Context, key: string, message = "Too many requests. Try again shortly.") {
    if (this.take(key)) return;
    c.header("Retry-After", String(Math.ceil(this.windowMs / 1000)));
    throw new HTTPException(429, { message });
  }
}

/** The client's address: the socket peer, or with `trustedHops` proxies in front (each appending
 * to X-Forwarded-For), the address the outermost trusted proxy saw. */
export function clientIp(c: Context, trustedHops = 0): string {
  const socket = (c.env as { ip?: string } | undefined)?.ip ?? "";
  if (trustedHops <= 0) return socket || "unknown";
  const forwarded = (c.req.header("x-forwarded-for") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return forwarded.at(-trustedHops) ?? (socket || "unknown");
}
