import type {
  AdminTransaction,
  AdminPreview as Preview,
} from "@conditional-stocks/evm-client/admin";
import type {
  CreationEvidencePacket,
  EvidenceEnvelope,
  ResolutionEvidencePacket,
} from "@conditional-stocks/market-data";

/** The API's transaction preview: the action's transaction plus any prerequisite
 * (a creation first lists the base token's custody pool). */
export type AdminPreview = Preview & { prerequisites: AdminTransaction[] };

import { assertRequestSession } from "./admin-session";
import { logger } from "./logger";
import { parseMarketSlug } from "./polymarket-slug";

export const SESSION_EXPIRED_EVENT = "probabl:admin-session-expired";
export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (
    !/^\/api\/(?:gateway\/[A-Za-z0-9_/-]+|indexer\/[A-Za-z0-9_/-]+|health)(?:\?[A-Za-z0-9=&_-]+)?$/.test(
      path,
    ) ||
    path.includes("//") ||
    path.includes("..")
  )
    throw new Error("Invalid same-origin API path");
  const timeout = AbortSignal.timeout(30_000);
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    logger.warn("admin.request.failed", {
      status: response.status,
      requestId: response.headers.get("x-request-id"),
      method: init.method ?? "GET",
    });
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error &&
      typeof body.error === "object" &&
      "message" in body.error &&
      typeof body.error.message === "string"
        ? body.error.message
        : `Request failed (${response.status})`;
    throw new AdminApiError(message, response.status);
  }
  if (!body || typeof body !== "object") throw new Error("API returned an invalid JSON response");
  return body as T;
}

export async function adminRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!token) throw new AdminApiError("Sign in with an operator wallet first", 401);
  if (typeof window !== "undefined") {
    try {
      assertRequestSession(token);
    } catch {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: token }));
      throw new AdminApiError("Your four-hour operator session expired. Sign in again.", 401);
    }
  }
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  try {
    return await requestJson<T>(`/api/gateway/${path}`, { ...init, headers });
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401 && typeof window !== "undefined")
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: token }));
    throw error;
  }
}

export function fetchMarketMetadata<T>(token: string, input: string): Promise<T> {
  return adminRequest<T>(token, "admin/polymarket/metadata/fetch-by-slug", {
    method: "POST",
    body: JSON.stringify({ marketSlug: parseMarketSlug(input) }),
  });
}

export interface EvidenceView {
  envelope: EvidenceEnvelope<CreationEvidencePacket | ResolutionEvidencePacket>;
  observations: Array<{ action: string; observedAt: string; transactionHash: string }>;
  previews: AdminPreview[];
  reviews: Array<{ decision: string; reviewedAt: string; reviewer: string }>;
  status: "approved" | "prepared" | "rejected";
}

/** Every on-chain market of the deployment for venue-level operations: `id` is the on-chain
 * market id the contract takes; `publicId` is the chain-independent id users see. */
export async function readVenues<T extends object>(signal?: AbortSignal) {
  const { markets } = await requestJson<{
    markets: (T & { id: string; venue: { marketId: string } })[];
  }>("/api/indexer/markets?venues=all", signal ? { signal } : {});
  return { markets: markets.map((m) => ({ ...m, publicId: m.id, id: m.venue.marketId })) };
}
