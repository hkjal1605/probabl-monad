import { Page } from "@/components/ui/page";
import { Explore } from "./components/Explore";

/** The open orders anyone can quote, and every world trade. */
export function WorldsExplorePageModule() {
  return (
    <Page className="max-w-[1120px] px-4 pb-16 sm:px-6">
      <Explore />
    </Page>
  );
}
