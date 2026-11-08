/** Whether a page is one of the worlds pages (the worlds page, a world, the builder, the lists,
 * My worlds): there the header shows and funds the world account. */
export const isWorldsPath = (pathname: string | null) =>
  pathname === "/worlds" || pathname?.startsWith("/worlds/") === true;
