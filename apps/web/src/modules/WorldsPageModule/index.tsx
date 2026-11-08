import { Page } from "@/components/ui/page";
import { ExploringWorldsList, LiveWorldsList } from "./components/ListPages";
import { WorldsHome } from "./components/WorldsHome";

export function WorldsPageModule() {
  return (
    <Page className="max-w-[1120px] px-4 pb-16 sm:px-6">
      <WorldsHome />
    </Page>
  );
}

/** Every live world (the worlds page shows its first four). */
export function LiveWorldsPageModule() {
  return (
    <Page className="max-w-[1120px] px-4 pb-16 sm:px-6">
      <LiveWorldsList />
    </Page>
  );
}

/** Every world people are exploring (the worlds page shows its first four). */
export function ExploringWorldsPageModule() {
  return (
    <Page className="max-w-[1120px] px-4 pb-16 sm:px-6">
      <ExploringWorldsList />
    </Page>
  );
}
