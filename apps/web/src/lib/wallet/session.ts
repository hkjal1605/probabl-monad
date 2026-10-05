import { getAddress, isAddress } from "viem";

type Deployment = { chainId: number; exchange: string };

/** The API keeps a session 30 days from its last use; the app accepts nothing longer. */
export const WALLET_SESSION_MS = 31 * 24 * 60 * 60 * 1000;
/** A tab open this long rereads its session, which also renews it. */
export const SESSION_REREAD_MS = 24 * 60 * 60 * 1000;
export const WALLET_STORAGE_KEY = "probabl:ui:wallet:v1";
/** Announces cookie sign-ins and sign-outs to other tabs. It holds no credential: those sessions
 * are HttpOnly cookies the page cannot read. */
export const SESSION_STORAGE_KEY = "probabl:ui:session:v2";
/** Bearer sessions, one per wallet, for an API whose cookies this page cannot use (another site). */
export const TOKEN_STORAGE_KEY = "probabl:ui:sessions:v3";
/** Whether cookies reach each API, checked once per browser. */
export const TRANSPORT_STORAGE_KEY = "probabl:ui:transport:v1";
/** The one bearer session earlier releases kept, carried over once. */
export const LEGACY_SESSION_KEY = "probabl:ui:session:v1";
const MAX_STORED_SESSIONS = 20;
/** EIP-6963 reverse-DNS id of the wallet, or "injected". */
export type WalletKind = string;
export interface RememberedWallet {
  version: 1;
  kind: WalletKind;
  owner: string;
}
/** A wallet's membership: invited wallets trade and see their portfolio. */
export interface MemberView {
  joinedAt: string;
  referrer: string | null;
  codeQuota: number;
  suspended: boolean;
}
/** How a session reaches the API: the wallet's HttpOnly cookie when this page's cookies reach it,
 * otherwise a bearer token kept in this browser. */
export type Transport = "cookie" | "token";
/** The signed-in wallet as this tab knows it. `id` is local and secret-free: it names this sign-in
 * so a request reviewed under it is never sent under another. */
export interface WalletSession {
  version: 2;
  binding: string;
  owner: string;
  id: string;
  issuedAt: number;
  expiresAt: number;
  member: MemberView | null;
  transport: Transport;
  /** The bearer token, for the token transport only. */
  token?: string;
}
/** What the wallet may do: browse, sign in, join with an invite, or trade. */
export type WalletAccess =
  | "disconnected"
  | "signed-out"
  | "invite-required"
  | "suspended"
  | "member";
export type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function browserStorage(): SessionStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
export const sessionBinding = (deployment: Deployment, origin: string) =>
  JSON.stringify([origin, deployment.chainId, deployment.exchange]);

function read(storage: SessionStorage | null, name: string): unknown {
  try {
    const raw = storage?.getItem(name);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function write(storage: SessionStorage | null, name: string, value: unknown) {
  try {
    if (!storage) return false;
    storage.setItem(name, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function forget(storage: SessionStorage | null, name: string) {
  try {
    storage?.removeItem(name);
  } catch {
    /* Memory session is still cleared if storage is unavailable. */
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
/** A checksummed address, exactly as the wallet controller stores it. */
const ownerAddress = (value: unknown): value is string =>
  typeof value === "string" && isAddress(value, { strict: false }) && getAddress(value) === value;
const bearerToken = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export function rememberedWallet(storage: SessionStorage | null): RememberedWallet | null {
  const value = read(storage, WALLET_STORAGE_KEY);
  if (
    !object(value) ||
    value.version !== 1 ||
    typeof value.kind !== "string" ||
    !/^[a-z0-9.-]{1,100}$/i.test(value.kind) ||
    !ownerAddress(value.owner)
  )
    return null;
  return value as unknown as RememberedWallet;
}
export function rememberWallet(storage: SessionStorage | null, kind: WalletKind, owner: string) {
  if (!ownerAddress(owner)) throw new Error("Invalid wallet address");
  return write(storage, WALLET_STORAGE_KEY, { version: 1, kind, owner });
}

/** A membership as the API reports it, or null for a wallet that has not joined. */
export function parseMember(value: unknown): MemberView | null {
  if (value === null || value === undefined) return null;
  if (
    !object(value) ||
    typeof value.joinedAt !== "string" ||
    Number.isNaN(Date.parse(value.joinedAt)) ||
    !(
      value.referrer === null ||
      (typeof value.referrer === "string" && isAddress(value.referrer))
    ) ||
    !Number.isSafeInteger(value.codeQuota) ||
    (value.codeQuota as number) < 0 ||
    typeof value.suspended !== "boolean"
  )
    throw new Error("API returned an invalid membership");
  return {
    joinedAt: value.joinedAt,
    referrer: value.referrer === null ? null : getAddress(value.referrer as string),
    codeQuota: value.codeQuota as number,
    suspended: value.suspended,
  };
}
export const walletAccess = (
  account: string | null,
  session: WalletSession | null,
): WalletAccess =>
  !account
    ? "disconnected"
    : !session
      ? "signed-out"
      : !session.member
        ? "invite-required"
        : session.member.suspended
          ? "suspended"
          : "member";
const localId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/** This tab's view of the API's session for `owner` (`{ wallet, expiresInMs, member }`). The
 * session ends `expiresInMs` from now by this clock, however far off the clock is. */
export function createWalletSession(
  binding: string,
  owner: string,
  response: unknown,
  now = Date.now(),
  transport: Transport = "cookie",
  token?: string,
): WalletSession {
  if (!ownerAddress(owner) || !Number.isSafeInteger(now) || now < 0 || !object(response))
    throw new Error("API returned an invalid session");
  const { wallet, expiresInMs, expiresAtMs } = response;
  if (typeof wallet !== "string" || !isAddress(wallet) || getAddress(wallet) !== owner)
    throw new Error("API returned a session for another wallet");
  // The API's remaining lifetime (its own clock); its absolute expiry only from older APIs.
  const remaining =
    expiresInMs !== undefined
      ? expiresInMs
      : typeof expiresAtMs === "number"
        ? expiresAtMs - now
        : Number.NaN;
  if (
    typeof remaining !== "number" ||
    !Number.isSafeInteger(remaining) ||
    remaining <= 0 ||
    remaining > WALLET_SESSION_MS
  )
    throw new Error("API returned an expired or invalid session lifetime");
  if (transport === "token" && !bearerToken(token))
    throw new Error("API returned an invalid session token");
  return {
    version: 2,
    binding,
    owner,
    id: localId(),
    issuedAt: now,
    expiresAt: now + remaining,
    member: parseMember(response.member),
    transport,
    ...(transport === "token" && token ? { token } : {}),
  };
}

// ---------------------------------------------------------------- bearer sessions in storage

interface StoredSession {
  binding: string;
  owner: string;
  token: string;
  expiresAt: number;
}
function storedSessions(storage: SessionStorage | null, now: number): StoredSession[] {
  const value = read(storage, TOKEN_STORAGE_KEY);
  if (!object(value) || value.version !== 3 || !Array.isArray(value.sessions)) return [];
  return value.sessions.filter(
    (s): s is StoredSession =>
      object(s) &&
      typeof s.binding === "string" &&
      ownerAddress(s.owner) &&
      bearerToken(s.token) &&
      Number.isSafeInteger(s.expiresAt) &&
      (s.expiresAt as number) > now &&
      (s.expiresAt as number) <= now + WALLET_SESSION_MS,
  );
}
/** A wallet's bearer session kept in this browser, while it lasts. */
export function storedToken(
  storage: SessionStorage | null,
  binding: string,
  owner: string,
  now = Date.now(),
): { token: string; expiresAt: number } | null {
  const found = storedSessions(storage, now).find(
    (s) => s.binding === binding && s.owner === owner,
  );
  return found ? { token: found.token, expiresAt: found.expiresAt } : null;
}
/** Keeps (or renews) a wallet's bearer session; every wallet keeps its own. */
export function storeToken(
  storage: SessionStorage | null,
  binding: string,
  owner: string,
  token: string,
  expiresAt: number,
  now = Date.now(),
) {
  if (!ownerAddress(owner) || !bearerToken(token)) throw new Error("Invalid session");
  const others = storedSessions(storage, now).filter(
    (s) => !(s.binding === binding && s.owner === owner),
  );
  return write(storage, TOKEN_STORAGE_KEY, {
    version: 3,
    sessions: [{ binding, owner, token, expiresAt }, ...others].slice(0, MAX_STORED_SESSIONS),
  });
}
export function forgetToken(
  storage: SessionStorage | null,
  binding: string,
  owner: string,
  now = Date.now(),
) {
  const sessions = storedSessions(storage, now);
  const kept = sessions.filter((s) => !(s.binding === binding && s.owner === owner));
  if (kept.length !== sessions.length)
    write(storage, TOKEN_STORAGE_KEY, { version: 3, sessions: kept });
}
/** The bearer session an earlier release kept for this deployment, while it lasts. */
export function legacySession(
  storage: SessionStorage | null,
  binding: string,
  now = Date.now(),
): { owner: string; token: string; expiresAt: number } | null {
  const value = read(storage, LEGACY_SESSION_KEY);
  if (
    !object(value) ||
    value.version !== 1 ||
    value.binding !== binding ||
    !ownerAddress(value.owner) ||
    !bearerToken(value.token) ||
    !Number.isSafeInteger(value.expiresAt) ||
    (value.expiresAt as number) <= now
  )
    return null;
  return {
    owner: value.owner,
    token: value.token,
    expiresAt: Math.min(value.expiresAt as number, now + WALLET_SESSION_MS),
  };
}

// ---------------------------------------------------------------- transport per API

/** Whether this browser's cookies reach `api`, as checked earlier; null when not yet known. */
export function knownTransport(storage: SessionStorage | null, api: string): Transport | null {
  const value = read(storage, TRANSPORT_STORAGE_KEY);
  const known = object(value) ? value[api] : undefined;
  return known === "cookie" || known === "token" ? known : null;
}
export function rememberTransport(
  storage: SessionStorage | null,
  api: string,
  transport: Transport | null,
) {
  const value = read(storage, TRANSPORT_STORAGE_KEY);
  const next: Record<string, unknown> = object(value) ? { ...value } : {};
  if (transport) next[api] = transport;
  else delete next[api];
  return write(storage, TRANSPORT_STORAGE_KEY, next);
}

// ---------------------------------------------------------------- cookie sign-in announcements

/** The last cookie sign-in another tab announced, if it is for this deployment and still current. */
export function announcedSession(
  storage: SessionStorage | null,
  binding: string,
  now = Date.now(),
): { owner: string; id: string; expiresAt: number } | null {
  const value = read(storage, SESSION_STORAGE_KEY);
  if (
    !object(value) ||
    value.version !== 2 ||
    value.binding !== binding ||
    !ownerAddress(value.owner) ||
    typeof value.id !== "string" ||
    !/^[a-f0-9]{32}$/.test(value.id) ||
    !Number.isSafeInteger(value.expiresAt) ||
    (value.expiresAt as number) <= now
  )
    return null;
  return { owner: value.owner, id: value.id, expiresAt: value.expiresAt as number };
}
export const announceSession = (storage: SessionStorage | null, session: WalletSession) =>
  write(storage, SESSION_STORAGE_KEY, {
    version: 2,
    binding: session.binding,
    owner: session.owner,
    id: session.id,
    expiresAt: session.expiresAt,
  });

// A request-time guard also covers background tabs whose expiry timers were throttled.
export const SESSION_EXPIRED_EVENT = "probabl:ui-session-expired";
/** The API refused a request for membership reasons: the controller rereads the session. */
export const MEMBERSHIP_EVENT = "probabl:ui-membership";
let active: WalletSession | null = null;
let assertIdentity: (() => void) | undefined;
export function setRequestSession(value: WalletSession | null, checkIdentity?: () => void) {
  active = value;
  assertIdentity = checkIdentity;
}
/** The active session (`id` when a request was reviewed under a specific sign-in), or throws. */
export function assertRequestSession(id?: string, now = Date.now()): WalletSession {
  if (
    !Number.isSafeInteger(now) ||
    !active ||
    (id !== undefined && id !== active.id) ||
    now >= active.expiresAt
  )
    throw new Error("Your trading session expired. Sign in again.");
  assertIdentity?.();
  return active;
}
export const hasRequestSession = () => active !== null;
