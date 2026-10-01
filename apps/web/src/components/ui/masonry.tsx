"use client";
import { Children, type ReactNode, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** Where each item goes: in order, into the shortest column (the leftmost of equals), right
 * below that column's last item. Returns each item's column (0-based) and top offset, and the
 * layout's height. An empty item takes no gap. */
export function masonryLayout(heights: readonly number[], columns: number, gap: number) {
  const bottoms = Array.from({ length: Math.max(1, columns) }, () => 0);
  const placed = heights.map((height) => {
    const column = bottoms.indexOf(Math.min(...bottoms));
    const top = bottoms[column] ?? 0;
    if (height > 0) bottoms[column] = top + height + gap;
    return { column, top };
  });
  return { placed, height: Math.max(0, ...bottoms.map((bottom) => bottom - gap)) };
}

/** Items of varying heights packed into columns, each right below the one above it. The grid
 * classes in `className` set the columns and gaps, so breakpoints stay in CSS; this only picks
 * each item's column and offset, from measured heights, again whenever an item resizes or the
 * items change. Items keep their DOM order and are never remounted; until the first placement
 * (or without JavaScript) they lay out as that ordinary grid. */
export function Masonry({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const grid = ref.current;
    if (!grid) return;
    const layout = () => {
      const style = getComputedStyle(grid);
      const columns = style.gridTemplateColumns
        .split(" ")
        .filter((track) => track.endsWith("px")).length;
      if (!columns) return;
      const items = [...grid.children] as HTMLElement[];
      // Every item sits in the first column, which always exists and is as wide as any other,
      // and is offset into its own: its width never depends on a placement, even one made for
      // more columns than there are now.
      grid.dataset.masonry = "";
      const { placed, height } = masonryLayout(
        items.map((item) => item.getBoundingClientRect().height),
        columns,
        Number.parseFloat(style.rowGap) || 0,
      );
      const gap = Number.parseFloat(style.columnGap) || 0;
      for (const [i, { column, top }] of placed.entries()) {
        const item = items[i] as HTMLElement;
        item.style.left = `calc(${column} * (100% + ${gap}px))`;
        item.style.top = `${top}px`;
      }
      grid.style.height = `${height}px`;
    };
    // Items resize when their content or the columns change, never on being placed; the grid
    // itself is not observed, since placing items sets its height.
    const resized = new ResizeObserver(layout);
    const observe = () => {
      for (const item of grid.children) resized.observe(item);
    };
    const changed = new MutationObserver((records) => {
      for (const record of records)
        for (const node of record.removedNodes) resized.unobserve(node as Element);
      observe();
      layout();
    });
    layout();
    observe();
    changed.observe(grid, { childList: true });
    return () => {
      changed.disconnect();
      resized.disconnect();
    };
  }, []);
  return (
    <div
      ref={ref}
      className={cn(
        "relative grid data-masonry:*:absolute data-masonry:*:col-start-1 data-masonry:*:col-end-2 data-masonry:*:w-full",
        className,
      )}
    >
      {Children.map(children, (child) => (
        <div>{child}</div>
      ))}
    </div>
  );
}
