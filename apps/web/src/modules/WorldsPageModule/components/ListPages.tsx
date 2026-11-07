"use client";
import { ExploringWorlds } from "./ExploringWorlds";
import { ListPage, LiveWorlds } from "./LiveWorlds";

/** `/worlds/live`: every world someone holds a position in, a page at a time. */
export function LiveWorldsList() {
  return (
    <ListPage>
      <LiveWorlds heading="h1" />
    </ListPage>
  );
}

/** `/worlds/exploring`: every world people priced lately that nobody holds yet, a page at a
 * time. */
export function ExploringWorldsList() {
  return (
    <ListPage>
      <ExploringWorlds heading="h1" />
    </ListPage>
  );
}
