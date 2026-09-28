/** Number of price rows that fit above and below the midpoint without scrolling. */
export function visibleDepthPerSide(
  availableHeight: number,
  headerHeight: number,
  rowHeight: number,
): number {
  if (
    !Number.isFinite(availableHeight) ||
    !Number.isFinite(headerHeight) ||
    !Number.isFinite(rowHeight) ||
    availableHeight <= 0 ||
    headerHeight < 0 ||
    rowHeight <= 0
  )
    return 1;
  return Math.max(1, Math.floor((availableHeight - headerHeight - rowHeight) / (2 * rowHeight)));
}

export interface DepthLevel {
  priceExact: string;
  price: number;
  quantity: number;
  /** Running total from the best price outward. */
  cumulative: number;
}

/** Visible depth for one book side. */
export function depthLevels(
  levels: readonly { priceExact: string; price: number; quantity: number }[],
  count: number,
): DepthLevel[] {
  const result: DepthLevel[] = [];
  let cumulative = 0;
  for (const level of levels) {
    if (result.length >= Math.max(0, Math.floor(count))) break;
    if (!(level.quantity > 0)) continue;
    cumulative += level.quantity;
    result.push({
      priceExact: level.priceExact,
      price: level.price,
      quantity: level.quantity,
      cumulative,
    });
  }
  return result;
}
