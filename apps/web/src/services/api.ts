import {
  assertRequestSession,
  hasRequestSession,
  MEMBERSHIP_EVENT,
  SESSION_EXPIRED_EVENT,
} from "../lib/wallet/session";
import { apiUrl } from "./constants";
import { retryAfterMs } from "./read-policy";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly requestId: string | null,
    public readonly retryAfterMs?: number,
    /** Why a gate refused (e.g. "invite-required", "suspended", "wrong-wallet"). */
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Mutations name the app and the wallet it shows; a GET adds no header (no CORS preflight). */
const CLIENT_HEADER = "x-probabl-client";
const WALLET_HEADER = "x-probabl-wallet";
const announce = (name: string, detail?: unknown) => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
};

/** Direct, origin-bound transport. Never retry mutations or log signed payloads.
 *
 * `auth` sends a request as the signed-in wallet: the id of the sign-in it was reviewed under, or
 * `true` for the current one. It is checked before anything is sent and carries the session (its
 * cookie, or its bearer token for an API on another site). Without a session, `cookies` and
 * `bearer` carry a credential explicitly (signing in and out, rereading a kept session). */
export async function requestJson<T>(
  path: string,
  options: {
    signal?: AbortSignal;
    body?: unknown;
    timeoutMs?: number;
    auth?: string | true;
    cookies?: boolean;
    /** The wallet a cookie request acts for, when no session is active (signing out). */
    wallet?: string;
    bearer?: string;
    /** Lets the request outlive the page (a last call as it is left). */
    keepalive?: boolean;
  } = {},
): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    throw new Error("Invalid API path");
  let session: { id: string; owner: string; transport: "cookie" | "token"; token?: string } | null =
    null;
  if (options.auth !== undefined) {
    if (options.auth === true && !hasRequestSession())
      throw new ApiError("Sign in to continue.", 401, null, undefined, "signed-out");
    try {
      session = assertRequestSession(options.auth === true ? undefined : options.auth);
    } catch {
      announce(SESSION_EXPIRED_EVENT, options.auth === true ? undefined : options.auth);
      throw new ApiError(
        "Your trading session expired or wallet changed. Sign in again.",
        401,
        null,
      );
    }
  }
  const mutation = options.body !== undefined;
  const bearer = session
    ? session.transport === "token"
      ? session.token
      : undefined
    : options.bearer;
  const cookies = session ? session.transport === "cookie" : options.cookies === true;
  const wallet = session?.owner ?? options.wallet;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const response = await fetch(apiUrl(path), {
    credentials: cookies ? "include" : "omit",
    method: mutation ? "POST" : "GET",
    cache: "no-store",
    redirect: "error",
    ...(options.keepalive ? { keepalive: true } : {}),
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    headers: {
      ...(mutation ? { "content-type": "application/json" } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(mutation && cookies ? { [CLIENT_HEADER]: "web" } : {}),
      ...(mutation && cookies && wallet ? { [WALLET_HEADER]: wallet } : {}),
    },
    ...(mutation ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    const field = (name: string) =>
      error && typeof error === "object" && name in error
        ? (error as Record<string, unknown>)[name]
        : undefined;
    const message = field("message");
    const code = typeof field("code") === "string" ? (field("code") as string) : undefined;
    if (session) {
      // The cookie ended or now belongs to another wallet: this sign-in is over.
      if (response.status === 401 || code === "wrong-wallet")
        announce(SESSION_EXPIRED_EVENT, session.id);
      else if (code === "invite-required" || code === "suspended") announce(MEMBERSHIP_EVENT);
    }
    throw new ApiError(
      typeof message === "string" ? message : `Data unavailable (${response.status})`,
      response.status,
      response.headers.get("x-request-id"),
      retryAfterMs(response.headers.get("retry-after")),
      code,
    );
  }
  return response.json() as Promise<T>;
}

/** Reads a server-sent event stream as the signed-in wallet (an `EventSource` cannot carry a
 * bearer token), calling `onEvent` with each event's name and JSON data until the stream ends or
 * `signal` aborts. Resolves when the server closes it; rejects when it cannot be opened or
 * breaks. The caller reconnects. */
export async function requestEvents(
  path: string,
  options: {
    signal: AbortSignal;
    auth: string | true;
    onEvent: (event: string, data: unknown) => void;
  },
): Promise<void> {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    throw new Error("Invalid API path");
  if (options.auth === true && !hasRequestSession())
    throw new ApiError("Sign in to continue.", 401, null, undefined, "signed-out");
  const session = assertRequestSession(options.auth === true ? undefined : options.auth);
  const response = await fetch(apiUrl(path), {
    credentials: session.transport === "cookie" ? "include" : "omit",
    cache: "no-store",
    redirect: "error",
    signal: options.signal,
    headers: {
      accept: "text/event-stream",
      ...(session.transport === "token" ? { authorization: `Bearer ${session.token}` } : {}),
    },
  });
  if (!response.ok || !response.body) {
    if (response.status === 401) announce(SESSION_EXPIRED_EVENT, session.id);
    throw new ApiError(
      `Stream unavailable (${response.status})`,
      response.status,
      response.headers.get("x-request-id"),
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (!data.length) continue;
      try {
        options.onEvent(event, JSON.parse(data.join("\n")));
      } catch {
        // A malformed frame changes nothing.
      }
    }
  }
}
