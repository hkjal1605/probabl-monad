function amount(value: bigint) {
  if (typeof value !== "bigint" || value < 0n) throw new Error("Claim amount must be non-negative");
}

export function payoutDenominator(payouts: readonly number[]): bigint {
  if (
    payouts.length !== 2 ||
    ![
      [1, 0],
      [0, 1],
      [1, 1],
    ].some(([y, n]) => payouts[0] === y && payouts[1] === n)
  )
    throw new Error("Invalid finalized payout");
  return BigInt(payouts[0]! + payouts[1]!);
}

/** Underlying that must back outstanding claims: max(YES, NO) before resolution, the weighted
 * payout (rounded up) after. Outstanding claims include fees not yet claimed. */
export function requiredClaimBacking(yes: bigint, no: bigint, payouts?: readonly number[]) {
  amount(yes);
  amount(no);
  if (payouts === undefined) return yes > no ? yes : no;
  const denominator = payoutDenominator(payouts);
  const weighted = yes * BigInt(payouts[0]!) + no * BigInt(payouts[1]!);
  return (weighted + denominator - 1n) / denominator;
}

/** Exact contract semantics: never silently burn a fractional raw unit. */
export function exactRedemption(yes: bigint, no: bigint, payouts: readonly number[]) {
  amount(yes);
  amount(no);
  const denominator = payoutDenominator(payouts);
  const weighted = yes * BigInt(payouts[0]!) + no * BigInt(payouts[1]!);
  if (weighted % denominator !== 0n)
    throw new Error(
      "Redemption would discard a fractional raw unit; retain or combine the odd claim",
    );
  return weighted / denominator;
}

/** What one `redeem` call burns and pays for held claims. Under INVALID (1/2 each) an odd total
 * leaves exactly one raw claim unit held: it remains a real, transferable claim. */
export function planRedemption(yes: bigint, no: bigint, payouts: readonly number[]) {
  amount(yes);
  amount(no);
  const denominator = payoutDenominator(payouts);
  let redeemYes = yes,
    redeemNo = no,
    retainedYes = 0n,
    retainedNo = 0n;
  if (denominator === 2n && (yes + no) % 2n === 1n) {
    if (redeemNo > 0n) {
      redeemNo -= 1n;
      retainedNo = 1n;
    } else {
      redeemYes -= 1n;
      retainedYes = 1n;
    }
  }
  return {
    redeemYes,
    redeemNo,
    retainedYes,
    retainedNo,
    credit: exactRedemption(redeemYes, redeemNo, payouts),
  };
}
export type RedemptionPlan = ReturnType<typeof planRedemption>;
