import { MarketDataError } from "@conditional-stocks/market-data";
import { fetchJson } from "./fetch-json.ts";
import { logger } from "./logger.ts";

export interface PolymarketSocket {
  close(): void;
}

export interface PolymarketSource {
  connect(
    tokenIds: string[],
    onEvent: (event: unknown) => void,
    onDisconnect: (reason: string) => void,
  ): PolymarketSocket;
  getBook(tokenId: string): Promise<unknown>;
  getMarket(gammaMarketId: string): Promise<unknown>;
}

export class OfficialPolymarketSource implements PolymarketSource {
  constructor(
    readonly gammaUrl: string,
    readonly clobUrl: string,
    readonly websocketUrl: string,
  ) {}

  async getMarket(gammaMarketId: string): Promise<unknown> {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(gammaMarketId)) {
      throw new MarketDataError("INVALID_REQUEST", "Gamma market ID is invalid");
    }
    return this.#json(`${this.gammaUrl}/markets/${encodeURIComponent(gammaMarketId)}`);
  }

  async getBook(tokenId: string): Promise<unknown> {
    if (!/^[1-9][0-9]*$/.test(tokenId)) {
      throw new MarketDataError("INVALID_REQUEST", "CLOB token ID is invalid");
    }
    return this.#json(`${this.clobUrl}/book?token_id=${encodeURIComponent(tokenId)}`);
  }

  connect(
    tokenIds: string[],
    onEvent: (event: unknown) => void,
    onDisconnect: (reason: string) => void,
  ): PolymarketSocket {
    const socket = new WebSocket(this.websocketUrl);
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let disconnectNotified = false;
    let intentionallyClosed = false;
    let lastPongAt = Date.now();
    const notifyDisconnect = (reason: string): void => {
      if (intentionallyClosed || disconnectNotified) return;
      disconnectNotified = true;
      onDisconnect(reason);
    };
    socket.addEventListener("open", () => {
      // A connection may finish opening after shutdown/replacement was requested.
      if (intentionallyClosed || disconnectNotified) {
        socket.close();
        return;
      }
      logger.info("polymarket.socket.connected", { subscriptions: tokenIds.length });
      socket.send(JSON.stringify({ assets_ids: tokenIds, type: "market" }));
      lastPongAt = Date.now();
      heartbeat = setInterval(() => {
        if (Date.now() - lastPongAt > 30_000) {
          notifyDisconnect("heartbeat-timeout");
          socket.close();
          return;
        }
        if (socket.readyState === WebSocket.OPEN) socket.send("PING");
      }, 10_000);
    });
    socket.addEventListener("message", (message) => {
      if (intentionallyClosed || disconnectNotified) return;
      if (message.data === "PONG") {
        lastPongAt = Date.now();
        return;
      }
      try {
        const decoded = JSON.parse(String(message.data)) as unknown;
        for (const event of Array.isArray(decoded) ? decoded : [decoded]) onEvent(event);
      } catch (error) {
        notifyDisconnect(
          `invalid-message:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    socket.addEventListener("error", () => notifyDisconnect("socket-error"));
    socket.addEventListener("close", (event) => {
      if (heartbeat) clearInterval(heartbeat);
      notifyDisconnect(`socket-close:${event.code}`);
    });
    return {
      close: () => {
        intentionallyClosed = true;
        if (heartbeat) clearInterval(heartbeat);
        socket.close();
      },
    };
  }

  #json(url: string): Promise<unknown> {
    return fetchJson(url, "Polymarket");
  }
}
