import { Page } from "@/components/ui/page";
import { MyWorlds } from "./components/MyWorlds";

export function MyWorldsPageModule() {
  return (
    <Page className="max-w-[1056px] px-4 pb-16 sm:px-6">
      <MyWorlds />
    </Page>
  );
}
