import { Suspense } from "react";
import { Page } from "@/components/ui/page";
import { WorldBuilder } from "./components/WorldBuilder";

export function WorldBuilderPageModule() {
  return (
    <Page className="max-w-[1180px] px-4 pb-28 sm:px-6 lg:pb-16">
      <Suspense>
        <WorldBuilder />
      </Suspense>
    </Page>
  );
}
