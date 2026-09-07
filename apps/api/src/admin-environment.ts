import { MarketDataError } from "@conditional-stocks/market-data";
import { type Address, getAddress, isAddress } from "viem";

export interface AdminEvidenceEnvironment {
  attachmentPublicBaseUrl: string;
  marketAdminSafe: Address;
  operators: ReadonlySet<string>;
  polymarketIngestorToken: string;
  polymarketIngestorUrl: string;
  resolutionAdminSafe: Address;
  resolutionController: Address;
}

const address = (value: string | undefined, name: string): Address => {
  if (!value || !isAddress(value))
    throw new MarketDataError("INVALID_CONFIG", `${name} is invalid`);
  return getAddress(value);
};

export const loadAdminEvidenceEnvironment = (
  environment: NodeJS.ProcessEnv,
): AdminEvidenceEnvironment | null => {
  const operatorInput = environment.ADMIN_OPERATOR_ADDRESSES?.trim();
  if (!operatorInput) return null;
  const operators = new Set(
    operatorInput
      .split(",")
      .map((item, index) =>
        address(item.trim(), `ADMIN_OPERATOR_ADDRESSES[${index}]`).toLowerCase(),
      ),
  );
  if (operators.size < 2) {
    throw new MarketDataError(
      "INVALID_CONFIG",
      "at least two different admin operators are required",
    );
  }
  const ingestorUrl = environment.POLYMARKET_INGESTOR_URL ?? "http://127.0.0.1:42073";
  const parsedIngestorUrl = new URL(ingestorUrl);
  if (parsedIngestorUrl.protocol !== "http:" && parsedIngestorUrl.protocol !== "https:") {
    throw new MarketDataError("INVALID_CONFIG", "POLYMARKET_INGESTOR_URL must be HTTP(S)");
  }
  const publicBaseUrl = environment.ADMIN_EVIDENCE_PUBLIC_BASE_URL;
  if (!publicBaseUrl || new URL(publicBaseUrl).protocol !== "https:") {
    throw new MarketDataError("INVALID_CONFIG", "ADMIN_EVIDENCE_PUBLIC_BASE_URL must be HTTPS");
  }
  const token = environment.POLYMARKET_INTERNAL_TOKEN;
  if (!token || token.length < 16) {
    throw new MarketDataError("INVALID_CONFIG", "POLYMARKET_INTERNAL_TOKEN is required");
  }
  return {
    attachmentPublicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
    marketAdminSafe: address(environment.MARKET_ADMIN_SAFE_ADDRESS, "MARKET_ADMIN_SAFE_ADDRESS"),
    operators,
    polymarketIngestorToken: token,
    polymarketIngestorUrl: parsedIngestorUrl.toString().replace(/\/$/, ""),
    resolutionAdminSafe: address(
      environment.RESOLUTION_ADMIN_SAFE_ADDRESS,
      "RESOLUTION_ADMIN_SAFE_ADDRESS",
    ),
    resolutionController: address(
      environment.RESOLUTION_CONTROLLER_ADDRESS,
      "RESOLUTION_CONTROLLER_ADDRESS",
    ),
  };
};
