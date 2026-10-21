import { parseTokenAmount } from "@conditional-stocks/domain";

/** What a person types into an amount or price field, as the exact plain decimal the unit
 * parsers accept, or null when it is not a number. Spaces and thousands separators are dropped
 * ("1,000.5"), a lone comma is a decimal point ("2,5"), ".5" reads as 0.5 and "5." as 5, and
 * extra leading zeros go. */
export function decimalInput(text: string): string | null {
  let value = text.trim().replace(/[\s_]/g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(value)) value = value.replace(/,/g, "");
  else if (/^\d*,\d+$/.test(value)) value = value.replace(",", ".");
  const match = /^(\d*)(?:\.(\d*))?$/.exec(value);
  if (!match || !/\d/.test(value)) return null;
  const whole = (match[1] ?? "").replace(/^0+(?=\d)/, "") || "0";
  const fraction = match[2] ?? "";
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Decimal places a typed number really uses (trailing zeros do not count). */
export const decimalPlaces = (value: string) =>
  (value.split(".")[1] ?? "").replace(/0+$/, "").length;

/** Raw units of a typed amount of a token with `decimals` places; throws a message a person can
 * act on ("Enter an amount", "USDG allows at most 6 decimal places"), never a parser's. */
export function parseAmountInput(text: string, decimals: number, unit = "This amount"): bigint {
  if (!text.trim()) throw new Error("Enter an amount.");
  const value = decimalInput(text);
  if (value === null) throw new Error("Enter a number, like 10 or 2.5.");
  if (decimalPlaces(value) > decimals)
    throw new Error(
      decimals === 0
        ? `${unit} takes whole numbers only.`
        : `${unit} allows at most ${decimals} decimal places.`,
    );
  return parseTokenAmount(value, decimals);
}
