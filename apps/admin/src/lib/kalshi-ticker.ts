/** A Kalshi market ticker as typed (case-insensitive), in Kalshi's upper case. */
export function parseKalshiTicker(input: unknown): string {
  const ticker = typeof input === "string" ? input.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9._-]{0,127}$/.test(ticker))
    throw new Error(
      "Enter the Kalshi market ticker, for example KXFEDDECISION-26DEC-H25 (not a full URL).",
    );
  return ticker;
}
