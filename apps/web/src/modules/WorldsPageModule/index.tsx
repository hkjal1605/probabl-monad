import { Page } from "@/components/ui/page";
import { WorldsHome } from "./components/WorldsHome";

export function WorldsPageModule() {
  return (
    <Page className="max-w-[1120px] px-4 pb-16 sm:px-6">
      <WorldsHome />
    </Page>
  );
}
