import { logger } from "./logger";

export async function adminRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/gateway/${path.replace(/^\//, "")}`, {
    ...init,
    cache: "no-store",
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!response.ok) {
    logger.warn("admin.request.failed", {
      status: response.status,
      requestId: response.headers.get("x-request-id"),
      method: init.method ?? "GET",
    });
    throw new Error(body.error?.message ?? `Admin request failed (${response.status})`);
  }
  return body;
}

export interface EvidenceView {
  envelope: {
    packet: {
      kind: "market-creation" | "market-resolution";
      preparedAt: string;
      preparer: string;
      localMarket?: { marketId: string };
      polymarket?: { question: string };
    };
    packetHash: string;
  };
  observations: Array<{ action: string; observedAt: string; transactionHash: string }>;
  previews: Array<{
    action: string;
    chainId: number;
    data: string;
    from: string;
    previewId: string;
    to: string;
    value: string;
  }>;
  reviews: Array<{ decision: string; reviewedAt: string; reviewer: string }>;
  status: "approved" | "prepared" | "rejected";
}
