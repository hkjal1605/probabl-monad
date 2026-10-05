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
